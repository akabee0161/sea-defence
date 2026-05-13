import type { Vector2D } from '../utils/Vector2D.ts';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  clear(color = '#0a1f3d'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawRect(
    pos: Vector2D,
    width: number,
    height: number,
    fillColor?: string,
    strokeColor?: string,
    lineWidth = 1,
  ): void {
    if (fillColor) {
      this.ctx.fillStyle = fillColor;
      this.ctx.fillRect(pos.x, pos.y, width, height);
    }
    if (strokeColor) {
      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = lineWidth;
      this.ctx.strokeRect(pos.x, pos.y, width, height);
    }
  }

  drawCircle(
    center: Vector2D,
    radius: number,
    fillColor?: string,
    strokeColor?: string,
    lineWidth = 1,
  ): void {
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    if (fillColor) {
      this.ctx.fillStyle = fillColor;
      this.ctx.fill();
    }
    if (strokeColor) {
      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = lineWidth;
      this.ctx.stroke();
    }
  }

  drawLine(
    from: Vector2D,
    to: Vector2D,
    color: string,
    lineWidth = 1,
    dashed = false,
  ): void {
    this.ctx.beginPath();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    if (dashed) {
      this.ctx.setLineDash([6, 4]);
    } else {
      this.ctx.setLineDash([]);
    }
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  drawText(
    text: string,
    pos: Vector2D,
    color = '#ffffff',
    font = '14px monospace',
  ): void {
    this.ctx.fillStyle = color;
    this.ctx.font = font;
    this.ctx.fillText(text, pos.x, pos.y);
  }

  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }
}
