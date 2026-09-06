// @ts-check
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildState, loadConfig, resolveTheme } from '../src/state.mjs';

// Fixed clock for every test: buildState must never read the real clock
// except through the injected `now`, so every assertion below is anchored
// to this exact instant and stays correct no matter when the suite runs.
const FIXED_NOW_MS = Date.parse('2026-09-06T12:00:00.000Z');
const fixedNow = () => new Date(FIXED_NOW_MS);

/**
 * @param {string} name
 * @param {number} ageMinutes
 * @param {object} [overrides]
 */
function makeRepo(name, ageMinutes, overrides = {}) {
  return {
    name,
    description: `${name} description`,
    language: 'JavaScript',
    url: `https://github.com/test-user/${name}`,
    lastPushed: new Date(FIXED_NOW_MS - ageMinutes * 60_000).toISOString(),
    ageMinutes,
    ...overrides,
  };
}

/**
 * @param {string[]} names
 */
function names(repos) {
  return repos.map((r) => r.name);
}

describe('buildState: broadcast staleness and live', () => {
  test('a fresh broadcast promotes its named repo to now, even when it is not the freshest', async () => {
    const repos = [makeRepo('freshest', 1), makeRepo('broadcast-target', 500), makeRepo('other', 1000)];
    const config = {
      user: 'octocat',
      style: 'terminal',
      theme: 'dark',
      broadcast: {
        repo: 'broadcast-target',
        note: 'refactoring the hook dispatcher',
        by: 'claude-opus-5',
        at: new Date(FIXED_NOW_MS - 5 * 60_000).toISOString(),
        ttlMinutes: 90,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.now.name, 'broadcast-target');
    assert.equal(state.live, true);
    assert.equal(state.note, 'refactoring the hook dispatcher');
    assert.equal(state.noteBy, 'claude-opus-5');
    // Everything else falls back to plain freshest-first for rotation.
    assert.deepEqual(names(state.rotation), ['freshest', 'other']);
  });

  test('an expired broadcast is ignored entirely; derived data takes over', async () => {
    const repos = [makeRepo('freshest', 1), makeRepo('broadcast-target', 500)];
    const config = {
      broadcast: {
        repo: 'broadcast-target',
        note: 'three weeks stale',
        by: 'someone',
        at: new Date(FIXED_NOW_MS - 200 * 60_000).toISOString(), // 200 minutes ago
        ttlMinutes: 90, // expires 90 minutes after "at" -> long expired by now
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.live, false);
    assert.equal(state.note, '');
    assert.equal(state.noteBy, '');
    assert.equal(state.now.name, 'freshest', 'now must fall back to pure freshest-first');
  });

  test('a broadcast naming a repo with no matching known repo still sets note/live, but now falls back to freshest', async () => {
    const repos = [makeRepo('freshest', 1), makeRepo('other', 5)];
    const config = {
      broadcast: {
        repo: 'does-not-exist-anywhere',
        note: 'ghost repo',
        by: 'agent',
        at: new Date(FIXED_NOW_MS - 1_000).toISOString(),
        ttlMinutes: 90,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.live, true);
    assert.equal(state.note, 'ghost repo');
    assert.equal(state.now.name, 'freshest');
  });

  test('ttlMinutes below 1 is clamped up to 1', async () => {
    const repos = [makeRepo('only-repo', 5)];
    const config = {
      broadcast: {
        repo: 'only-repo',
        note: 'clamped low',
        by: 'agent',
        at: new Date(FIXED_NOW_MS - 30_000).toISOString(), // 30 seconds ago
        // Unclamped, -100 minutes would already be deep in the past (stale).
        // Clamped to the minimum of 1, it expires 1 minute after "at",
        // which is 30 seconds from now: still fresh.
        ttlMinutes: -100,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.live, true, 'ttlMinutes must clamp up to 1, not stay negative');
  });

  test('ttlMinutes above 1440 is clamped down to 1440', async () => {
    const repos = [makeRepo('only-repo', 5)];
    // 1440 minutes and 1 second ago: with the ttl correctly capped at 1440,
    // this broadcast expired exactly one second ago. Left uncapped at
    // 999999 minutes it would still be wildly fresh, so this only passes
    // if the cap was actually applied.
    const atMs = FIXED_NOW_MS - 1440 * 60_000 - 1_000;
    const config = {
      broadcast: {
        repo: 'only-repo',
        note: 'clamped high',
        by: 'agent',
        at: new Date(atMs).toISOString(),
        ttlMinutes: 999_999,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.live, false, 'ttlMinutes must clamp down to 1440, not stay at 999999');
  });
});

describe('buildState: pin, exclude, rotation', () => {
  test('exclude removes the now repo and promotes the next freshest candidate', async () => {
    const repos = [makeRepo('a', 1), makeRepo('b', 2), makeRepo('c', 3)];
    const config = { exclude: ['a'] };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.now.name, 'b');
    assert.deepEqual(names(state.rotation), ['c']);
    const everywhere = [state.now.name, ...names(state.rotation)];
    assert.ok(!everywhere.includes('a'), 'an excluded repo must not appear anywhere in the output');
  });

  test('exclude can remove a broadcast-promoted now repo too, falling back to next freshest', async () => {
    const repos = [makeRepo('a', 1), makeRepo('b', 2), makeRepo('c', 3)];
    const config = {
      exclude: ['b'],
      broadcast: {
        repo: 'b',
        note: 'working on b',
        by: 'agent',
        at: new Date(FIXED_NOW_MS - 1_000).toISOString(),
        ttlMinutes: 90,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    // b was promoted by the broadcast, then excluded: next in the same
    // (broadcast-first, then freshest) order is "a".
    assert.equal(state.now.name, 'a');
    assert.ok(!names(state.rotation).includes('b'));
  });

  test('pin entries come first in rotation, ahead of fresher unpinned repos, but never affect now', async () => {
    const repos = [makeRepo('freshest', 1), makeRepo('pinned-stale', 50), makeRepo('mid', 2)];
    const config = { pin: ['pinned-stale'] };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.now.name, 'freshest', 'pin must never override the freshest-first now choice');
    assert.deepEqual(names(state.rotation), ['pinned-stale', 'mid']);
  });

  test('rotation holds at most 8 repos and never contains the now repo', async () => {
    const repos = Array.from({ length: 10 }, (_, i) => makeRepo(`repo-${i}`, i + 1));
    const config = {};

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.equal(state.now.name, 'repo-0');
    assert.equal(state.rotation.length, 8);
    assert.ok(!names(state.rotation).includes('repo-0'));
    assert.deepEqual(
      names(state.rotation),
      ['repo-1', 'repo-2', 'repo-3', 'repo-4', 'repo-5', 'repo-6', 'repo-7', 'repo-8'],
    );
    assert.ok(!names(state.rotation).includes('repo-9'), 'the 10th repo is dropped by the cap, not silently kept');
  });

  test('with no known repos at all, now is a safe empty placeholder and rotation is empty', async () => {
    const config = {};
    const state = await buildState({ config, derived: { repos: [], stats: {} }, now: fixedNow });

    assert.equal(state.now.name, '');
    assert.deepEqual(state.rotation, []);
  });
});

describe('buildState: determinism', () => {
  test('calling buildState twice with identical input yields deep-equal output', async () => {
    const repos = [makeRepo('a', 1), makeRepo('b', 2), makeRepo('c', 3)];
    const config = {
      user: 'octocat',
      style: 'winamp',
      theme: 'dark',
      pin: ['b'],
      exclude: [],
      broadcast: {
        repo: 'c',
        note: 'shipping the thing',
        by: 'claude-opus-5',
        at: new Date(FIXED_NOW_MS - 1_000).toISOString(),
        ttlMinutes: 30,
      },
    };
    const derived = {
      repos,
      stats: { pushesThisWeek: 4, privateContributions: 2, hourly: new Array(24).fill(0) },
    };

    const first = await buildState({ config, derived, now: fixedNow });
    const second = await buildState({ config, derived, now: fixedNow });

    assert.deepEqual(first, second);
  });
});

describe('buildState: sanitization boundary', () => {
  test('config strings (user, style, noteBy) are run through sanitizeIdent, not passed through raw', async () => {
    const repos = [makeRepo('a', 1)];
    const config = {
      user: 'oct/o cat!!',
      style: 'terminal<script>',
      broadcast: {
        note: 'hi',
        by: 'agent"; drop',
        at: new Date(FIXED_NOW_MS - 1_000).toISOString(),
        ttlMinutes: 30,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.ok(!state.user.includes('/'));
    assert.ok(!state.user.includes(' '));
    assert.ok(!state.style.includes('<'));
    assert.ok(!state.noteBy.includes('"'));
    assert.ok(!state.noteBy.includes(' '));
  });

  test('a broadcast note is escaped for safe SVG text embedding', async () => {
    const repos = [makeRepo('a', 1)];
    const config = {
      broadcast: {
        note: '<script>alert(1)</script>',
        by: 'agent',
        at: new Date(FIXED_NOW_MS - 1_000).toISOString(),
        ttlMinutes: 30,
      },
    };

    const state = await buildState({ config, derived: { repos, stats: {} }, now: fixedNow });

    assert.ok(!state.note.includes('<script'));
    assert.ok(state.note.includes('&lt;script'));
  });
});

describe('resolveTheme', () => {
  test('passes light and dark through unchanged', () => {
    assert.equal(resolveTheme('light'), 'light');
    assert.equal(resolveTheme('dark'), 'dark');
  });

  test('resolves auto and any invalid value to the same deterministic default', () => {
    const autoResolved = resolveTheme('auto');
    assert.ok(autoResolved === 'light' || autoResolved === 'dark');
    assert.equal(resolveTheme('auto'), autoResolved);
    assert.equal(resolveTheme(undefined), autoResolved);
    assert.equal(resolveTheme('not-a-real-theme'), autoResolved);
  });
});

describe('loadConfig', () => {
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'commit-fm-state-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns sensible defaults when the file does not exist', () => {
    const cfg = loadConfig(join(tmpDir, 'does-not-exist.json'));

    assert.equal(cfg.user, '');
    assert.equal(cfg.style, 'terminal');
    assert.equal(cfg.theme, 'auto');
    assert.deepEqual(cfg.exclude, []);
    assert.deepEqual(cfg.pin, []);
    assert.equal(cfg.broadcast, null);
  });

  test('returns sensible defaults when the file contains invalid JSON, without throwing', () => {
    const path = join(tmpDir, 'invalid.json');
    writeFileSync(path, '{ this is not json ', 'utf8');

    assert.doesNotThrow(() => loadConfig(path));
    const cfg = loadConfig(path);
    assert.equal(cfg.style, 'terminal');
  });

  test('returns sensible defaults when the file holds a JSON array instead of an object', () => {
    const path = join(tmpDir, 'array.json');
    writeFileSync(path, '[1, 2, 3]', 'utf8');

    const cfg = loadConfig(path);
    assert.equal(cfg.style, 'terminal');
    assert.deepEqual(cfg.pin, []);
  });

  test('ignores unknown top level keys without error', () => {
    const path = join(tmpDir, 'unknown-keys.json');
    writeFileSync(
      path,
      JSON.stringify({ user: 'octocat', totallyMadeUpKey: 'boo', $schema: 'whatever' }),
      'utf8',
    );

    const cfg = loadConfig(path);
    assert.equal(cfg.user, 'octocat');
    assert.equal('totallyMadeUpKey' in cfg, false);
    assert.equal('$schema' in cfg, false);
  });

  test('normalizes a well-formed broadcast block', () => {
    const path = join(tmpDir, 'broadcast.json');
    writeFileSync(
      path,
      JSON.stringify({
        broadcast: { repo: 'margin', note: 'x', by: 'y', at: '2026-09-06T06:10:00Z', ttlMinutes: 45 },
      }),
      'utf8',
    );

    const cfg = loadConfig(path);
    assert.deepEqual(cfg.broadcast, {
      repo: 'margin',
      note: 'x',
      by: 'y',
      at: '2026-09-06T06:10:00Z',
      ttlMinutes: 45,
    });
  });

  test('a malformed broadcast block (wrong type) normalizes to null rather than throwing', () => {
    const path = join(tmpDir, 'broadcast-wrong-type.json');
    writeFileSync(path, JSON.stringify({ broadcast: 'not an object' }), 'utf8');

    const cfg = loadConfig(path);
    assert.equal(cfg.broadcast, null);
  });
});
