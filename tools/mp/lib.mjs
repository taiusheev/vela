// Shared helpers for the master-plan Draw.io generator.

export const C = {
  ink: "#1E1A16", ink2: "#5A534B", ink3: "#7A7267",
  rule: "#E8E1D6", soft: "#F3EDE4", white: "#FFFFFF",
  green: "#1F5C66", greenSoft: "#E1EEF0",
  amber: "#E9A23B", amberSoft: "#FBEBCF",
  red: "#B3261E", redSoft: "#F6E3E1",
  blue: "#3b6ea5", blueSoft: "#e6eef8",
};
const base = "rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingRight=8;spacingTop=6;fontSize=11;";
export const S = {
  card: `${base}fillColor=${C.white};strokeColor=${C.rule};fontColor=${C.ink};`,
  cardGreen: `${base}fillColor=${C.greenSoft};strokeColor=${C.green};strokeWidth=2;fontColor=${C.ink};`,
  cardAmber: `${base}fillColor=${C.amberSoft};strokeColor=${C.amber};strokeWidth=2;fontColor=${C.ink};`,
  cardRed: `${base}fillColor=${C.redSoft};strokeColor=${C.red};fontColor=${C.ink};`,
  cardBlue: `${base}fillColor=${C.blueSoft};strokeColor=${C.blue};fontColor=${C.ink};`,
  cardGrey: `${base}fillColor=${C.soft};strokeColor=${C.rule};fontColor=${C.ink};`,
  hub: `ellipse;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=${C.amberSoft};strokeColor=${C.amber};strokeWidth=3;fontColor=${C.ink};fontSize=16;fontStyle=1;`,
  state: `rounded=1;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=${C.white};strokeColor=${C.ink2};fontColor=${C.ink};fontSize=12;fontStyle=1;`,
  stateAmber: `rounded=1;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=${C.amberSoft};strokeColor=${C.amber};strokeWidth=2;fontColor=${C.ink};fontSize=12;fontStyle=1;`,
  stateGrey: `rounded=1;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=${C.soft};strokeColor=${C.rule};fontColor=${C.ink3};fontSize=12;fontStyle=1;`,
  title: `text;html=1;align=left;verticalAlign=top;fontSize=22;fontStyle=1;fontColor=${C.ink};whiteSpace=wrap;`,
  h2: `text;html=1;align=left;verticalAlign=top;fontSize=14;fontStyle=1;fontColor=${C.ink};whiteSpace=wrap;`,
  sub: `text;html=1;align=left;verticalAlign=top;fontSize=11;fontColor=${C.ink3};whiteSpace=wrap;`,
  small: `text;html=1;align=left;verticalAlign=top;fontSize=10;fontColor=${C.ink3};whiteSpace=wrap;`,
  lane: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;fillColor=${C.soft};strokeColor=${C.rule};fontColor=${C.ink3};fontStyle=1;fontSize=11;`,
  laneAmber: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;fillColor=${C.amberSoft};strokeColor=${C.amber};fontColor=${C.ink3};fontStyle=1;fontSize=11;`,
  th: `whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=6;fillColor=${C.soft};strokeColor=${C.rule};fontColor=${C.ink3};fontStyle=1;fontSize=10;`,
  td: `whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=6;spacingTop=3;fillColor=${C.white};strokeColor=${C.rule};fontColor=${C.ink};fontSize=10;`,
  tdGreen: `whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=6;spacingTop=3;fillColor=${C.greenSoft};strokeColor=${C.rule};fontColor=${C.ink};fontSize=10;`,
  tdAmber: `whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=6;spacingTop=3;fillColor=${C.amberSoft};strokeColor=${C.rule};fontColor=${C.ink};fontSize=10;`,
  edge: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=${C.ink2};fontSize=10;fontColor=${C.ink2};`,
  edgeSoft: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=${C.ink3};dashed=1;fontSize=10;fontColor=${C.ink3};`,
  edgeAmber: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=${C.amber};strokeWidth=2;fontSize=10;fontColor=${C.ink2};`,
  bar: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=8;fillColor=${C.greenSoft};strokeColor=${C.green};fontColor=${C.ink};fontSize=11;`,
  barAmber: `rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=8;fillColor=${C.amberSoft};strokeColor=${C.amber};fontColor=${C.ink};fontSize=11;`,
  milestone: `rhombus;whiteSpace=wrap;html=1;fillColor=${C.amber};strokeColor=${C.amber};fontColor=${C.ink};fontSize=10;`,
};

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const h = (title, lines = []) => `<b>${title}</b>` + (Array.isArray(lines) ? (lines.length ? "<br>" + lines.join("<br>") : "") : "<br>" + lines);
export const li = (items) => items.map((i) => "• " + i).join("<br>");
const plain = (s) => String(s).replace(/<[^>]+>/g, "");

export class Page {
  constructor(name) { this.name = name; this.cells = []; this.n = 0; this.maxY = 0; this.maxX = 0; }
  id() { return `c${++this.n}`; }
  box(x, y, w, hh, label, style = S.card, id = this.id()) {
    this.cells.push(`<mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${hh}" as="geometry"/></mxCell>`);
    this.maxY = Math.max(this.maxY, y + hh); this.maxX = Math.max(this.maxX, x + w);
    return id;
  }
  edge(src, dst, style = S.edge, points = [], label = "") {
    const id = this.id();
    const pts = points.length ? `<Array as="points">${points.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>` : "";
    this.cells.push(`<mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
    return id;
  }
  title(t, sub) {
    this.box(40, 30, 1200, 36, t, S.title);
    if (sub) this.box(40, 68, 1300, 30, sub, S.sub);
    return 110;
  }
  h2(y, t) { this.box(40, y, 1300, 24, t, S.h2); return y + 30; }
  grid(items, { cols, x = 40, y = 120, w = 260, h: hh = 120, gx = 20, gy = 20, style = S.card }) {
    let rows = 0;
    const ids = items.map((it, i) => {
      const col = i % cols, row = Math.floor(i / cols); rows = row + 1;
      const st = typeof it === "object" && it.style ? it.style : style;
      const label = typeof it === "object" ? it.label : it;
      const hq = typeof it === "object" && it.h ? it.h : hh;
      return this.box(x + col * (w + gx), y + row * (hh + gy), w, hq, label, st);
    });
    return { ids, bottom: y + rows * (hh + gy) };
  }
  // Table with estimated row heights. cols: [{w, title}], rows: [[cell,...]], cell = string | {label, style}
  table(x, y, cols, rows, { minH = 26, lineH = 13, charsPerPx = 0.165, headerH = 24 } = {}) {
    let cx = x;
    cols.forEach((c) => { this.box(cx, y, c.w, headerH, c.title, S.th); cx += c.w; });
    let cy = y + headerH;
    rows.forEach((r) => {
      const rh = Math.max(minH, ...r.map((cell, i) => {
        const text = plain(typeof cell === "object" ? cell.label : cell);
        const perLine = Math.max(8, Math.floor(cols[i].w * charsPerPx));
        const explicit = (String(typeof cell === "object" ? cell.label : cell).match(/<br>/g) || []).length;
        return (Math.ceil(text.length / perLine) + explicit) * lineH + 10;
      }));
      let cxx = x;
      r.forEach((cell, i) => {
        const label = typeof cell === "object" ? cell.label : cell;
        const style = typeof cell === "object" && cell.style ? cell.style : S.td;
        this.box(cxx, cy, cols[i].w, rh, label, style); cxx += cols[i].w;
      });
      cy += rh;
    });
    return cy;
  }
  xml() {
    const pw = Math.max(1400, this.maxX + 40), ph = Math.max(1000, this.maxY + 40);
    return `<diagram id="${this.name.replace(/\W+/g, "_")}" name="${esc(this.name)}"><mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pw}" pageHeight="${ph}" background="#ffffff"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${this.cells.join("")}</root></mxGraphModel></diagram>`;
  }
}
