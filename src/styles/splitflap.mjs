/**
 * Split-flap departure board.
 *
 * The only family whose core mechanic already is the requirement: a moving list
 * of what is coming up. It reads as a schedule being announced rather than a
 * card reporting statistics, and it is the one style that gets better the more
 * repositories you have rather than worse.
 *
 * Layout is computed from measured widths, and the hero is built from
 * fixed-width character tiles, so a long repository name shortens the tile
 * count instead of running into the description panel.
 */

import { svgOpen, svgClose, esc, n, vScroll, ago, fitText } from "../svg.mjs";
import { measure } from "../measure.mjs";

export const meta = {
  id: "splitflap",
  name: "Split-flap board",
  blurb: "An airport departures board. Mechanical, authoritative, scales with your repo count.",
};

const PALETTE = {
  dark: { case: "#121212", header: "#1c1c1c", seam: "#121212", dim: "#6f6a5e", ink: "#17150f", sub: "#4a463c" },
  light: { case: "#2a2a28", header: "#343430", seam: "#1a1a18", dim: "#8f897b", ink: "#17150f", sub: "#4a463c" },
};

const YELLOW = "#f2c230";
const FLAP = ` font-family="'Archivo Black','Helvetica Neue',Arial Black,Arial,sans-serif" font-weight="800"`;
const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;

const TILE_W = 38;
const TILE_GAP = 4;
const HERO_MAX_PX = 330;

export function render(state, opts = {}) {
  const W = opts.width ?? 800;
  const H = opts.height ?? 200;
  const P = 14;
  const c = PALETTE[state.theme === "light" ? "light" : "dark"];
  const now = state.now ?? { name: "nothing playing", description: "", language: "", ageMinutes: 0 };
  const out = [];

  out.push(svgOpen({
    width: W, height: H,
    title: `Commit FM: ${now.name}`,
    label: `Now building ${now.name}. ${now.description || "No description."}`,
  }));

  // The flip is a scaleY squash, because SVG has no real rotateX. Staggered so
  // it cascades left to right the way a real board does, and slow enough that
  // it reads as mechanical rather than as flicker.
  const stagger = [];
  for (let i = 0; i < 10; i++) {
    stagger.push(`.cfm-f${i}{animation:cfm-flip 5.4s ease-in-out ${(i * 0.09).toFixed(2)}s infinite;transform-origin:center;transform-box:fill-box}`);
  }
  out.push(
    `<style>@keyframes cfm-flip{0%,88%{transform:scaleY(1)}91%{transform:scaleY(.06)}94.5%{transform:scaleY(.6)}100%{transform:scaleY(1)}}` +
    stagger.join("") +
    `@keyframes cfm-tick{0%,49%{opacity:1}50%,100%{opacity:.2}}` +
    `.cfm-tick{animation:cfm-tick 1.3s step-end infinite}` +
    `@media (prefers-reduced-motion:reduce){[class^="cfm-f"],.cfm-tick{animation:none}}</style>`
  );

  out.push(
    `<defs><linearGradient id="cfm-tile" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#f3f0e6"/><stop offset="0.49" stop-color="#e4e0d3"/>` +
    `<stop offset="0.51" stop-color="#d8d4c6"/><stop offset="1" stop-color="#eae6da"/>` +
    `</linearGradient></defs>`
  );

  out.push(`<rect width="${W}" height="${H}" fill="${c.case}"/>`);

  // Header.
  out.push(`<rect width="${W}" height="26" fill="${c.header}"/>`);
  out.push(`<rect x="${P}" y="6" width="132" height="15" fill="${YELLOW}"/>`);
  out.push(`<text x="${P + 6}" y="18" font-size="10" letter-spacing="1.5" fill="#121212"${FLAP}>NOW BUILDING</text>`);
  out.push(`<text x="${P + 146}" y="18" font-size="10" letter-spacing="2" fill="${c.dim}"${MONO}>${esc(fitText(state.user.toUpperCase(), 240, 10, "mono", 2))}</text>`);
  const liveLabel = state.live ? "BROADCASTING" : "LIVE";
  const liveW = measure(liveLabel, 10, "mono", 2) + 14;
  out.push(`<text class="cfm-tick" x="${n(W - P - liveW)}" y="18" font-size="10" letter-spacing="2" fill="${YELLOW}"${MONO}>&#9679; ${esc(liveLabel)}</text>`);

  // Hero: one tile per character, capped so the description panel always fits.
  const maxTiles = Math.max(3, Math.floor((HERO_MAX_PX + TILE_GAP) / (TILE_W + TILE_GAP)));
  const chars = Array.from(now.name.toUpperCase()).slice(0, maxTiles);
  const heroW = chars.length * TILE_W + (chars.length - 1) * TILE_GAP;

  chars.forEach((ch, i) => {
    const x = P + i * (TILE_W + TILE_GAP);
    out.push(`<g class="cfm-f${i % 10}"><rect x="${n(x)}" y="34" width="${TILE_W}" height="48" rx="2" fill="url(#cfm-tile)"/></g>`);
  });
  chars.forEach((ch, i) => {
    const x = P + i * (TILE_W + TILE_GAP);
    out.push(`<text x="${n(x + TILE_W / 2)}" y="68" font-size="27" fill="${c.ink}" text-anchor="middle"${FLAP}>${esc(ch)}</text>`);
    out.push(`<path d="M${n(x)} 58 H${n(x + TILE_W)}" stroke="${c.seam}" stroke-width="1.4" opacity="0.75"/>`);
  });

  // Description panel.
  const px = P + heroW + 10;
  const pw = W - P - px;
  out.push(`<rect x="${n(px)}" y="34" width="${n(pw)}" height="48" rx="2" fill="url(#cfm-tile)"/>`);
  out.push(`<path d="M${n(px)} 58 H${n(px + pw)}" stroke="${c.seam}" stroke-width="1.4" opacity="0.75"/>`);

  const line = (state.live && state.note ? state.note : now.description) || "";
  out.push(
    `<text x="${n(px + 14)}" y="54" font-size="13" letter-spacing="0.5" fill="${c.ink}"${FLAP}>` +
    `${esc(fitText(line.toUpperCase(), pw - 28, 13, "black", 0.5))}</text>`
  );

  const facts = [];
  if (now.language) facts.push(now.language.toUpperCase());
  if (state.stats.pushesThisWeek) facts.push(`${state.stats.pushesThisWeek} PUSHES THIS WEEK`);
  facts.push(`PUSHED ${ago(now.ageMinutes).toUpperCase()} AGO`);
  if (state.stats.privateContributions) facts.push(`+${state.stats.privateContributions} PRIVATE`);
  out.push(
    `<text x="${n(px + 14)}" y="74" font-size="10" letter-spacing="1.5" fill="${c.sub}"${MONO}>` +
    `${esc(fitText(facts.join(" · "), pw - 28, 10, "mono", 1.5))}</text>`
  );

  // Column geometry, computed once and shared by the headers and every row.
  const COLS = [
    { key: "repo", x: P, w: 156, label: "REPO" },
    { key: "what", x: P + 162, w: W - P - 162 - 212 - 6, label: "WHAT IT IS" },
    { key: "lang", x: W - P - 206, w: 88, label: "LANG" },
    { key: "push", x: W - P - 112, w: 112, label: "LAST PUSH" },
  ];
  for (const col of COLS) {
    out.push(`<text x="${n(col.x + 2)}" y="94" font-size="8" letter-spacing="2" fill="${c.dim}"${MONO}>${col.label}</text>`);
  }

  const rowH = 32;
  const rows = state.rotation.map((r) => {
    const cells = [
      fitText(r.name.toUpperCase(), COLS[0].w - 20, 12, "black"),
      fitText((r.description || "").toUpperCase(), COLS[1].w - 20, 11, "black"),
      fitText((r.language || "").toUpperCase(), COLS[2].w - 20, 11, "black"),
      ago(r.ageMinutes).toUpperCase(),
    ];
    return COLS.map((col, i) =>
      `<rect x="${n(col.x)}" y="0" width="${n(col.w)}" height="26" rx="2" fill="url(#cfm-tile)"/>` +
      `<text x="${n(col.x + 10)}" y="18" font-size="${i === 0 ? 12 : 11}" fill="${c.ink}"${FLAP}>${esc(cells[i])}</text>`
    ).join("");
  });

  if (rows.length) {
    out.push(vScroll({
      id: "cfm-board", x: 0, y: 100, width: W, height: 96,
      rows, rowHeight: rowH, visible: 3, secondsPerRow: 4.2,
    }));
  }

  out.push(svgClose);
  return out.join("");
}
