/**
 * Shared SVG construction helpers.
 *
 * Three of the decisions here came directly from review feedback on the first
 * seven mockups, so they are documented rather than left as tuning constants:
 *
 * 1. A marquee only scrolls when the text does not fit. Short text sits still.
 *    Motion with nothing to reveal is just noise.
 * 2. A marquee's loop distance is MEASURED, never guessed. Guessing it is what
 *    makes the two copies of the text either collide or leave a visible gap as
 *    the loop wraps.
 * 3. Spectrum bars stand at their real data height and only breathe slightly
 *    around it. The first version animated bars across the full range on
 *    roughly one second cycles, which read as a distracting strobe and, worse,
 *    meant the bars carried no information at all.
 */

import { measure, fitText } from "./measure.mjs";

/**
 * Escape a string for use as SVG text content or an attribute value.
 * Applied once, at the point of emission. Untrusted input should already have
 * been through `sanitizeText` in sanitize.mjs; this is the belt to that braces.
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
  // Idempotent by design. Text reaching a style has usually already been
  // through `sanitizeText`, which escapes as its last step, and a naive
  // `.replace(/&/g, "&amp;")` here would turn that `&amp;` into `&amp;amp;`
  // and print the entity on the banner. The negative lookahead leaves an
  // existing entity alone, so escaping twice is the same as escaping once and
  // both layers can stay in place.
  return String(s ?? "")
    .replace(/&(?![#a-zA-Z0-9]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Round to 2dp and drop a trailing `.00`, so the output stays readable and,
 *  more importantly, byte-identical between runs with identical input. */
export function n(v) {
  return String(Math.round(v * 100) / 100);
}

/**
 * Open an SVG document.
 * `role` and `aria-label` matter: this image is the first thing on somebody's
 * profile, and a screen reader should be able to say what is playing.
 * @param {{width: number, height: number, title: string, label: string}} o
 */
export function svgOpen({ width, height, title, label }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(title)}</title>`
  );
}

export const svgClose = "</svg>";

/**
 * A horizontal scroller that only moves when it has to.
 *
 * @param {object} o
 * @param {string} o.id            unique clip id within the document
 * @param {number} o.x             left edge of the visible window
 * @param {number} o.y             text baseline
 * @param {number} o.width         width of the visible window
 * @param {number} o.height        height of the clip window
 * @param {string} o.content       already-escaped SVG text content (may contain tspans)
 * @param {string} o.plain         the same content as plain text, for measuring
 * @param {number} o.size
 * @param {import("./measure.mjs").FontKind} [o.kind]
 * @param {string} [o.attrs]       extra attributes for the text element
 * @param {number} [o.letterSpacing]
 * @param {number} [o.pxPerSecond] scroll speed. 18 is a readable walking pace;
 *                                 the first cut ran near 40 and was reported as
 *                                 too fast to follow.
 * @param {number} [o.gap]         blank space between the end of one copy and
 *                                 the start of the next
 * @returns {string}
 */
export function marquee({
  id, x, y, width, height, content, plain, size,
  kind = "mono", attrs = "", letterSpacing = 0, pxPerSecond = 18, gap = 90,
}) {
  const textWidth = measure(plain, size, kind, letterSpacing);

  // Fits: render it once, still. No clip path, no animation, no reason.
  if (textWidth <= width) {
    return `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}"${attrs}>${content}</text>`;
  }

  const period = textWidth + gap;
  const dur = period / pxPerSecond;

  return (
    `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y - height + 4)}" width="${n(width)}" height="${n(height)}"/></clipPath>` +
    `<g clip-path="url(#${id})">` +
    `<g><animateTransform attributeName="transform" type="translate" ` +
    `values="0 0; ${n(-period)} 0" dur="${n(dur)}s" repeatCount="indefinite"/>` +
    `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}"${attrs}>${content}</text>` +
    `<text x="${n(x + period)}" y="${n(y)}" font-size="${n(size)}"${attrs}>${content}</text>` +
    `</g></g>`
  );
}

/**
 * Vertically scrolling list, used by the Winamp playlist and the departure board.
 * Like the marquee, it stays still when every row already fits.
 *
 * @param {object} o
 * @param {string} o.id
 * @param {number} o.x
 * @param {number} o.y      top of the visible window
 * @param {number} o.width
 * @param {number} o.height visible window height
 * @param {string[]} o.rows already-rendered SVG for each row, positioned relative to 0
 * @param {number} o.rowHeight
 * @param {number} [o.visible] how many rows fit in the window
 * @param {number} [o.secondsPerRow] dwell time per row. Slower than it feels it
 *                 should be: a list that steps faster than about three seconds
 *                 per row cannot be read by someone who just arrived.
 */
export function vScroll({ id, x, y, width, height, rows, rowHeight, visible, secondsPerRow = 3.4 }) {
  const fit = Math.max(1, visible ?? Math.floor(height / rowHeight));

  if (rows.length <= fit) {
    return (
      `<g transform="translate(${n(x)},${n(y)})">` +
      rows.map((r, i) => `<g transform="translate(0,${n(i * rowHeight)})">${r}</g>`).join("") +
      `</g>`
    );
  }

  // Step one whole row at a time and hold, rather than gliding continuously.
  //
  // A continuous scroll always has a half-row sliced by the window edge, which
  // on a departures board or a playlist reads as a rendering bug rather than as
  // motion. Discrete steps keep every visible row whole, and a board that
  // clacks one line upward is what the real object does anyway.
  const all = rows.concat(rows.slice(0, fit));
  const stops = rows.length;
  const values = [];
  const keyTimes = [];
  for (let i = 0; i <= stops; i++) {
    values.push(`${n(x)} ${n(y - i * rowHeight)}`);
    keyTimes.push(n(i / stops));
  }

  return (
    `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(fit * rowHeight)}"/></clipPath>` +
    `<g clip-path="url(#${id})"><g transform="translate(${n(x)},${n(y)})">` +
    `<animateTransform attributeName="transform" type="translate" calcMode="discrete" ` +
    `values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" ` +
    `dur="${n(stops * secondsPerRow)}s" repeatCount="indefinite"/>` +
    all.map((r, i) => `<g transform="translate(0,${n(i * rowHeight)})">${r}</g>`).join("") +
    `</g></g>`
  );
}

/**
 * A spectrum where the bars mean something.
 *
 * `values` is real data, normally pushes per hour over the last 24 hours. Each
 * bar stands at its true height and breathes by a small percentage around it,
 * with a fast rise and a slow fall, which is how an analogue meter behaves.
 *
 * The first version animated every bar across the whole range on ~1.3 second
 * cycles. That was reported as distracting, and it was also dishonest: the
 * movement looked like data and was not.
 *
 * @param {object} o
 * @param {number[]} o.values      raw counts, any scale
 * @param {number} o.x
 * @param {number} o.baseline      y of the bar feet
 * @param {number} o.barWidth
 * @param {number} o.gap
 * @param {number} o.maxHeight
 * @param {string} o.fill          colour or url(#gradient)
 * @param {number} [o.minHeight]   floor so an empty hour still shows a stub
 * @param {number} [o.breathe]     fraction of the bar's own height it moves by
 * @param {boolean} [o.animate]
 */
export function spectrumBars({
  values, x, baseline, barWidth, gap, maxHeight, fill,
  minHeight = 3, breathe = 0.16, animate = true,
}) {
  const peak = Math.max(1, ...values);
  const parts = [];

  values.forEach((v, i) => {
    const bx = i * (barWidth + gap);
    const h = Math.max(minHeight, (v / peak) * maxHeight);

    if (!animate || h <= minHeight + 1) {
      parts.push(`<rect x="${n(bx)}" width="${n(barWidth)}" height="${n(h)}"/>`);
      return;
    }

    const low = Math.max(minHeight, h * (1 - breathe));
    // Durations spread across a wide, deliberately non-harmonic range so the
    // bars never fall into a visible marching pattern. All of them are slow:
    // the whole point of the change is that the eye should be able to ignore
    // this and read the text.
    const dur = 3.2 + ((i * 7) % 11) * 0.34;
    const begin = -(((i * 13) % 17) * 0.29);
    parts.push(
      `<rect x="${n(bx)}" width="${n(barWidth)}" height="${n(h)}">` +
      `<animate attributeName="height" values="${n(low)};${n(h)};${n(low)}" ` +
      `keyTimes="0;0.14;1" dur="${n(dur)}s" begin="${n(begin)}s" repeatCount="indefinite"/></rect>`
    );
  });

  // The group is flipped so bars grow upward from y=0 and only `height` has to
  // animate. Animating y and height together doubles the timeline for no gain.
  return `<g transform="translate(${n(x)},${n(baseline)}) scale(1,-1)" fill="${fill}">${parts.join("")}</g>`;
}

/**
 * Build a `values`/`keyTimes` pair that moves to each stop and then holds.
 *
 * Requested directly in review of the VU meter: "the meter does not need to
 * move so fast, maybe move and stop". A needle that sweeps continuously reads
 * as a decoration; one that steps and settles reads as an instrument.
 *
 * @param {number[]} stops        values to visit, returning to the first
 * @param {number} [holdFraction] share of each step spent stationary
 * @returns {{values: string, keyTimes: string}}
 */
export function stepAndHold(stops, holdFraction = 0.62) {
  const seq = stops.concat([stops[0]]);
  const legs = seq.length - 1;
  const values = [];
  const keyTimes = [];
  for (let i = 0; i < legs; i++) {
    const legStart = i / legs;
    const moveEnd = legStart + (1 / legs) * (1 - holdFraction);
    values.push(n(seq[i]), n(seq[i + 1]));
    keyTimes.push(n(legStart), n(moveEnd));
  }
  values.push(n(seq[legs]));
  keyTimes.push("1");
  return { values: values.join(";"), keyTimes: keyTimes.join(";") };
}

/**
 * Human phrasing for an age in minutes. Kept short because it competes for
 * horizontal room with everything else on the row.
 * @param {number} minutes
 */
export function ago(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return "unknown";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const h = minutes / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d`;
  return `${Math.round(d / 7)}w`;
}

/** Zero-padded clock reading of an age, for the styles with a time display. */
export function agoClock(minutes) {
  const m = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hh = Math.min(99, Math.floor(m / 60));
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export { measure, fitText };
