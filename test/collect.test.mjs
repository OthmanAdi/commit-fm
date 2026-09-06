// @ts-check
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { collect } from '../src/collect.mjs';

// Fixed clock: collect() must only read time through the injected `now`.
const FIXED_NOW_MS = Date.parse('2026-09-06T12:00:00.000Z');
const fixedNow = () => new Date(FIXED_NOW_MS);

/**
 * @param {unknown} body
 * @param {{status?: number, headers?: Record<string,string>}} [init]
 * @returns {Response}
 */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('collect: conditional requests and total failure', () => {
  test('a 304 on the events endpoint returns notModified:true and reads no body', async () => {
    const fetchImpl = async (url) => {
      assert.match(String(url), /\/events\/public/);
      return new Response(null, { status: 304 });
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.deepEqual(result, { notModified: true });
  });

  test('sends If-None-Match when an etag from a previous run is supplied', async () => {
    /** @type {Record<string,string>|undefined} */
    let capturedHeaders;
    const fetchImpl = async (url, opts) => {
      capturedHeaders = /** @type {Record<string,string>} */ (opts.headers);
      return new Response(null, { status: 304 });
    };

    const result = await collect({ user: 'octocat', etag: '"abc123"', fetchImpl, now: fixedNow });

    assert.equal(capturedHeaders?.['If-None-Match'], '"abc123"');
    assert.deepEqual(result, { notModified: true });
  });

  test('a thrown network error returns failed:true instead of throwing', async () => {
    const fetchImpl = async () => {
      throw new Error('simulated DNS failure');
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.deepEqual(result, { failed: true });
  });

  test('a non-ok, non-304 response on the primary request returns failed:true instead of throwing', async () => {
    const fetchImpl = async () => new Response('service unavailable', { status: 503 });

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.deepEqual(result, { failed: true });
  });

  test('an empty or missing user short-circuits to failed:true without making a request', async () => {
    const fetchImpl = async () => {
      throw new Error('must not be called');
    };

    const result = await collect({ user: '', fetchImpl, now: fixedNow });

    assert.deepEqual(result, { failed: true });
  });
});

describe('collect: tolerating a single bad repo', () => {
  test('a 404 on one repo detail request falls back to an empty description/language, not a whole-collect failure', async () => {
    const pushEvent = {
      type: 'PushEvent',
      created_at: new Date(FIXED_NOW_MS - 5 * 60_000).toISOString(),
      repo: { name: 'octocat/missing-repo' },
      payload: { size: 2, distinct_size: 2 },
    };
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) {
        return jsonResponse([pushEvent], { headers: { etag: '"events-etag"' } });
      }
      if (u.includes('/repos/octocat/missing-repo')) {
        return new Response('not found', { status: 404 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.equal('failed' in result, false);
    assert.equal('notModified' in result, false);
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].name, 'missing-repo');
    assert.equal(result.repos[0].description, '');
    assert.equal(result.repos[0].language, '');
    assert.equal(result.etag, '"events-etag"');
  });

  test('a network error on one repo detail request also falls back rather than failing the collect', async () => {
    const pushEvent = {
      type: 'PushEvent',
      created_at: new Date(FIXED_NOW_MS - 5 * 60_000).toISOString(),
      repo: { name: 'octocat/flaky-repo' },
      payload: { distinct_size: 1 },
    };
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([pushEvent]);
      if (u.includes('/repos/octocat/flaky-repo')) throw new Error('connection reset');
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.equal('failed' in result, false);
    assert.equal(result.repos[0].description, '');
    assert.equal(result.repos[0].language, '');
  });
});

describe('collect: deriving stats from PushEvents', () => {
  test('builds repos, the 24-slot hourly histogram and pushesThisWeek, and sanitizes API strings', async () => {
    const threeHoursAgo = new Date(FIXED_NOW_MS - 3 * 60 * 60 * 1000).toISOString();
    const fiveMinutesAgo = new Date(FIXED_NOW_MS - 5 * 60 * 1000).toISOString();
    const events = [
      {
        type: 'PushEvent',
        created_at: threeHoursAgo,
        repo: { name: 'octocat/alpha' },
        payload: { size: 3, distinct_size: 2 },
      },
      {
        type: 'PushEvent',
        created_at: fiveMinutesAgo,
        repo: { name: 'octocat/alpha' },
        payload: { size: 1, distinct_size: 1 },
      },
      // Not a PushEvent: must be ignored entirely.
      { type: 'CreateEvent', created_at: fiveMinutesAgo, repo: { name: 'octocat/alpha' } },
    ];
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse(events);
      if (u.includes('/repos/octocat/alpha')) {
        return jsonResponse({ description: 'A <script>evil()</script> repo', language: 'JavaScript' });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.equal(result.repos.length, 1);
    const repo = result.repos[0];
    assert.equal(repo.name, 'alpha');
    assert.equal(repo.url, 'https://github.com/octocat/alpha');
    assert.equal(repo.language, 'JavaScript');
    assert.equal(repo.ageMinutes, 5, 'ageMinutes must reflect the most recent of the two pushes');
    assert.ok(!repo.description.includes('<script'), 'raw markup must never survive into description');
    assert.ok(repo.description.includes('&lt;script'), 'description must be XML-escaped');

    // Two PushEvents, so two pushes. The payload counters are ignored on
    // purpose: GitHub does not send them, so trusting them would report zero.
    assert.equal(result.stats.pushesThisWeek, 2);
    assert.equal(result.stats.hourly.length, 24);
    assert.equal(result.stats.hourly[23], 1, 'the current hour bucket (last, oldest-first) gets the recent push');
    assert.equal(result.stats.hourly[20], 1, '3 hours ago lands at index 23 - 3 = 20');
    assert.equal(result.stats.privateContributions, 0, 'no token means no GraphQL call, count stays 0');
  });

  test('counts one per push and ignores size, which GitHub does not actually send', async () => {
    // Verified against the live API on 2026-09-06: a real PushEvent payload
    // carries only before, head, push_id, ref and repository_id. size and
    // distinct_size are documented as optional and come back absent, so any
    // arithmetic on them silently produces zero. One push counts as one push,
    // whether or not a counter happens to be present.
    const events = [
      {
        type: 'PushEvent',
        created_at: new Date(FIXED_NOW_MS - 10 * 60_000).toISOString(),
        repo: { name: 'octocat/beta' },
        payload: { size: 4 },
      },
      {
        type: 'PushEvent',
        created_at: new Date(FIXED_NOW_MS - 20 * 60_000).toISOString(),
        repo: { name: 'octocat/beta' },
        payload: { before: 'a', head: 'b', push_id: 1, ref: 'refs/heads/main', repository_id: 2 },
      },
    ];
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse(events);
      if (u.includes('/repos/octocat/beta')) return jsonResponse({ description: null, language: null });
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.equal(result.stats.pushesThisWeek, 2);
    assert.equal(result.repos[0].description, '');
    assert.equal(result.repos[0].language, '');
  });
});

describe('collect: rate limit budget', () => {
  test('stops fetching repo details once x-ratelimit-remaining is at or below the safety floor', async () => {
    let repoDetailCalls = 0;
    const events = [1, 2, 3].map((n) => ({
      type: 'PushEvent',
      created_at: new Date(FIXED_NOW_MS - n * 60_000).toISOString(),
      repo: { name: `octocat/repo-${n}` },
      payload: { distinct_size: 1 },
    }));
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) {
        return jsonResponse(events, { headers: { 'x-ratelimit-remaining': '5' } });
      }
      if (u.includes('/repos/octocat/repo-')) {
        repoDetailCalls += 1;
        return jsonResponse({ description: 'should never be reached', language: 'X' });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.equal(repoDetailCalls, 0, 'no repo-detail request should fire once remaining is at the floor');
    for (const repo of result.repos) {
      assert.equal(repo.description, '');
      assert.equal(repo.language, '');
    }
  });
});

describe('collect: headers', () => {
  test('sends the required Accept/version/User-Agent headers, and Authorization only with a token', async () => {
    /** @type {Record<string,string>|undefined} */
    let withoutToken;
    await collect({
      user: 'octocat',
      fetchImpl: async (url, opts) => {
        withoutToken = /** @type {Record<string,string>} */ (opts.headers);
        return jsonResponse([]);
      },
      now: fixedNow,
    });
    assert.equal(withoutToken?.Accept, 'application/vnd.github+json');
    assert.equal(withoutToken?.['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(withoutToken?.['User-Agent']);
    assert.equal('Authorization' in (withoutToken ?? {}), false);

    /** @type {Record<string,string>|undefined} */
    let withToken;
    await collect({
      user: 'octocat',
      token: 'secret-token',
      fetchImpl: async (url, opts) => {
        withToken = /** @type {Record<string,string>} */ (opts.headers);
        return jsonResponse([]);
      },
      now: fixedNow,
    });
    assert.equal(withToken?.Authorization, 'Bearer secret-token');
  });
});

describe('collect: private contributions', () => {
  test('without a token, GraphQL is never called and the count stays 0', async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([]);
      if (u.includes('/graphql')) throw new Error('must not call GraphQL without a token');
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', fetchImpl, now: fixedNow });

    assert.equal(result.stats.privateContributions, 0);
  });

  test('with a token, a successful GraphQL response supplies the aggregate count', async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([]);
      if (u.includes('/graphql')) {
        return jsonResponse({
          data: { user: { contributionsCollection: { restrictedContributionsCount: 7 } } },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', token: 'tkn', fetchImpl, now: fixedNow });

    assert.equal(result.stats.privateContributions, 7);
  });

  test('any GraphQL failure (bad status, errors array, network throw) returns 0 rather than throwing', async () => {
    const badStatusFetch = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([]);
      if (u.includes('/graphql')) return new Response('nope', { status: 500 });
      throw new Error(`unexpected fetch: ${u}`);
    };
    const badStatusResult = await collect({ user: 'octocat', token: 'tkn', fetchImpl: badStatusFetch, now: fixedNow });
    assert.equal(badStatusResult.stats.privateContributions, 0);

    const errorsArrayFetch = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([]);
      if (u.includes('/graphql')) return jsonResponse({ errors: [{ message: 'nope' }] });
      throw new Error(`unexpected fetch: ${u}`);
    };
    const errorsArrayResult = await collect({ user: 'octocat', token: 'tkn', fetchImpl: errorsArrayFetch, now: fixedNow });
    assert.equal(errorsArrayResult.stats.privateContributions, 0);

    const throwingFetch = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([]);
      if (u.includes('/graphql')) throw new Error('connection reset');
      throw new Error(`unexpected fetch: ${u}`);
    };
    const throwingResult = await collect({ user: 'octocat', token: 'tkn', fetchImpl: throwingFetch, now: fixedNow });
    assert.equal(throwingResult.stats.privateContributions, 0);
  });

  test('never attempts to name a private repository: the field is a bare count', async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/events/public')) return jsonResponse([]);
      if (u.includes('/graphql')) {
        return jsonResponse({
          data: { user: { contributionsCollection: { restrictedContributionsCount: 3 } } },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await collect({ user: 'octocat', token: 'tkn', fetchImpl, now: fixedNow });

    assert.equal(typeof result.stats.privateContributions, 'number');
    assert.equal(result.repos.length, 0, 'no repo objects are fabricated for private contributions');
  });
});
