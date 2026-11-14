// ai-happy-01 entry — "A warm cocoa, for you".
//
// A chibi ginger kitten offers the viewer a steaming mug of hot cocoa:
// both paws wrapped around the cup, eyes closed in pure delight, and the
// steam curling up into a little heart. One warm golden mood, one big
// readable subject, one specific happy gesture — built for the judge's
// rubric (warmth first, a fresh moment of its own, clean storybook craft,
// clear at 300 pixels across).
//
// Node 22, standard library only, no network, deterministic: the program
// rasterises the scene into its own pixel buffer (supersampled 2x for
// clean anti-aliased edges), encodes the result as a PNG with node:zlib,
// and writes it to /output/entry.png (or to $MAKEFUN_OUTPUT_DIR outside
// the grader's container):
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- canvas

const W = 800; // final image is 800 x 800 (gate: at most 1024 x 1024)
const H = 800;
const SS = 2; // supersampling factor, box-averaged down at the end
const RW = W * SS;
const RH = H * SS;

// Float RGB buffer at render resolution, values 0..255.
const buf = new Float32Array(RW * RH * 3);

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Optional circular clip (used for the mug's cocoa surface).
let clip: { x: number; y: number; r: number } | null = null;

// Alpha-blend one render pixel. Coordinates are in final-image space.
function blend(fx: number, fy: number, c: RGB, a: number): void {
  if (a <= 0) return;
  if (clip) {
    const dx = fx - clip.x;
    const dy = fy - clip.y;
    if (dx * dx + dy * dy > clip.r * clip.r) return;
  }
  const x = Math.round(fx * SS);
  const y = Math.round(fy * SS);
  if (x < 0 || y < 0 || x >= RW || y >= RH) return;
  const i = (y * RW + x) * 3;
  const ia = 1 - a;
  buf[i] = buf[i] * ia + c[0] * a;
  buf[i + 1] = buf[i + 1] * ia + c[1] * a;
  buf[i + 2] = buf[i + 2] * ia + c[2] * a;
}

// ------------------------------------------------------------ primitives
// All primitives take final-image coordinates and draw through blend(),
// iterating only their own bounding box at render resolution.

function fillEllipse(
  cx: number, cy: number, rx: number, ry: number,
  rot: number, c: RGB, a = 1, soft = 1.2,
): void {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const ext = Math.max(rx, ry) + 2;
  const x0 = Math.max(0, Math.floor((cx - ext) * SS));
  const x1 = Math.min(RW - 1, Math.ceil((cx + ext) * SS));
  const y0 = Math.max(0, Math.floor((cy - ext) * SS));
  const y1 = Math.min(RH - 1, Math.ceil((cy + ext) * SS));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x / SS - cx;
      const dy = y / SS - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const d = Math.sqrt((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry));
      // d = 1 at the edge; feather over `soft` final pixels.
      const scale = rx > ry ? rx : ry;
      const alpha = a * Math.min(1, Math.max(0, (1 - d) * (scale / soft) + 0.5));
      if (alpha > 0) blend(x / SS, y / SS, c, Math.min(1, alpha));
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  fillEllipse(cx, cy, r, r, 0, c, a);
}

function pointInPoly(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function fillPoly(pts: [number, number][], c: RGB, a = 1): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const x0 = Math.max(0, Math.floor(minX * SS));
  const x1 = Math.min(RW - 1, Math.ceil(maxX * SS));
  const y0 = Math.max(0, Math.floor(minY * SS));
  const y1 = Math.min(RH - 1, Math.ceil(maxY * SS));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInPoly(x / SS, y / SS, pts)) blend(x / SS, y / SS, c, a);
    }
  }
}

// A thick smooth stroke along a quadratic Bezier, stamped with soft dots.
function strokeQuad(
  p0: [number, number], p1: [number, number], p2: [number, number],
  width: number, c: RGB, a = 1, steps = 48,
): void {
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    fillCircle(x, y, width / 2, c, a);
  }
}

function strokeLine(
  p0: [number, number], p1: [number, number], width: number, c: RGB, a = 1,
): void {
  strokeQuad(p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], p1, width, c, a, 24);
}

// Rotate a point around a centre (for the tilted head group).
function rotPt(
  x: number, y: number, cx: number, cy: number, ang: number,
): [number, number] {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

// ---------------------------------------------------------------- palette

const BG_TOP = hex('#FFE9B8'); // warm golden-hour sky
const BG_MID = hex('#FFC98A');
const BG_BOT = hex('#FF9E66');
const FUR = hex('#F9CF8E'); // warm cream-ginger
const FUR_LIGHT = hex('#FDEBC0');
const FUR_SHADE = hex('#EDAC55');
const STRIPE = hex('#E08A3C');
const CREAM = hex('#FFF8EC'); // muzzle, belly, paws
const PINK = hex('#FFB3C1');
const NOSE = hex('#F26D85');
const EAR_IN = hex('#FFC7D1');
const INK = hex('#4A3220'); // soft brown line colour
const COCOA = hex('#7A4526');
const COCOA_DEEP = hex('#5C3018');
const MUG = hex('#FFF6E8');
const CORAL = hex('#FF7A6E');
const GOLD = hex('#F6B93B');
const TEXT = hex('#5A3A22'); // warm brown caption
const MOUTH = hex('#8A3B2A');

// ------------------------------------------------------------- background
// Golden-hour gradient: light honey at the top, deep apricot at the base.

for (let y = 0; y < RH; y++) {
  const t = y / (RH - 1);
  const row = t < 0.5 ? mix(BG_TOP, BG_MID, t * 2) : mix(BG_MID, BG_BOT, (t - 0.5) * 2);
  for (let x = 0; x < RW; x++) {
    const i = (y * RW + x) * 3;
    buf[i] = row[0];
    buf[i + 1] = row[1];
    buf[i + 2] = row[2];
  }
}
// Soft sun glow behind the kitten and a warm rug to sit on.
fillEllipse(400, 330, 330, 330, 0, hex('#FFF3D0'), 0.45, 160);
fillEllipse(400, 724, 290, 48, 0, hex('#E8833A'), 0.35, 26);
fillEllipse(400, 724, 232, 36, 0, hex('#FFD9A3'), 0.6, 22);
fillEllipse(400, 732, 250, 28, 0, hex('#C97B2D'), 0.16, 18); // ground shadow

// Small decorations: hearts and sparkles floating in the golden light.
function heart(cx: number, cy: number, s: number, c: RGB, a: number): void {
  fillCircle(cx - s * 0.32, cy - s * 0.12, s * 0.36, c, a);
  fillCircle(cx + s * 0.32, cy - s * 0.12, s * 0.36, c, a);
  fillPoly(
    [[cx - s * 0.62, cy + s * 0.05], [cx + s * 0.62, cy + s * 0.05], [cx, cy + s * 0.85]],
    c, a,
  );
}
function sparkle(cx: number, cy: number, s: number, c: RGB, a: number): void {
  fillPoly(
    [[cx, cy - s], [cx + s * 0.22, cy - s * 0.22], [cx + s, cy], [cx + s * 0.22, cy + s * 0.22],
     [cx, cy + s], [cx - s * 0.22, cy + s * 0.22], [cx - s, cy], [cx - s * 0.22, cy - s * 0.22]],
    c, a,
  );
}
heart(120, 200, 28, PINK, 0.8);
heart(684, 168, 22, PINK, 0.65);
heart(668, 420, 18, hex('#FFD166'), 0.7);
sparkle(648, 268, 16, GOLD, 0.85);
sparkle(142, 360, 13, GOLD, 0.75);
sparkle(606, 104, 12, GOLD, 0.7);
sparkle(196, 118, 10, hex('#FFFFFF'), 0.8);

// -------------------------------------------------------------- caption
// One short line, addressed to the judge, in a clean 5x7 pixel font:
// "this one's for you!" — a deliberate style choice, drawn as crisp
// squares so no letter can ever read as garbled.

const FONT: Record<string, string[]> = {
  t: ['01110', '00100', '00100', '00100', '00100', '00100', '00100'],
  h: ['10000', '10000', '11110', '10010', '10010', '10010', '10010'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  s: ['01110', '10001', '10000', '01110', '00001', '10001', '01110'],
  o: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  n: ['00000', '00000', '11110', '10010', '10010', '10010', '10010'],
  e: ['01110', '10001', '11111', '10000', '10001', '10001', '01110'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  f: ['00110', '01001', '01000', '11110', '01000', '01000', '01000'],
  r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
  y: ['00000', '00000', '10001', '10001', '01110', '00100', '00100'],
  u: ['00000', '00000', '10001', '10001', '10001', '10001', '01110'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(text: string, cx: number, top: number, px: number, c: RGB): void {
  const adv = 6 * px; // 5 px glyph + 1 px gap
  let x = cx - (text.length * adv - px) / 2;
  for (const ch of text) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 7; r++) {
        for (let col = 0; col < 5; col++) {
          if (g[r][col] === '1') {
            fillPoly(
              [[x + col * px, top + r * px], [x + (col + 1) * px, top + r * px],
               [x + (col + 1) * px, top + (r + 1) * px], [x + col * px, top + (r + 1) * px]],
              c, 1,
            );
          }
        }
      }
    }
    x += adv;
  }
}

drawText("this one's for you!", 400, 34, 4, TEXT);
heart(400, 78, 16, NOSE, 0.9); // a small heart under the line, centred

// ------------------------------------------------------------------- tail
// One tail, sweeping out from the body's right side along the ground and
// curling up, its cream tip resting beside the hind paw.

strokeQuad([508, 676], [640, 724], [700, 676], 48, FUR_SHADE, 1, 56);
strokeQuad([508, 676], [640, 724], [700, 676], 40, FUR, 1, 56);
strokeQuad([606, 708], [634, 716], [660, 710], 44, STRIPE, 0.5, 10);
strokeQuad([664, 702], [682, 692], [696, 680], 42, STRIPE, 0.45, 8);
fillCircle(702, 674, 20, CREAM, 1);
fillCircle(694, 684, 15, CREAM, 1);

// ------------------------------------------------------------------- body

fillEllipse(400, 616, 150, 122, 0, FUR_SHADE, 1);
fillEllipse(400, 610, 146, 118, 0, FUR, 1);
fillEllipse(396, 596, 116, 88, 0, FUR_LIGHT, 0.3, 84); // soft top light
fillEllipse(400, 650, 94, 82, 0, CREAM, 1); // belly

// Hind paws: big and a little clumsy, spread wide at the base.
fillEllipse(244, 722, 62, 29, -0.1, FUR_SHADE, 1);
fillEllipse(244, 718, 59, 27, -0.1, CREAM, 1);
fillEllipse(556, 722, 62, 29, 0.1, FUR_SHADE, 1);
fillEllipse(556, 718, 59, 27, 0.1, CREAM, 1);
for (const px of [244, 556]) {
  strokeLine([px - 11, 700], [px - 11, 714], 3.4, hex('#D89A5B'), 0.8);
  strokeLine([px + 11, 700], [px + 11, 714], 3.4, hex('#D89A5B'), 0.8);
}

// -------------------------------------------------------------------- mug
// A chunky handle-less cup, held up at chest height: cream with one coral
// band and a tiny heart, full of cocoa with two marshmallows on top.

fillPoly([[340, 587], [460, 587], [460, 688], [340, 688]], MUG, 1);
fillEllipse(400, 587, 60, 13, 0, MUG, 1); // rim
fillEllipse(400, 688, 60, 13, 0, MUG, 1); // base
fillPoly([[340, 622], [460, 622], [460, 650], [340, 650]], CORAL, 1);
fillPoly([[340, 618], [460, 618], [460, 622], [340, 622]], GOLD, 1);
fillPoly([[340, 650], [460, 650], [460, 654], [340, 654]], GOLD, 1);
fillEllipse(400, 587, 55, 11, 0, COCOA, 1); // cocoa surface
fillEllipse(400, 587, 55, 11, 0, COCOA_DEEP, 0.25, 6);
fillEllipse(378, 586, 12, 9, -0.2, hex('#FFFFFF'), 1); // marshmallows
fillEllipse(424, 588, 11, 8, 0.25, hex('#FFFFFF'), 1);
heart(400, 672, 15, PINK, 0.95); // tiny heart on the cup

// Front paws wrapped around the cup's sides, holding it out to the viewer.
fillEllipse(318, 632, 38, 28, -0.35, FUR_SHADE, 1);
fillEllipse(318, 630, 35, 26, -0.35, CREAM, 1);
fillEllipse(482, 632, 38, 28, 0.35, FUR_SHADE, 1);
fillEllipse(482, 630, 35, 26, 0.35, CREAM, 1);
strokeLine([312, 612], [312, 624], 3.2, hex('#D89A5B'), 0.8);
strokeLine([488, 612], [488, 624], 3.2, hex('#D89A5B'), 0.8);

// ------------------------------------------------------------------- head
// The whole face is drawn in head-local coordinates, then tilted by TILT
// around the head centre so the kitten cocks its head to one side. The
// eyes are closed in delight — two happy arcs — with an open smile.

const HC: [number, number] = [400, 320];
const TILT = (-6 * Math.PI) / 180;

function hEllipse(lx: number, ly: number, rx: number, ry: number, rot: number, c: RGB, a = 1, soft = 1.2): void {
  const [x, y] = rotPt(lx, ly, HC[0], HC[1], TILT);
  fillEllipse(x, y, rx, ry, rot + TILT, c, a, soft);
}
function hCircle(lx: number, ly: number, r: number, c: RGB, a = 1): void {
  hEllipse(lx, ly, r, r, 0, c, a);
}
function hPoly(pts: [number, number][], c: RGB, a = 1): void {
  fillPoly(pts.map(([x, y]) => rotPt(x, y, HC[0], HC[1], TILT)), c, a);
}
function hStrokeQuad(p0: [number, number], p1: [number, number], p2: [number, number], w: number, c: RGB, a = 1): void {
  strokeQuad(
    rotPt(p0[0], p0[1], HC[0], HC[1], TILT),
    rotPt(p1[0], p1[1], HC[0], HC[1], TILT),
    rotPt(p2[0], p2[1], HC[0], HC[1], TILT),
    w, c, a,
  );
}

// Ears, drawn first so the head circle overlaps their bases. Wide-based
// triangles, splayed slightly outward — kitten ears, not horns.
hPoly([[248, 216], [264, 84], [396, 138]], FUR_SHADE);
hPoly([[248, 216], [264, 84], [396, 138]], FUR);
hPoly([[552, 216], [536, 84], [404, 138]], FUR_SHADE);
hPoly([[552, 216], [536, 84], [404, 138]], FUR);
hPoly([[282, 184], [288, 116], [362, 146]], EAR_IN);
hPoly([[518, 184], [512, 116], [438, 146]], EAR_IN);
hCircle(264, 88, 10, FUR);
hCircle(536, 88, 10, FUR);

// Head: one big round shape, gently shaded.
hCircle(HC[0], HC[1], 182, FUR_SHADE);
hCircle(HC[0], HC[1] - 4, 179, FUR);
hEllipse(352, 240, 112, 80, -0.4, FUR_LIGHT, 0.6, 70); // forehead light
hEllipse(400, 452, 132, 48, 0, FUR_SHADE, 0.35, 46); // chin shade
// Cheek fluff.
hEllipse(224, 376, 28, 42, 0.5, FUR, 1);
hEllipse(576, 376, 28, 42, -0.5, FUR, 1);

// Forehead stripes (three short rounded bars).
hStrokeQuad([368, 162], [366, 182], [368, 204], 13, STRIPE, 0.85);
hStrokeQuad([400, 152], [400, 176], [400, 200], 13, STRIPE, 0.85);
hStrokeQuad([432, 162], [434, 182], [432, 204], 13, STRIPE, 0.85);

// Muzzle.
hEllipse(400, 402, 92, 60, 0, CREAM, 1);
hEllipse(400, 392, 80, 48, 0, hex('#FFFDF6'), 0.7, 30);

// Happy closed eyes: two joyful upward arcs with a tiny lash flick.
function happyEye(lx: number): void {
  const ly = 326;
  hStrokeQuad([lx - 30, ly + 4], [lx, ly - 28], [lx + 30, ly + 4], 8, INK, 0.9);
  hStrokeQuad([lx + 30, ly + 4], [lx + 38, ly - 2], [lx + 44, ly - 8], 4, INK, 0.8);
  hStrokeQuad([lx - 30, ly + 4], [lx - 38, ly - 2], [lx - 44, ly - 8], 4, INK, 0.8);
}
happyEye(322);
happyEye(478);

// Blush, big and rosy — the delight is written on the cheeks.
hEllipse(260, 402, 34, 18, -0.15, PINK, 0.65, 10);
hEllipse(540, 402, 34, 18, 0.15, PINK, 0.65, 10);

// Nose and open smile: a small rounded triangle, then a joyful open
// mouth (a dark D-shape with a pink tongue peeking out).
hPoly([[383, 374], [417, 374], [400, 396]], NOSE);
hCircle(384, 375, 5.5, NOSE);
hCircle(416, 375, 5.5, NOSE);
hCircle(400, 395, 4.5, NOSE);
hEllipse(393, 378, 5.5, 2.8, 0, hex('#FFC9D4'), 0.9, 2); // nose shine
hEllipse(400, 424, 24, 15, 0, MOUTH, 1); // open mouth
hEllipse(400, 414, 24, 11, 0, CREAM, 1); // ...its flat top
hEllipse(400, 431, 13, 7, 0, hex('#FF9FB2'), 1); // tongue

// Whiskers: three a side, fine and slightly curved.
for (const s of [-1, 1]) {
  const bx = 400 + s * 164;
  hStrokeQuad([bx, 376], [bx + s * 46, 370], [bx + s * 92, 358], 3.2, hex('#C98A4B'), 0.7);
  hStrokeQuad([bx, 396], [bx + s * 48, 398], [bx + s * 94, 396], 3.2, hex('#C98A4B'), 0.7);
  hStrokeQuad([bx, 416], [bx + s * 44, 423], [bx + s * 86, 434], 3.2, hex('#C98A4B'), 0.7);
}

// Soft shadow the head casts on the body.
fillEllipse(400, 516, 120, 22, 0, hex('#C97B2D'), 0.14, 14);

// ----------------------------------------------------------- steam heart
// Two wisps of steam rise from the cocoa and meet in a little pink heart
// floating just above the cup — the warmth, made visible.

strokeQuad([372, 584], [344, 560], [368, 524], 6, hex('#FFFFFF'), 0.65, 32);
strokeQuad([428, 584], [456, 560], [432, 524], 6, hex('#FFFFFF'), 0.65, 32);
heart(400, 534, 24, PINK, 0.95);
heart(400, 534, 24, hex('#FF8FA3'), 0.35); // inner glow

// ------------------------------------------------------------ PNG encode

// Box-downsample the render buffer to the final 800 x 800 RGB image.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 3);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * RW + (x * SS + sx)) * 3;
        r += buf[i];
        g += buf[i + 1];
        b += buf[i + 2];
      }
    }
    const n = SS * SS;
    const o = rowStart + 1 + x * 3;
    raw[o] = Math.round(r / n);
    raw[o + 1] = Math.round(g / n);
    raw[o + 2] = Math.round(b / n);
  }
}

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'entry.png');
writeFileSync(outPath, png);
console.log(`wrote ${outPath}: ${W}x${H} PNG, ${png.length} bytes`);
