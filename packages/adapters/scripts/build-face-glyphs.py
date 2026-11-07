"""
Builds src/line/face/glyphs.bin, the outlines the LINE face picture draws a name's initial from.

    python3 packages/adapters/scripts/build-face-glyphs.py NotoSerifTC-Bold.otf

The font is Noto Serif TC Bold (SIL Open Font License 1.1) from github.com/notofonts/noto-cjk,
Serif/SubsetOTF/TC. Only the 5,401 common characters of Big5 level 1 and the Latin letters and
digits are kept; a name whose initial is not among them gets no face and shows the bot's own.

Format, little-endian:
  "VFG1", u32 count, u16 units per em,
  u32 codepoint[count] (ascending), u32 end[count] (end offset of each glyph in the data),
  data: per glyph a run of commands, each one byte (0 move, 1 line, 2 quad, 3 cubic, 4 close)
  followed by its points as zigzag varint deltas from the previous point, in units of GRID.
"""
import struct, sys
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

GRID = 4  # 1000 units per em on a grid of 4: a quarter of a pixel at 1000 px, invisible at 160 px.

def big5_level1():
    out = []
    for hi in range(0xA4, 0xC7):
        for lo in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            if (hi << 8 | lo) > 0xC67E:
                continue
            try:
                out.append(ord(bytes([hi, lo]).decode("big5")))
            except UnicodeDecodeError:
                pass
    return out

def varint(n):
    n = (n << 1) ^ (n >> 31)  # zigzag
    b = bytearray()
    while True:
        if n < 0x80:
            b.append(n); return bytes(b)
        b.append((n & 0x7F) | 0x80); n >>= 7

class Pen(BasePen):
    def __init__(self, gs):
        super().__init__(gs); self.out = bytearray(); self.x = 0; self.y = 0
    def pt(self, p):
        x, y = round(p[0] / GRID), round(p[1] / GRID)
        self.out += varint(x - self.x) + varint(y - self.y); self.x, self.y = x, y
    def _moveTo(self, p): self.out.append(0); self.pt(p)
    def _lineTo(self, p): self.out.append(1); self.pt(p)
    def _qCurveToOne(self, a, b): self.out.append(2); self.pt(a); self.pt(b)
    def _curveToOne(self, a, b, c): self.out.append(3); self.pt(a); self.pt(b); self.pt(c)
    def _closePath(self): self.out.append(4)
    def _endPath(self): self.out.append(4)

def main(path, out):
    font = TTFont(path); cmap = font.getBestCmap(); gs = font.getGlyphSet()
    upm = font["head"].unitsPerEm
    latin = [ord(c) for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]
    cps = sorted(set(c for c in big5_level1() + latin if c in cmap))
    data = bytearray(); ends = []
    for cp in cps:
        pen = Pen(gs); gs[cmap[cp]].draw(pen); data += pen.out; ends.append(len(data))
    with open(out, "wb") as f:
        f.write(b"VFG1" + struct.pack("<IH", len(cps), upm // GRID))
        f.write(struct.pack(f"<{len(cps)}I", *cps)); f.write(struct.pack(f"<{len(cps)}I", *ends))
        f.write(data)
    print(len(cps), "glyphs,", round((14 + 8 * len(cps) + len(data)) / 1e6, 2), "MB")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "packages/adapters/src/line/face/glyphs.bin")
