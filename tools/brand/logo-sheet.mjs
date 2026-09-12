// Generates design/brand/logo-round2.svg: option 1 from the founder's round, refined to the design system.
// Run: node tools/brand/logo-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const INK = "#1E1A16", INK2 = "#5A534B", INK3 = "#7A7267", CREAM = "#FBF7F0", CREAM2 = "#F3EDE4", RULE = "#E8E1D6";
const AMBER = "#E9A23B", SOFT = "#FBEBCF", DARK = "#1B1714", WHITE = "#FFFFFF";
const W = 1200, H = 900;
const o = [];

// window frame, 100 x 132 units
function framePath(kind) {
  if (kind === "soft") return "M34 0H66A34 34 0 0 1 100 34V118A14 14 0 0 1 86 132H14A14 14 0 0 1 0 118V34A34 34 0 0 1 34 0Z";
  if (kind === "arch") return "M0 50A50 50 0 0 1 100 50V118A14 14 0 0 1 86 132H14A14 14 0 0 1 0 118Z";
  return "M22 0H78A22 22 0 0 1 100 22V110A22 22 0 0 1 78 132H22A22 22 0 0 1 0 110V22A22 22 0 0 1 22 0Z";
}
function mark({ x, y, s = 1, kind = "soft", frame = INK, pane = "url(#paneGlow)", muntin = INK, muntins = true, halo = "url(#halo)", sw = 11, mw = 6 }) {
  const g = [`<g transform="translate(${x},${y}) scale(${s})">`];
  if (halo) g.push(`<ellipse cx="50" cy="60" rx="110" ry="118" fill="${halo}"/>`);
  if (pane !== "none") g.push(`<path d="${framePath(kind)}" fill="${pane}"/>`);
  if (muntins) {
    g.push(`<line x1="50" y1="0" x2="50" y2="132" stroke="${muntin}" stroke-width="${mw}"/>`);
    g.push(`<line x1="0" y1="52" x2="100" y2="52" stroke="${muntin}" stroke-width="${mw}"/>`);
  }
  g.push(`<path d="${framePath(kind)}" fill="none" stroke="${frame}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  g.push(`</g>`);
  return g.join("");
}
const word = (x, y, size, fill) => `<text x="${x}" y="${y}" font-family="Literata, Georgia, 'Times New Roman', serif" font-weight="600" font-size="${size}" fill="${fill}" letter-spacing="-0.5">Vela</text>`;
const label = (x, y, t, fill = INK3, size = 12, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${t}</text>`;
const eyebrow = (x, y, t) => `<text x="${x}" y="${y}" font-size="11" fill="${INK3}" letter-spacing="1.6" font-weight="600">${t}</text>`;

o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif">`);
o.push(`<defs>
  <radialGradient id="paneGlow" cx="50%" cy="32%" r="70%"><stop offset="0" stop-color="#F7CB6E"/><stop offset="1" stop-color="${AMBER}"/></radialGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${SOFT}" stop-opacity="1"/><stop offset="0.55" stop-color="${SOFT}" stop-opacity="0.55"/><stop offset="1" stop-color="${SOFT}" stop-opacity="0"/></radialGradient>
  <radialGradient id="haloDark" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.32"/><stop offset="0.6" stop-color="${AMBER}" stop-opacity="0.1"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>
</defs>`);
o.push(`<rect width="${W}" height="${H}" fill="${CREAM}"/>`);
o.push(eyebrow(40, 40, "VELA · LOGO SYSTEM · ROUND 2 · OPTION 1 REFINED TO THE DESIGN SYSTEM · 2026-09-12"));

// ---- row 1: the system
o.push(eyebrow(40, 84, "1 · THE SYSTEM"));
// full colour on cream
o.push(mark({ x: 80, y: 130, s: 0.9 }));
o.push(word(80 + 90 + 26, 239, 104, INK));
o.push(label(60, 322, "Full colour · charcoal frame, amber panes, cream ground"));
// silhouette on white
o.push(`<rect x="420" y="100" width="360" height="200" rx="10" fill="${WHITE}" stroke="${RULE}"/>`);
o.push(mark({ x: 460, y: 130, s: 0.9, pane: "none", halo: null }));
o.push(word(460 + 90 + 26, 239, 104, INK));
o.push(label(440, 322, "One colour · Android tint, Apple Tinted, print, embroidery"));
// reversed on ink
o.push(`<rect x="800" y="100" width="360" height="200" rx="10" fill="${DARK}"/>`);
o.push(mark({ x: 840, y: 130, s: 0.9, frame: CREAM2, muntin: CREAM2, pane: AMBER, halo: "url(#haloDark)" }));
o.push(word(840 + 90 + 26, 239, 104, CREAM2));
o.push(label(820, 322, "Reversed · dark app icon, dark mode, film"));

// ---- row 2: sizes and icons
o.push(eyebrow(40, 380, "2 · SIZES · IT MUST STILL BE A LIT WINDOW AT 16 PX"));
let x = 60;
for (const h of [128, 64, 32]) {
  const s = h / 132;
  o.push(mark({ x, y: 400 + (140 - h), s, halo: null, sw: 11, mw: 6 }));
  o.push(label(x + (100 * s) / 2, 560, `${h}`, INK3, 11, 'text-anchor="middle"'));
  x += 100 * s + 44;
}
// small-size variant: no muntins, solid amber, heavier frame
for (const h of [24, 16]) {
  const s = h / 132;
  o.push(mark({ x, y: 400 + (140 - h), s, halo: null, muntins: false, pane: AMBER, sw: 16 }));
  o.push(label(x + (100 * s) / 2, 560, `${h}`, INK3, 11, 'text-anchor="middle"'));
  x += 100 * s + 40;
}
o.push(label(60, 582, "Under 32 px the muntins fill in: drop them, thicken the frame, one solid amber pane. That small mark is also the in-app light glyph."));
// app icons
const iconX = 640;
o.push(`<rect x="${iconX}" y="400" width="120" height="120" rx="27" fill="${CREAM}" stroke="${RULE}"/>`);
o.push(mark({ x: iconX + 60 - 27.5, y: 400 + 60 - 36, s: 0.55, halo: "url(#halo)" }));
o.push(label(iconX + 60, 540, "app icon · light", INK3, 11, 'text-anchor="middle"'));
o.push(`<rect x="${iconX + 150}" y="400" width="120" height="120" rx="27" fill="${DARK}"/>`);
o.push(mark({ x: iconX + 150 + 60 - 27.5, y: 400 + 60 - 36, s: 0.55, frame: CREAM2, muntin: CREAM2, pane: AMBER, halo: "url(#haloDark)" }));
o.push(label(iconX + 150 + 60, 540, "app icon · dark", INK3, 11, 'text-anchor="middle"'));
o.push(`<rect x="${iconX + 300}" y="400" width="120" height="120" rx="27" fill="#8A8178"/>`);
o.push(mark({ x: iconX + 300 + 60 - 27.5, y: 400 + 60 - 36, s: 0.55, frame: WHITE, muntin: WHITE, pane: "none", halo: null }));
o.push(label(iconX + 300 + 60, 540, "Android themed icon (monochrome)", INK3, 11, 'text-anchor="middle"'));
o.push(`<rect x="${iconX + 450}" y="400" width="120" height="120" rx="27" fill="${CREAM}" stroke="${RULE}"/>`);
o.push(mark({ x: iconX + 450 + 60 - 27.5, y: 400 + 60 - 36, s: 0.55, muntins: false, pane: AMBER, sw: 14, halo: "url(#halo)" }));
o.push(label(iconX + 450 + 60, 540, "app icon · simplified (test both)", INK3, 11, 'text-anchor="middle"'));

// ---- row 3: which window
o.push(eyebrow(40, 640, "3 · WHICH WINDOW · THE ONE CHANGE FROM THE GENERATED OPTION"));
o.push(mark({ x: 80, y: 670, s: 0.72, halo: null }));
o.push(label(80 + 36, 790, "A · soft arch", INK, 12, 'text-anchor="middle" font-weight="600"'));
o.push(label(80 + 36, 808, "recommended", INK3, 11, 'text-anchor="middle"'));
o.push(mark({ x: 260, y: 670, s: 0.72, kind: "arch", halo: null }));
o.push(label(260 + 36, 790, "B · full arch (as generated)", INK, 12, 'text-anchor="middle" font-weight="600"'));
o.push(label(260 + 36, 808, "reads chapel; the cross reads medical", INK3, 11, 'text-anchor="middle"'));
o.push(mark({ x: 440, y: 670, s: 0.72, kind: "rect", halo: null }));
o.push(label(440 + 36, 790, "C · rounded rectangle", INK, 12, 'text-anchor="middle" font-weight="600"'));
o.push(label(440 + 36, 808, "safe, but reads phone or card", INK3, 11, 'text-anchor="middle"'));

const notes = [
  "What changed from the generated option 1, and why:",
  "· Top softened from a semicircle to a soft arch: warmth without the church window.",
  "· Transom moved up to 40%: four unequal panes read as a sash window, not a plus sign.",
  "· Wordmark set in Literata SemiBold (the system's serif), not a geometric sans.",
  "· Panes flat amber with one soft radial; halo only on cream and dark grounds.",
  "· Frame 11 units, muntins 6: the frame survives one-colour and 32 px.",
  "",
  "Options 2 and 3 (dark slab with a dot): rejected. They read as a doorbell,",
  "a phone, or a fingerprint sensor; the black mass fights the cream identity;",
  "and with the light removed, nothing is left.",
];
notes.forEach((t, i) => o.push(label(620, 672 + i * 19, t, i === 0 ? INK : INK2, 12.5, i === 0 ? 'font-weight="600"' : "")));

o.push(label(40, H - 28, "Source: tools/brand/logo-sheet.mjs · palette and type from design/design-system.md · vector master still to be drawn in Figma once the tool-call cap resets", INK3, 11));
o.push(`</svg>`);

mkdirSync("design/brand", { recursive: true });
writeFileSync("design/brand/logo-round2.svg", o.join("\n") + "\n");
console.log("wrote design/brand/logo-round2.svg");
