/**
 * Vinyl. The quiet one.
 *
 * Light ground, editorial type, one rotating record and nothing else in motion.
 * For a profile that does not want to shout. It is the only light style in the
 * set, which is why it survived the research note that a slow spin reads as
 * nearly static at this height: everything else here shouts, and a set with no
 * restrained option is not a set of choices.
 *
 * The sheen sits outside the rotating group on purpose. A highlight that turns
 * with the record is the single detail that gives away a fake turntable.
 */

import { svgOpen, svgClose, esc, n, marquee, ago, fitText } from "../svg.mjs";
import { measure, flowRow } from "../measure.mjs";

export const meta = {
  id: "vinyl",
  name: "Vinyl",
  blurb: "Record sleeve, not a dashboard. Restrained, editorial, light.",
};

const PALETTE = {
  light: { bg: "#f4f1ea", edge: "#ded8cc", ink: "#17140f", mid: "#6b645a", accent: "#8c2f22", rule: "#ded8cc", disc1: "#2b2b2b", disc2: "#0b0b0b" },
  dark: { bg: "#14120f", edge: "#2a2620", ink: "#f2eee6", mid: "#9a9186", accent: "#c8543f", rule: "#2a2620", disc1: "#31312f", disc2: "#0a0a0a" },
};

const SERIF = ` font-family="Georgia,'Iowan Old Style','Palatino Linotype','Times New Roman',serif"`;
const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;

export function render(state, opts = {}) {
  const W = opts.width ?? 800;
  const H = opts.height ?? 200;
  const c = PALETTE[state.theme === "dark" ? "dark" : "light"];
  const now = state.now ?? { name: "nothing playing", description: "", language: "", ageMinutes: 0 };
  const out = [];

  out.push(svgOpen({
    width: W, height: H,
    title: `Commit FM: ${now.name}`,
    label: `Now building ${now.name}. ${now.description || "No description."}`,
  }));

  out.push(
    `<style>@media (prefers-reduced-motion:reduce){.cfm-disc animateTransform{display:none}}</style>`
  );

  const cx = 108, cy = 100, r = 76;
  out.push(
    `<defs>` +
    `<radialGradient id="cfm-disc" cx="0.38" cy="0.32" r="0.82">` +
    `<stop offset="0" stop-color="${c.disc1}"/><stop offset="0.6" stop-color="#141414"/>` +
    `<stop offset="1" stop-color="${c.disc2}"/></radialGradient>` +
    `<linearGradient id="cfm-sheen" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.20"/>` +
    `<stop offset="0.45" stop-color="#ffffff" stop-opacity="0.02"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0.10"/></linearGradient>` +
    `<clipPath id="cfm-discclip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>` +
    `</defs>`
  );

  out.push(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`);
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${c.edge}"/>`);

  // Record.
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#cfm-disc)"/>`);
  out.push(`<g class="cfm-disc">`);
  out.push(
    `<animateTransform attributeName="transform" type="rotate" ` +
    `from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="5.2s" repeatCount="indefinite"/>`
  );
  out.push(`<g fill="none" stroke="#3a3a3a" stroke-width="0.6" opacity="0.55">`);
  for (let rr = 36; rr <= 72; rr += 4) out.push(`<circle cx="${cx}" cy="${cy}" r="${rr}"/>`);
  out.push(`</g>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="27" fill="${c.accent}"/>`);
  out.push(`<path d="M${cx} ${cy - 21} A21 21 0 0 1 ${cx + 21} ${cy}" fill="none" stroke="${c.bg}" stroke-width="1" opacity="0.5"/>`);
  const initial = (now.name || "?").trim().charAt(0).toLowerCase() || "?";
  out.push(`<text x="${cx}" y="${cy + 7}" font-size="20" font-style="italic" fill="${c.bg}" text-anchor="middle"${SERIF}>${esc(initial)}</text>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="3.2" fill="${c.bg}"/>`);
  out.push(`</g>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#cfm-sheen)" clip-path="url(#cfm-discclip)"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.edge}"/>`);

  // Tonearm.
  out.push(
    `<g stroke="#3d3a35" fill="#3d3a35">` +
    `<circle cx="196" cy="30" r="9" fill="#575249"/><circle cx="196" cy="30" r="3.5" fill="#2a2823"/>` +
    `<path d="M196 30 L150 84" stroke-width="3" stroke-linecap="round"/>` +
    `<g transform="translate(150,84) rotate(-49)"><rect x="-5" y="-2" width="16" height="9" rx="1.5" fill="#575249"/>` +
    `<path d="M11 2 L15 8" stroke-width="1.6"/></g></g>`
  );

  // Type column.
  const tx = 238, RIGHT = W - 22;
  const eyebrow = state.live ? "BROADCASTING · SIDE A" : "NOW PLAYING · SIDE A";
  out.push(`<text x="${tx}" y="36" font-size="9" letter-spacing="4" fill="${c.mid}"${MONO}>${esc(eyebrow)}</text>`);

  out.push(
    `<text x="${tx}" y="76" font-size="38" font-weight="700" letter-spacing="-0.5" fill="${c.ink}"${SERIF}>` +
    `${esc(fitText(now.name, RIGHT - tx, 38, "serif"))}</text>`
  );

  const line = state.live && state.note ? state.note : now.description;
  if (line) {
    out.push(
      `<text x="${tx}" y="100" font-size="14" font-style="italic" fill="${c.mid}"${SERIF}>` +
      `${esc(fitText(line, RIGHT - tx, 14, "serif"))}</text>`
    );
  }

  const items = [];
  if (now.language) items.push({ text: now.language.toUpperCase(), size: 10, kind: "mono", fill: c.accent, letterSpacing: 1.5 });
  if (state.stats.pushesThisWeek) items.push({ text: `${state.stats.pushesThisWeek} PUSHES THIS WEEK`, size: 10, kind: "mono", fill: c.ink, letterSpacing: 1.5 });
  items.push({ text: `${ago(now.ageMinutes).toUpperCase()} AGO`, size: 10, kind: "mono", fill: c.ink, letterSpacing: 1.5 });
  if (state.stats.privateContributions) items.push({ text: `+${state.stats.privateContributions} PRIVATE`, size: 10, kind: "mono", fill: c.mid, letterSpacing: 1.5 });

  const withDots = [];
  items.forEach((it, i) => {
    if (i) withDots.push({ text: "·", size: 10, kind: "mono", fill: c.mid, letterSpacing: 1.5 });
    withDots.push(it);
  });
  for (const it of flowRow(withDots, tx, RIGHT, 10)) {
    out.push(`<text x="${n(it.x)}" y="126" font-size="10" letter-spacing="1.5" fill="${it.fill}"${MONO}>${esc(it.text)}</text>`);
  }

  out.push(`<path d="M${tx} 140 H${RIGHT}" stroke="${c.rule}" stroke-width="1"/>`);

  // Side B, the rotation.
  const labelW = measure("B/", 9, "mono", 3);
  out.push(`<text x="${tx}" y="174" font-size="9" letter-spacing="3" fill="${c.mid}"${MONO}>B/</text>`);
  const queue = state.rotation.map((r) => r.name.toUpperCase());
  if (queue.length) {
    const plain = queue.join("   ·   ");
    const content = queue
      .map((q, i) => (i ? `<tspan fill="${c.accent}">&#8195;&#183;&#8195;</tspan>` : "") + `<tspan fill="${c.ink}">${esc(q)}</tspan>`)
      .join("");
    const qx = tx + labelW + 14;
    out.push(marquee({
      id: "cfm-sideb", x: qx, y: 174, width: RIGHT - qx, height: 20,
      content, plain, size: 10, kind: "mono", attrs: MONO + ` letter-spacing="1.5"`,
      letterSpacing: 1.5, pxPerSecond: 13, gap: 80,
    }));
  }

  out.push(svgClose);
  return out.join("");
}
