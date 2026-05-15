import type { Renderer } from '../core/Renderer.ts';
import { GRID_OFFSET_Y, TILE_SIZE } from '../level/MapGrid.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import { GameObject } from './GameObject.ts';

export const CORAL_COST = 1;
export const CORAL_MAX_HP = 150;

const HP_BAR_W = 30;
const HP_BAR_H = 4;

export class CoralWall extends GameObject {
  readonly tileCol: number;
  readonly tileRow: number;

  private hp: number = CORAL_MAX_HP;
  private readonly maxHp: number = CORAL_MAX_HP;
  private broken = false;

  constructor(col: number, row: number) {
    super(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2 + GRID_OFFSET_Y,
    );
    this.tileCol = col;
    this.tileRow = row;
  }

  get isBroken(): boolean {
    return this.broken;
  }

  /** ダメージを与える。破壊が発生した場合 true を返す。 */
  takeDamage(amount: number): boolean {
    if (this.broken) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.broken = true;
      return true;
    }
    return false;
  }

  /** Wave クリア後に呼ぶ。HP を全回復して復活させる。 */
  restore(): void {
    this.hp = this.maxHp;
    this.broken = false;
  }

  update(_deltaTime: number): void {
    /* static structure */
  }

  draw(renderer: Renderer): void {
    if (!this.active) return;
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y;
    const baseY = cy + 10;

    if (this.broken) {
      this.drawRubble(ctx, cx, baseY);
      return;
    }

    const ratio = this.hp / this.maxHp;
    this.drawBranches(ctx, cx, baseY, ratio);
    this.drawPolyps(ctx, cx, baseY, ratio);
    if (ratio < 0.25) this.drawCracks(ctx, cx, baseY);
    this.drawRockBase(ctx, cx, baseY);
    this.drawHpBar(renderer, cx, cy, ratio);
  }

  private drawBranches(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    ratio: number,
  ): void {
    // HP に応じて枝の色を赤→暗灰色へ補間
    const r = Math.round(192 * ratio + 80 * (1 - ratio));
    const g = Math.round(57 * ratio + 60 * (1 - ratio));
    const b = Math.round(43 * ratio + 60 * (1 - ratio));
    const branchColor = `rgb(${r},${g},${b})`;

    const branches: [number, number, number, number, number][] = [
      [0, 0, 0, -22, 5.0],
      [0, -9, -12, -21, 3.5],
      [0, -9, 12, -19, 3.5],
      [-1, -15, -16, -25, 2.5],
      [1, -15, 14, -23, 2.5],
    ];

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [sx, sy, ex, ey, lw] of branches) {
      ctx.beginPath();
      ctx.strokeStyle = branchColor;
      ctx.lineWidth = lw;
      ctx.moveTo(cx + sx, baseY + sy);
      ctx.lineTo(cx + ex, baseY + ey);
      ctx.stroke();
    }
  }

  private drawPolyps(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    ratio: number,
  ): void {
    // HP が低いほどポリプが白みがかる
    const alpha = 0.4 + ratio * 0.6;
    const tips: [number, number, string][] = [
      [0, -22, '#ff6b6b'],
      [-12, -21, '#ff8c69'],
      [12, -19, '#ff6b6b'],
      [-16, -25, '#ffd166'],
      [14, -23, '#ffd166'],
    ];

    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * alpha;
    for (const [tx, ty, color] of tips) {
      ctx.beginPath();
      ctx.arc(cx + tx, baseY + ty, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = prevAlpha;
  }

  private drawCracks(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
  ): void {
    ctx.strokeStyle = 'rgba(30,10,0,0.55)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(cx - 2, baseY - 5);
    ctx.lineTo(cx + 5, baseY - 12);
    ctx.lineTo(cx + 2, baseY - 18);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + 1, baseY - 8);
    ctx.lineTo(cx - 6, baseY - 14);
    ctx.stroke();
  }

  private drawRockBase(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
  ): void {
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 2, 8, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7f5539';
    ctx.fill();
  }

  private drawRubble(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
  ): void {
    // 岩の台座だけ残す（灰色化）
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 2, 8, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#555555';
    ctx.fill();

    // 小石を散らす
    const pebbles: [number, number, number][] = [
      [-6, -3, 2.5],
      [5, -4, 2],
      [0, -6, 1.8],
      [-3, -8, 1.5],
    ];
    ctx.fillStyle = '#666666';
    for (const [px, py, pr] of pebbles) {
      ctx.beginPath();
      ctx.arc(cx + px, baseY + py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHpBar(
    renderer: Renderer,
    cx: number,
    cy: number,
    ratio: number,
  ): void {
    const barX = cx - HP_BAR_W / 2;
    const barY = cy + 18;
    const barPos = new Vector2D(barX, barY);

    renderer.drawRect(barPos, HP_BAR_W, HP_BAR_H, '#333');
    const barColor =
      ratio > 0.5 ? '#2ecc71' : ratio > 0.25 ? '#f39c12' : '#e74c3c';
    renderer.drawRect(barPos, HP_BAR_W * ratio, HP_BAR_H, barColor);
  }
}
