/**
 * Transit sign. Amber LED dot matrix.
 *
 * Public infrastructure rather than a card: civic, not cute. It is also the one
 * style that can honestly represent private work, because it can print a count
 * with no repository name attached.
 *
 * Two review notes shaped this revision:
 *  - The first cut was unreadable. A six pixel dot grid chopped every letter
 *    stroke thinner than one dot into loose fragments. The pitch is now five
 *    pixels with a much smaller gutter, the type is heavier, and anything under
 *    about twenty pixels is kept off the mask entirely, because small text
 *    cannot survive being dotted at all.
 *  - "text collision issues" -> the status row is flowed from measured widths
 *    instead of sitting at six hard-coded x positions.
 */

import { svgOpen, svgClose, esc, n, marquee, ago, fitText } from "../svg.mjs";
import { flowRow } from "../measure.mjs";

export const meta = {
  id: "dotmatrix",
  name: "Transit sign",
  blurb: "Amber LED destination board. The one that can count private work honestly.",
};

const PALETTE = {
  dark: { case: "#060d05", board: "#0a1408", frame: "#1d3a18", unlit: "#132a10", divider: "#1f5c1a" },
  light: { case: "#161a14", board: "#0d1a0a", frame: "#2c4f26", unlit: "#173013", divider: "#2a6f24" },
};

const HOT = "#fff0c9";
const AMBER = "#ffb62e";
const AMBER_DIM = "#c98f2a";
const AMBER_FAINT = "#8a6a1e";
const GREEN = "#4ade5e";
const SANS = ` font-family="'Helvetica Neue',Arial,sans-serif" font-weight="800"`;
const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;

export function render(state, opts = {}) {
  const W = opts.width ?? 800;
  const H = opts.height ?? 200;
  const P = 16;
  const c = PALETTE[state.theme === "light" ? "light" : "dark"];
  const now = state.now ?? { name: "nothing playing", description: "", language: "", ageMinutes: 0 };
  const out = [];

  out.push(svgOpen({
    width: W, height: H,
    title: `Commit FM: ${now.name}`,
    label: `Now building ${now.name}. ${now.description || "No description."}`,
  }));

  out.push(
    `<style>@keyframes cfm-led{0%,100%{opacity:1}50%{opacity:.45}}` +
    `.cfm-led{animation:cfm-led 2.2s ease-in-out infinite}` +
    `@media (prefers-reduced-motion:reduce){.cfm-led{animation:none}}</style>`
  );

  out.push(
    `<defs>` +
    // Unlit lamp bed, same pitch as the lit grid so the lamps line up.
    `<pattern id="cfm-bed" width="5" height="5" patternUnits="userSpaceOnUse">` +
    `<circle cx="2.5" cy="2.5" r="1.7" fill="${c.unlit}"/></pattern>` +
    // The gutter mask. r is deliberately near half the pitch: any smaller and a
    // stroke thinner than one cell breaks into disconnected dots.
    `<pattern id="cfm-gutter" width="5" height="5" patternUnits="userSpaceOnUse">` +
    `<rect width="5" height="5" fill="#000"/><circle cx="2.5" cy="2.5" r="2.3" fill="#fff"/></pattern>` +
    `<mask id="cfm-dots"><rect width="${W}" height="${H}" fill="url(#cfm-gutter)"/></mask>` +
    `</defs>`
  );

  out.push(`<rect width="${W}" height="${H}" fill="${c.case}"/>`);
  out.push(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="3" fill="${c.board}" stroke="${c.frame}"/>`);
  out.push(`<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="url(#cfm-bed)"/>`);

  // Everything large enough to survive the mask.
  const lit = [];

  const desc = state.live && state.note ? state.note : now.description;
  const heroPlain = now.name.toUpperCase() + (desc ? "   " + desc.toUpperCase() : "");
  const heroContent =
    `<tspan fill="${HOT}">${esc(now.name.toUpperCase())}</tspan>` +
    (desc ? `<tspan fill="${AMBER}">&#8195;${esc(desc.toUpperCase())}</tspan>` : "");
  lit.push(marquee({
    id: "cfm-hero", x: P + 4, y: 78, width: W - 2 * P - 8, height: 58,
    content: heroContent, plain: heroPlain, size: 44, kind: "black",
    attrs: SANS + ` letter-spacing="1"`, letterSpacing: 1, pxPerSecond: 24, gap: 150,
  }));

  const queue = state.rotation.map((r) => `${r.name.toUpperCase()} ${ago(r.ageMinutes).toUpperCase()}`);
  if (queue.length) {
    const qPlain = queue.join("   ·   ");
    const qContent = queue
      .map((q, i) => (i ? `<tspan fill="${GREEN}">&#8195;&#183;&#8195;</tspan>` : "") + `<tspan fill="${AMBER}">${esc(q)}</tspan>`)
      .join("");
    lit.push(marquee({
      id: "cfm-queue", x: P + 4, y: 176, width: W - 2 * P - 8, height: 32,
      content: qContent, plain: qPlain, size: 24, kind: "black",
      attrs: SANS + ` letter-spacing="1"`, letterSpacing: 1, pxPerSecond: 17, gap: 130,
    }));
  }

  out.push(`<g mask="url(#cfm-dots)">${lit.join("")}</g>`);

  out.push(`<rect x="${P}" y="104" width="${W - 2 * P}" height="2" fill="${c.divider}"/>`);

  // Status row, off the mask so it stays legible, and flowed so it cannot collide.
  const status = [];
  status.push({ text: state.live ? "BROADCASTING" : "PUSHING", size: 13, kind: "mono", fill: GREEN, letterSpacing: 1.5 });
  if (now.language) status.push({ text: now.language.toUpperCase(), size: 13, kind: "mono", fill: AMBER_DIM, letterSpacing: 1.5 });
  if (state.stats.pushesThisWeek) status.push({ text: `${state.stats.pushesThisWeek} PUSHES THIS WEEK`, size: 13, kind: "mono", fill: AMBER_DIM, letterSpacing: 1.5 });
  status.push({ text: `${ago(now.ageMinutes).toUpperCase()} SINCE PUSH`, size: 13, kind: "mono", fill: AMBER_DIM, letterSpacing: 1.5 });
  if (state.stats.privateContributions) {
    status.push({ text: `+${state.stats.privateContributions} PRIVATE`, size: 13, kind: "mono", fill: AMBER_FAINT, letterSpacing: 1.5 });
  }

  const lampX = P + 8;
  out.push(`<circle class="cfm-led" cx="${lampX}" cy="126" r="4" fill="${GREEN}"/>`);
  for (const it of flowRow(status, lampX + 12, W - P, 22)) {
    const cls = it.fill === GREEN ? ` class="cfm-led"` : "";
    out.push(
      `<text${cls} x="${n(it.x)}" y="131" font-size="${n(it.size)}" ` +
      `letter-spacing="${n(it.letterSpacing)}" fill="${it.fill}"${MONO}>${esc(it.text)}</text>`
    );
  }

  out.push(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="3" fill="none" stroke="#000" stroke-width="2"/>`);
  out.push(svgClose);
  return out.join("");
}
