import { type Container, Graphics } from "pixi.js";
import { DESK_H, DESK_W } from "./model";
import { blendColor } from "./drawing-core";
import { OFFICE_PASTEL } from "./themes-locale";

function drawDesk(parent: Container, dx: number, dy: number, working: boolean): Graphics {
  const g = new Graphics();
  const edge = 0x253541;
  const surface = 0x61717f;
  const screen = 0x101b25;
  const indicator = working ? 0x62c6a6 : 0x71818e;
  g.ellipse(dx + DESK_W / 2, dy + DESK_H + 3, DESK_W / 2, 4).fill({ color: 0x000000, alpha: 0.15 });
  for (const x of [dx + 4, dx + DESK_W - 7]) {
    g.roundRect(x, dy + DESK_H - 2, 3, 5, 1).fill(edge);
  }
  g.roundRect(dx, dy, DESK_W, DESK_H, 2).fill(edge);
  g.roundRect(dx + 1, dy + 1, DESK_W - 2, DESK_H - 3, 1).fill(surface);
  g.moveTo(dx + 2, dy + 1)
    .lineTo(dx + DESK_W - 2, dy + 1)
    .stroke({ color: 0xb3c1ca, width: 0.5, alpha: 0.65 });

  // Two compact workstation displays. The glyphs indicate activity, not market prices.
  const monitorW = (DESK_W - 8) / 2;
  for (let index = 0; index < 2; index++) {
    const mx = dx + 3 + index * (monitorW + 2);
    const my = dy + DESK_H - 15;
    g.roundRect(mx + monitorW / 2 - 4, my - 3, 8, 3, 1).fill(edge);
    g.roundRect(mx, my, monitorW, 13, 1.5).fill(0x18232d);
    g.roundRect(mx, my, monitorW, 13, 1.5).stroke({ color: 0x90a0ae, width: 0.45, alpha: 0.8 });
    g.roundRect(mx + 1.5, my + 1.5, monitorW - 3, 9.5, 0.5).fill(screen);
    if (working) {
      for (let row = 0; row < 3; row++) {
        const lineWidth = (monitorW - 6) * (row === 1 ? 0.6 : 0.9);
        g.rect(mx + 3, my + 3 + row * 2.4, lineWidth, 0.8).fill({
          color: index === 0 ? 0x75b7ca : indicator,
          alpha: 0.8,
        });
      }
    }
    g.circle(mx + monitorW - 2.5, my + 11.5, 0.65).fill(indicator);
  }
  // Keyboard and pointing device.
  const kx = dx + DESK_W / 2 - 10;
  g.roundRect(kx, dy + 2, 20, 6, 1).fill(0x253541);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 7; col++) {
      g.rect(kx + 1.5 + col * 2.5, dy + 3 + row * 2, 1.5, 1).fill(0x8e9eab);
    }
  }
  g.roundRect(kx + 23, dy + 2, 4, 6, 1.5).fill(0x2c3d49);
  parent.addChild(g);
  return g;
}

function drawChair(parent: Container, cx: number, cy: number, color: number) {
  const g = new Graphics();
  const chairBase = blendColor(color, OFFICE_PASTEL.creamWhite, 0.18);
  const chairMid = blendColor(color, OFFICE_PASTEL.creamWhite, 0.08);
  const chairShadow = blendColor(color, OFFICE_PASTEL.ink, 0.22);
  const chairDark = blendColor(color, OFFICE_PASTEL.ink, 0.35);
  // Floor shadow
  g.ellipse(cx, cy + 5, 18, 6).fill({ color: OFFICE_PASTEL.cocoa, alpha: 0.08 });
  // Wheel base (star pattern)
  g.circle(cx - 8, cy + 3, 1.5).fill({ color: 0x555555, alpha: 0.3 });
  g.circle(cx + 8, cy + 3, 1.5).fill({ color: 0x555555, alpha: 0.3 });
  g.circle(cx, cy + 4, 1.5).fill({ color: 0x555555, alpha: 0.3 });
  // Seat cushion
  g.ellipse(cx, cy, 16, 10).fill({ color: OFFICE_PASTEL.cocoa, alpha: 0.06 });
  g.ellipse(cx, cy, 15, 9).fill(chairBase);
  g.ellipse(cx, cy, 15, 9).stroke({ width: 1, color: chairShadow, alpha: 0.25 });
  // Seat highlight (subtle dome)
  g.ellipse(cx - 1, cy - 1.5, 11, 5.5).fill({ color: 0xffffff, alpha: 0.12 });
  g.ellipse(cx, cy + 3, 10, 3).fill({ color: chairShadow, alpha: 0.08 });
  // Cushion stitch line
  g.ellipse(cx, cy, 10, 6).stroke({ width: 0.3, color: chairShadow, alpha: 0.12 });
  // Armrests (rounded, softer)
  g.roundRect(cx - 17, cy - 5, 5, 13, 2.5).fill(chairMid);
  g.roundRect(cx - 17, cy - 5, 5, 13, 2.5).stroke({ width: 0.5, color: chairShadow, alpha: 0.2 });
  g.roundRect(cx + 12, cy - 5, 5, 13, 2.5).fill(chairMid);
  g.roundRect(cx + 12, cy - 5, 5, 13, 2.5).stroke({ width: 0.5, color: chairShadow, alpha: 0.2 });
  // Armrest top highlight
  g.roundRect(cx - 16, cy - 4.5, 3, 1, 0.5).fill({ color: 0xffffff, alpha: 0.12 });
  g.roundRect(cx + 13, cy - 4.5, 3, 1, 0.5).fill({ color: 0xffffff, alpha: 0.12 });
  // Backrest (ergonomic curve)
  g.roundRect(cx - 14, cy - 13, 28, 7, 4).fill(chairShadow);
  g.roundRect(cx - 14, cy - 13, 28, 7, 4).stroke({ width: 0.8, color: chairDark, alpha: 0.25 });
  // Backrest top highlight
  g.roundRect(cx - 12, cy - 12, 24, 2.5, 2).fill({ color: blendColor(chairBase, 0xffffff, 0.4), alpha: 0.4 });
  // Backrest lumbar support detail
  g.roundRect(cx - 10, cy - 9, 20, 2, 1).fill({ color: chairBase, alpha: 0.3 });
  // Seat cushion center detail
  g.ellipse(cx, cy - 0.5, 9, 3.2).fill({ color: blendColor(chairBase, OFFICE_PASTEL.softMint, 0.22), alpha: 0.5 });
  parent.addChild(g);
}

function drawPlant(parent: Container, x: number, y: number, variant: number = 0) {
  const g = new Graphics();
  // Pot shadow (softer, larger)
  g.ellipse(x, y + 8, 8, 3).fill({ color: OFFICE_PASTEL.cocoa, alpha: 0.1 });
  g.ellipse(x, y + 7, 7, 2.5).fill({ color: OFFICE_PASTEL.cocoa, alpha: 0.07 });
  // Pot body (warm terra cotta with richer shading)
  g.roundRect(x - 5, y, 10, 7, 2).fill(0xd07858);
  g.roundRect(x - 4.5, y + 0.5, 9, 6, 1.5).fill(0xd88060);
  g.roundRect(x - 4, y + 1, 8, 5, 1.5).fill(0xe89070);
  // Pot highlight stripe
  g.roundRect(x - 3, y + 2, 6, 1, 0.5).fill({ color: 0xffffff, alpha: 0.08 });
  // Pot rim (thicker, with detail)
  g.roundRect(x - 6, y - 1.5, 12, 3.5, 1.8).fill(0xe08060);
  g.roundRect(x - 5.5, y - 1, 11, 2, 1.2).fill(0xf0a080);
  g.roundRect(x - 5, y - 1, 10, 1.2, 1).fill({ color: 0xffffff, alpha: 0.12 });
  // Pot decorative band
  g.roundRect(x - 4, y + 4, 8, 1, 0.5).fill({ color: 0xc06848, alpha: 0.3 });
  // Soil (richer)
  g.ellipse(x, y, 4.5, 1.8).fill(0x5e4530);
  g.ellipse(x - 1, y + 0.2, 2.5, 1).fill({ color: 0x7a5840, alpha: 0.5 });
  // Tiny soil pebble
  g.circle(x + 2.5, y - 0.3, 0.7).fill({ color: 0x8a6a50, alpha: 0.4 });
  if (variant % 4 === 0) {
    // Bushy monstera-style plant (soft mint)
    g.rect(x - 0.4, y - 2, 0.8, 3).fill(0x6aaa88);
    g.circle(x, y - 4, 6.5).fill(0x78bfa4);
    g.circle(x - 3, y - 6, 4.5).fill(0x89cfb5);
    g.circle(x + 3, y - 6.5, 4).fill(0x89cfb5);
    g.circle(x, y - 8.5, 4).fill(0x9dd9c2);
    g.circle(x - 2, y - 10, 2.8).fill(0xb7e7d5);
    g.circle(x + 2.5, y - 9.5, 2.2).fill(0xb7e7d5);
    // Leaf veins
    g.moveTo(x, y - 4)
      .lineTo(x, y - 8)
      .stroke({ width: 0.3, color: 0x5e9f7f, alpha: 0.3 });
    g.moveTo(x - 2, y - 6)
      .lineTo(x - 4, y - 8)
      .stroke({ width: 0.2, color: 0x5e9f7f, alpha: 0.2 });
    g.moveTo(x + 2, y - 6)
      .lineTo(x + 4, y - 8)
      .stroke({ width: 0.2, color: 0x5e9f7f, alpha: 0.2 });
    // Highlight leaves
    g.circle(x + 2, y - 7, 1.8).fill({ color: 0xffffff, alpha: 0.18 });
    g.circle(x - 2, y - 9.5, 1.2).fill({ color: 0xffffff, alpha: 0.12 });
  } else if (variant % 4 === 1) {
    // Tall cactus (mint-sage, more detailed)
    g.roundRect(x - 2.5, y - 12, 5, 12, 2.5).fill(0x6eaa88);
    g.roundRect(x - 2, y - 10, 4, 10, 2).fill(0x82bc9a);
    g.roundRect(x - 1.5, y - 9, 3, 8, 1.5).fill(0x92c8aa);
    // Cactus ribs
    g.moveTo(x - 1, y - 11)
      .lineTo(x - 1, y - 1)
      .stroke({ width: 0.25, color: 0x5a9a78, alpha: 0.3 });
    g.moveTo(x + 1, y - 11)
      .lineTo(x + 1, y - 1)
      .stroke({ width: 0.25, color: 0x5a9a78, alpha: 0.3 });
    // Arms (more rounded)
    g.roundRect(x - 7, y - 7, 5, 2.5, 1.2).fill(0x72b090);
    g.roundRect(x - 7, y - 10, 2.5, 5, 1.2).fill(0x82bc9a);
    g.roundRect(x + 2, y - 5, 5, 2.5, 1.2).fill(0x72b090);
    g.roundRect(x + 4.5, y - 8, 2.5, 5, 1.2).fill(0x82bc9a);
    // Spines (tiny dots)
    for (let i = 0; i < 5; i++) {
      g.circle(x + (i % 2 === 0 ? 2.5 : -2.5), y - 2 - i * 2, 0.3).fill({ color: 0xd8d0c0, alpha: 0.4 });
    }
    // Flower on top
    g.circle(x, y - 13, 2).fill(0xe3a8b2);
    g.circle(x - 1.2, y - 13.5, 1.5).fill(0xedb8c2);
    g.circle(x + 1.2, y - 13.5, 1.5).fill(0xedb8c2);
    g.circle(x, y - 13, 1).fill(0xf6d57a);
  } else if (variant % 4 === 2) {
    // Flower pot (mint stem + dusty blossoms, more flowers)
    g.rect(x - 0.5, y - 9, 1, 9).fill(0x6aaa88);
    g.rect(x - 2.5, y - 6, 0.8, 5).fill(0x7ab898);
    g.rect(x + 2, y - 5, 0.8, 4).fill(0x7ab898);
    // Leaves
    g.circle(x, y - 3.5, 5).fill(0x6eaa88);
    g.circle(x - 3.5, y - 5.5, 3.5).fill(0x82bc9a);
    g.circle(x + 3.5, y - 5.5, 3).fill(0x82bc9a);
    g.circle(x, y - 7, 3).fill(0x92c8aa);
    // Flowers (multiple, varied)
    g.circle(x, y - 10, 3).fill(0xe09aaa);
    g.circle(x - 1, y - 10.5, 1.8).fill(0xeaacb8);
    g.circle(x + 1, y - 10.5, 1.8).fill(0xeaacb8);
    g.circle(x, y - 10, 1.5).fill(0xf6d685);
    g.circle(x - 4, y - 8, 2.5).fill(0x9fbede);
    g.circle(x - 4, y - 8, 1.2).fill(0xf8efba);
    g.circle(x + 3.5, y - 8.5, 2).fill(0xf2b28a);
    g.circle(x + 3.5, y - 8.5, 1).fill(0xf7df97);
    // Tiny bud
    g.circle(x + 1.5, y - 12, 1.2).fill(0xe8a0b0);
  } else {
    // Snake plant / sansevieria (tall pointed leaves)
    const leafColors = [0x5e9a78, 0x6eaa88, 0x7cb898, 0x5a9070];
    for (let i = 0; i < 4; i++) {
      const lx = x + (i - 1.5) * 2.5;
      const lh = 10 + (i % 2) * 3;
      g.moveTo(lx, y)
        .lineTo(lx - 1.5, y - lh * 0.6)
        .lineTo(lx, y - lh)
        .lineTo(lx + 1.5, y - lh * 0.6)
        .lineTo(lx, y)
        .fill(leafColors[i]);
      // Leaf highlight stripe
      g.moveTo(lx, y)
        .lineTo(lx, y - lh + 1)
        .stroke({ width: 0.3, color: 0xb8e0c8, alpha: 0.25 });
    }
    // Yellow leaf edge detail
    g.moveTo(x - 2, y - 8)
      .lineTo(x - 3, y - 5)
      .stroke({ width: 0.3, color: 0xc8d8a8, alpha: 0.25 });
  }
  parent.addChild(g);
}

function drawWhiteboard(parent: Container, x: number, y: number) {
  const g = new Graphics();
  // Shadow behind board (deeper, offset)
  g.roundRect(x + 2, y + 2, 38, 22, 2).fill({ color: 0x000000, alpha: 0.15 });
  g.roundRect(x + 1, y + 1, 38, 22, 2).fill({ color: 0x000000, alpha: 0.08 });
  // Frame (warmer silver)
  g.roundRect(x, y, 38, 22, 2).fill(0xcccccc);
  g.roundRect(x, y, 38, 22, 2).stroke({ width: 0.5, color: 0xaaaaaa });
  // Frame highlight (top edge)
  g.moveTo(x + 2, y + 0.5)
    .lineTo(x + 36, y + 0.5)
    .stroke({ width: 0.5, color: 0xffffff, alpha: 0.15 });
  // White surface
  g.roundRect(x + 2, y + 2, 34, 18, 1).fill(0xfaf8f2);
  // Content: colored lines + shapes
  const cc = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b];
  for (let i = 0; i < 3; i++) {
    g.moveTo(x + 5, y + 5 + i * 5)
      .lineTo(x + 5 + 8 + Math.random() * 16, y + 5 + i * 5)
      .stroke({ width: 1, color: cc[i], alpha: 0.6 });
  }
  // Small sticky notes
  g.rect(x + 26, y + 4, 6, 5).fill({ color: 0xffee88, alpha: 0.8 });
  g.rect(x + 26, y + 11, 6, 5).fill({ color: 0x88eeff, alpha: 0.8 });
  // Marker tray
  g.roundRect(x + 8, y + 21, 22, 3, 1).fill(0x999999);
  // Markers
  g.roundRect(x + 10, y + 20, 2, 3, 0.5).fill(0x3366ff);
  g.roundRect(x + 13, y + 20, 2, 3, 0.5).fill(0xff3333);
  g.roundRect(x + 16, y + 20, 2, 3, 0.5).fill(0x33aa33);
  parent.addChild(g);
}

export { drawDesk, drawChair, drawPlant, drawWhiteboard };
