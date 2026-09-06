/**
 * Text measurement for SVG that will be rendered as an image.
 *
 * Why this file exists at all: a banner served through GitHub's image proxy is
 * a static `<img>`. There is no DOM, no layout engine, and no way to ask the
 * renderer how wide a string came out. So any layout built on hard-coded x
 * positions is a guess about text width, and the guess fails the moment a real
 * repository name is longer than the one the designer had in mind. That failure
 * looks like two labels printed on top of each other.
 *
 * The fix is to measure here, at generation time, using the advance-width
 * tables of the font families we actually name, and to flow rows from measured
 * widths instead of from assumed ones.
 *
 * Widths are in units of 1/1000 em, which is how font metrics are conventionally
 * expressed, so `advance(ch) * fontSize / 1000` is a width in pixels.
 */

/** Helvetica / Arial regular, standard AFM advance widths. */
const HELVETICA = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
  "·": 278, "–": 556, "—": 1000, "…": 1000, "•": 350,
};

/** Helvetica / Arial bold. Bold is meaningfully wider; using the regular table
 *  for bold text is one of the classic ways a measured layout still collides. */
const HELVETICA_BOLD = {
  ...HELVETICA,
  " ": 278, "!": 333, '"': 474, "&": 722, "'": 238, "(": 333, ")": 333,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  ":": 333, ";": 333, "-": 333, "·": 350,
};

/** Every monospace face we name advances every glyph by the same amount.
 *  0.6em covers SF Mono, Menlo, JetBrains Mono and IBM Plex Mono; Consolas is
 *  slightly narrower, so 0.6 errs toward reserving too much room, which is the
 *  safe direction for collision avoidance. */
const MONO_ADVANCE = 600;

/** Archivo Black and other ultra-heavy grotesques run wider than Helvetica
 *  Bold. Scaling the bold table is far more accurate than pretending it is
 *  regular weight, which is what produced the split-flap overlap. */
const BLACK_SCALE = 1.07;

/**
 * @typedef {"mono"|"sans"|"sans-bold"|"black"|"serif"} FontKind
 */

/**
 * Advance width of one character in 1/1000 em.
 * Unknown characters fall back to a middling width rather than zero: assuming
 * zero width is what makes an unmeasured character silently overlap its neighbour.
 * @param {string} ch
 * @param {FontKind} kind
 * @returns {number}
 */
function advance(ch, kind) {
  if (kind === "mono") return MONO_ADVANCE;
  if (kind === "black") return (HELVETICA_BOLD[ch] ?? 600) * BLACK_SCALE;
  if (kind === "sans-bold") return HELVETICA_BOLD[ch] ?? 600;
  // Georgia and other text serifs run a little wider than Helvetica at the
  // same size. 1.04 is close enough for layout reservation.
  if (kind === "serif") return (HELVETICA[ch] ?? 556) * 1.04;
  return HELVETICA[ch] ?? 556;
}

/**
 * Width of a string in pixels at a given size.
 * `letterSpacing` is added per character exactly as SVG applies it, because a
 * banner with `letter-spacing="2"` over 40 characters is 80px wider than the
 * font metrics alone predict, which is more than enough to cause a collision.
 *
 * @param {string} text
 * @param {number} fontSize
 * @param {FontKind} [kind]
 * @param {number} [letterSpacing]
 * @returns {number} width in pixels
 */
export function measure(text, fontSize, kind = "sans", letterSpacing = 0) {
  if (!text) return 0;
  let units = 0;
  for (const ch of text) units += advance(ch, kind);
  return (units * fontSize) / 1000 + letterSpacing * text.length;
}

/**
 * Truncate text so it fits `maxWidth`, appending an ellipsis when it had to cut.
 * Iterates by code point, so it will not slice a surrogate pair in half.
 *
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} fontSize
 * @param {FontKind} [kind]
 * @param {number} [letterSpacing]
 * @returns {string}
 */
export function fitText(text, maxWidth, fontSize, kind = "sans", letterSpacing = 0) {
  if (!text) return "";
  if (measure(text, fontSize, kind, letterSpacing) <= maxWidth) return text;

  const ell = "…";
  const ellW = measure(ell, fontSize, kind, letterSpacing);
  const chars = Array.from(text);
  let width = 0;
  let out = "";
  for (const ch of chars) {
    const w = measure(ch, fontSize, kind, letterSpacing);
    if (width + w + ellW > maxWidth) break;
    out += ch;
    width += w;
  }
  return out.replace(/[ ·,;:]+$/, "") + ell;
}

/**
 * Lay a row of items out left to right from measured widths, dropping any item
 * that will not fit rather than letting it overlap its neighbour.
 *
 * This is the direct fix for the reported collisions: the previous layouts
 * placed meta fields at fixed x coordinates chosen for one specific set of
 * demo strings, so real data of a different length printed on top of the next
 * field along.
 *
 * @param {{text: string, kind?: FontKind, size: number, fill: string, letterSpacing?: number}[]} items
 * @param {number} startX
 * @param {number} maxX   hard right boundary; nothing is placed past it
 * @param {number} gap    space between items in pixels
 * @returns {{text: string, x: number, size: number, kind: FontKind, fill: string, letterSpacing: number}[]}
 */
export function flowRow(items, startX, maxX, gap) {
  const out = [];
  let x = startX;
  for (const item of items) {
    const kind = item.kind ?? "sans";
    const ls = item.letterSpacing ?? 0;
    const w = measure(item.text, item.size, kind, ls);
    if (x + w > maxX) break;
    out.push({ text: item.text, x, size: item.size, kind, fill: item.fill, letterSpacing: ls });
    x += w + gap;
  }
  return out;
}

/**
 * Width the whole row will occupy, for callers that need to right-align or
 * centre a flowed row.
 * @param {ReturnType<typeof flowRow>} placed
 * @param {number} startX
 * @returns {number}
 */
export function rowWidth(placed, startX) {
  if (placed.length === 0) return 0;
  const last = placed[placed.length - 1];
  return last.x + measure(last.text, last.size, last.kind, last.letterSpacing) - startX;
}
