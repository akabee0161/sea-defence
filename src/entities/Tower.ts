import { GameObject } from './GameObject.ts';
import { Enemy } from './Enemy.ts';
import { Bullet } from './Bullet.ts';
import { ObjectPool } from '../utils/ObjectPool.ts';
import { Renderer } from '../core/Renderer.ts';
import { TILE_SIZE, GRID_OFFSET_Y } from '../level/MapGrid.ts';

export class Tower extends GameObject {
  readonly range: number;
  readonly fireRate: number;
  readonly cost: number;
  readonly damage: number;
  readonly bulletSpeed: number;

  private cooldown = 0;
  private target: Enemy | null = null;

  constructor(
    col: number,
    row: number,
    range       = 150,
    fireRate    = 1,
    cost        = 5,
    damage      = 20,
    bulletSpeed = 250,
  ) {
    super(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2 + GRID_OFFSET_Y);
    this.range       = range;
    this.fireRate    = fireRate;
    this.cost        = cost;
    this.damage      = damage;
    this.bulletSpeed = bulletSpeed;
  }

  update(
    deltaTime: number,
    enemies: Enemy[] = [],
    bulletPool: ObjectPool<Bullet> | null = null,
  ): void {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - deltaTime);
    }

    this.target = null;
    let minDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.isActive) continue;
      const dist = this.position.distanceTo(enemy.pos);
      if (dist <= this.range && dist < minDist) {
        minDist = dist;
        this.target = enemy;
      }
    }

    if (this.cooldown <= 0 && this.target !== null && bulletPool !== null) {
      const bullet = bulletPool.acquire();
      bullet.init(this.position, this.target, this.damage, this.bulletSpeed);
      this.cooldown = 1 / this.fireRate;
    }
  }

  draw(_renderer: Renderer): void { /* overridden by subclass */ }

  get canFire(): boolean { return this.cooldown <= 0; }
  get currentTarget(): Enemy | null { return this.target; }
}

// ── Octopus Tower ─────────────────────────────────────────────────────────────

export class BasicTower extends Tower {
  constructor(col: number, row: number) {
    super(col, row);
  }

  override draw(renderer: Renderer): void {
    const ctx    = renderer.context;
    const cx     = this.position.x;
    const cy     = this.position.y;
    const active = this.currentTarget !== null;

    // Range aura
    renderer.drawCircle(
      this.position,
      this.range,
      'rgba(0,0,0,0)',
      active ? 'rgba(142, 68, 173, 0.30)' : 'rgba(142, 68, 173, 0.10)',
      1,
    );

    const bodyR = 12;
    const bodyY = cy - 3; // body center slightly above tile centre

    // ── Tentacles (drawn behind body) ────────────────────────────────────────
    ctx.strokeStyle = '#6c3483';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';

    const tCount = 6;
    for (let i = 0; i < tCount; i++) {
      const t      = i / (tCount - 1);              // 0 → 1
      const sx     = cx + (t - 0.5) * bodyR * 1.7;  // spread across body base
      const sy     = bodyY + bodyR * 0.75;
      const spread = (t - 0.5) * 10;
      const ex     = sx + spread;
      const ey     = sy + 13;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + spread * 0.5, sy + 7, ex, ey);
      ctx.stroke();

      // Curl at tip
      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#6c3483';
      ctx.fill();
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, bodyY, bodyR, 0, Math.PI * 2);
    ctx.fillStyle = '#9b59b6';
    ctx.fill();
    ctx.strokeStyle = '#6c3483';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Highlight
    ctx.beginPath();
    ctx.arc(cx - bodyR * 0.3, bodyY - bodyR * 0.3, bodyR * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fill();

    // ── Eyes ──────────────────────────────────────────────────────────────────
    for (const [ox, oy] of [[-4, -2], [4, -2]] as [number, number][]) {
      // Sclera
      ctx.beginPath();
      ctx.arc(cx + ox, bodyY + oy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // Pupil
      ctx.beginPath();
      ctx.arc(cx + ox + 0.8, bodyY + oy + 0.5, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTower(col: number, row: number): Tower {
  return new BasicTower(col, row);
}

export function towerCost(): number {
  return 1;
}
