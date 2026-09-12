// Builds the Vela mark ("The Kept Light", soft-arch window) as outlined vector files, the lockups with the
// wordmark converted to paths from Literata SemiBold, the app icons as PNG, and an exploration sheet.
// Run from the repo root: node tools/brand/build-mark.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as ot from "opentype.js";
import { Resvg } from "@resvg/resvg-js";

const parse = ot.parse ?? ot.default?.parse;
const OUT = "design/brand";
mkdirSync(`${OUT}/icons`, { recursive: true });

// ---- palette (design/design-system.md)
const INK = "#1E1A16", INK2 = "#5A534B", INK3 = "#7A7267", CREAM = "#FBF7F0", CREAM2 = "#F3EDE4", RULE = "#E8E1D6";
const AMBER = "#E9A23B", SOFT = "#FBEBCF", DARK = "#1B1714", WHITE = "#FFFFFF";

// ---- locked geometry (window 100 x 132 units, stroke centred on that outline)
const G = { w: 100, h: 132, topR: 34, botR: 14, frame: 11, muntin: 6, transom: 0.40, smallFrame: 16 };

// rounded window outline with different top and bottom radii, inset by `i` (positive = inward)
function outline(i, topR, botR, w = G.w, h = G.h) {
  const x0 = i, y0 = i, x1 = w - i, y1 = h - i;
  const rt = Math.max(0, topR - i), rb = Math.max(0, botR - i);
  return `M${x0 + rt} ${y0}H${x1 - rt}A${rt} ${rt} 0 0 1 ${x1} ${y0 + rt}V${y1 - rb}A${rb} ${rb} 0 0 1 ${x1 - rb} ${y1}H${x0 + rb}A${rb} ${rb} 0 0 1 ${x0} ${y1 - rb}V${y0 + rt}A${rt} ${rt} 0 0 1 ${x0 + rt} ${y0}Z`;
}
const r3 = (n) => Math.round(n * 1000) / 1000;

// The mark as filled paths only (no strokes), so it is a clean vector master.
// Returns SVG inner markup positioned at the origin; bounding box is (-f/2, -f/2) to (w+f/2, h+f/2).
function markPaths({ frame = INK, pane = AMBER, muntin = INK, muntins = true, frameW = G.frame, topR = G.topR, transom = G.transom } = {}) {
  const f = frameW / 2;
  const parts = [];
  if (pane && pane !== "none") parts.push(`<path d="${outline(f, topR, G.botR)}" fill="${pane}"/>`);
  parts.push(`<path fill-rule="evenodd" d="${outline(-f, topR, G.botR)}${outline(f, topR, G.botR)}" fill="${frame}"/>`);
  if (muntins) {
    const m = G.muntin / 2, ty = G.h * transom;
    parts.push(`<rect x="${r3(G.w / 2 - m)}" y="${r3(f)}" width="${G.muntin}" height="${r3(G.h - 2 * f)}" fill="${muntin}"/>`);
    parts.push(`<rect x="${r3(f)}" y="${r3(ty - m)}" width="${r3(G.w - 2 * f)}" height="${G.muntin}" fill="${muntin}"/>`);
  }
  return parts.join("\n");
}
function markSvg(opts, { pad = 8, bg = null, halo = null } = {}) {
  const f = (opts.frameW ?? G.frame) / 2;
  const x0 = -f - pad, y0 = -f - pad, w = G.w + 2 * f + 2 * pad, h = G.h + 2 * f + 2 * pad;
  const bgRect = bg ? `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${bg}"/>` : "";
  const haloEl = halo ? `<ellipse cx="${G.w / 2}" cy="${G.h * 0.45}" rx="${G.w * 1.1}" ry="${G.h * 0.9}" fill="${halo}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r3(x0)} ${r3(y0)} ${r3(w)} ${r3(h)}" width="${r3(w)}" height="${r3(h)}">
${bgRect}${haloEl}
${markPaths(opts)}
</svg>
`;
}

// ---- wordmark outlined from Literata SemiBold
const font = parse(readFileSync("design/brand/fonts/Literata-SemiBold.ttf").buffer);
const upm = font.unitsPerEm;
const capH = (font.tables.os2?.sCapHeight || 0.66 * upm) / upm;
const MARK_OUTER_H = G.h + G.frame; // 143
const WORD_CAP = 0.58 * MARK_OUTER_H; // cap height of the wordmark relative to the mark
const WORD_SIZE = WORD_CAP / capH;
const GAP = 0.30 * MARK_OUTER_H;
const BASELINE = G.h + G.frame / 2 - 0.05 * MARK_OUTER_H; // slightly above the mark's bottom edge
function wordmarkPath(x, y, size, fill) {
  const p = font.getPath("Vela", x, y, size, { kerning: true, letterSpacing: -0.004 });
  const bb = p.getBoundingBox();
  return { d: `<path d="${p.toPathData(2)}" fill="${fill}"/>`, bb };
}

// ---- 1. mark files
writeFileSync(`${OUT}/vela-mark.svg`, markSvg({}));
writeFileSync(`${OUT}/vela-mark-mono.svg`, markSvg({ pane: "none", frame: "currentColor", muntin: "currentColor" }));
writeFileSync(`${OUT}/vela-mark-reversed.svg`, markSvg({ frame: CREAM2, muntin: CREAM2 }, { bg: DARK, pad: 24 }));
writeFileSync(`${OUT}/vela-mark-small.svg`, markSvg({ muntins: false, frameW: G.smallFrame }));
writeFileSync(`${OUT}/vela-mark-small-mono.svg`, markSvg({ muntins: false, frameW: G.smallFrame, pane: "none", frame: "currentColor" }));

// ---- 2. wordmark and lockups
{
  const wm = wordmarkPath(0, 0, WORD_SIZE, INK);
  const bb = wm.bb, pad = 10;
  writeFileSync(`${OUT}/vela-wordmark.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r3(bb.x1 - pad)} ${r3(bb.y1 - pad)} ${r3(bb.x2 - bb.x1 + 2 * pad)} ${r3(bb.y2 - bb.y1 + 2 * pad)}">\n${wm.d}\n</svg>\n`);
  const lock = (ink, pane, muntin, bg, name) => {
    const f = G.frame / 2, pad = bg ? 28 : 12;
    const wx = G.w + f + GAP;
    const w2 = wordmarkPath(wx, BASELINE, WORD_SIZE, ink);
    const x0 = -f - pad, y0 = -f - pad, W = w2.bb.x2 + pad - x0, H = G.h + f + pad - y0;
    const bgRect = bg ? `<rect x="${r3(x0)}" y="${r3(y0)}" width="${r3(W)}" height="${r3(H)}" fill="${bg}"/>` : "";
    writeFileSync(`${OUT}/${name}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r3(x0)} ${r3(y0)} ${r3(W)} ${r3(H)}">\n${bgRect}\n${markPaths({ frame: ink, pane, muntin })}\n${w2.d}\n</svg>\n`);
  };
  lock(INK, AMBER, INK, null, "vela-lockup.svg");
  lock("currentColor", "none", "currentColor", null, "vela-lockup-mono.svg");
  lock(CREAM2, AMBER, CREAM2, DARK, "vela-lockup-reversed.svg");
  // vertical lockup: mark above the wordmark, centred (splash screens, square placements)
  const vlock = (ink, pane, muntin, bg, name) => {
    const f = G.frame / 2, pad = bg ? 32 : 14, vsize = WORD_SIZE * 0.56;
    const probe = wordmarkPath(0, 0, vsize, ink).bb, ww = probe.x2 - probe.x1;
    const wx = G.w / 2 - ww / 2 - probe.x1, wy = G.h + f + 0.26 * MARK_OUTER_H + vsize * capH;
    const w2 = wordmarkPath(wx, wy, vsize, ink);
    const x0 = Math.min(-f, w2.bb.x1) - pad, x1 = Math.max(G.w + f, w2.bb.x2) + pad, y0 = -f - pad, y1 = w2.bb.y2 + pad;
    const bgRect = bg ? `<rect x="${r3(x0)}" y="${r3(y0)}" width="${r3(x1 - x0)}" height="${r3(y1 - y0)}" fill="${bg}"/>` : "";
    writeFileSync(`${OUT}/${name}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r3(x0)} ${r3(y0)} ${r3(x1 - x0)} ${r3(y1 - y0)}">\n${bgRect}\n${markPaths({ frame: ink, pane, muntin })}\n${w2.d}\n</svg>\n`);
  };
  vlock(INK, AMBER, INK, null, "vela-lockup-vertical.svg");
  vlock(CREAM2, AMBER, CREAM2, DARK, "vela-lockup-vertical-reversed.svg");
}

// ---- 3. app icons (PNG via resvg)
function iconSvg({ dark = false, simplified = false, mono = false } = {}) {
  const S = 1024, r = 0; // iOS masks its own corners; Android adaptive icons use the safe zone
  const bg = mono ? "#000000" : dark ? DARK : CREAM;
  const scale = (simplified ? 0.50 : 0.56) * S / MARK_OUTER_H;
  const mw = (G.w + G.frame) * scale, mh = MARK_OUTER_H * scale;
  const tx = (S - mw) / 2 + (G.frame / 2) * scale, ty = (S - mh) / 2 + (G.frame / 2) * scale;
  const halo = mono ? "" : `<radialGradient id="h" cx="50%" cy="46%" r="50%"><stop offset="0" stop-color="${AMBER}" stop-opacity="${dark ? 0.30 : 0.55}"/><stop offset="0.55" stop-color="${AMBER}" stop-opacity="${dark ? 0.08 : 0.18}"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>`;
  const paneGrad = `<radialGradient id="p" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#F7CB6E"/><stop offset="1" stop-color="${AMBER}"/></radialGradient>`;
  const opts = mono
    ? { frame: WHITE, muntin: WHITE, pane: "none", muntins: !simplified, frameW: simplified ? G.smallFrame : G.frame }
    : { frame: dark ? CREAM2 : INK, muntin: dark ? CREAM2 : INK, pane: "url(#p)", muntins: !simplified, frameW: simplified ? G.smallFrame : G.frame };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><defs>${halo}${paneGrad}</defs><rect width="${S}" height="${S}" rx="${r}" fill="${bg}"/>${mono ? "" : `<ellipse cx="${S / 2}" cy="${S * 0.47}" rx="${S * 0.42}" ry="${S * 0.42}" fill="url(#h)"/>`}<g transform="translate(${r3(tx)},${r3(ty)}) scale(${r3(scale)})">${markPaths(opts)}</g></svg>`;
}
function png(svg, size, file, withText = false) {
  const font = withText ? { loadSystemFonts: true, defaultFontFamily: "Arial" } : { loadSystemFonts: false };
  const r = new Resvg(svg, { fitTo: { mode: "width", value: size }, font });
  writeFileSync(file, r.render().asPng());
}
writeFileSync(`${OUT}/icons/app-icon.svg`, iconSvg());
writeFileSync(`${OUT}/icons/app-icon-dark.svg`, iconSvg({ dark: true }));
writeFileSync(`${OUT}/icons/app-icon-monochrome.svg`, iconSvg({ mono: true }));
for (const s of [1024, 512, 192, 180]) png(iconSvg(), s, `${OUT}/icons/app-icon-${s}.png`);
png(iconSvg({ dark: true }), 1024, `${OUT}/icons/app-icon-dark-1024.png`);
png(iconSvg({ mono: true }), 1024, `${OUT}/icons/app-icon-monochrome-1024.png`);
for (const s of [64, 48, 32, 16]) png(iconSvg({ simplified: true }), s, `${OUT}/icons/favicon-${s}.png`);
writeFileSync(`${OUT}/icons/favicon.svg`, markSvg({ muntins: false, frameW: G.smallFrame }, { pad: 6 }));
png(markSvg({}), 1024, `${OUT}/vela-mark-1024.png`);
{
  // lockup PNG for decks and mail signatures
  const svg = readFileSync(`${OUT}/vela-lockup.svg`, "utf8");
  png(svg, 2400, `${OUT}/vela-lockup-2400.png`);
  png(readFileSync(`${OUT}/vela-lockup-reversed.svg`, "utf8"), 2400, `${OUT}/vela-lockup-reversed-2400.png`);
  png(readFileSync(`${OUT}/vela-lockup-vertical.svg`, "utf8"), 1200, `${OUT}/vela-lockup-vertical-1200.png`);
}

// ---- 4. exploration sheet: arch radius x transom height, frame weights, and the locked choice
{
  const W = 1200, H = 900, o = [];
  const lab = (x, y, t, fill = INK3, size = 12, extra = "") => `<text x="${x}" y="${y}" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${size}" fill="${fill}" ${extra}>${t}</text>`;
  const eyebrow = (x, y, t) => lab(x, y, t, INK3, 11, 'letter-spacing="1.6" font-weight="600"');
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${CREAM}"/>`);
  o.push(eyebrow(40, 40, "VELA · THE KEPT LIGHT · SOFT ARCH · GEOMETRY EXPLORATION AND THE LOCKED MARK · 2026-09-12"));
  o.push(eyebrow(40, 84, "A · ARCH RADIUS (ACROSS) × TRANSOM HEIGHT (DOWN)"));
  const radii = [26, 34, 42], trans = [0.36, 0.40, 0.44];
  trans.forEach((t, ri) => radii.forEach((R, ci) => {
    const x = 70 + ci * 150, y = 110 + ri * 175, s = 0.95;
    const chosen = R === G.topR && t === G.transom;
    if (chosen) o.push(`<rect x="${x - 26}" y="${y - 22}" width="${100 * s + 52}" height="${132 * s + 56}" rx="14" fill="none" stroke="#1F5C66" stroke-width="2"/>`);
    o.push(`<g transform="translate(${x},${y}) scale(${s})">${markPaths({ topR: R, transom: t })}</g>`);
    o.push(lab(x + 50 * s, y + 132 * s + 26, `r ${R} · transom ${Math.round(t * 100)}%${chosen ? " · locked" : ""}`, chosen ? "#1F5C66" : INK3, 11, 'text-anchor="middle"' + (chosen ? ' font-weight="600"' : "")));
  }));
  [
    "r 26 is a rounded card; r 42 is nearly the church arch again.",
    "34 keeps the arch readable at 24 px and the top panes wide enough for the light.",
    "Transom at 36% pinches the top panes; at 44% the four panes start to look equal,",
    "and equal panes read as a plus. 40% is the sash window.",
  ].forEach((t, i) => o.push(lab(70, 655 + i * 18, t, INK2, 12)));

  o.push(eyebrow(560, 84, "B · FRAME WEIGHT"));
  [9, 11, 13].forEach((fw, i) => {
    const x = 590 + i * 130, y = 110, s = 0.8;
    o.push(`<g transform="translate(${x},${y}) scale(${s})">${markPaths({ frameW: fw, muntin: INK })}</g>`);
    o.push(lab(x + 40, y + 132 * s + 24, `frame ${fw}${fw === G.frame ? " · locked" : ""}`, fw === G.frame ? "#1F5C66" : INK3, 11, 'text-anchor="middle"' + (fw === G.frame ? ' font-weight="600"' : "")));
  });
  o.push(lab(590, 262, "9 disappears in one colour at 32 px; 13 gets heavy next to the wordmark.", INK2, 12));
  o.push(lab(590, 280, "11 with muntins at 6 keeps a 1.8:1 hierarchy between frame and bars.", INK2, 12));

  o.push(eyebrow(560, 310, "C · THE LOCKED MARK"));
  const w2 = wordmarkPath(590 + 100 + 5.5 + GAP * 0.9, 340 + BASELINE * 0.9, WORD_SIZE * 0.9, INK);
  o.push(`<g transform="translate(590,340) scale(0.9)">${markPaths({})}</g>`);
  o.push(w2.d);
  [
    "Window 100 × 132 · arch radius 34 · bottom radius 14 · frame 11 · muntins 6 · transom 40%.",
    "Wordmark Literata SemiBold, outlined; cap height 58% of the mark, gap 30%, baseline 5% above the foot.",
    "Clear space: half the mark's height on every side. Minimum 32 px with muntins, 16 px simplified.",
  ].forEach((t, i) => o.push(lab(590, 500 + i * 18, t, INK2, 11.5)));

  o.push(eyebrow(560, 566, "D · THE THREE STATES AND THE SMALL MARK"));
  o.push(`<g transform="translate(590,590) scale(0.6)">${markPaths({})}</g>`);
  o.push(`<rect x="700" y="585" width="110" height="100" rx="8" fill="${WHITE}" stroke="${RULE}"/><g transform="translate(725,592) scale(0.6)">${markPaths({ pane: "none" })}</g>`);
  o.push(`<rect x="830" y="585" width="110" height="100" rx="8" fill="${DARK}"/><g transform="translate(855,592) scale(0.6)">${markPaths({ frame: CREAM2, muntin: CREAM2 })}</g>`);
  o.push(`<g transform="translate(980,600) scale(0.5)">${markPaths({ muntins: false, frameW: G.smallFrame })}</g>`);
  o.push(`<g transform="translate(1060,640) scale(0.19)">${markPaths({ muntins: false, frameW: G.smallFrame })}</g>`);
  o.push(`<g transform="translate(1100,650) scale(0.12)">${markPaths({ muntins: false, frameW: G.smallFrame })}</g>`);
  o.push(lab(590 + 30, 706, "full colour", INK3, 11, 'text-anchor="middle"'));
  o.push(lab(755, 706, "one colour", INK3, 11, 'text-anchor="middle"'));
  o.push(lab(885, 706, "reversed", INK3, 11, 'text-anchor="middle"'));
  o.push(lab(1040, 706, "small mark · 24 · 16", INK3, 11, 'text-anchor="middle"'));

  o.push(eyebrow(560, 750, "E · APP ICON"));
  const ic = (x, svg) => o.push(`<g transform="translate(${x},770) scale(0.1)"><clipPath id="c${x}"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#c${x})">${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g></g>`);
  ic(590, iconSvg()); ic(710, iconSvg({ dark: true })); ic(830, iconSvg({ mono: true })); ic(950, iconSvg({ simplified: true }));
  o.push(lab(641, 892, "light", INK3, 11, 'text-anchor="middle"')); o.push(lab(761, 892, "dark", INK3, 11, 'text-anchor="middle"')); o.push(lab(881, 892, "Android mono", INK3, 11, 'text-anchor="middle"')); o.push(lab(1001, 892, "simplified", INK3, 11, 'text-anchor="middle"'));
  o.push(`</svg>`);
  writeFileSync(`${OUT}/logo-soft-arch.svg`, o.join("\n") + "\n");
  png(o.join("\n"), 2400, `${OUT}/logo-soft-arch.png`, true);
}
console.log(`wrote mark, lockups, icons, and the exploration sheet to ${OUT}/ (cap height ratio ${r3(capH)}, wordmark size ${r3(WORD_SIZE)})`);
