// @ts-check
/**
 * Turns GitHub's public API into the derived half of the State object
 * (see state.mjs): which repos were pushed to, how recently, a 24-bucket
 * push activity histogram spanning the trailing week, and (with a token) an
 * aggregate private-contribution
 * count. Never throws: every failure mode collapses into one of the three
 * documented return shapes so the caller can decide, without a try/catch of
 * its own, whether to write a file, skip a commit, or exit quietly.
 *
 * Everything here is a pure function of its injected `fetchImpl` and `now`,
 * which is what makes it possible to test fully offline (see
 * test/collect.test.mjs): no global `fetch` call happens unless the caller
 * did not override the default.
 */

import { sanitizeText, sanitizeIdent } from './sanitize.mjs';

/**
 * @typedef {import('./state.mjs').Repo} Repo
 */

/**
 * sanitizeText rejects a null byte by throwing rather than stripping it (see
 * sanitize.mjs). A repo description containing one is malformed input from
 * GitHub, not a reason to take down the whole collect: this falls back to
 * an empty string, the same tolerance already extended to a 404 or 403 on
 * the repo-detail request.
 *
 * @param {string} value
 * @param {{maxGraphemes: number}} options
 * @returns {string}
 */
function safeSanitizeText(value, options) {
  try {
    return sanitizeText(value, options);
  } catch {
    return '';
  }
}

/**
 * @typedef {object} CollectStats
 * @property {number} pushesThisWeek
 * @property {number} privateContributions
 * @property {number[]} hourly  24 numbers, oldest first, one per ~7h bucket
 *   across the trailing week (see HISTOGRAM_BUCKET_MS)
 */

/**
 * @typedef {object} CollectSuccess
 * @property {Repo[]} repos
 * @property {CollectStats} stats
 * @property {string} [etag]  the events endpoint's new ETag, for the caller to persist
 */

/**
 * @typedef {{notModified: true}} CollectNotModified
 */

/**
 * @typedef {{failed: true}} CollectFailed
 */

/**
 * @typedef {CollectSuccess | CollectNotModified | CollectFailed} CollectResult
 */

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'commit-fm (+https://github.com/OthmanAdi/commit-fm)';
const API_VERSION = '2022-11-28';

// GitHub documents up to 300 events across pages; per_page 100 x 3-10 pages
// is generous headroom while the "paginate only as far as needed" rule
// still applies: the loop below stops well before this on a short history.
const MAX_PAGES = 10;
const PER_PAGE = 100;

// Leave headroom rather than spending the budget down to zero: a later step
// in the same run (repo details, GraphQL) still needs a request or two.
const RATE_LIMIT_FLOOR = 5;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOURLY_SLOTS = 24;
// A real push cadence is daily bursts across a handful of repos, not one
// push every single hour, so a window sized in literal hours sits empty 23
// slots out of 24 for almost anyone. The histogram instead spans the same
// week the events are already fetched for (see fetchAllPushEvents), so each
// slot covers WEEK_MS / HOURLY_SLOTS, about 7 hours, and a normal week of
// work fills most of the row instead of one bar.
const HISTOGRAM_BUCKET_MS = WEEK_MS / HOURLY_SLOTS;

// Repo descriptions and languages are free text from the GitHub API; cap
// generously but finitely before sanitizeText enforces it by grapheme.
const DESCRIPTION_MAX_GRAPHEMES = 140;
const LANGUAGE_MAX_GRAPHEMES = 40;

/**
 * @param {string} [token]
 * @param {string} [etag]
 * @returns {Record<string, string>}
 */
function buildHeaders(token, etag) {
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers['If-None-Match'] = etag;
  return headers;
}

/**
 * @param {Record<string, string>} headers
 * @returns {Record<string, string>}
 */
function withoutIfNoneMatch(headers) {
  const { 'If-None-Match': _omit, ...rest } = headers;
  return rest;
}

/**
 * Reads x-ratelimit-remaining off a fetch Response, tolerating fakes that
 * don't implement a real Headers object.
 *
 * @param {Response} resp
 * @param {number} fallback
 * @returns {number}
 */
function readRateRemaining(resp, fallback) {
  const raw = resp && resp.headers && typeof resp.headers.get === 'function'
    ? resp.headers.get('x-ratelimit-remaining')
    : null;
  if (raw === null || raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * @param {object|null|undefined} payload
 * @returns {number}
 */
function pushWeight(payload) {
  // GitHub documents only before, head, push_id, ref and repository_id as
  // guaranteed PushEvent payload fields, and live responses confirm it: size
  // and distinct_size come back absent, so a commit count cannot be derived
  // from this endpoint at all. Every push therefore weighs exactly one, and
  // the banner says "pushes" rather than claiming a commit count it does not
  // have. If GitHub ever populates the counters again, honouring them here
  // would silently mix two units in one number, which is worse than the
  // slightly coarser truth.
  if (!payload) return 0;
  return 1;
}

/**
 * 24 slots, oldest first, each covering HISTOGRAM_BUCKET_MS (about 7 hours),
 * together spanning the trailing week.
 *
 * @param {any[]} pushEvents
 * @param {number} nowMs
 * @returns {number[]}
 */
function computeActivityHistogram(pushEvents, nowMs) {
  const buckets = new Array(HOURLY_SLOTS).fill(0);
  for (const evt of pushEvents) {
    const createdMs = Date.parse(evt?.created_at);
    if (Number.isNaN(createdMs)) continue;
    const bucketsAgo = Math.floor((nowMs - createdMs) / HISTOGRAM_BUCKET_MS);
    if (bucketsAgo < 0 || bucketsAgo >= HOURLY_SLOTS) continue;
    const idx = HOURLY_SLOTS - 1 - bucketsAgo;
    buckets[idx] += pushWeight(evt.payload);
  }
  return buckets;
}

/**
 * @param {any[]} pushEvents
 * @param {number} nowMs
 * @returns {number}
 */
function computePushesThisWeek(pushEvents, nowMs) {
  let total = 0;
  for (const evt of pushEvents) {
    const createdMs = Date.parse(evt?.created_at);
    if (Number.isNaN(createdMs)) continue;
    if (createdMs <= nowMs && nowMs - createdMs <= WEEK_MS) {
      total += pushWeight(evt.payload);
    }
  }
  return total;
}

/**
 * Fetches every page of /users/{user}/events/public needed to cover the
 * lookback window, filtering down to PushEvents as it goes. Throws on a
 * first-page failure (network error or non-ok, non-304 status) so the
 * caller can collapse that into `{failed: true}`; a later page failing
 * just stops pagination and keeps what was already gathered, since partial
 * recent history is still useful and a rate-limit mid-pagination is not a
 * total failure.
 *
 * @param {object} params
 * @param {string} params.user
 * @param {Record<string, string>} params.headers
 * @param {typeof fetch} params.fetchImpl
 * @param {number} params.nowMs
 * @returns {Promise<{notModified: true} | {pushEvents: any[], rateRemaining: number, etag: string|undefined}>}
 */
async function fetchAllPushEvents({ user, headers, fetchImpl, nowMs }) {
  /** @type {any[]} */
  const pushEvents = [];
  let rateRemaining = Infinity;
  /** @type {string|undefined} */
  let newEtag;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${GITHUB_API}/users/${encodeURIComponent(user)}/events/public?per_page=${PER_PAGE}&page=${page}`;
    const reqHeaders = page === 1 ? headers : withoutIfNoneMatch(headers);

    let resp;
    try {
      resp = await fetchImpl(url, { headers: reqHeaders });
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    if (page === 1 && resp.status === 304) {
      return { notModified: true };
    }

    if (!resp.ok) {
      if (page === 1) throw new Error(`GitHub events request failed: ${resp.status}`);
      break;
    }

    rateRemaining = readRateRemaining(resp, rateRemaining);
    if (page === 1) newEtag = resp.headers?.get?.('etag') ?? undefined;

    /** @type {any[]} */
    let batch;
    try {
      batch = await resp.json();
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const evt of batch) {
      if (evt && evt.type === 'PushEvent') pushEvents.push(evt);
    }

    const last = batch[batch.length - 1];
    const lastCreatedMs = last ? Date.parse(last.created_at) : NaN;

    if (batch.length < PER_PAGE) break;
    if (!Number.isNaN(lastCreatedMs) && nowMs - lastCreatedMs > WEEK_MS) break;
    if (rateRemaining <= RATE_LIMIT_FLOOR) break;
  }

  return { pushEvents, rateRemaining, etag: newEtag };
}

/**
 * Fetches description and language for one repo, tolerating any failure
 * (404, 403, network error) by falling back to an empty description and
 * language rather than letting one bad repo take down the whole collect.
 *
 * @param {object} params
 * @param {string} params.fullName  "owner/repo"
 * @param {string} [params.token]
 * @param {typeof fetch} params.fetchImpl
 * @returns {Promise<{description: string, language: string, rateRemaining: number|undefined}>}
 */
async function fetchRepoDetail({ fullName, token, fetchImpl }) {
  try {
    const resp = await fetchImpl(`${GITHUB_API}/repos/${fullName}`, { headers: buildHeaders(token) });
    const rateRemaining = readRateRemaining(resp, undefined);
    if (!resp.ok) {
      return { description: '', language: '', rateRemaining };
    }
    const data = await resp.json();
    return {
      description: typeof data?.description === 'string' ? data.description : '',
      language: typeof data?.language === 'string' ? data.language : '',
      rateRemaining,
    };
  } catch {
    return { description: '', language: '', rateRemaining: undefined };
  }
}

/**
 * Reads the aggregate private-contribution count via GraphQL. Only
 * meaningful with a token (unauthenticated GraphQL is rejected outright by
 * GitHub) and only non-zero when the target user opted into showing private
 * contributions on their own profile. Never names a repository: this field
 * is a server-side aggregate with none attached. Any failure, at any step,
 * returns 0 rather than throwing.
 *
 * @param {object} params
 * @param {string} params.user
 * @param {string} params.token
 * @param {typeof fetch} params.fetchImpl
 * @returns {Promise<number>}
 */
async function fetchPrivateContributions({ user, token, fetchImpl, now = () => new Date() }) {
  try {
    // Bound the window to the same seven days the rest of the banner talks
    // about. Without `from`, contributionsCollection defaults to the past year,
    // and a real account came back with "+5962 private" sitting next to a
    // weekly commit count, which is both meaningless and faintly ridiculous.
    const from = new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const query = `query($login: String!, $from: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from) {
          restrictedContributionsCount
        }
      }
    }`;
    const resp = await fetchImpl(`${GITHUB_API}/graphql`, {
      method: 'POST',
      headers: {
        ...buildHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { login: user, from } }),
    });
    if (!resp.ok) return 0;
    const json = await resp.json();
    if (!json || json.errors) return 0;
    const count = json?.data?.user?.contributionsCollection?.restrictedContributionsCount;
    return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0;
  } catch {
    return 0;
  }
}

/**
 * Collects the derived half of the State object from GitHub's REST and
 * GraphQL APIs.
 *
 * @param {object} params
 * @param {string} params.user
 * @param {string} [params.token]
 * @param {typeof fetch} [params.fetchImpl]
 * @param {() => Date} [params.now]
 * @param {string} [params.etag]  from a previous run, for a conditional request
 * @returns {Promise<CollectResult>}
 */
export async function collect({ user, token, fetchImpl = fetch, now = () => new Date(), etag } = {}) {
  if (!user || typeof user !== 'string') {
    return { failed: true };
  }

  const nowMs = now().getTime();
  const headers = buildHeaders(token, etag);

  /** @type {Awaited<ReturnType<typeof fetchAllPushEvents>>} */
  let eventsResult;
  try {
    eventsResult = await fetchAllPushEvents({ user, headers, fetchImpl, nowMs });
  } catch {
    return { failed: true };
  }

  if ('notModified' in eventsResult) {
    return { notModified: true };
  }

  const { pushEvents, rateRemaining: rateAfterEvents, etag: newEtag } = eventsResult;

  const hourly = computeActivityHistogram(pushEvents, nowMs);
  const pushesThisWeek = computePushesThisWeek(pushEvents, nowMs);

  /** @type {Map<string, number>} full name -> most recent push, ms epoch */
  const lastPushedMsByRepo = new Map();
  for (const evt of pushEvents) {
    const fullName = evt?.repo?.name;
    if (typeof fullName !== 'string' || !fullName.includes('/')) continue;
    const createdMs = Date.parse(evt.created_at);
    if (Number.isNaN(createdMs)) continue;
    const existing = lastPushedMsByRepo.get(fullName);
    if (existing === undefined || createdMs > existing) {
      lastPushedMsByRepo.set(fullName, createdMs);
    }
  }

  /** @type {Map<string, {description: string, language: string}>} */
  const detailByRepo = new Map();
  let rateRemaining = rateAfterEvents;
  for (const fullName of lastPushedMsByRepo.keys()) {
    if (rateRemaining <= RATE_LIMIT_FLOOR) {
      detailByRepo.set(fullName, { description: '', language: '' });
      continue;
    }
    const detail = await fetchRepoDetail({ fullName, token, fetchImpl });
    if (typeof detail.rateRemaining === 'number') rateRemaining = detail.rateRemaining;
    detailByRepo.set(fullName, { description: detail.description, language: detail.language });
  }

  const repos = [...lastPushedMsByRepo.entries()].map(([fullName, lastPushedMs]) => {
    const [ownerRaw, repoRaw] = fullName.split('/');
    const owner = sanitizeIdent(ownerRaw ?? '');
    const name = sanitizeIdent(repoRaw ?? '');
    const detail = detailByRepo.get(fullName) ?? { description: '', language: '' };
    const ageMinutes = Math.max(0, Math.floor((nowMs - lastPushedMs) / 60_000));
    return {
      name,
      description: safeSanitizeText(detail.description, { maxGraphemes: DESCRIPTION_MAX_GRAPHEMES }),
      language: safeSanitizeText(detail.language, { maxGraphemes: LANGUAGE_MAX_GRAPHEMES }),
      url: `https://github.com/${owner}/${name}`,
      lastPushed: new Date(lastPushedMs).toISOString(),
      ageMinutes,
    };
  });

  let privateContributions = 0;
  if (token) {
    privateContributions = await fetchPrivateContributions({ user, token, fetchImpl, now });
  }

  return {
    repos,
    stats: { pushesThisWeek, privateContributions, hourly },
    etag: newEtag,
  };
}
