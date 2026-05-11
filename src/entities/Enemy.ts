import { GameObject } from './GameObject.ts';
import { Renderer } from '../core/Renderer.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import { ENEMY_DEFS, EnemyKind } from '../defs/enemyDefs.ts';

export type { EnemyKind };

export const EATING_INTERVAL = 1.0; // seconds between egg consumption at goal

const HP_BAR_H        = 5;
const REACH_THRESHOLD = 4; // px — distance to snap to waypoint

export class Enemy extends GameObject {
  readonly kind:   EnemyKind;
  readonly radius: number;
  readonly reward: number;

  private waypoints:        Vector2D[];
  private waypointIndex:    number;
  private hp:               number;
  private readonly maxHp:   number;
  private readonly speed:   number;
  private readonly bodyColor: string;
  private readonly finColor:  string;
  isAtGoal =      false;  // true when shark has reached goal, eating eggs
  eatingTimer =   0;      // seconds until next egg consumed; managed by Game
  currentGoalIdx: number; // index into GOAL_COLS; managed by Game
  private facingAngle =      0;   // radians; 0 = facing right (+x)
  private speedMultiplier =  1.0; // 1.0 = normal, < 1 = slowed by coral

  constructor(waypoints: Vector2D[], kind: EnemyKind = 'small', goalIdx = 0) {
    super(waypoints[0].x, waypoints[0].y);
    const def = ENEMY_DEFS[kind];
    if (!def) throw new Error(`Unknown enemy kind: "${kind}". Add it to ENEMY_DEFS.`);

    this.kind           = kind;
    this.waypoints      = waypoints;
    this.waypointIndex  = 1;
    this.radius         = def.radius;
    this.speed          = def.speed;
    this.maxHp          = def.maxHp;
    this.hp             = def.maxHp;
    this.reward         = def.reward;
    this.bodyColor      = def.bodyColor;
    this.finColor       = def.finColor;
    this.currentGoalIdx = goalIdx;
  }

  /** Redirect this enemy to a new path toward a different goal. */
  setNewPath(waypoints: Vector2D[], goalIdx: number): void {
    this.waypoints     = waypoints;
    this.waypointIndex = 1;
    this.isAtGoal      = false;
    this.eatingTimer   = 0;
    this.currentGoalIdx = goalIdx;
  }

  update(deltaTime: number): void {
    if (!this.active || this.isAtGoal) return;
    if (this.waypointIndex >= this.waypoints.length) return;

    const target   = this.waypoints[this.waypointIndex];
    const toTarget = target.subtract(this.position);
    const dist     = toTarget.magnitude();
    const step     = this.speed * this.speedMultiplier * deltaTime;

    if (dist > REACH_THRESHOLD) {
      const dir = toTarget.normalize();
      this.facingAngle = Math.atan2(dir.y, dir.x);
    }

    if (dist <= Math.max(step, REACH_THRESHOLD)) {
      this.position = target.clone();
      this.waypointIndex++;
      if (this.waypointIndex >= this.waypoints.length) {
        this.isAtGoal    = true;
        this.eatingTimer = EATING_INTERVAL;
      }
    } else {
      this.position = this.position.add(toTarget.normalize().scale(step));
    }
  }

  draw(renderer: Renderer): void {
    if (!this.active) return;
    this.drawShark(renderer);
    this.drawHpBar(renderer);
  }

  private drawShark(renderer: Renderer): void {
    const ctx = renderer.context;
    const { x, y } = this.position;
    const r = this.radius;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.facingAngle);

    // Tail fin — drawn first so the body overlaps the joint cleanly
    ctx.beginPath();
    ctx.moveTo(-r * 0.95, 0);
    ctx.lineTo(-r * 1.6,  -r * 0.55);
    ctx.lineTo(-r * 1.3,   0);
    ctx.lineTo(-r * 1.6,   r * 0.55);
    ctx.closePath();
    ctx.fillStyle = this.finColor;
    ctx.fill();

    // Body (ellipse — wider than tall, front = right)
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.3, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = this.bodyColor;
    ctx.fill();
    ctx.strokeStyle = this.finColor;
    ctx.lineWidth   = r > 20 ? 3 : 2;
    ctx.stroke();

    // ── Open mouth ────────────────────────────────────────────────────────────
    const jawDrop = this.isAtGoal
      ? r * (0.10 + 0.14 * Math.abs(Math.sin(Date.now() / 280)))
      : r * 0.32;
    const jawBack = this.isAtGoal ? jawDrop * 0.80 : r * 0.26;

    ctx.beginPath();
    ctx.moveTo(r * 0.82, -r * 0.05);
    ctx.lineTo(r * 1.28, -r * 0.08);
    ctx.lineTo(r * 1.20,  jawDrop);
    ctx.lineTo(r * 0.82,  jawBack);
    ctx.closePath();
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();

    // ── Teeth ─────────────────────────────────────────────────────────────────
    const tw = Math.max(r * 0.075, 1.2);
    const th = Math.max(r * 0.14,  2.0);

    ctx.fillStyle = '#f2f2f2';

    for (const tx of [r * 0.93, r * 1.09]) {
      ctx.beginPath();
      ctx.moveTo(tx - tw, -r * 0.05);
      ctx.lineTo(tx,       th - r * 0.05);
      ctx.lineTo(tx + tw, -r * 0.05);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(r * 1.02, jawBack);
    ctx.lineTo(r * 1.10, jawBack - th);
    ctx.lineTo(r * 1.18, jawBack);
    ctx.closePath();
    ctx.fill();

    // ── Dorsal fin ────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.71);
    ctx.lineTo( r * 0.35, -r * 0.71);
    ctx.lineTo( r * 0.12, -r * 1.40);
    ctx.closePath();
    ctx.fillStyle = this.finColor;
    ctx.fill();

    // ── Eye: angry crescent ───────────────────────────────────────────────────
    const ex = r * 0.48;
    const ey = -r * 0.24;
    const er = Math.max(r * 0.22, 3.5);

    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(ex + er * 0.10, ey - er * 0.55, er * 1.05, 0, Math.PI * 2);
    ctx.fillStyle = '#111111';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(ex - er * 1.0, ey - er * 1.35);
    ctx.lineTo(ex + er * 0.9, ey - er * 0.70);
    ctx.strokeStyle = this.finColor;
    ctx.lineWidth   = Math.max(r * 0.15, 2);
    ctx.lineCap     = 'round';
    ctx.stroke();

    ctx.restore();
  }

  private drawHpBar(renderer: Renderer): void {
    const barW   = Math.max(this.radius * 2.6, 28);
    const barX   = this.position.x - barW / 2;
    const barY   = this.position.y - this.radius * 1.65 - 6;
    const barPos = new Vector2D(barX, barY);

    renderer.drawRect(barPos, barW, HP_BAR_H, '#333');
    const ratio    = this.hp / this.maxHp;
    const barColor = ratio > 0.5 ? '#2ecc71' : ratio > 0.25 ? '#f39c12' : '#e74c3c';
    renderer.drawRect(barPos, barW * ratio, HP_BAR_H, barColor);
  }

  setSpeedMultiplier(m: number): void { this.speedMultiplier = m; }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.destroy();
  }

  get currentHp(): number { return this.hp; }
}
