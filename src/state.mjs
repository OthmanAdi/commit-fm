// @ts-check
/**
 * Builds the single State object every style module renders.
 *
 * State is produced here and only here: it merges the human-authored control
 * surface (commitfm.json, loaded by loadConfig) with the derived facts
 * collected from GitHub (produced by collect.mjs), and resolves every
 * selection rule (broadcast staleness, pin, exclude, rotation cap) into one
 * deterministic, already-sanitized object. Style modules stay pure functions
 * of this object; nothing here reads the network or the clock except through
 * the injected `now` function.
 */

import { readFileSync } from 'node:fs';
import { sanitizeText, sanitizeIdent } from './sanitize.mjs';

/**
 * @typedef {object} Repo
 * @property {string} name          "margin"
 * @property {string} description   already sanitized, already length capped
 * @property {string} language      "Rust", or "" when unknown
 * @property {string} url
 * @property {string} lastPushed    ISO 8601
 * @property {number} ageMinutes    minutes since lastPushed, computed once
 */

/**
 * @typedef {object} Stats
 * @property {number} pushesThisWeek
 * @property {number} privateContributions  0 unless the user opted in
 * @property {number[]} hourly  24 numbers, pushes per hour, oldest first
 */

/**
 * @typedef {object} State
 * @property {string}  user
 * @property {string}  style        one of the seven ids
 * @property {"light"|"dark"} theme resolved, never "auto" by the time a style sees it
 * @property {Repo}    now          the repo currently playing
 * @property {string}  note         "" when there is no live broadcast
 * @property {string}  noteBy       "" or the agent id that wrote it
 * @property {boolean} live         true only when a broadcast note is present and fresh
 * @property {Repo[]}  rotation     0 to 8 more repos, freshest first
 * @property {Stats}   stats
 * @property {string}  generatedAt  ISO 8601
 */

/**
 * @typedef {object} BroadcastConfig
 * @property {string} [repo]
 * @property {string} [note]
 * @property {string} [by]
 * @property {string} [at]           ISO 8601
 * @property {number} [ttlMinutes]
 */

/**
 * @typedef {object} Config
 * @property {string} [user]
 * @property {string} [style]
 * @property {string} [theme]        "light" | "dark" | "auto"
 * @property {string[]} [exclude]
 * @property {string[]} [pin]
 * @property {BroadcastConfig|null} [broadcast]
 */

/**
 * @typedef {object} DerivedStats
 * @property {number} [pushesThisWeek]
 * @property {number} [privateContributions]
 * @property {number[]} [hourly]
 */

/**
 * @typedef {object} Derived
 * @property {Repo[]} [repos]   repos pushed to, any order; buildState sorts freshest first
 * @property {DerivedStats} [stats]
 */

const ROTATION_MAX = 8;
const NOTE_MAX_GRAPHEMES = 120;
// Must match collect.mjs: the same value applied at both sanitisation layers,
// so re-sanitising an already-collected repo is a no-op rather than a second cut.
const DESCRIPTION_MAX_GRAPHEMES = 140;
const LANGUAGE_MAX_GRAPHEMES = 40;
const BROADCAST_TTL_DEFAULT_MINUTES = 90;
const BROADCAST_TTL_MIN_MINUTES = 1;
const BROADCAST_TTL_MAX_MINUTES = 1440;
const DEFAULT_STYLE = 'terminal';

/**
 * sanitizeText rejects a null byte by throwing rather than stripping it (see
 * sanitize.mjs). A broadcast note is written by a human or an unsupervised
 * agent editing commitfm.json; malformed content there is exactly the
 * "invalid config" case this module treats as absent rather than fatal.
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

const EMPTY_REPO = Object.freeze({
  name: '',
  description: '',
  language: '',
  url: '',
  lastPushed: '',
  ageMinutes: 0,
});

/**
 * Default config, returned whenever the file is missing, unreadable or not
 * a JSON object. Never throws.
 * @returns {Required<Pick<Config, 'user'|'style'|'theme'|'exclude'|'pin'>> & {broadcast: null}}
 */
function defaultConfig() {
  return {
    user: '',
    style: DEFAULT_STYLE,
    theme: 'auto',
    exclude: [],
    pin: [],
    broadcast: null,
  };
}

/**
 * Loads and normalizes commitfm.json from disk. Unknown top level keys are
 * dropped (only the known control-surface keys survive). A missing file, an
 * unreadable file, invalid JSON, or JSON that is not an object all resolve
 * to sensible defaults rather than throwing.
 *
 * @param {string} path
 * @returns {Config}
 */
export function loadConfig(path) {
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return defaultConfig();
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultConfig();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultConfig();
  }

  const obj = /** @type {Record<string, unknown>} */ (parsed);
  const defaults = defaultConfig();

  return {
    user: typeof obj.user === 'string' ? obj.user : defaults.user,
    style: typeof obj.style === 'string' && obj.style ? obj.style : defaults.style,
    theme: typeof obj.theme === 'string' ? obj.theme : defaults.theme,
    exclude: normalizeStringArray(obj.exclude),
    pin: normalizeStringArray(obj.pin),
    broadcast: normalizeBroadcastShape(obj.broadcast),
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string');
}

/**
 * @param {unknown} value
 * @returns {BroadcastConfig|null}
 */
function normalizeBroadcastShape(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  return {
    repo: typeof obj.repo === 'string' ? obj.repo : '',
    note: typeof obj.note === 'string' ? obj.note : '',
    by: typeof obj.by === 'string' ? obj.by : '',
    at: typeof obj.at === 'string' ? obj.at : '',
    ttlMinutes: typeof obj.ttlMinutes === 'number' ? obj.ttlMinutes : BROADCAST_TTL_DEFAULT_MINUTES,
  };
}

/**
 * Resolves a config theme string to a concrete theme a style module can
 * render. "auto" has no OS or browser signal available at generation time
 * (this runs headless in a GitHub Action), so it and any other unrecognized
 * value fall back to the same deterministic default every time. A caller
 * that wants both variants (the `<picture>` + prefers-color-scheme pattern)
 * renders twice, passing "light" and "dark" explicitly.
 *
 * @param {unknown} theme
 * @returns {"light"|"dark"}
 */
export function resolveTheme(theme) {
  if (theme === 'light') return 'light';
  return 'dark';
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
  if (typeof n !== 'number' || Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolves the raw broadcast config against the clock, applying ttl
 * clamping and staleness. Returns null when there is no broadcast, the
 * broadcast has no parseable `at`, or it has already expired: in every one
 * of those cases the banner falls back to derived data entirely.
 *
 * @param {BroadcastConfig|null|undefined} raw
 * @param {Date} nowDate
 * @returns {{repo: string, note: string, by: string, at: string, ttlMinutes: number}|null}
 */
function resolveBroadcast(raw, nowDate) {
  if (!raw || typeof raw !== 'object') return null;

  const atMs = typeof raw.at === 'string' ? Date.parse(raw.at) : NaN;
  if (Number.isNaN(atMs)) return null;

  const rawTtl = typeof raw.ttlMinutes === 'number' ? raw.ttlMinutes : BROADCAST_TTL_DEFAULT_MINUTES;
  const ttlMinutes = clamp(rawTtl, BROADCAST_TTL_MIN_MINUTES, BROADCAST_TTL_MAX_MINUTES);
  const expiresAtMs = atMs + ttlMinutes * 60_000;

  if (expiresAtMs <= nowDate.getTime()) return null;

  return {
    repo: typeof raw.repo === 'string' ? raw.repo : '',
    note: typeof raw.note === 'string' ? raw.note : '',
    by: typeof raw.by === 'string' ? raw.by : '',
    at: raw.at ?? '',
    ttlMinutes,
  };
}

/**
 * Freshest-first comparator: smaller ageMinutes (more recently pushed) sorts
 * first. Array.prototype.sort is stable (ES2019+), so ties keep their
 * original relative order, which keeps the whole pipeline deterministic.
 *
 * @param {Repo} a
 * @param {Repo} b
 * @returns {number}
 */
function byFreshest(a, b) {
  return a.ageMinutes - b.ageMinutes;
}

/**
 * Deduplicates repos by name, keeping the freshest (lowest ageMinutes)
 * instance of each name. Defensive: collect.mjs already caches per unique
 * repo, but state.mjs never trusts an upstream invariant it can cheaply
 * re-check.
 *
 * @param {Repo[]} repos
 * @returns {Repo[]}
 */
function dedupeRepos(repos) {
  /** @type {Map<string, Repo>} */
  const byName = new Map();
  for (const raw of repos) {
    if (!raw || typeof raw !== 'object') continue;
    // Re-sanitize here even though collect.mjs already did it at ingest.
    // buildState is a public entry point: anything that assembles a `derived`
    // object by hand, a test, a future importer, a caller reading a cached
    // file, would otherwise hand unsanitized text straight to a style. Both
    // sanitizeText and the escaping it performs are idempotent, so paying for
    // it twice costs nothing and removes the assumption entirely.
    const repo = {
      ...raw,
      name: sanitizeIdent(raw.name),
      description: safeSanitizeText(raw.description, { maxGraphemes: DESCRIPTION_MAX_GRAPHEMES }),
      language: safeSanitizeText(raw.language, { maxGraphemes: LANGUAGE_MAX_GRAPHEMES }),
    };
    const existing = byName.get(repo.name);
    if (!existing || repo.ageMinutes < existing.ageMinutes) {
      byName.set(repo.name, repo);
    }
  }
  return [...byName.values()];
}

/**
 * Orders the candidate pool: pinned repos first (freshest first among
 * themselves), then every other repo, freshest first.
 *
 * @param {Repo[]} repos
 * @param {string[]} pin
 * @returns {Repo[]}
 */
function orderByPinThenFreshest(repos, pin) {
  const pinSet = new Set(pin);
  const pinned = repos.filter((r) => pinSet.has(r.name)).sort(byFreshest);
  const rest = repos.filter((r) => !pinSet.has(r.name)).sort(byFreshest);
  return [...pinned, ...rest];
}

/**
 * Builds the complete, deterministic State object for one render.
 *
 * Selection order, exactly as specified:
 *   1. Candidates are deduplicated by name. `now` is chosen from them
 *      freshest first; pin never affects this choice.
 *   2. A fresh broadcast naming a known repo promotes that repo to `now`
 *      instead, even if it is not the freshest. An unresolvable or absent
 *      broadcast repo falls through to the ordinary freshest-first choice,
 *      but the broadcast's note/live/noteBy still apply regardless: those
 *      describe the broadcast itself, not whether its named repo could be
 *      matched.
 *   3. `exclude` is applied last, by exact name match, against both the
 *      `now` pick and the rotation pool. It can remove `now`, in which case
 *      the next candidate in the same freshest-first (or broadcast-first)
 *      order is promoted.
 *   4. `rotation` is everything left after `now` and `exclude`, ordered
 *      pin-first then freshest first, capped at 8.
 *
 * @param {object} params
 * @param {Config} params.config
 * @param {Derived} params.derived
 * @param {() => Date} [params.now]
 * @returns {Promise<State>}
 */
export async function buildState({ config, derived, now = () => new Date() }) {
  const nowDate = now();
  const generatedAt = nowDate.toISOString();

  const cfg = config && typeof config === 'object' ? config : {};
  const user = sanitizeIdent(typeof cfg.user === 'string' ? cfg.user : '');
  const style = sanitizeIdent(typeof cfg.style === 'string' && cfg.style ? cfg.style : DEFAULT_STYLE);
  const theme = resolveTheme(cfg.theme);

  // pin/exclude entries are matched against already-sanitized repo names
  // (collect.mjs runs every repo name through sanitizeIdent), so they are
  // sanitized here too: both sides of an "exact match" must speak the same
  // dialect, and these strings come from commitfm.json like everything else
  // this module is required to sanitize.
  const pin = normalizeStringArray(cfg.pin).map((name) => sanitizeIdent(name));
  const exclude = normalizeStringArray(cfg.exclude).map((name) => sanitizeIdent(name));

  // The profile repository excludes itself by default.
  //
  // On GitHub the repository whose name equals the account name is the one that
  // renders the profile page, so it is the frame around the banner rather than a
  // project worth announcing. Worse, it is self-reinforcing: this tool commits
  // the rendered SVG into that very repository, which makes it the most recently
  // pushed repository, which would make it permanently the thing "now playing".
  // The first live install did exactly that and broadcast "Config files for my
  // GitHub profile" as the current work.
  //
  // Pinning it is the deliberate opt out, for anyone whose profile repository
  // genuinely is the project they want to show.
  const pinSet = new Set(pin);
  if (user && !pinSet.has(user)) exclude.push(user);

  const rawRepos = Array.isArray(derived?.repos) ? derived.repos : [];
  const allRepos = dedupeRepos(rawRepos);
  // Freshest-first order is the baseline for choosing `now`. Pin never
  // influences this choice, only the leftover `rotation` order below: the
  // only thing that can override freshest-first for `now` is a fresh
  // broadcast naming a specific repo.
  const freshestOrder = [...allRepos].sort(byFreshest);

  const broadcast = resolveBroadcast(cfg.broadcast ?? null, nowDate);

  let note = '';
  let noteBy = '';
  let live = false;
  let nowCandidates = freshestOrder;

  if (broadcast) {
    note = safeSanitizeText(broadcast.note, { maxGraphemes: NOTE_MAX_GRAPHEMES });
    noteBy = sanitizeIdent(broadcast.by);
    live = true;

    if (broadcast.repo) {
      const broadcastRepoName = sanitizeIdent(broadcast.repo);
      const promoted = allRepos.find((r) => r.name === broadcastRepoName);
      if (promoted) {
        nowCandidates = [promoted, ...freshestOrder.filter((r) => r !== promoted)];
      }
    }
  }

  // exclude runs last, against whichever candidate order is in play, so it
  // can remove the broadcast pick or the plain freshest pick just the same
  // and let the next candidate in that same order take over.
  const excludeSet = new Set(exclude);
  const survivingNowCandidates = nowCandidates.filter((r) => !excludeSet.has(r.name));
  const nowRepo = survivingNowCandidates.length > 0 ? survivingNowCandidates[0] : EMPTY_REPO;

  // Everything else, pin-first then freshest-first, capped at 8. `now` is
  // excluded by reference (it is one specific object drawn from allRepos,
  // or the EMPTY_REPO singleton when there were no candidates at all).
  const remaining = allRepos.filter((r) => r !== nowRepo && !excludeSet.has(r.name));
  const rotation = orderByPinThenFreshest(remaining, pin).slice(0, ROTATION_MAX);

  const derivedStats = derived && typeof derived === 'object' ? derived.stats : undefined;
  const hourly = Array.isArray(derivedStats?.hourly) && derivedStats.hourly.length === 24
    ? derivedStats.hourly
    : new Array(24).fill(0);
  const stats = {
    pushesThisWeek: typeof derivedStats?.pushesThisWeek === 'number' ? derivedStats.pushesThisWeek : 0,
    privateContributions: typeof derivedStats?.privateContributions === 'number' ? derivedStats.privateContributions : 0,
    hourly,
  };

  return {
    user,
    style,
    theme,
    now: nowRepo,
    note,
    noteBy,
    live,
    rotation,
    stats,
    generatedAt,
  };
}
