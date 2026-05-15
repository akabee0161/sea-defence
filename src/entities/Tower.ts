import type { Renderer } from '../core/Renderer.ts';
import { TOWER_DEFS } from '../defs/towerDefs.ts';
import { GRID_OFFSET_Y, type MapGrid, TILE_SIZE } from '../level/MapGrid.ts';
import type { ObjectPool } from '../utils/ObjectPool.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import type { Bullet } from './Bullet.ts';
import type { Enemy } from './Enemy.ts';
import { GameObject } from './GameObject.ts';

export enum TowerKind {
  Octopus = 'octopus',
  Crab = 'crab',
  HermitCrab = 'hermit_crab',
  Eel = 'eel',
}

export class Tower extends GameObject {
  readonly range: number;
  readonly fireRate: number;
  readonly cost: number;
  readonly damage: number;
  readonly bulletSpeed: number;

  protected cooldown = 0;
  protected target: Enemy | null = null;

  constructor(col: number, row: number, kind: TowerKind) {
    super(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2 + GRID_OFFSET_Y,
    );
    const def = TOWER_DEFS[kind];
    if (!def)
      throw new Error(`Unknown tower kind: "${kind}". Add it to TOWER_DEFS.`);
    this.range = def.range;
    this.fireRate = def.fireRate;
    this.cost = def.cost;
    this.damage = def.damage;
    this.bulletSpeed = def.bulletSpeed;
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
      if (!enemy.isActive || enemy.isDying) continue;
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

  draw(_renderer: Renderer): void {
    /* overridden by subclass */
  }

  get canFire(): boolean {
    return this.cooldown <= 0;
  }
  get currentTarget(): Enemy | null {
    return this.target;
  }
}

// ── Octopus Tower ─────────────────────────────────────────────────────────────

interface InkDrop {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
}

// 各触手の制御点（cx, bcy からの相対オフセット: sx,sy, c1x,c1y, c2x,c2y, ex,ey）
type TentacleDef = [number, number, number, number, number, number, number, number];
const OCTOPUS_TENTACLES: TentacleDef[] = [
  [-11,  7, -19,  9, -21, 16, -17, 21],
  [ -9,  8, -14, 13, -14, 19, -11, 24],
  [ -5,  9,  -7, 16,  -6, 22,  -4, 26],
  [ -1, 10,  -2, 19,  -1, 25,   0, 27],
  [  1, 10,   2, 19,   2, 25,   1, 27],
  [  5,  9,   8, 16,   8, 22,   6, 26],
  [  9,  8,  15, 13,  16, 19,  13, 24],
  [ 11,  7,  20,  9,  22, 16,  18, 21],
];

export class OctopusTower extends Tower {
  private ink: InkDrop[] = [];

  constructor(col: number, row: number) {
    super(col, row, TowerKind.Octopus);
  }

  override update(
    deltaTime: number,
    enemies: Enemy[],
    bulletPool: ObjectPool<Bullet> | null,
  ): void {
    const prevCooldown = this.cooldown;
    super.update(deltaTime, enemies, bulletPool);

    if (this.cooldown > prevCooldown) {
      const cx = this.position.x;
      const cy = this.position.y;
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 20 + Math.random() * 35;
        const maxLife = 0.4 + Math.random() * 0.35;
        this.ink.push({
          x: cx + (Math.random() - 0.5) * 8,
          y: cy + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife, maxLife,
          size: 4 + Math.random() * 5,
        });
      }
    }

    const surviving: InkDrop[] = [];
    for (const p of this.ink) {
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.vx *= 0.88;
      p.vy *= 0.88;
      p.life -= deltaTime;
      if (p.life > 0) surviving.push(p);
    }
    this.ink = surviving;
  }

  override draw(renderer: Renderer): void {
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y;
    const active = this.currentTarget !== null;

    renderer.drawCircle(
      this.position,
      this.range,
      'rgba(0,0,0,0)',
      active ? 'rgba(200, 80, 60, 0.25)' : 'rgba(200, 80, 60, 0.08)',
      1,
    );

    const bcy = cy - 3;
    const bodyR = 13;

    // 墨煙（胴体・触手の背後に描画）
    ctx.save();
    for (const p of this.ink) {
      const ratio = p.life / p.maxLife;
      ctx.globalAlpha = ratio * 0.6;
      ctx.fillStyle = '#0a0a14';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * ratio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 触手（8本）— 三次ベジェ + 波打ちアニメーション
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < OCTOPUS_TENTACLES.length; i++) {
      const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = OCTOPUS_TENTACLES[i];
      const w = 0;

      const ax  = cx + sx,      ay  = bcy + sy;
      const b1x = cx + c1x + w, b1y = bcy + c1y;
      const b2x = cx + c2x + w, b2y = bcy + c2y;
      const aex = cx + ex,      aey = bcy + ey;

      ctx.strokeStyle = '#c05848';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(b1x, b1y, b2x, b2y, aex, aey);
      ctx.stroke();

      // 吸盤（3個）— 三次ベジェ上をサンプリング
      ctx.save();
      for (const ts of [0.3, 0.6, 0.85]) {
        const mt = 1 - ts;
        const bx = mt**3*ax + 3*mt**2*ts*b1x + 3*mt*ts**2*b2x + ts**3*aex;
        const by = mt**3*ay + 3*mt**2*ts*b1y + 3*mt*ts**2*b2y + ts**3*aey;
        ctx.beginPath();
        ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f7d4cc';
        ctx.fill();
        ctx.strokeStyle = '#c06858';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // 胴体（円 + 線形グラデーション）
    const grad = ctx.createLinearGradient(cx, bcy - bodyR, cx, bcy + bodyR);
    grad.addColorStop(0,   '#f9d0c5');
    grad.addColorStop(0.5, '#e07060');
    grad.addColorStop(1,   '#b84040');

    ctx.beginPath();
    ctx.arc(cx, bcy, bodyR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#9b3030';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 目（白い強膜 → 暗い瞳孔 → ハイライト）
    for (const [ox, oy] of [[-5, -1.5], [5, -1.5]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(cx + ox, bcy + oy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#c06060';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + ox + 0.5, bcy + oy + 0.3, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx + ox - 0.8, bcy + oy - 1.2, 1, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }
}

// ── Crab Tower ────────────────────────────────────────────────────────────────

export class CrabTower extends Tower {
  private readonly patrolCols: number[];
  private patrolIndex: number;
  private movingRight = true;
  private attackFlash = 0;

  private static readonly MOVE_SPEED = 60;
  private static readonly FLASH_TIME = 0.12;

  constructor(col: number, row: number, patrolCols: number[]) {
    super(col, row, TowerKind.Crab);
    this.patrolCols = patrolCols.length > 0 ? patrolCols : [col];
    this.patrolIndex = Math.max(0, this.patrolCols.indexOf(col));
  }

  override update(
    deltaTime: number,
    enemies: Enemy[],
    _pool: ObjectPool<Bullet> | null,
  ): void {
    if (this.patrolCols.length > 1) {
      const targetX =
        this.patrolCols[this.patrolIndex] * TILE_SIZE + TILE_SIZE / 2;
      const dx = targetX - this.position.x;
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
            this.patrolIndex = Math.min(
              this.patrolCols.length - 1,
              this.patrolIndex + 1,
            );
          }
        }
      } else {
        this.position = new Vector2D(
          this.position.x + (dx > 0 ? step : -step),
          this.position.y,
        );
      }
    }

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
        if (!enemy.isActive || enemy.isDying) continue;
        const dist = this.position.distanceTo(enemy.pos);
        if (dist <= this.range && dist < nearestDist) {
          nearestDist = dist;
          nearest = enemy;
        }
      }
      if (nearest !== null) {
        nearest.takeDamage(this.damage);
        nearest.stun(0.2);
        this.cooldown = 1 / this.fireRate;
        this.attackFlash = CrabTower.FLASH_TIME;
        this.target = nearest;
      }
    }
  }

  override draw(renderer: Renderer): void {
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y;
    const snapping = this.attackFlash > 0;

    renderer.drawCircle(
      this.position,
      this.range,
      'rgba(0,0,0,0)',
      snapping ? 'rgba(230,126,34,0.30)' : 'rgba(230,126,34,0.10)',
      1,
    );

    ctx.strokeStyle = '#a04000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
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

    const crabBodyGrad = ctx.createLinearGradient(cx, cy - 9, cx, cy + 9);
    crabBodyGrad.addColorStop(0, '#f0913a');
    crabBodyGrad.addColorStop(1, '#a04000');
    ctx.beginPath();
    ctx.ellipse(cx, cy, 13, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = crabBodyGrad;
    ctx.fill();
    ctx.strokeStyle = '#a04000';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const ox of [-5, 5] as const) {
      ctx.beginPath();
      ctx.strokeStyle = '#a04000';
      ctx.lineWidth = 1.5;
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

    const clawGap = snapping ? 3 : 9;
    for (const side of [-1, 1] as const) {
      const armX = cx + side * 20;
      const armY = cy - 1;

      ctx.strokeStyle = '#a04000';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(cx + side * 10, cy);
      ctx.lineTo(armX, armY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(armX, armY);
      ctx.lineTo(armX + side * 9, armY - clawGap);
      ctx.stroke();

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
  private hcState: HermitCrabState = 'hidden';
  private stateTimer = 0;
  private attackTimer = 0;

  private static readonly EMERGE_TIME = 0.4;
  private static readonly ATTACK_TIME = 0.8;
  private static readonly RETREAT_TIME = 0.6;

  constructor(col: number, row: number) {
    super(col, row, TowerKind.HermitCrab);
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
          this.hcState = 'emerging';
          this.stateTimer = 0;
        }
        break;
      }
      case 'emerging': {
        this.stateTimer += deltaTime;
        if (this.stateTimer >= HermitCrabTower.EMERGE_TIME) {
          this.hcState = 'attacking';
          this.attackTimer = 0;
          this.cooldown = 0;
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
          this.hcState = 'retreating';
          this.stateTimer = 0;
          this.target = null;
        }
        break;
      }
      case 'retreating': {
        this.stateTimer += deltaTime;
        if (this.stateTimer >= HermitCrabTower.RETREAT_TIME) {
          this.hcState = 'hidden';
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
      if (!enemy.isActive || enemy.isDying) continue;
      const dist = this.position.distanceTo(enemy.pos);
      if (dist <= this.range && dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }
    return nearest;
  }

  get emergeProgress(): number {
    switch (this.hcState) {
      case 'hidden':
        return 0;
      case 'emerging':
        return this.stateTimer / HermitCrabTower.EMERGE_TIME;
      case 'attacking':
        return 1;
      case 'retreating':
        return 1 - this.stateTimer / HermitCrabTower.RETREAT_TIME;
      default:
        return 0;
    }
  }

  get currentHcState(): HermitCrabState {
    return this.hcState;
  }

  override draw(renderer: Renderer): void {
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y;
    const prog = this.emergeProgress;

    renderer.drawCircle(
      this.position,
      this.range,
      'rgba(0,0,0,0)',
      prog > 0 ? 'rgba(142,107,34,0.25)' : 'rgba(142,107,34,0.08)',
      1,
    );

    ctx.save();
    ctx.globalAlpha *= 1 - prog * 0.6;

    // 三角形の巻貝（棘付き円錐螺旋貝）
    const tx = cx + 2;
    const tipY = cy - 18;
    const baseY = cy + 8;
    const shellH = baseY - tipY;

    // 影・暗い側面
    ctx.beginPath();
    ctx.moveTo(tx, tipY);
    ctx.lineTo(tx + 15, baseY + 2);
    ctx.lineTo(tx - 12, baseY + 2);
    ctx.closePath();
    ctx.fillStyle = '#4a1c05';
    ctx.fill();

    // メインボディ（円錐）
    ctx.beginPath();
    ctx.moveTo(tx, tipY);
    ctx.lineTo(tx + 12, baseY - 1);
    ctx.bezierCurveTo(tx + 12, baseY + 4, tx - 10, baseY + 4, tx - 10, baseY - 1);
    ctx.closePath();
    ctx.fillStyle = '#7a3210';
    ctx.fill();
    ctx.strokeStyle = '#3d1005';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 渦巻き輪郭（4段）と棘
    const whorlTs = [0.22, 0.44, 0.64, 0.82];
    for (let i = 0; i < whorlTs.length; i++) {
      const wy = tipY + shellH * whorlTs[i];
      const hw = 10 * whorlTs[i] + 1;

      // 輪帯（光沢ライン）
      ctx.beginPath();
      ctx.moveTo(tx - hw - 1, wy);
      ctx.quadraticCurveTo(tx, wy + 2, tx + hw + 1, wy);
      ctx.quadraticCurveTo(tx, wy + 4, tx - hw - 1, wy);
      ctx.fillStyle = '#7a3210';
      ctx.fill();
      ctx.strokeStyle = '#3d1005';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      // 左右の大きな棘
      if (i > 0) {
        const sLen = 4 + i * 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#3d1005';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(tx - hw, wy);
        ctx.lineTo(tx - hw - sLen * 0.6, wy - sLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tx + hw, wy);
        ctx.lineTo(tx + hw + sLen * 0.6, wy - sLen);
        ctx.stroke();
      }

      // 中間の小棘（上段ほど少なく）
      const smallSpines = i + 1;
      ctx.strokeStyle = '#5c1e08';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (let s = 0; s < smallSpines; s++) {
        const frac = (s + 0.5) / smallSpines;
        const sx = tx - hw + hw * 2 * frac;
        const outX = (sx - tx) * 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, wy - 0.5);
        ctx.lineTo(sx + outX, wy - 3 - i * 1.2);
        ctx.stroke();
      }
    }

    // 貝口（緑がかった真珠層）
    ctx.beginPath();
    ctx.ellipse(tx, baseY + 2, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3a6e4e';
    ctx.fill();
    ctx.strokeStyle = '#3d1005';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(tx, baseY + 2, 4.5, 2.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a5038';
    ctx.fill();

    // 先端ハイライト
    ctx.beginPath();
    ctx.arc(tx - 1, tipY + 3, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#c06030';
    ctx.fill();

    ctx.restore();

    if (prog > 0.05) {
      const emergeY = cy + 10;

      ctx.save();
      ctx.globalAlpha *= prog;

      ctx.strokeStyle = '#a04000';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
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

      const hcBodyGrad = ctx.createLinearGradient(cx, emergeY - 7, cx, emergeY + 7);
      hcBodyGrad.addColorStop(0, '#f0913a');
      hcBodyGrad.addColorStop(1, '#a04000');
      ctx.beginPath();
      ctx.ellipse(cx, emergeY, 10, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = hcBodyGrad;
      ctx.fill();
      ctx.strokeStyle = '#a04000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

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

      if (prog >= 0.8 && this.hcState === 'attacking') {
        const snapping = this.target !== null;
        const clawGap = snapping ? 3 : 8;
        for (const side of [-1, 1] as const) {
          const armX = cx + side * 16;
          ctx.strokeStyle = '#a04000';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
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

type EelState =
  | 'idle'
  | 'anticipating'
  | 'stretching'
  | 'biting'
  | 'retracting';

export class EelTower extends Tower {
  private eelState: EelState = 'idle';
  private stretchProgress = 0;
  private biteTimer = 0;
  private anticipateTimer = 0;
  private stretchTarget: Enemy | null = null;
  private stretchDir: Vector2D = Vector2D.zero();
  private stretchMaxDist = 0;

  private static readonly ANTICIPATE_TIME = 0.22;
  private static readonly STRIKE_TIME = 0.09;
  private static readonly BITE_TIME = 0.18;
  private static readonly RETRACT_TIME = 0.72;

  constructor(col: number, row: number) {
    super(col, row, TowerKind.Eel);
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
            this.stretchTarget = nearest;
            const toEnemy = nearest.pos.subtract(this.position);
            this.stretchMaxDist = Math.min(toEnemy.magnitude(), this.range);
            this.stretchDir = toEnemy.normalize();
            this.stretchProgress = 0;
            this.anticipateTimer = 0;
            this.eelState = 'anticipating';
          }
        }
        break;
      }
      case 'anticipating': {
        this.anticipateTimer += deltaTime;
        if (this.stretchTarget?.isActive) {
          const toEnemy = this.stretchTarget.pos.subtract(this.position);
          this.stretchMaxDist = Math.min(toEnemy.magnitude(), this.range);
          this.stretchDir = toEnemy.normalize();
        }
        if (this.anticipateTimer >= EelTower.ANTICIPATE_TIME) {
          this.stretchProgress = 0;
          this.eelState = 'stretching';
        }
        break;
      }
      case 'stretching': {
        this.stretchProgress = Math.min(
          1,
          this.stretchProgress + deltaTime / EelTower.STRIKE_TIME,
        );
        if (this.stretchProgress >= 1) {
          this.eelState = 'biting';
          this.biteTimer = 0;
          if (this.stretchTarget?.isActive) {
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
          this.eelState = 'idle';
          this.cooldown = 1 / this.fireRate;
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
      if (!enemy.isActive || enemy.isDying) continue;
      const dist = this.position.distanceTo(enemy.pos);
      if (dist <= this.range && dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }
    return nearest;
  }

  get headPos(): Vector2D {
    return this.position.add(
      this.stretchDir.scale(this.stretchProgress * this.stretchMaxDist),
    );
  }

  get currentEelState(): EelState {
    return this.eelState;
  }

  override draw(renderer: Renderer): void {
    const ctx = renderer.context;
    const cx = this.position.x;
    const cy = this.position.y;
    const state = this.eelState;

    renderer.drawCircle(
      this.position,
      this.range,
      'rgba(0,0,0,0)',
      state !== 'idle' ? 'rgba(39,174,96,0.25)' : 'rgba(39,174,96,0.08)',
      1,
    );

    if (state === 'idle') {
      ctx.save();
      // Body: thick dark-brown S-curve (same width as head)
      ctx.beginPath();
      ctx.moveTo(cx, cy + 10);
      ctx.bezierCurveTo(cx + 13, cy + 4, cx - 13, cy, cx, cy - 5);
      ctx.bezierCurveTo(cx + 13, cy - 10, cx + 8, cy - 18, cx, cy - 18);
      ctx.strokeStyle = '#8a6a08';
      ctx.lineWidth = 13;
      ctx.lineCap = 'round';
      ctx.stroke();
      // Dark-brown spots along S-curve body
      ctx.fillStyle = '#3a2008';
      for (const [sx, sy, sr] of [
        [cx, cy + 2, 3.5],
        [cx + 2, cy - 6, 3],
        [cx + 5, cy - 13, 3],
      ] as [number, number, number][]) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
      // moray head: body joins at right (x+), mouth/fangs at left (x-)
      ctx.save();
      ctx.translate(cx, cy - 18);
      // upper jaw (main head body, left = snout, right = body junction)
      ctx.beginPath();
      ctx.moveTo(5, -2); // body junction upper
      ctx.lineTo(3, -7); // upper right
      ctx.lineTo(-3, -8); // top
      ctx.lineTo(-11, -4); // upper snout
      ctx.lineTo(-15, 0); // snout tip
      ctx.lineTo(-11, 3); // lower snout
      ctx.lineTo(-3, 4); // chin
      ctx.lineTo(5, 2); // body junction lower
      ctx.closePath();
      ctx.fillStyle = '#8a6a08';
      ctx.fill();
      ctx.strokeStyle = '#1a0800';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Dark spots on head
      ctx.fillStyle = '#3a2008';
      ctx.beginPath();
      ctx.arc(-1, -5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-7, -1, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // lower jaw
      ctx.beginPath();
      ctx.moveTo(-3, 4);
      ctx.lineTo(-11, 6);
      ctx.lineTo(-15, 1);
      ctx.lineTo(-15, 0); // snout tip
      ctx.lineTo(-11, 3);
      ctx.lineTo(-3, 4);
      ctx.fillStyle = '#a07c0a';
      ctx.fill();
      ctx.strokeStyle = '#1a0800';
      ctx.lineWidth = 1;
      ctx.stroke();
      // upper fangs (pointing down into mouth, on left/mouth side)
      ctx.fillStyle = '#f2f0d8';
      ctx.beginPath();
      ctx.moveTo(-5, 3);
      ctx.lineTo(-3.5, -1);
      ctx.lineTo(-2, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-9, 2);
      ctx.lineTo(-7.5, -2);
      ctx.lineTo(-6, 2);
      ctx.fill();
      // eye (upper right – near body junction side)
      ctx.beginPath();
      ctx.arc(2, -4, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#d4a800';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(2.4, -4, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0.8, -5.2, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
      ctx.restore();
      ctx.restore();
      return;
    }

    // anticipating: visually creep forward just a little in attack direction
    const visualProgress =
      state === 'anticipating'
        ? (this.anticipateTimer / EelTower.ANTICIPATE_TIME) * 0.14
        : this.stretchProgress;

    const head = this.position.add(
      this.stretchDir.scale(visualProgress * this.stretchMaxDist),
    );
    const perp = new Vector2D(-this.stretchDir.y, this.stretchDir.x);
    const midX = cx + (head.x - cx) * 0.5 + perp.x * 12 * visualProgress;
    const midY = cy + (head.y - cy) * 0.5 + perp.y * 12 * visualProgress;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(midX, midY, head.x, head.y);
    ctx.strokeStyle = state === 'anticipating' ? '#a07c0a' : '#8a6a08';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Dark spots along stretched body (quadratic bezier at t=0.3, 0.6)
    ctx.fillStyle = '#3a2008';
    for (const t of [0.3, 0.6]) {
      const bx =
        (1 - t) * (1 - t) * cx + 2 * t * (1 - t) * midX + t * t * head.x;
      const by =
        (1 - t) * (1 - t) * cy + 2 * t * (1 - t) * midY + t * t * head.y;
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#8a6a08';
    ctx.fill();

    // jaw opens during biting (sin curve: 0→max→0)
    const jawOpenY =
      state === 'biting'
        ? Math.sin((this.biteTimer / EelTower.BITE_TIME) * Math.PI) * 11
        : 0;

    const headAngle = Math.atan2(this.stretchDir.y, this.stretchDir.x);
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(headAngle);

    // mouth cavity (drawn behind jaws so it shows through the gap)
    if (jawOpenY > 0.5) {
      ctx.beginPath();
      ctx.moveTo(-2, 2);
      ctx.lineTo(20, 0);
      ctx.lineTo(14, 3 + jawOpenY * 0.6);
      ctx.lineTo(-2, 2 + jawOpenY * 0.25);
      ctx.fillStyle = '#1a0500';
      ctx.fill();
    }

    // upper jaw
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-10, -8);
    ctx.lineTo(2, -10);
    ctx.lineTo(14, -6);
    ctx.lineTo(22, 0);
    ctx.lineTo(14, 4);
    ctx.lineTo(2, 5);
    ctx.lineTo(-10, 3);
    ctx.closePath();
    ctx.fillStyle = '#8a6a08';
    ctx.fill();
    ctx.strokeStyle = '#1a0800';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Dark spots on upper jaw
    ctx.fillStyle = '#3a2008';
    ctx.beginPath();
    ctx.arc(4, -5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(12, -3, 2, 0, Math.PI * 2);
    ctx.fill();

    // lower jaw (drops by jawOpenY)
    ctx.beginPath();
    ctx.moveTo(-10, 3);
    ctx.lineTo(-8, 4 + jawOpenY * 0.3);
    ctx.lineTo(2, 6 + jawOpenY * 0.85);
    ctx.lineTo(14, 4 + jawOpenY * 0.65);
    ctx.lineTo(22, 0 + jawOpenY * 0.15);
    ctx.lineTo(14, 4);
    ctx.lineTo(2, 5);
    ctx.lineTo(-10, 3);
    ctx.fillStyle = '#a07c0a';
    ctx.fill();
    ctx.strokeStyle = '#1a0800';
    ctx.lineWidth = 1;
    ctx.stroke();

    // upper fangs (3, pointing downward into mouth)
    ctx.fillStyle = '#f2f0d8';
    const upperFangs: [number, number][] = [
      [14, -5],
      [9, -6],
      [4, -5],
    ];
    for (const [fx, fy] of upperFangs) {
      ctx.beginPath();
      ctx.moveTo(fx - 2.5, fy + 6);
      ctx.lineTo(fx, fy);
      ctx.lineTo(fx + 2.5, fy + 6);
      ctx.fill();
    }

    // lower fangs (fade in when mouth opens)
    if (jawOpenY > 1) {
      ctx.globalAlpha = Math.min(1, (jawOpenY - 1) / 4);
      const lowerFangs: [number, number][] = [
        [13, 4 + jawOpenY * 0.55],
        [8, 5 + jawOpenY * 0.65],
      ];
      for (const [fx, fy] of lowerFangs) {
        ctx.beginPath();
        ctx.moveTo(fx - 2, fy - 2);
        ctx.lineTo(fx, fy + 4);
        ctx.lineTo(fx + 2, fy - 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // eye (golden iris)
    ctx.beginPath();
    ctx.arc(-4, -5, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#d4a800';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-3.5, -5, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-5.5, -6.5, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();

    ctx.restore();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTower(
  kind: TowerKind,
  col: number,
  row: number,
  mapGrid?: MapGrid,
): Tower {
  switch (kind) {
    case TowerKind.Octopus:
      return new OctopusTower(col, row);

    case TowerKind.Crab: {
      const patrolCols: number[] = [];
      if (mapGrid) {
        let left = col;
        let right = col;
        while (left > 0 && mapGrid.isPathTile(left - 1, row)) left--;
        while (right < mapGrid.cols - 1 && mapGrid.isPathTile(right + 1, row))
          right++;
        for (let c = left; c <= right; c++) {
          if (mapGrid.isPathTile(c, row)) patrolCols.push(c);
        }
      }
      if (patrolCols.length === 0) patrolCols.push(col);
      return new CrabTower(col, row, patrolCols);
    }

    case TowerKind.HermitCrab:
      return new HermitCrabTower(col, row);

    case TowerKind.Eel:
      return new EelTower(col, row);
  }
}
