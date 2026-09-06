/**
 * Car dashboard. A hi-fi fascia where every repository is a station on the dial.
 *
 * The rarest looking option in the set, and the most "real object": warm glass,
 * brushed metal, one amber readout in the dark. The seven-segment digits are
 * drawn as paths rather than set in a font, so the style needs nothing embedded.
 *
 * The needle steps between stations and settles, rather than sweeping
 * continuously, for the same reason the VU needle does: an instrument that
 * holds a reading looks like it is measuring something.
 */

import { svgOpen, svgClose, esc, n, marquee, stepAndHold, ago, agoClock, fitText } from "../svg.mjs";
import { measure, flowRow } from "../measure.mjs";

export const meta = {
  id: "carradio",
  name: "Car dashboard",
  blurb: "A tuner fascia. Every repo is a station, and the needle seeks between them.",
};

const PALETTE = {
  dark: { m1: "#3a3a3c", m2: "#5a5a5d", m3: "#38383a", m4: "#242426", m5: "#4a4a4c", glass1: "#150c02", glass2: "#0a0600", etch: "#9c9691", frame: "#5f5f63" },
  light: { m1: "#d5d5d8", m2: "#eeeef1", m3: "#cfcfd3", m4: "#b6b6bb", m5: "#e4e4e8", glass1: "#1a0f03", glass2: "#0d0700", etch: "#4a4a50", frame: "#a6a6ad" },
};

const AMBER = "#ff9d21";
const AMBER_DIM = "#7a4405";
const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;
const SANS = ` font-family="'Helvetica Neue',Arial,sans-serif"`;

/** Which of the seven segments each digit lights. */
const SEG = {
  0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc",
  5: "afgcd", 6: "afgecd", 7: "abc", 8: "abcdefg", 9: "abcdfg",
};

/** Offsets of each segment inside a 24 by 44 digit cell. */
const SEG_POS = {
  a: [0, 0, "h"], b: [18, 0, "v"], c: [18, 22, "v"], d: [0, 38, "h"],
  e: [0, 22, "v"], f: [0, 0, "v"], g: [0, 19, "h"],
};

/**
 * One seven-segment digit as SVG `use` elements pointing at two local shapes.
 * Fragment references only, never external, so this stays inside the rules for
 * an image served through a proxy.
 */
function digit(ch, x, y) {
  const on = SEG[ch];
  if (!on) return "";
  let s = "";
  for (const seg of on) {
    const [dx, dy, kind] = SEG_POS[seg];
    s += `<use href="#cfm-${kind}s" x="${n(x + dx)}" y="${n(y + dy)}"/>`;
  }
  return s;
}

export function render(state, opts = {}) {
  const W = opts.width ?? 800;
  const H = opts.height ?? 200;
  const c = PALETTE[state.theme === "light" ? "light" : "dark"];
  const now = state.now ?? { name: "nothing playing", description: "", language: "", ageMinutes: 0 };
  const out = [];

  out.push(svgOpen({
    width: W, height: H,
    title: `Commit FM: ${now.name}`,
    label: `Now building ${now.name}. ${now.description || "No description."}`,
  }));

  out.push(
    `<style>@keyframes cfm-pulse{0%,100%{opacity:1}50%{opacity:.35}}` +
    `.cfm-pulse{animation:cfm-pulse 2.6s ease-in-out infinite}` +
    `@media (prefers-reduced-motion:reduce){.cfm-pulse{animation:none}}</style>`
  );

  out.push(
    `<defs>` +
    `<linearGradient id="cfm-brush" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.m1}"/><stop offset="0.06" stop-color="${c.m2}"/>` +
    `<stop offset="0.5" stop-color="${c.m3}"/><stop offset="0.94" stop-color="${c.m4}"/>` +
    `<stop offset="1" stop-color="${c.m5}"/></linearGradient>` +
    `<linearGradient id="cfm-glass" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.glass1}"/><stop offset="1" stop-color="${c.glass2}"/></linearGradient>` +
    `<linearGradient id="cfm-btn" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#55555a"/><stop offset="1" stop-color="#2d2d31"/></linearGradient>` +
    `<filter id="cfm-glow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feGaussianBlur stdDeviation="2.2" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<path id="cfm-hs" d="M3,0 L21,0 L24,3 L21,6 L3,6 L0,3 Z"/>` +
    `<path id="cfm-vs" d="M0,3 L3,0 L6,3 L6,17 L3,20 L0,17 Z"/>` +
    `</defs>`
  );

  out.push(`<rect width="${W}" height="${H}" fill="url(#cfm-brush)"/>`);
  out.push(`<g opacity="0.16" stroke="#ffffff" stroke-width="0.5">`);
  for (let y = 26; y < H; y += 28) out.push(`<path d="M0 ${y} H${W}"/>`);
  out.push(`</g>`);
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#111"/>`);
  out.push(`<rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="4" fill="none" stroke="${c.frame}"/>`);

  // Display glass.
  const gx = 24, gy = 18, gw = 648, gh = 88;
  out.push(`<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="3" fill="url(#cfm-glass)"/>`);
  out.push(`<rect x="${gx + 0.5}" y="${gy + 0.5}" width="${gw - 1}" height="${gh - 1}" rx="3" fill="none" stroke="#000"/>`);

  // Seven-segment reading of the time since the last push.
  const clock = agoClock(now.ageMinutes);
  out.push(`<g filter="url(#cfm-glow)" fill="${AMBER}"><g transform="translate(44,34)">`);
  let sx = 0;
  for (const ch of clock) {
    if (ch === ":") {
      out.push(`<circle cx="${n(sx + 4)}" cy="14" r="3"/><circle cx="${n(sx + 4)}" cy="30" r="3"/>`);
      sx += 14;
    } else {
      out.push(digit(ch, sx, 0));
      sx += 32;
    }
  }
  out.push(`</g></g>`);
  out.push(`<text x="44" y="94" font-size="8" letter-spacing="2" fill="${AMBER_DIM}"${MONO}>SINCE LAST PUSH</text>`);

  // Indicator lamps pinned to the right of the glass, so the station name below
  // can be truncated to whatever room is actually left.
  const lampX = gx + gw - 96;
  out.push(`<text class="cfm-pulse" x="${n(lampX)}" y="36" font-size="9" letter-spacing="1" fill="${AMBER}"${MONO}>${state.live ? "LIVE" : "ON"}</text>`);
  if (now.language) {
    out.push(`<text x="${n(lampX + 40)}" y="36" font-size="9" letter-spacing="1" fill="${AMBER_DIM}"${MONO}>${esc(fitText(now.language.toUpperCase(), 52, 9, "mono", 1))}</text>`);
  }
  if (state.stats.pushesThisWeek) {
    out.push(`<text x="${n(lampX)}" y="50" font-size="9" letter-spacing="1" fill="${AMBER_DIM}"${MONO}>${state.stats.pushesThisWeek}/WK</text>`);
  }
  if (state.stats.privateContributions) {
    out.push(`<text x="${n(lampX + 40)}" y="50" font-size="9" letter-spacing="1" fill="${AMBER_DIM}"${MONO}>+${state.stats.privateContributions}P</text>`);
  }

  // Station name.
  const nameX = 300;
  const nameMax = lampX - nameX - 16;
  out.push(
    `<text x="${nameX}" y="58" font-size="32" font-weight="700" letter-spacing="5" fill="${AMBER}" ` +
    `filter="url(#cfm-glow)"${SANS}>${esc(fitText(now.name.toUpperCase(), nameMax, 32, "sans-bold", 5))}</text>`
  );

  // Radio text, the description or the live note.
  const rds = state.live && state.note ? state.note : now.description;
  if (rds) {
    out.push(marquee({
      id: "cfm-rds", x: nameX, y: 90, width: gx + gw - nameX - 14, height: 20,
      content: esc(rds), plain: rds, size: 11, kind: "mono",
      attrs: MONO + ` fill="${AMBER}" opacity="0.92"`, pxPerSecond: 16, gap: 70,
    }));
  }

  // Tuning knob.
  const kx = W - 74;
  out.push(`<circle cx="${kx}" cy="62" r="34" fill="#1f1f21"/><circle cx="${kx}" cy="62" r="30" fill="url(#cfm-btn)"/>`);
  out.push(`<circle cx="${kx}" cy="62" r="22" fill="#2a2a2d"/>`);
  out.push(`<g stroke="#8d8d92" stroke-width="1"><path d="M${kx} 32 v6 M${kx + 30} 62 h-6 M${kx} 92 v-6 M${kx - 30} 62 h6"/></g>`);
  out.push(`<rect x="${kx - 2}" y="40" width="4" height="12" rx="2" fill="${AMBER}"/>`);
  out.push(`<text x="${kx}" y="108" font-size="7" letter-spacing="1" fill="${c.etch}" text-anchor="middle"${MONO}>TUNE</text>`);

  // Dial. Stations are repositories, spaced evenly across the scale.
  const dx = 24, dy = 116, dw = 648, dh = 44;
  out.push(`<rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="3" fill="#141416"/>`);

  const stations = [now, ...state.rotation].slice(0, 5);
  const span = dw - 60;
  const step = stations.length > 1 ? span / (stations.length - 1) : 0;
  const stops = [];
  stations.forEach((s, i) => {
    const x = dx + 20 + i * step;
    stops.push(Math.round((x - (dx + 20)) * 10) / 10);
    out.push(`<path d="M${n(x)} ${dy + 12} v8" stroke="#6d6a66" stroke-width="1.4"/>`);
    const label = fitText(s.name, Math.max(40, step - 12), 8, "mono", 1);
    out.push(`<text x="${n(x)}" y="${dy + 36}" font-size="8" letter-spacing="1" fill="${c.etch}" text-anchor="middle"${MONO}>${esc(label)}</text>`);
  });

  // Needle: seeks between stations and rests, ending back on the one playing.
  const seek = stops.length > 1 ? stops.slice().reverse() : [0];
  const { values, keyTimes } = stepAndHold(seek, 0.66);
  out.push(
    `<g><animateTransform attributeName="transform" type="translate" ` +
    `values="${values.split(";").map((v) => `${v} 0`).join(";")}" keyTimes="${keyTimes}" ` +
    `dur="${n(Math.max(12, seek.length * 3.6))}s" repeatCount="indefinite"/>` +
    `<rect x="${dx + 18}" y="${dy + 2}" width="3" height="30" fill="#ff2d2d"/>` +
    `<path d="M${dx + 13} ${dy + 2} L${dx + 26} ${dy + 2} L${dx + 19.5} ${dy + 9} Z" fill="#ff2d2d"/></g>`
  );
  out.push(`<rect x="${dx + 0.5}" y="${dy + 0.5}" width="${dw - 1}" height="${dh - 1}" rx="3" fill="none" stroke="#000"/>`);
  out.push(`<text x="${dx + dw + 14}" y="${dy + 18}" font-size="7" letter-spacing="1" fill="${c.etch}"${MONO}>SEEK</text>`);
  out.push(`<text x="${dx + dw + 14}" y="${dy + 32}" font-size="7" letter-spacing="1" fill="${c.etch}"${MONO}>AUTO</text>`);

  // Presets, one per repository in rotation.
  const presets = [now, ...state.rotation].slice(0, 6);
  const pw = (W - 48) / 6;
  presets.forEach((p, i) => {
    const x = 24 + i * pw;
    out.push(`<rect x="${n(x)}" y="168" width="${n(pw - 8)}" height="22" rx="3" fill="url(#cfm-btn)"/>`);
    const numW = measure(String(i + 1), 9, "mono", 1);
    out.push(`<text x="${n(x + 10)}" y="183" font-size="9" letter-spacing="1" fill="${i === 0 ? AMBER : "#8b8781"}"${MONO}>${i + 1}</text>`);
    out.push(
      `<text x="${n(x + 10 + numW + 8)}" y="183" font-size="9" letter-spacing="1" fill="#cfcac4"${MONO}>` +
      `${esc(fitText(p.name, pw - 34 - numW, 9, "mono", 1))}</text>`
    );
  });

  out.push(svgClose);
  return out.join("");
}
