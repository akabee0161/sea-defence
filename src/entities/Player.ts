import type { Renderer } from '../core/Renderer.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import { GameObject } from './GameObject.ts';

const HIT_RADIUS = 34; // px — generous touch target for grabbing
const BODY_HALF = 28; // half-length of body (excluding bill)
const FOLLOW_LERP = 12; // higher = snappier follow
const ANGLE_LERP = 10; // smoothing for facing-angle changes

const COOLDOWN_GAUGE_R = 12; // px — radius of attack cooldown ring
const COOLDOWN_GAUGE_OY = 50; // px above player center

const COLOR_DARK = '#0d2842';
const COLOR_BACK = '#1f4d78';
const COLOR_MID = '#5594c5';
const COLOR_BELLY = '#dfeaf3';

export class Player extends GameObject {
  private target: Vector2D;
  private facingAngle = 0; // radians
  private animTime = 0;
  private speedNorm = 0; // 0..1 — drives fin amplitude
  private _isAttacking = false;
  readonly hitRadius = HIT_RADIUS;

  constructor(x: number, y: number) {
    super(x, y);
    this.target = new Vector2D(x, y);
  }

  setTarget(x: number, y: number): void {
    this.target = new Vector2D(x, y);
  }

  setPosition(x: number, y: number): void {
    this.position = new Vector2D(x, y);
    this.target = new Vector2D(x, y);
  }

  setFacing(angle: number): void {
    this.facingAngle = angle;
  }

  setAttacking(v: boolean): void {
    this._isAttacking = v;
  }

  resetTo(x: number, y: number): void {
    this.position = new Vector2D(x, y);
    this.target = new Vector2D(x, y);
    this.facingAngle = 0;
    this.speedNorm = 0;
    this.animTime = 0;
  }

  containsPoint(x: number, y: number): boolean {
    const dx = x - this.position.x;
    const dy = y - this.position.y;
    return dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS;
  }

  update(deltaTime: number): void {
    if (this._isAttacking) {
      this.speedNorm = Math.min(1, this.speedNorm + deltaTime * 6);
      this.animTime += deltaTime * (4 + this.speedNorm * 10);
      return;
    }

    const prevX = this.position.x;
    const prevY = this.position.y;

    const t = Math.min(1, FOLLOW_LERP * deltaTime);
    const nx = prevX + (this.target.x - prevX) * t;
    const ny = prevY + (this.target.y - prevY) * t;
    this.position = new Vector2D(nx, ny);

    const dx = nx - prevX;
    const dy = ny - prevY;
    const moveDist = Math.hypot(dx, dy);

    if (moveDist > 0.4) {
      const desired = Math.atan2(dy, dx);
      // Shortest-arc interpolation
      let diff = desired - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, ANGLE_LERP * deltaTime);
    }

    const speed = moveDist / Math.max(deltaTime, 1e-6);
    const speedTarget = Math.min(1, speed / 350);
    this.speedNorm +=
      (speedTarget - this.speedNorm) * Math.min(1, deltaTime * 6);

    this.animTime += deltaTime * (4 + this.speedNorm * 10);
  }

  drawCooldown(renderer: Renderer, progress: number): void {
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y - COOLDOWN_GAUGE_OY;
    const startAngle = -Math.PI / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      COOLDOWN_GAUGE_R,
      startAngle,
      startAngle + Math.PI * 2 * progress,
    );
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  draw(renderer: Renderer): void {
    const ctx = renderer.context;
    const r = BODY_HALF;
    const wave = Math.sin(this.animTime);
    const tailFlap = wave * (0.18 + this.speedNorm * 0.45);
    const idleFlap = wave * 0.1;

    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    ctx.rotate(this.facingAngle);

    // ── Tail fin (crescent), pivots from base ───────────────────────────────
    ctx.save();
    ctx.translate(-r * 0.85, 0);
    ctx.rotate(tailFlap);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.55, -r * 0.6);
    ctx.quadraticCurveTo(-r * 0.3, 0, -r * 0.55, r * 0.6);
    ctx.closePath();
    ctx.fillStyle = COLOR_BACK;
    ctx.fill();
    ctx.strokeStyle = COLOR_DARK;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ── Body (long, sleek) ──────────────────────────────────────────────────
    const grad = ctx.createLinearGradient(0, -r * 0.42, 0, r * 0.42);
    grad.addColorStop(0, COLOR_BACK);
    grad.addColorStop(0.55, COLOR_MID);
    grad.addColorStop(1, COLOR_BELLY);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.85, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = COLOR_DARK;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // ── Bill (long pointed snout) ───────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(r * 0.78, -r * 0.05);
    ctx.lineTo(r * 1.55, 0);
    ctx.lineTo(r * 0.78, r * 0.05);
    ctx.closePath();
    ctx.fillStyle = COLOR_DARK;
    ctx.fill();

    // ── Dorsal fin (sail), gentle sway ──────────────────────────────────────
    ctx.save();
    ctx.translate(-r * 0.1, -r * 0.3);
    ctx.rotate(idleFlap * 0.5);
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, 0);
    ctx.lineTo(r * 0.1, -r * 0.65);
    ctx.lineTo(r * 0.3, 0);
    ctx.closePath();
    ctx.fillStyle = COLOR_BACK;
    ctx.fill();
    ctx.strokeStyle = COLOR_DARK;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ── Pectoral fin (side), flaps with movement ────────────────────────────
    ctx.save();
    ctx.translate(r * 0.05, r * 0.2);
    ctx.rotate(0.45 + tailFlap * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.42, r * 0.22);
    ctx.lineTo(-r * 0.05, r * 0.06);
    ctx.closePath();
    ctx.fillStyle = COLOR_BACK;
    ctx.fill();
    ctx.strokeStyle = COLOR_DARK;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // ── Lateral stripe (subtle) ─────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, r * 0.02);
    ctx.quadraticCurveTo(0, -r * 0.04, r * 0.7, r * 0.02);
    ctx.strokeStyle = 'rgba(13, 40, 66, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Gill line ───────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(r * 0.32, -r * 0.2);
    ctx.quadraticCurveTo(r * 0.26, 0, r * 0.32, r * 0.2);
    ctx.strokeStyle = 'rgba(13, 40, 66, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Eye ─────────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(r * 0.48, -r * 0.12, r * 0.075, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.5, -r * 0.12, r * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();

    ctx.restore();
  }
}
