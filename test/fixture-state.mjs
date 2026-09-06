/**
 * A fixed State used by the example renderer and by the style tests.
 *
 * Committed rather than fetched so that `npm run examples` is deterministic and
 * works offline, and so a failing example diff means a real rendering change
 * rather than somebody having pushed a commit in the meantime.
 *
 * The repositories are real ones, because a gallery built on lorem never shows
 * you what a genuinely long description does to a layout.
 */

/** Minutes since a push, expressed readably. */
const h = (n) => n * 60;
const d = (n) => n * 24 * 60;

/** @type {number[]} pushes per hour over the last 24, oldest first. */
const HOURLY = [0, 0, 0, 0, 0, 1, 3, 0, 0, 2, 6, 4, 1, 0, 0, 3, 8, 5, 2, 0, 1, 4, 7, 2];

export const fixtureState = Object.freeze({
  user: "OthmanAdi",
  style: "terminal",
  theme: "dark",
  now: {
    name: "margin",
    description: "one-keystroke rating of a running agent, mid-turn, through hooks",
    language: "Rust",
    url: "https://github.com/OthmanAdi/margin",
    lastPushed: "2026-09-06T03:32:00.000Z",
    ageMinutes: h(2) + 14,
  },
  note: "",
  noteBy: "",
  live: false,
  rotation: [
    { name: "chronos", description: "temporal awareness for coding agents", language: "JavaScript", url: "", lastPushed: "", ageMinutes: h(14) },
    { name: "patchbay", description: "per-folder plugin control panel", language: "Rust", url: "", lastPushed: "", ageMinutes: d(2) },
    { name: "nibrun", description: "seven pull requests merged upstream", language: "Rust", url: "", lastPushed: "", ageMinutes: d(3) },
    { name: "vitrine", description: "the sensory layer for web builds", language: "TypeScript", url: "", lastPushed: "", ageMinutes: d(5) },
    { name: "atmen", description: "anti-procrastination sentinel", language: "Rust", url: "", lastPushed: "", ageMinutes: d(6) },
    { name: "plandeck", description: "a live kanban board for long-running agents", language: "TypeScript", url: "", lastPushed: "", ageMinutes: d(9) },
  ],
  stats: { pushesThisWeek: 23, privateContributions: 7, hourly: HOURLY },
  generatedAt: "2026-09-06T05:46:00.000Z",
});

/** The same state, but mid-broadcast, so the live path gets exercised too. */
export const liveState = Object.freeze({
  ...fixtureState,
  note: "refactoring the hook dispatcher so feedback reaches a running turn",
  noteBy: "claude-opus-5",
  live: true,
});

/**
 * Deliberately hostile state, for the security tests. Everything here is the
 * kind of thing a repository description can legally contain.
 */
export const hostileState = Object.freeze({
  ...fixtureState,
  now: {
    ...fixtureState.now,
    name: "<script>alert(1)</script>",
    description: `"><foreignObject><iframe src="javascript:alert(1)"></iframe> ‮gnahc ​ <!ENTITY x SYSTEM "file:///etc/passwd">`,
  },
  rotation: [
    { name: "]]><script>x</script>", description: "<image href=\"http://evil.example/a.png\"/>", language: "&<>\"'", url: "", lastPushed: "", ageMinutes: 60 },
  ],
});

/** A profile with nothing to show: no rotation, no stats, no description. */
export const emptyState = Object.freeze({
  user: "somebody",
  style: "terminal",
  theme: "dark",
  now: { name: "first-repo", description: "", language: "", url: "", lastPushed: "", ageMinutes: 5 },
  note: "", noteBy: "", live: false,
  rotation: [],
  stats: { pushesThisWeek: 0, privateContributions: 0, hourly: new Array(24).fill(0) },
  generatedAt: "2026-09-06T05:46:00.000Z",
});

/** Absurdly long values, to prove truncation and flow keep everything inside. */
export const longState = Object.freeze({
  ...fixtureState,
  now: {
    ...fixtureState.now,
    name: "a-repository-with-an-unreasonably-long-name-that-nobody-should-have-chosen",
    description:
      "a description that simply refuses to stop, going on well past the point where any " +
      "layout could reasonably be expected to accommodate it, precisely so that the " +
      "truncation and the measured row flow both get exercised properly",
    language: "AGS Script",
  },
});
