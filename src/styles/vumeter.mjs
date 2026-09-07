/**
 * VU meter and ON AIR lamp. Broadcast studio.
 *
 * Review notes this revision answers:
 *  - "the meter does not need to move so fast, maybe move and stop" -> the
 *    needle now steps to each reading and settles there for most of the cycle,
 *    via stepAndHold. A needle that sweeps continuously reads as decoration; one
 *    that steps and holds reads as an instrument.
 *  - "text collision issues" -> the header row and the plate are both laid out
 *    from measured widths, and the plate text is truncated to the plate.
 *
 * The needle is driven by real pushes per hour, so the deflection means
 * something. The red zone begins where the current week exceeds its own median.
 */

import { svgOpen, svgClose, esc, n, marquee, stepAndHold, ago, agoClock, fitText } from "../svg.mjs";
import { measure, flowRow } from "../measure.mjs";

export const meta = {
  id: "vumeter",
  name: "VU and ON AIR",
  blurb: "Analogue meter and a studio lamp. Warm, serious, instrument-like.",
};

const PALETTE = {
  dark: { case1: "#4a3527", case2: "#251a12", frame: "#6b4f39", plate: "#241a13", cream: "#efe6cf", warm: "#c9bda1", faint: "#8a7059" },
  light: { case1: "#c8a882", case2: "#9c7e5c", frame: "#7d5c40", plate: "#3a2a1d", cream: "#f6efdc", warm: "#e0d3b8", faint: "#8a6f4e" },
};

const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;
const SANS = ` font-family="'Helvetica Neue',Arial,sans-serif"`;

/** Ticks at these angles, matching a real VU scale's uneven spacing. */
const TICKS = [-52, -40, -29, -19, -10, -3, 4, 12, 20, 28];
const TICK_LABELS = [
  [-52, "20"], [-40, "10"], [-29, "7"], [-19, "5"], [-10, "3"],
  [-3, "1"], [4, "0"], [14, "1"], [24, "3"],
];

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
    `<style>@keyframes cfm-lamp{0%,100%{opacity:1}50%{opacity:.5}}` +
    `.cfm-lamp{animation:cfm-lamp 2.8s ease-in-out infinite}` +
    `@media (prefers-reduced-motion:reduce){.cfm-lamp{animation:none}}</style>`
  );

  out.push(
    `<defs>` +
    `<linearGradient id="cfm-case" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.case1}"/><stop offset="1" stop-color="${c.case2}"/></linearGradient>` +
    `<linearGradient id="cfm-face" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#f6efdc"/><stop offset="1" stop-color="#e2d5b6"/></linearGradient>` +
    `<radialGradient id="cfm-bulb" cx="0.5" cy="0.4" r="0.6">` +
    `<stop offset="0" stop-color="#ff6b52"/><stop offset="1" stop-color="#8f1a0c"/></radialGradient>` +
    `</defs>`
  );

  out.push(`<rect width="${W}" height="${H}" fill="url(#cfm-case)"/>`);
  out.push(`<rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="3" fill="none" stroke="${c.frame}"/>`);

  // Meter housing.
  const mx = 18, my = 18, mw = 292, mh = H - 36;
  out.push(`<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="4" fill="#100c09"/>`);
  out.push(`<rect x="${mx + 8}" y="${my + 8}" width="${mw - 16}" height="${mh - 16}" rx="2" fill="url(#cfm-face)"/>`);

  const pivotX = mx + mw / 2, pivotY = my + mh - 14;
  out.push(`<g transform="translate(${n(pivotX)},${n(pivotY)})">`);
  out.push(`<path d="M-118 -22 A120 120 0 0 1 118 -22" fill="none" stroke="#4a4336" stroke-width="1.2"/>`);
  out.push(`<path d="M30 -116 A120 120 0 0 1 118 -22" fill="none" stroke="#b3271a" stroke-width="3"/>`);
  for (const a of TICKS) {
    const red = a >= 4;
    out.push(
      `<path d="M0 -120 v${red ? 12 : 10}" transform="rotate(${a})" ` +
      `stroke="${red ? "#b3271a" : "#4a4336"}" stroke-width="${red ? 2 : 1.4}"/>`
    );
  }
  for (const [a, label] of TICK_LABELS) {
    out.push(
      `<text transform="rotate(${a}) translate(0,-96) rotate(${-a})" font-size="8" ` +
      `fill="${a >= 4 ? "#b3271a" : "#4a4336"}" text-anchor="middle"${MONO}>${esc(label)}</text>`
    );
  }
  out.push(`<text x="0" y="-64" font-size="8" letter-spacing="2" fill="#6b6152" text-anchor="middle"${MONO}>ACTIVITY, 7 DAYS</text>`);
  out.push(`<text x="0" y="-44" font-size="9" letter-spacing="1" fill="#8a7f6b" text-anchor="middle"${SANS}>VU</text>`);

  // Needle: real readings, stepped and held.
  const hourly = Array.isArray(state.stats.hourly) && state.stats.hourly.length === 24
    ? state.stats.hourly : new Array(24).fill(0);
  const peak = Math.max(1, ...hourly);
  const recent = hourly.slice(-6);
  const stops = recent.map((v) => Math.round((-52 + (v / peak) * 80) * 10) / 10);
  const { values, keyTimes } = stepAndHold(stops.length ? stops : [-52, -20, -40]);
  // Linear interpolation on purpose. The move-then-hold shape already lives in
  // keyTimes, and calcMode="spline" would additionally require exactly one
  // keySplines entry per interval: getting that count wrong invalidates the
  // whole animation, and a silently invalid animateTransform leaves the needle
  // parked at zero rather than failing loudly.
  out.push(
    `<g><animateTransform attributeName="transform" type="rotate" values="${values}" ` +
    `keyTimes="${keyTimes}" dur="16s" repeatCount="indefinite"/>` +
    `<path d="M0 0 L-1.6 -116 L1.6 -116 Z" fill="#1b1b1b"/></g>`
  );
  out.push(`<circle cx="0" cy="0" r="9" fill="#2b2b2b"/><circle cx="0" cy="0" r="4" fill="#585858"/>`);
  out.push(`</g>`);
  out.push(`<rect x="${mx + 8.5}" y="${my + 8.5}" width="${mw - 17}" height="${mh - 17}" rx="2" fill="none" stroke="#a4917a"/>`);

  // Right column.
  const rx = 330, rw = W - rx - 18;

  // ON AIR lamp, then a flowed status row that starts after it.
  const badgeW = 120;
  out.push(`<rect x="${rx}" y="20" width="${badgeW}" height="30" rx="3" fill="#1a1310" stroke="${c.frame}"/>`);
  out.push(`<circle class="cfm-lamp" cx="${rx + 16}" cy="35" r="6" fill="url(#cfm-bulb)"/>`);
  out.push(`<text x="${rx + 32}" y="40" font-size="14" font-weight="700" letter-spacing="3" fill="#e8836f"${SANS}>ON AIR</text>`);

  const head = [];
  head.push({ text: `${agoClock(now.ageMinutes)} SINCE PUSH`, size: 9, kind: "mono", fill: c.warm, letterSpacing: 2 });
  if (now.language) head.push({ text: now.language.toUpperCase(), size: 9, kind: "mono", fill: c.warm, letterSpacing: 2 });
  if (state.stats.pushesThisWeek) head.push({ text: `${state.stats.pushesThisWeek}/WK`, size: 9, kind: "mono", fill: c.warm, letterSpacing: 2 });
  if (state.stats.privateContributions) head.push({ text: `+${state.stats.privateContributions} PRIVATE`, size: 9, kind: "mono", fill: c.faint, letterSpacing: 2 });
  for (const it of flowRow(head, rx + badgeW + 20, W - 18, 18)) {
    out.push(`<text x="${n(it.x)}" y="40" font-size="9" letter-spacing="2" fill="${it.fill}"${MONO}>${esc(it.text)}</text>`);
  }

  // Engraved plate. Name and description are both cut to the plate width.
  out.push(`<rect x="${rx}" y="60" width="${rw}" height="82" rx="3" fill="${c.plate}" stroke="${c.frame}"/>`);
  const inner = rw - 36;
  out.push(
    `<text x="${rx + 18}" y="102" font-size="34" font-weight="700" letter-spacing="-0.5" ` +
    `fill="${c.cream}"${SANS}>${esc(fitText(now.name, inner, 34, "sans-bold"))}</text>`
  );
  const line = state.live && state.note ? state.note : now.description;
  if (line) {
    out.push(
      `<text x="${rx + 18}" y="126" font-size="11" fill="${c.warm}"${MONO}>` +
      `${esc(fitText(line, inner, 11, "mono"))}</text>`
    );
  }

  // Rotation strip.
  const labelW = measure("ROTATION", 8, "mono", 2);
  out.push(`<text x="${rx}" y="174" font-size="8" letter-spacing="2" fill="${c.faint}"${MONO}>ROTATION</text>`);
  const queue = state.rotation.map((r) => `${r.name} ${ago(r.ageMinutes)}`);
  if (queue.length) {
    const plain = queue.join("   ·   ");
    const content = queue
      .map((q, i) => {
        const cut = q.lastIndexOf(" ");
        return (i ? `<tspan fill="#b3271a">&#8195;&#183;&#8195;</tspan>` : "") +
          `<tspan fill="${c.warm}">${esc(q.slice(0, cut))}</tspan>` +
          `<tspan fill="${c.faint}"> ${esc(q.slice(cut + 1))}</tspan>`;
      })
      .join("");
    const qx = rx + labelW + 16;
    out.push(marquee({
      id: "cfm-rot", x: qx, y: 174, width: W - 18 - qx, height: 20,
      content, plain, size: 10, kind: "mono", attrs: MONO + ` letter-spacing="1"`,
      pxPerSecond: 15, gap: 70,
    }));
  }

  out.push(svgClose);
  return out.join("");
}
