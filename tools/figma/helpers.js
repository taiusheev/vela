// Helper snippet pasted at the top of use_figma calls for the Vela file (eJxG0c9ZHNSlY794RA9nrL).
// Token ids and style names are from design/figma-state.json. Rules learned: auto-layout frames default to a white fill
// (clear it); wrapped text must be appended first, then set layoutSizingHorizontal = "FILL" and textAutoResize = "HEIGHT".
/*
await Promise.all([["Inter","Regular"],["Inter","Medium"],["Inter","Semi Bold"],["Literata","Regular"],["Literata","SemiBold"]].map(([family,style]) => figma.loadFontAsync({family,style})));
const V = {}; for (const [k,id] of Object.entries({bg:"VariableID:5:4",surface:"VariableID:5:5",surface2:"VariableID:5:7",ink:"VariableID:5:8",ink2:"VariableID:5:9",ink3:"VariableID:5:10",rule:"VariableID:5:11",light:"VariableID:5:12",lightDeep:"VariableID:9:13",lightSoft:"VariableID:5:13",action:"VariableID:9:14",actionSoft:"VariableID:9:15",onAction:"VariableID:9:16"})) V[k] = await figma.variables.getVariableByIdAsync(id);
const paint = (v) => figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:0,g:0,b:0}},"color",v);
const styles = await figma.getLocalTextStylesAsync(); const TS = (n) => styles.find(s => s.name === n).id;
async function text(parent, chars, style, colorVar, wrap) { const t = figma.createText(); t.characters = chars; await t.setTextStyleIdAsync(TS(style)); t.fills = [paint(colorVar)]; parent.appendChild(t); if (wrap) { t.layoutSizingHorizontal = "FILL"; t.textAutoResize = "HEIGHT"; } return t; }
function col(parent, props) { const f = figma.createAutoLayout("VERTICAL", props); f.fills = []; if (parent) parent.appendChild(f); return f; }
function row(parent, props) { const f = figma.createAutoLayout("HORIZONTAL", props); f.fills = []; if (parent) parent.appendChild(f); return f; }
function card(parent, bg, bordered) { const c = col(parent, { name: "Card", itemSpacing: 10, paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: 14 }); c.fills = [paint(bg)]; c.cornerRadius = 16; if (bordered) { c.strokes = [paint(V.rule)]; c.strokeWeight = 1; } c.layoutSizingHorizontal = "FILL"; return c; }
async function lightInstance(parent, state) { const set = await figma.getNodeByIdAsync("9:28"); const i = set.children.find(c => c.name === "State=" + state).createInstance(); parent.appendChild(i); return i; }
async function button(parent, style, size, label) { const set = await figma.getNodeByIdAsync("6:21"); const i = set.children.find(c => c.name === "Style=" + style + ", Size=" + size).createInstance(); parent.appendChild(i); i.layoutSizingHorizontal = "FILL"; const t = i.findOne(n => n.type === "TEXT"); if (t && label) t.characters = label; return i; }
function spacer(parent) { const f = figma.createFrame(); f.fills = []; f.resize(10, 10); parent.appendChild(f); f.layoutSizingHorizontal = "FILL"; f.layoutSizingVertical = "FILL"; return f; }
function hspacer(parent) { const f = figma.createFrame(); f.fills = []; f.resize(10, 10); parent.appendChild(f); f.layoutSizingHorizontal = "FILL"; return f; }
function screenFrame(page, name, x, y, w = 393, h = 852, pad = 20) { const s = col(null, { name, paddingLeft: pad, paddingRight: pad, paddingTop: 60, paddingBottom: 24, itemSpacing: 16 }); s.resize(w, h); s.primaryAxisSizingMode = "FIXED"; s.counterAxisSizingMode = "FIXED"; s.fills = [paint(V.bg)]; s.clipsContent = true; page.appendChild(s); s.x = x; s.y = y; return s; }
*/
