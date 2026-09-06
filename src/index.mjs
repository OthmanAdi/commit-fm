/**
 * Commit FM renderer.
 *
 * `render(state)` picks a style module and returns a complete SVG document as a
 * string. Style modules are pure functions of state: no I/O, no clock reads, no
 * randomness. That is a hard rule rather than a preference, because a GitHub
 * Action commits this output, and a renderer that produced different bytes for
 * identical input would create a commit on every scheduled run forever.
 *
 * Every render passes through `assertNoActiveContent` before it is returned.
 * A style module cannot ship a script, a foreign object, or an external
 * reference even by accident, because the boundary refuses to hand it back.
 */

import { assertNoActiveContent } from "./sanitize.mjs";

import * as winamp from "./styles/winamp.mjs";
import * as terminal from "./styles/terminal.mjs";
import * as splitflap from "./styles/splitflap.mjs";
import * as dotmatrix from "./styles/dotmatrix.mjs";
import * as carradio from "./styles/carradio.mjs";
import * as vumeter from "./styles/vumeter.mjs";
import * as vinyl from "./styles/vinyl.mjs";

/** @type {Record<string, {meta: {id: string, name: string, blurb: string}, render: Function}>} */
export const STYLES = Object.freeze({
  [terminal.meta.id]: terminal,
  [splitflap.meta.id]: splitflap,
  [dotmatrix.meta.id]: dotmatrix,
  [winamp.meta.id]: winamp,
  [carradio.meta.id]: carradio,
  [vumeter.meta.id]: vumeter,
  [vinyl.meta.id]: vinyl,
});

/** Style ids, in the order they are presented to a user choosing one. */
export const STYLE_IDS = Object.freeze(Object.keys(STYLES));

/** The default when no style is configured. Ranked first for a developer
 *  audience: it is the cheapest to read and the most native to the context. */
export const DEFAULT_STYLE = "terminal";

/**
 * Render a banner.
 *
 * @param {object} state          the State object from state.mjs
 * @param {object} [options]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @returns {string} a complete SVG document
 */
export function render(state, options = {}) {
  if (!state || typeof state !== "object") {
    throw new TypeError("render(state): state must be an object");
  }

  const id = STYLES[state.style] ? state.style : DEFAULT_STYLE;
  const style = STYLES[id];

  const svg = style.render(
    {
      user: "",
      theme: "dark",
      note: "",
      noteBy: "",
      live: false,
      rotation: [],
      generatedAt: new Date(0).toISOString(),
      ...state,
      stats: { pushesThisWeek: 0, privateContributions: 0, hourly: new Array(24).fill(0), ...(state.stats || {}) },
    },
    options,
  );

  // The render boundary. Nothing leaves here carrying active content.
  assertNoActiveContent(svg);
  return svg;
}

/** Metadata for every style, for `commit-fm styles` and the README gallery. */
export function listStyles() {
  return STYLE_IDS.map((id) => ({ ...STYLES[id].meta }));
}
