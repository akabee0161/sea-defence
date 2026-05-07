import { GameObject } from './GameObject.ts';
import { Enemy } from './Enemy.ts';
import { Bullet } from './Bullet.ts';
import { ObjectPool } from '../utils/ObjectPool.ts';
import { Renderer } from '../core/Renderer.ts';
import { TILE_SIZE, GRID_OFFSET_Y } from '../level/MapGrid.ts';
import { Vector2D } from '../utils/Vector2D.ts';

export enum TowerKind {
  Octopus    = 'octopus',
  Crab       = 'crab',
  HermitCrab = 'hermit_crab',
  Eel        = 'eel',
}

export class Tower extends GameObject {
  readonly range: number;
  readonly fireRate: number;
  readonly cost: number;
  readonly damage: number;
  readonly bulletSpeed: number;

  protected cooldown = 0;
  protected target: Enemy | null = null;

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

export class OctopusTower extends Tower {
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

// ── Crab Tower ────────────────────────────────────────────────────────────────

export class CrabTower extends Tower {
  private readonly patrolCols: number[];
  private patrolIndex: number;
  private movingRight = true;
  private attackFlash = 0; // seconds remaining for claw-snap animation

  private static readonly MOVE_SPEED  = 60;  // px/s
  private static readonly FLASH_TIME  = 0.12; // seconds for claw-snap visual

  constructor(col: number, row: number, patrolCols: number[]) {
    // range=45, fireRate=2.0, cost=1, damage=35, bulletSpeed=0 (直接攻撃)
    super(col, row, 45, 2.0, 1, 35, 0);
    this.patrolCols  = patrolCols.length > 0 ? patrolCols : [col];
    this.patrolIndex = Math.max(0, this.patrolCols.indexOf(col));
  }

  override update(
    deltaTime: number,
    enemies: Enemy[],
    _pool: ObjectPool<Bullet> | null,
  ): void {
    // ── 1. 横方向の巡回移動 ────────────────────────────────────────────────────
    if (this.patrolCols.length > 1) {
      const targetX = this.patrolCols[this.patrolIndex] * TILE_SIZE + TILE_SIZE / 2;
      const dx   = targetX - this.position.x;
      const step = CrabTower.MOVE_SPEED * deltaTime;

      if (Math.abs(dx) <= step) {
        this.position = new Vector2D(targetX, this.position.y);
        if (this.movingRight) {
          if (this.patrolIndex < this.patrolCols.length - 1) {
            this.patrolIndex++;
          } else {
            this.movingRight = false;
            this.patrolIndex = Math.max(0, this.patrolIndex - 1);
          }
        } else {
          if (this.patrolIndex > 0) {
            this.patrolIndex--;
          } else {
            this.movingRight = true;
            this.patrolIndex = Math.min(this.patrolCols.length - 1, this.patrolIndex + 1);
          }
        }
      } else {
        this.position = new Vector2D(
          this.position.x + (dx > 0 ? step : -step),
          this.position.y,
        );
      }
    }

    // ── 2. 射程内の敵に直接ダメージ ────────────────────────────────────────────
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - deltaTime);
    }
    if (this.attackFlash > 0) {
      this.attackFlash = Math.max(0, this.attackFlash - deltaTime);
    }

    this.target = null;
    if (this.cooldown <= 0) {
      let nearest: Enemy | null = null;
      let nearestDist = Infinity;
      for (const enemy of enemies) {
        if (!enemy.isActive) continue;
        const dist = this.position.distanceTo(enemy.pos);
        if (dist <= this.range && dist < nearestDist) {
          nearestDist = dist;
          nearest     = enemy;
        }
      }
      if (nearest !== null) {
        nearest.takeDamage(this.damage);
        this.cooldown    = 1 / this.fireRate;
        this.attackFlash = CrabTower.FLASH_TIME;
        this.target      = nearest;
      }
    }
  }

  override draw(renderer: Renderer): void {
    const ctx = renderer.context;
    const cx  = this.position.x;
    const cy  = this.position.y;
    const snapping = this.attackFlash > 0;

    // Range aura
    renderer.drawCircle(
      this.position, this.range, 'rgba(0,0,0,0)',
      snapping ? 'rgba(230,126,34,0.30)' : 'rgba(230,126,34,0.10)', 1,
    );

    // Legs (3 pairs, behind body)
    ctx.strokeStyle = '#a04000';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    for (let i = 0; i < 3; i++) {
      const ly = cy + 1 + i * 5;
      const lx = 8 + i * 2;
      ctx.beginPath();
      ctx.moveTo(cx - 9, ly);
      ctx.lineTo(cx - 9 - lx, ly + 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 9, ly);
      ctx.lineTo(cx + 9 + lx, ly + 7);
      ctx.stroke();
    }

    // Body
    ctx.beginPath();
    ctx.ellipse(cx, cy, 13, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e67e22';
    ctx.fill();
    ctx.strokeStyle = '#a04000';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Carapace highlight
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, 8, 4, 0, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.strokeStyle = 'rgba(255,200,100,0.40)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Eyes on stalks
    for (const ox of [-5, 5] as const) {
      ctx.beginPath();
      ctx.strokeStyle = '#a04000';
      ctx.lineWidth   = 1.5;
      ctx.moveTo(cx + ox, cy - 6);
      ctx.lineTo(cx + ox, cy - 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + ox, cy - 11, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + ox, cy - 11, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
    }

    // Claws (left and right)
    const clawGap = snapping ? 3 : 9;
    for (const side of [-1, 1] as const) {
      const armX = cx + side * 20;
      const armY = cy - 1;

      ctx.strokeStyle = '#a04000';
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';

      // Arm
      ctx.beginPath();
      ctx.moveTo(cx + side * 10, cy);
      ctx.lineTo(armX, armY);
      ctx.stroke();

      // Upper jaw
      ctx.beginPath();
      ctx.moveTo(armX, armY);
      ctx.lineTo(armX + side * 9, armY - clawGap);
      ctx.stroke();

      // Lower jaw
      ctx.beginPath();
      ctx.moveTo(armX, armY);
      ctx.lineTo(armX + side * 9, armY + clawGap);
      ctx.stroke();
    }
  }
}

// ── Hermit Crab Tower ─────────────────────────────────────────────────────────

type HermitCrabState = 'hidden' | 'emerging' | 'attacking' | 'retreating';

export class HermitCrabTower extends Tower {
  private hcState:    HermitCrabState = 'hidden';
  private stateTimer  = 0;
  private attackTimer = 0;

  private static readonly EMERGE_TIME  = 0.4;  // s
  private static readonly ATTACK_TIME  = 0.8;  // s
  private static readonly RETREAT_TIME = 0.6;  // s

  constructor(col: number, row: number) {
    // range=70, fireRate=1.5, cost=1, damage=25, bulletSpeed=0
    super(col, row, 70, 1.5, 1, 25, 0);
  }

  override update(
    deltaTime: number,
    enemies: Enemy[],
    _pool: ObjectPool<Bullet> | null,
  ): void {
    switch (this.hcState) {
      case 'hidden': {
        const nearby = this.findNearest(enemies);
        if (nearby !== null) {
          this.hcState    = 'emerging';
          this.stateTimer = 0;
        }
        break;
      }
      case 'emerging': {
        this.stateTimer += deltaTime;
        if (this.stateTimer >= HermitCrabTower.EMERGE_TIME) {
          this.hcState     = 'attacking';
          this.attackTimer = 0;
          this.cooldown    = 0;
        }
        break;
      }
      case 'attacking': {
        this.attackTimer += deltaTime;
        if (this.cooldown > 0) {
          this.cooldown = Math.max(0, this.cooldown - deltaTime);
        }
        const nearest = this.findNearest(enemies);
        this.target = nearest;
        if (nearest !== null && this.cooldown <= 0) {
          nearest.takeDamage(this.damage);
          this.cooldown = 1 / this.fireRate;
        }
        if (this.attackTimer >= HermitCrabTower.ATTACK_TIME) {
          this.hcState    = 'retreating';
          this.stateTimer = 0;
          this.target     = null;
        }
        break;
      }
      case 'retreating': {
        this.stateTimer += deltaTime;
        if (this.stateTimer >= HermitCrabTower.RETREAT_TIME) {
          this.hcState    = 'hidden';
          this.stateTimer = 0;
        }
        break;
      }
    }
  }

  private findNearest(enemies: Enemy[]): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.isActive) continue;
      const dist = this.position.distanceTo(enemy.pos);
      if (dist <= this.range && dist < nearestDist) {
        nearestDist = dist;
        nearest     = enemy;
      }
    }
    return nearest;
  }

  /** 0 = 完全に貝殻 / 1 = 完全に出現 */
  get emergeProgress(): number {
    switch (this.hcState) {
      case 'hidden':     return 0;
      case 'emerging':   return this.stateTimer / HermitCrabTower.EMERGE_TIME;
      case 'attacking':  return 1;
      case 'retreating': return 1 - this.stateTimer / HermitCrabTower.RETREAT_TIME;
    }
  }

  get currentHcState(): HermitCrabState { return this.hcState; }

  override draw(renderer: Renderer): void {
    const ctx  = renderer.context;
    const cx   = this.position.x;
    const cy   = this.position.y;
    const prog = this.emergeProgress;

    // Range aura
    renderer.drawCircle(
      this.position, this.range, 'rgba(0,0,0,0)',
      prog > 0 ? 'rgba(142,107,34,0.25)' : 'rgba(142,107,34,0.08)', 1,
    );

    // ── Shell (fades slightly as crab emerges) ────────────────────────────────
    ctx.save();
    ctx.globalAlpha *= (1 - prog * 0.6);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14);
    ctx.bezierCurveTo(cx + 13, cy - 10, cx + 13,  cy + 4, cx, cy + 6);
    ctx.bezierCurveTo(cx - 13, cy + 4,  cx - 13, cy - 10, cx, cy - 14);
    ctx.fillStyle   = '#8e6030';
    ctx.fill();
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    // Spiral detail
    ctx.beginPath();
    ctx.arc(cx + 2, cy - 2, 4.5, 0.2, Math.PI * 1.6);
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();

    // ── Crab body (emerges from below) ────────────────────────────────────────
    if (prog > 0.05) {
      const emergeY = cy + 10 - prog * 18;

      ctx.save();
      ctx.globalAlpha *= prog;

      // Legs
      ctx.strokeStyle = '#a04000';
      ctx.lineWidth   = 1.5;
      ctx.lineCap     = 'round';
      for (let i = 0; i < 2; i++) {
        const ly = emergeY + i * 4;
        ctx.beginPath();
        ctx.moveTo(cx - 7, ly);
        ctx.lineTo(cx - 14, ly + 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 7, ly);
        ctx.lineTo(cx + 14, ly + 6);
        ctx.stroke();
      }

      // Body
      ctx.beginPath();
      ctx.ellipse(cx, emergeY, 10, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle   = '#e67e22';
      ctx.fill();
      ctx.strokeStyle = '#a04000';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Eyes
      for (const ox of [-4, 4] as const) {
        ctx.beginPath();
        ctx.arc(cx + ox, emergeY - 5, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + ox, emergeY - 5, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
      }

      // Claws (fully visible in attacking state)
      if (prog >= 0.8 && this.hcState === 'attacking') {
        const snapping = this.target !== null;
        const clawGap  = snapping ? 3 : 8;
        for (const side of [-1, 1] as const) {
          const armX = cx + side * 16;
          ctx.strokeStyle = '#a04000';
          ctx.lineWidth   = 2.5;
          ctx.lineCap     = 'round';
          ctx.beginPath();
          ctx.moveTo(cx + side * 8, emergeY);
          ctx.lineTo(armX, emergeY - 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(armX, emergeY - 2);
          ctx.lineTo(armX + side * 7, emergeY - 2 - clawGap);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(armX, emergeY - 2);
          ctx.lineTo(armX + side * 7, emergeY - 2 + clawGap);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }
}

// ── Eel Tower ─────────────────────────────────────────────────────────────────

type EelState = 'idle' | 'stretching' | 'biting' | 'retracting';

export class EelTower extends Tower {
  private eelState:        EelState = 'idle';
  private stretchProgress  = 0;
  private biteTimer        = 0;
  private stretchTarget:   Enemy | null  = null;
  private stretchDir:      Vector2D      = Vector2D.zero();
  private stretchMaxDist   = 0;

  private static readonly STRETCH_TIME = 0.5;  // s
  private static readonly BITE_TIME    = 0.2;  // s
  private static readonly RETRACT_TIME = 0.4;  // s

  constructor(col: number, row: number) {
    // range=200, fireRate=0.4, cost=1, damage=60, bulletSpeed=0
    super(col, row, 200, 0.4, 1, 60, 0);
  }

  override update(
    deltaTime: number,
    enemies: Enemy[],
    _pool: ObjectPool<Bullet> | null,
  ): void {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - deltaTime);
    }

    switch (this.eelState) {
      case 'idle': {
        if (this.cooldown <= 0) {
          const nearest = this.findNearest(enemies);
          if (nearest !== null) {
            this.stretchTarget   = nearest;
            const toEnemy        = nearest.pos.subtract(this.position);
            this.stretchMaxDist  = Math.min(toEnemy.magnitude(), this.range);
            this.stretchDir      = toEnemy.normalize();
            this.stretchProgress = 0;
            this.eelState        = 'stretching';
          }
        }
        break;
      }
      case 'stretching': {
        this.stretchProgress = Math.min(
          1,
          this.stretchProgress + deltaTime / EelTower.STRETCH_TIME,
        );
        if (this.stretchProgress >= 1) {
          this.eelState  = 'biting';
          this.biteTimer = 0;
          if (this.stretchTarget !== null && this.stretchTarget.isActive) {
            this.stretchTarget.takeDamage(this.damage);
          }
        }
        break;
      }
      case 'biting': {
        this.biteTimer += deltaTime;
        if (this.biteTimer >= EelTower.BITE_TIME) {
          this.eelState = 'retracting';
        }
        break;
      }
      case 'retracting': {
        this.stretchProgress = Math.max(
          0,
          this.stretchProgress - deltaTime / EelTower.RETRACT_TIME,
        );
        if (this.stretchProgress <= 0) {
          this.eelState      = 'idle';
          this.cooldown      = 1 / this.fireRate;
          this.stretchTarget = null;
        }
        break;
      }
    }
  }

  private findNearest(enemies: Enemy[]): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.isActive) continue;
      const dist = this.position.distanceTo(enemy.pos);
      if (dist <= this.range && dist < nearestDist) {
        nearestDist = dist;
        nearest     = enemy;
      }
    }
    return nearest;
  }

  get headPos(): Vector2D {
    return this.position.add(
      this.stretchDir.scale(this.stretchProgress * this.stretchMaxDist),
    );
  }

  get currentEelState(): EelState { return this.eelState; }

  override draw(renderer: Renderer): void {
    const ctx   = renderer.context;
    const cx    = this.position.x;
    const cy    = this.position.y;
    const state = this.eelState;

    renderer.drawCircle(
      this.position, this.range, 'rgba(0,0,0,0)',
      state !== 'idle' ? 'rgba(39,174,96,0.25)' : 'rgba(39,174,96,0.08)', 1,
    );

    if (state === 'idle') {
      ctx.beginPath();
      ctx.moveTo(cx, cy + 10);
      ctx.bezierCurveTo(cx + 13, cy + 4,  cx - 13, cy,      cx,      cy - 5);
      ctx.bezierCurveTo(cx + 13, cy - 10, cx + 8,  cy - 18, cx,      cy - 18);
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth   = 6;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy - 18, 6, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle   = '#1e8449';
      ctx.fill();
      ctx.strokeStyle = '#145a32';
      ctx.lineWidth   = 1;
      ctx.stroke();
      return;
    }

    const head  = this.headPos;
    const perp  = new Vector2D(-this.stretchDir.y, this.stretchDir.x);
    const midX  = cx + (head.x - cx) * 0.5 + perp.x * 12 * this.stretchProgress;
    const midY  = cy + (head.y - cy) * 0.5 + perp.y * 12 * this.stretchProgress;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(midX, midY, head.x, head.y);
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth   = 6;
    ctx.lineCap     = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#1e8449';
    ctx.fill();

    const headAngle = Math.atan2(this.stretchDir.y, this.stretchDir.x);
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(headAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle   = state === 'biting' ? '#e74c3c' : '#1e8449';
    ctx.fill();
    ctx.strokeStyle = '#145a32';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, -4);
    ctx.lineTo(13, 0);
    ctx.lineTo(8, 4);
    ctx.closePath();
    ctx.fillStyle = state === 'biting' ? '#c0392b' : '#1a1a1a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-2, -3, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-1.5, -3, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.restore();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTower(col: number, row: number): Tower {
  return new OctopusTower(col, row);
}

export function towerCost(): number {
  return 1;
}
