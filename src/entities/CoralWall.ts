import type { Renderer } from '../core/Renderer.ts';
import { GRID_OFFSET_Y, TILE_SIZE } from '../level/MapGrid.ts';
import { GameObject } from './GameObject.ts';

export const CORAL_COST = 1;

export class CoralWall extends GameObject {
  readonly tileCol: number;
  readonly tileRow: number;

  constructor(col: number, row: number) {
    super(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2 + GRID_OFFSET_Y,
    );
    this.tileCol = col;
    this.tileRow = row;
  }

  update(_deltaTime: number): void {
    /* static structure */
  }

  draw(renderer: Renderer): void {
    if (!this.active) return;
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y;
    const baseY = cy + 10; // anchor at lower part of tile

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ── Branches ─────────────────────────────────────────────────────────────
    // [startX, startY, endX, endY, lineWidth] — all offsets from (cx, baseY)
    const branches: [number, number, number, number, number][] = [
      [0, 0, 0, -22, 5.0], // main stem
      [0, -9, -12, -21, 3.5], // left branch
      [0, -9, 12, -19, 3.5], // right branch
      [-1, -15, -16, -25, 2.5], // left sub-branch
      [1, -15, 14, -23, 2.5], // right sub-branch
    ];

    for (const [sx, sy, ex, ey, lw] of branches) {
      ctx.beginPath();
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = lw;
      ctx.moveTo(cx + sx, baseY + sy);
      ctx.lineTo(cx + ex, baseY + ey);
      ctx.stroke();
    }

    // ── Polyp blobs at tips ───────────────────────────────────────────────────
    const tips: [number, number, string][] = [
      [0, -22, '#ff6b6b'],
      [-12, -21, '#ff8c69'],
      [12, -19, '#ff6b6b'],
      [-16, -25, '#ffd166'],
      [14, -23, '#ffd166'],
    ];

    for (const [tx, ty, color] of tips) {
      ctx.beginPath();
      ctx.arc(cx + tx, baseY + ty, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // ── Rock base ─────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 2, 8, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7f5539';
    ctx.fill();
  }
}
