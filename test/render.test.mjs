/**
 * Render boundary tests.
 *
 * These are the tests that stand between a style module and somebody's public
 * profile. They assert three things a reviewer should be able to take on trust:
 * every style renders for every shape of input, the output never carries active
 * content even when the input is hostile, and the same state always produces
 * the same bytes.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { render, listStyles, STYLE_IDS, DEFAULT_STYLE, STYLES } from "../src/index.mjs";
import { FORBIDDEN_SVG_TOKENS } from "../src/sanitize.mjs";
import { fixtureState, liveState, emptyState, longState, hostileState } from "./fixture-state.mjs";

/**
 * Cases that reach a style through the ordinary pipeline, where `buildState`
 * has already sanitized every untrusted string.
 */
const CASES = {
  fixture: fixtureState,
  live: liveState,
  empty: emptyState,
  long: longState,
};

/**
 * The styles whose description is placed as static text and must therefore be
 * cut to the space available.
 *
 * The marquee styles are deliberately absent: each puts the description in a
 * scroller, whose whole job is to carry text wider than the window and reveal
 * it over time. Truncating a marquee would defeat the point of having one.
 */
const TRUNCATING_STYLES = ["terminal", "splitflap", "vumeter", "vinyl"];
const MARQUEE_STYLES = ["dotmatrix", "carradio", "winamp"];

test("every style id resolves to a module with a render function and metadata", () => {
  assert.equal(STYLE_IDS.length, 7);
  for (const id of STYLE_IDS) {
    assert.equal(typeof STYLES[id].render, "function", `${id} has no render`);
    assert.equal(STYLES[id].meta.id, id, `${id} meta id does not match its key`);
    assert.ok(STYLES[id].meta.name, `${id} has no display name`);
    assert.ok(STYLES[id].meta.blurb, `${id} has no blurb`);
  }
  assert.ok(STYLE_IDS.includes(DEFAULT_STYLE));
  assert.equal(listStyles().length, 7);
});

test("every style renders a complete SVG for every case and theme", () => {
  for (const id of STYLE_IDS) {
    for (const [caseName, state] of Object.entries(CASES)) {
      for (const theme of ["dark", "light"]) {
        const svg = render({ ...state, style: id, theme });
        const where = `${id}/${caseName}/${theme}`;
        assert.ok(svg.startsWith("<svg "), `${where} does not open with an svg element`);
        assert.ok(svg.endsWith("</svg>"), `${where} does not close its svg element`);
        assert.ok(svg.includes('width="800"'), `${where} lost its width`);
        assert.ok(svg.includes('height="200"'), `${where} lost its height`);
        assert.ok(svg.includes("<title>"), `${where} has no title for screen readers`);
        assert.ok(svg.includes('role="img"'), `${where} is missing role=img`);
      }
    }
  }
});

test("no render carries active content", () => {
  for (const id of STYLE_IDS) {
    for (const [caseName, state] of Object.entries(CASES)) {
      const svg = render({ ...state, style: id }).toLowerCase();
      for (const token of FORBIDDEN_SVG_TOKENS) {
        assert.ok(
          !svg.includes(token.toLowerCase()),
          `${id}/${caseName} emitted the forbidden token ${token}`,
        );
      }
    }
  }
});

test("hostile text survives the real pipeline as inert, escaped text", async () => {
  // The pipeline is collect, then buildState (which sanitizes), then render.
  // This asserts the shipped path, so a repository description written by an
  // attacker reaches the banner as printable text and nothing more.
  const { buildState } = await import("../src/state.mjs");
  const state = await buildState({
    config: { user: "someone", style: "terminal", theme: "dark" },
    derived: {
      repos: [
        {
          name: hostileState.now.name,
          description: hostileState.now.description,
          language: "&<>\"'",
          url: "",
          lastPushed: new Date().toISOString(),
        },
      ],
      stats: { pushesThisWeek: 1, privateContributions: 0, hourly: new Array(24).fill(0) },
    },
  });

  for (const id of STYLE_IDS) {
    const svg = render({ ...state, style: id }).toLowerCase();
    for (const token of FORBIDDEN_SVG_TOKENS) {
      assert.ok(!svg.includes(token.toLowerCase()), `${id} emitted ${token} from hostile input`);
    }
    assert.ok(!svg.includes("&amp;amp;"), `${id} double escaped an ampersand`);
  }
});

test("render refuses to return unsanitized hostile state instead of shipping it", () => {
  // Calling render() directly with raw, never-sanitized data is a programming
  // error. The boundary check exists so that mistake fails loudly here rather
  // than quietly writing something unpleasant onto a public profile.
  assert.throws(
    () => render({ ...hostileState, style: "terminal" }),
    /forbidden|active content|script|javascript/i,
  );
});

test("renders are byte identical for identical state", () => {
  // The workflow commits this file. A nondeterministic renderer would produce a
  // commit on every scheduled run, forever, which is the single most annoying
  // way a tool like this can misbehave.
  for (const id of STYLE_IDS) {
    const a = render({ ...fixtureState, style: id });
    const b = render({ ...fixtureState, style: id });
    assert.equal(a, b, `${id} is not deterministic`);
  }
});

test("an unknown style falls back to the default rather than throwing", () => {
  const svg = render({ ...fixtureState, style: "does-not-exist" });
  assert.equal(svg, render({ ...fixtureState, style: DEFAULT_STYLE }));
});

test("a state with no rotation and no stats still renders every style", () => {
  for (const id of STYLE_IDS) {
    const svg = render({ ...emptyState, style: id });
    assert.ok(svg.length > 200, `${id} produced almost nothing for an empty profile`);
    assert.ok(svg.includes("first-repo"), `${id} dropped the only repo it had`);
  }
});

test("render rejects a non-object state loudly", () => {
  assert.throws(() => render(null), TypeError);
  assert.throws(() => render("terminal"), TypeError);
});

test("missing stats are defaulted rather than crashing a style", () => {
  for (const id of STYLE_IDS) {
    const svg = render({
      user: "x",
      style: id,
      theme: "dark",
      now: { name: "r", description: "", language: "", ageMinutes: 1 },
      rotation: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.ok(svg.startsWith("<svg "), `${id} could not cope with absent stats`);
  }
});

test("long values are truncated rather than allowed to overflow the frame", () => {
  // The banner is a fixed 800 by 200 with no layout engine behind it, so a
  // value that is not truncated does not wrap, it prints over its neighbour.
  for (const id of TRUNCATING_STYLES) {
    const svg = render({ ...longState, style: id });

    // The aria-label deliberately carries the untruncated description, because
    // a screen reader has no width to run out of and should get the whole
    // sentence. Only what is drawn has to fit, so strip the label first.
    const drawn = svg.replace(/aria-label="[^"]*"/g, "");

    assert.ok(
      !drawn.includes(longState.now.description),
      `${id} drew the whole description instead of cutting it to fit`,
    );
    assert.ok(drawn.includes("…"), `${id} truncated without marking the cut`);
  }
});

test("a marquee style carries the whole description, because scrolling reveals it", () => {
  for (const id of MARQUEE_STYLES) {
    const svg = render({ ...longState, style: id });
    assert.ok(svg.includes("animateTransform"), `${id} lost its marquee`);
    assert.ok(
      svg.includes(longState.now.description),
      `${id} truncated text it was supposed to scroll`,
    );
  }
});

test("a marquee stands still when its text already fits", () => {
  // Motion with nothing left to reveal is noise. A short description should
  // simply sit there.
  const short = {
    ...emptyState,
    now: { ...emptyState.now, description: "tiny" },
    style: "carradio",
  };
  const svg = render(short);
  assert.ok(svg.includes("tiny"));
  assert.ok(!svg.includes('id="cfm-rds"'), "carradio animated a description that already fitted");
});
