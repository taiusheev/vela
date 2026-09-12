import { Page, S, h, li } from "./lib.mjs";

export function overview(sections) {
  const p = new Page("0 · Overview and contents");
  p.title("Vela · the foundation, as one map", "Every page of this file, by section. Open a tab at the bottom to go deeper. Source of truth: github.com/taiusheev/vela · updated 2026-09-12");
  const hub = p.box(520, 150, 360, 110, "Vela<br><span style=\"font-size:11px;font-weight:normal\">One family, three generations, and a light kept on.<br>One daily touch from the family; the family knows the moment it goes quiet.</span>", S.hub);
  const titles = ["1 · Foundation", "2 · Research", "3 · Product", "4 · Architecture", "5 · Business", "6 · Go to market", "7 · Plan and operations"];
  const styles = [S.cardAmber, S.card, S.cardGreen, S.card, S.card, S.card, S.cardGreen];
  const cols = 4, w = 315, gx = 20, y0 = 320;
  const rowH = [0, 0];
  sections.forEach((pages, i) => { const r = Math.floor(i / cols); rowH[r] = Math.max(rowH[r], 44 + pages.length * 30); });
  sections.forEach((pages, i) => {
    const r = Math.floor(i / cols);
    const x = 40 + (i % cols) * (w + gx), y = y0 + (r === 0 ? 0 : rowH[0] + 30);
    const id = p.box(x, y, w, rowH[r], h(titles[i], li(pages.map((pg) => pg.name))), styles[i]);
    p.edge(hub, id, S.edgeSoft);
  });
  p.box(40, y0 + rowH[0] + rowH[1] + 60, 1320, 90, h("How to use this file", [
    "Read left to right, top to bottom: foundation → research → product → architecture → business → go to market → plan.",
    "Green pages are the product and the plan; amber is the foundation. Tables are editable cells; every number is sourced in research/01–07 in the repo.",
    "This file is generated from tools/build-master-plan-drawio.mjs; the founder may edit it directly in Draw.io, in which case tell the co-founder to stop regenerating.",
  ]), S.cardGrey);
  return p;
}
