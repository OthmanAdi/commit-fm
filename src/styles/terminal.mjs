/**
 * Terminal. A cmus window with a cava spectrum.
 *
 * The native visual language of the people who actually read a GitHub profile.
 * It does not look like a widget, it looks like something you left running.
 *
 * Review notes this revision answers:
 *  - "too much fast movement in the freq bars, a bit distracting" -> the bars
 *    now stand at real pushes per hour and breathe by 16 percent on slow,
 *    non-harmonic cycles instead of strobing across the full range.
 *  - "horizontally moving text a bit too fast" -> the queue scrolls at 16px per
 *    second and does not scroll at all when it already fits.
 *  - "text collision issues" -> every row is laid out from measured widths.
 */

import { svgOpen, svgClose, esc, n, marquee, spectrumBars, ago, fitText } from "../svg.mjs";
import { measure, flowRow } from "../measure.mjs";

export const meta = {
  id: "terminal",
  name: "Terminal",
  blurb: "cmus with a cava spectrum. Native to the audience reading your profile.",
};

const PALETTE = {
  dark: {
    bg: "#05080a", chrome: "#0d1117", rule: "#16321f",
    dim: "#3d6b4a", body: "#5f9e70", fg: "#7ee787", hot: "#d8ffdc",
    accent: "#e3a72c", bar: "#2ea043", barHot: "#56d364",
  },
  light: {
    bg: "#fbfaf5", chrome: "#eceadf", rule: "#d5d8cf",
    dim: "#7c8a80", body: "#4a5a4e", fg: "#1a7f37", hot: "#08331a",
    accent: "#9a6700", bar: "#48ab5c", barHot: "#2c8340",
  },
};

const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;

/**
 * @param {import("../state.mjs").State} state
 * @param {{width?: number, height?: number}} [opts]
 * @returns {string}
 */
export function render(state, opts = {}) {
  const W = opts.width ?? 800;
  const H = opts.height ?? 200;
  const P = 16;
  const RIGHT = W - P;
  const c = PALETTE[state.theme === "light" ? "light" : "dark"];

  const now = state.now ?? { name: "nothing playing", description: "", language: "", ageMinutes: 0 };
  const out = [];

  out.push(svgOpen({
    width: W, height: H,
    title: `Commit FM: ${now.name}`,
    label: `Now building ${now.name}. ${now.description || "No description."}`,
  }));

  out.push(
    `<style>` +
    `@keyframes cfm-cur{0%,49%{opacity:1}50%,100%{opacity:0}}` +
    `.cfm-cur{animation:cfm-cur 1.1s step-end infinite}` +
    `@media (prefers-reduced-motion:reduce){.cfm-cur{animation:none}}` +
    `</style>`
  );

  out.push(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`);

  // Window chrome. The three dots are drawn, not typed, so no font can shift them.
  out.push(`<rect width="${W}" height="22" fill="${c.chrome}"/>`);
  out.push(
    `<circle cx="16" cy="11" r="4" fill="${c.dim}"/>` +
    `<circle cx="30" cy="11" r="4" fill="${c.dim}"/>` +
    `<circle cx="44" cy="11" r="4" fill="${c.dim}"/>`
  );
  const tab = fitText(`${esc(state.user)}@commit-fm`, 260, 10, "mono");
  out.push(`<text x="62" y="15" font-size="10" fill="${c.dim}"${MONO}>${tab}</text>`);

  // Prompt line.
  out.push(
    `<text x="${P}" y="44" font-size="12"${MONO}>` +
    `<tspan fill="${c.dim}">$</tspan>` +
    `<tspan fill="${c.fg}" dx="8">commit-fm</tspan>` +
    `<tspan fill="${c.dim}" dx="8">--watch</tspan>` +
    `</text>`
  );

  // Repo name, with a right-aligned state badge. The badge is measured and
  // placed from the right edge, and the name is truncated to whatever is left,
  // so the two can never meet.
  const badge = state.live ? "LIVE" : ago(now.ageMinutes) + " ago";
  const badgeW = measure(badge, 11, "mono", 1.5);
  const badgeX = RIGHT - badgeW;
  out.push(
    `<text x="${n(badgeX)}" y="72" font-size="11" letter-spacing="1.5" ` +
    `fill="${state.live ? c.accent : c.dim}"${MONO}>${esc(badge)}</text>`
  );
  if (state.live) {
    out.push(`<circle class="cfm-cur" cx="${n(badgeX - 12)}" cy="68" r="3.5" fill="${c.accent}"/>`);
  }

  const nameMax = badgeX - P - 30;
  const name = fitText(now.name, nameMax, 21, "mono");
  out.push(
    `<text x="${P}" y="74" font-size="21" fill="${c.hot}"${MONO}>` +
    `<tspan fill="${c.dim}">&#9654; </tspan>${esc(name)}</text>`
  );

  // Description or the live broadcast note, one line, truncated to fit exactly.
  const line = state.live && state.note ? state.note : now.description;
  if (line) {
    out.push(
      `<text x="${P}" y="96" font-size="12.5" fill="${state.live ? c.accent : c.body}"${MONO}>` +
      `${esc(fitText(line, RIGHT - P, 12.5, "mono"))}</text>`
    );
  }

  // Meta row, flowed from measured widths and clipped at the right margin.
  const bits = [];
  if (now.language) bits.push({ text: now.language.toLowerCase(), fill: c.accent });
  if (state.stats.pushesThisWeek) bits.push({ text: `${state.stats.pushesThisWeek} pushes this week`, fill: c.body });
  if (state.rotation.length) bits.push({ text: `${state.rotation.length + 1} in rotation`, fill: c.body });
  if (state.stats.privateContributions) bits.push({ text: `+${state.stats.privateContributions} private`, fill: c.dim });

  const items = [];
  bits.forEach((b, i) => {
    if (i > 0) items.push({ text: "·", size: 11, kind: "mono", fill: c.dim });
    items.push({ text: b.text, size: 11, kind: "mono", fill: b.fill });
  });
  for (const it of flowRow(items, P, RIGHT, 8)) {
    out.push(`<text x="${n(it.x)}" y="118" font-size="${n(it.size)}" fill="${it.fill}"${MONO}>${esc(it.text)}</text>`);
  }

  // Spectrum: 24 bars, one per hour, standing at real push counts.
  const hourly = Array.isArray(state.stats.hourly) && state.stats.hourly.length === 24
    ? state.stats.hourly
    : new Array(24).fill(0);
  const barW = 21, barGap = 11;
  out.push(spectrumBars({
    values: hourly, x: P, baseline: 152, barWidth: barW, gap: barGap,
    maxHeight: 30, fill: c.bar, minHeight: 2,
  }));
  out.push(`<rect x="${P}" y="153" width="${n(24 * (barW + barGap) - barGap)}" height="1" fill="${c.rule}"/>`);
  out.push(`<text x="${P}" y="166" font-size="9" letter-spacing="1" fill="${c.dim}"${MONO}>PUSHES PER HOUR, LAST 24</text>`);

  // Queue. Scrolls only if it overflows, at a readable pace.
  const queue = state.rotation.map((r) => `${r.name} ${ago(r.ageMinutes)}`);
  if (queue.length) {
    const plain = "queue: " + queue.join("  ·  ");
    const content =
      `<tspan fill="${c.dim}">queue: </tspan>` +
      queue.map((q, i) => {
        const [nm, age] = [q.slice(0, q.lastIndexOf(" ")), q.slice(q.lastIndexOf(" ") + 1)];
        return (i ? `<tspan fill="${c.dim}">  ·  </tspan>` : "") +
          `<tspan fill="${c.fg}">${esc(nm)}</tspan><tspan fill="${c.dim}"> ${esc(age)}</tspan>`;
      }).join("");
    out.push(marquee({
      id: "cfm-q", x: P, y: 188, width: RIGHT - P, height: 18,
      content, plain, size: 11.5, kind: "mono",
      attrs: MONO, pxPerSecond: 16, gap: 70,
    }));
  }

  out.push(svgClose);
  return out.join("");
}
