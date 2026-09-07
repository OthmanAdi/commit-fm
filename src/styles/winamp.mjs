/**
 * Winamp. The 2.x main window compressed into one strip.
 *
 * Highest nostalgia recognition per pixel of anything in the set: transport,
 * spectrum and a playlist that scrolls the rotation.
 *
 * Review note this revision answers: "too much fast movement in the freq bars,
 * a bit distracting". The bars now stand at real push counts across the
 * trailing week and breathe slowly around that height. The peak-hold caps,
 * which were the fastest moving thing in the first cut, are gone.
 *
 * The display panel stays dark in both themes on purpose. A real Winamp window
 * on a light desktop still had a black LCD, and inverting it loses the object.
 */

import { svgOpen, svgClose, esc, n, marquee, vScroll, spectrumBars, ago, agoClock, fitText } from "../svg.mjs";
import { measure, flowRow } from "../measure.mjs";

export const meta = {
  id: "winamp",
  name: "Winamp",
  blurb: "The classic skin. Loud, nostalgic, unmistakable.",
};

const PALETTE = {
  dark: { chromeTop: "#4a4a52", chromeBot: "#2a2a30", edge: "#6a6a74", shadow: "#15151a", title: "#c9c9d6", sub: "#6f6f85" },
  light: { chromeTop: "#d8d8dd", chromeBot: "#b4b4bc", edge: "#eeeef2", shadow: "#7c7c86", title: "#2a2a33", sub: "#6a6a78" },
};

const LCD_BG = "#000000";
const LCD_EDGE = "#0d3a12";
const GREEN = "#1ee62a";
const GREEN_DIM = "#0b7a15";
const MONO = ` font-family="ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace"`;

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
    `<style>@keyframes cfm-blink{0%,49%{opacity:1}50%,100%{opacity:.15}}` +
    `.cfm-blink{animation:cfm-blink 1.4s step-end infinite}` +
    `@media (prefers-reduced-motion:reduce){.cfm-blink{animation:none}}</style>`
  );

  out.push(
    `<defs>` +
    `<linearGradient id="cfm-chrome" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.chromeTop}"/><stop offset="1" stop-color="${c.chromeBot}"/></linearGradient>` +
    `<linearGradient id="cfm-title" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#3d3d5c"/><stop offset="1" stop-color="#16161f"/></linearGradient>` +
    `<linearGradient id="cfm-spec" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="52">` +
    `<stop offset="0" stop-color="#12b81c"/><stop offset="0.55" stop-color="#c8e21a"/>` +
    `<stop offset="1" stop-color="#e8452a"/></linearGradient>` +
    `</defs>`
  );

  // Shell with a one pixel bevel, light on top, dark below.
  out.push(`<rect width="${W}" height="${H}" fill="url(#cfm-chrome)"/>`);
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${c.edge}"/>`);
  out.push(`<rect x="2.5" y="2.5" width="${W - 5}" height="${H - 5}" fill="none" stroke="${c.shadow}"/>`);

  // Title bar.
  out.push(`<rect x="4" y="4" width="${W - 8}" height="20" fill="url(#cfm-title)"/>`);
  out.push(`<text x="14" y="18" font-size="10" letter-spacing="2" fill="#c9c9d6"${MONO}>COMMIT FM</text>`);
  out.push(`<text x="106" y="18" font-size="9" fill="#6f6f85"${MONO}>${esc(fitText(state.user, 200, 9, "mono"))}</text>`);
  out.push(
    `<g fill="#9a9ab0"><rect x="${W - 60}" y="9" width="10" height="10"/>` +
    `<rect x="${W - 44}" y="9" width="10" height="10"/><rect x="${W - 28}" y="9" width="10" height="10"/></g>`
  );

  // Main LCD.
  const dx = 10, dy = 32, dw = 480, dh = 66;
  out.push(`<rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" fill="${LCD_BG}"/>`);
  out.push(`<rect x="${dx + 0.5}" y="${dy + 0.5}" width="${dw - 1}" height="${dh - 1}" fill="none" stroke="${LCD_EDGE}"/>`);

  out.push(`<text x="22" y="62" font-size="26" letter-spacing="2" fill="${GREEN}"${MONO}>${agoClock(now.ageMinutes)}</text>`);
  out.push(`<text x="22" y="78" font-size="8" letter-spacing="1" fill="${GREEN_DIM}"${MONO}>SINCE LAST PUSH</text>`);

  // Scrolling title. The window starts after the clock, whose width is fixed
  // by the mono face, so the two cannot overlap regardless of the age shown.
  const titleX = 150, titleW = dx + dw - titleX - 10;
  const desc = state.live && state.note ? state.note : now.description;
  const plain = `${state.user} — ${now.name}${desc ? " · " + desc : ""}`;
  const content =
    `<tspan fill="${GREEN_DIM}">${esc(state.user)} &#8212; </tspan>` +
    `<tspan fill="${GREEN}">${esc(now.name)}</tspan>` +
    (desc ? `<tspan fill="${GREEN_DIM}"> &#183; ${esc(desc)}</tspan>` : "");
  out.push(marquee({
    id: "cfm-title-m", x: titleX, y: 57, width: titleW, height: 20,
    content, plain, size: 12, kind: "mono", attrs: MONO, pxPerSecond: 17, gap: 60,
  }));

  // The old bitrate and sample rate fields, repurposed. Flowed, so a long
  // language name cannot run into the status word.
  const metaItems = [];
  if (now.language) metaItems.push({ text: now.language.toUpperCase(), size: 9, kind: "mono", fill: GREEN_DIM, letterSpacing: 1 });
  if (state.stats.pushesThisWeek) metaItems.push({ text: `${state.stats.pushesThisWeek}/WK`, size: 9, kind: "mono", fill: GREEN_DIM, letterSpacing: 1 });
  if (state.stats.privateContributions) metaItems.push({ text: `+${state.stats.privateContributions} PRIVATE`, size: 9, kind: "mono", fill: GREEN_DIM, letterSpacing: 1 });
  metaItems.push({ text: state.live ? "▶ BROADCASTING" : "▶ PLAYING", size: 9, kind: "mono", fill: GREEN, letterSpacing: 1 });
  for (const it of flowRow(metaItems, titleX, dx + dw - 8, 14)) {
    out.push(`<text x="${n(it.x)}" y="88" font-size="9" letter-spacing="1" fill="${it.fill}"${MONO}>${esc(it.text)}</text>`);
  }

  // Spectrum panel: 24 bars, one per ~7h bucket of real push history across
  // the trailing week.
  const sx = 500, sw = W - sx - 10;
  out.push(`<rect x="${sx}" y="${dy}" width="${sw}" height="${dh}" fill="${LCD_BG}"/>`);
  out.push(`<rect x="${sx + 0.5}" y="${dy + 0.5}" width="${sw - 1}" height="${dh - 1}" fill="none" stroke="${LCD_EDGE}"/>`);
  const hourly = Array.isArray(state.stats.hourly) && state.stats.hourly.length === 24
    ? state.stats.hourly : new Array(24).fill(0);
  out.push(spectrumBars({
    values: hourly, x: sx + 12, baseline: 92, barWidth: 8, gap: 3,
    maxHeight: 52, fill: "url(#cfm-spec)", minHeight: 2,
  }));

  // Position bar, showing the week rather than a track.
  const pct = Math.max(0, Math.min(1, (new Date(state.generatedAt).getUTCDay() || 7) / 7));
  const trackW = W - 20;
  out.push(`<rect x="10" y="104" width="${trackW}" height="12" fill="#1b1b20"/>`);
  out.push(`<rect x="12" y="106" width="${n((trackW - 4) * pct)}" height="8" fill="#2f7a34"/>`);
  out.push(`<rect x="${n(10 + (trackW - 12) * pct)}" y="103" width="12" height="14" fill="#c9c9d6"/>`);

  // Playlist. Real rows, scrolled only when there are more than fit.
  const px = 10, py = 122, pw = W - 20, ph = H - py - 8;
  out.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#050505"/>`);
  out.push(`<rect x="${px + 0.5}" y="${py + 0.5}" width="${pw - 1}" height="${ph - 1}" fill="none" stroke="${LCD_EDGE}"/>`);
  out.push(`<text x="18" y="${py + 14}" font-size="8" letter-spacing="2" fill="${GREEN_DIM}"${MONO}>UP NEXT</text>`);
  out.push(`<rect class="cfm-blink" x="${W - 30}" y="${py + 7}" width="6" height="6" fill="${GREEN}"/>`);

  const rows = state.rotation.map((r, i) => {
    const num = `${i + 2}.`;
    const nameW = 150;
    const nm = fitText(r.name, nameW, 11, "mono");
    const age = ago(r.ageMinutes);
    const ageW = measure(age, 11, "mono");
    const descX = 30 + nameW + 14;
    const descMax = pw - 24 - descX - ageW - 16;
    const dsc = fitText(r.description || "", Math.max(0, descMax), 11, "mono");
    return (
      `<text x="18" y="12" font-size="11" fill="${GREEN}"${MONO}>${esc(num)}</text>` +
      `<text x="30" y="12" font-size="11" fill="${GREEN}"${MONO}>${esc(nm)}</text>` +
      (dsc ? `<text x="${n(descX)}" y="12" font-size="11" fill="${GREEN_DIM}"${MONO}>${esc(dsc)}</text>` : "") +
      `<text x="${n(pw - 16 - ageW)}" y="12" font-size="11" fill="${GREEN_DIM}"${MONO}>${esc(age)}</text>`
    );
  });

  if (rows.length) {
    out.push(vScroll({
      id: "cfm-pl", x: px + 4, y: py + 20, width: pw - 8, height: 48,
      rows, rowHeight: 16, visible: 3, secondsPerRow: 3.6,
    }));
  }

  out.push(svgClose);
  return out.join("");
}
