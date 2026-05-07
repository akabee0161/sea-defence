# 新タワー追加 (Crab / HermitCrab / Eel) 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CrabTower・HermitCrabTower・EelTower の3種類の新タワーを追加し、既存 SpotKind システムを5種に拡張する。

**Architecture:** `SpotKind` を `'tower'|'coral'` から5値に拡張し、Tower 基底クラスのアクセス制御を `protected` に変更して直接ダメージ方式の新タワーをサポートする。新タワークラスはすべて Tower を継承し、各自の `update()` と `draw()` をオーバーライドする。

**Tech Stack:** TypeScript strict + HTML5 Canvas API / Vite 5 / npm run build (= tsc && vite build)

---

## ファイル構成

| ファイル | 変更内容 |
|---------|---------|
| `src/level/MapGrid.ts` | `SpotKind` 型を5値に更新、`PLACEMENT_SPOTS` を再割当 |
| `src/entities/Tower.ts` | `TowerKind` enum 追加、Tower基底 protected 化、`BasicTower`→`OctopusTower` リネーム、`CrabTower` / `HermitCrabTower` / `EelTower` 追加、`createTower` ファクトリ更新 |
| `src/core/Game.ts` | `placeAtSpot` / `drawSpots` / `drawProximityPreview` / `drawHoldPreview` を5種対応に更新 |

---

## Task 1: MapGrid.ts — SpotKind と PLACEMENT_SPOTS の更新

**Files:**
- Modify: `src/level/MapGrid.ts`

- [ ] **Step 1: SpotKind 型を5値に変更**

[src/level/MapGrid.ts](src/level/MapGrid.ts) 6行目を以下に置換:

```typescript
export type SpotKind = 'octopus' | 'crab' | 'hermit_crab' | 'eel' | 'coral';
```

- [ ] **Step 2: PLACEMENT_SPOTS 配列を更新**

[src/level/MapGrid.ts](src/level/MapGrid.ts) の `PLACEMENT_SPOTS` 定数全体を以下に置換:

```typescript
const PLACEMENT_SPOTS: PlacementSpot[] = [
  // ── BUILDABLE スポット: Octopus と Eel を交互配置 ────────────────────────────
  { col: 2, row:  2, kind: 'octopus' },
  { col: 4, row:  2, kind: 'eel' },
  { col: 6, row:  1, kind: 'octopus' },
  { col: 6, row:  3, kind: 'eel' },
  { col: 0, row:  6, kind: 'octopus' },
  { col: 2, row:  6, kind: 'eel' },
  { col: 7, row:  6, kind: 'octopus' },
  { col: 1, row: 10, kind: 'eel' },
  { col: 4, row: 10, kind: 'octopus' },
  { col: 6, row: 10, kind: 'eel' },
  // ── PATH スポット (row 2): Coral と HermitCrab ───────────────────────────────
  { col: 0, row:  2, kind: 'coral' },
  { col: 7, row:  2, kind: 'coral' },
  { col: 1, row:  2, kind: 'hermit_crab' },
  { col: 3, row:  2, kind: 'hermit_crab' },
  { col: 5, row:  2, kind: 'hermit_crab' },
  // ── PATH スポット (row 4): Crab ───────────────────────────────────────────────
  // row 4 は全列が PATH タイル → CrabTower が 0-7 の全幅 400px を巡回できる
  { col: 2, row:  4, kind: 'crab' },
  { col: 5, row:  4, kind: 'crab' },
];
```

- [ ] **Step 3: ビルドで型エラーがないか確認**

```bash
npm run build 2>&1 | tail -20
```

期待: `src/core/Game.ts` で `kind === 'tower'` の比較が型エラーになる（次 Task で修正）。  
エラーがなければ次へ（TypeScript が narrowing を許容している場合あり）。

- [ ] **Step 4: コミット**

```bash
git add src/level/MapGrid.ts
git commit -m "feat: expand SpotKind to 5 values and add crab spots at row 4"
```

---

## Task 2: Tower.ts — 基底クラスのリファクタリング

**Files:**
- Modify: `src/entities/Tower.ts`

- [ ] **Step 1: TowerKind enum と MapGrid import を追加**

[src/entities/Tower.ts](src/entities/Tower.ts) の先頭 import 部分を以下に更新:

```typescript
import { GameObject } from './GameObject.ts';
import { Enemy } from './Enemy.ts';
import { Bullet } from './Bullet.ts';
import { ObjectPool } from '../utils/ObjectPool.ts';
import { Renderer } from '../core/Renderer.ts';
import { MapGrid, TILE_SIZE, GRID_OFFSET_Y } from '../level/MapGrid.ts';
import { Vector2D } from '../utils/Vector2D.ts';

export enum TowerKind {
  Octopus    = 'octopus',
  Crab       = 'crab',
  HermitCrab = 'hermit_crab',
  Eel        = 'eel',
}
```

- [ ] **Step 2: Tower 基底クラスの `private` → `protected` に変更**

Tower クラス内の `private cooldown` と `private target` を `protected` に変更:

```typescript
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
```

- [ ] **Step 3: BasicTower を OctopusTower にリネーム**

`BasicTower` クラス宣言と export を `OctopusTower` に変更:

```typescript
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
    const bodyY = cy - 3;

    // Tentacles
    ctx.strokeStyle = '#6c3483';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';

    const tCount = 6;
    for (let i = 0; i < tCount; i++) {
      const t      = i / (tCount - 1);
      const sx     = cx + (t - 0.5) * bodyR * 1.7;
      const sy     = bodyY + bodyR * 0.75;
      const spread = (t - 0.5) * 10;
      const ex     = sx + spread;
      const ey     = sy + 13;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + spread * 0.5, sy + 7, ex, ey);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#6c3483';
      ctx.fill();
    }

    // Body
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

    // Eyes
    for (const [ox, oy] of [[-4, -2], [4, -2]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(cx + ox, bodyY + oy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + ox + 0.8, bodyY + oy + 0.5, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
    }
  }
}
```

- [ ] **Step 4: ビルド確認**

```bash
npm run build 2>&1 | tail -20
```

期待: `createTower` の呼び出し箇所で型エラーが出る（Task 6 で修正）。  
`BasicTower` 参照が残っていればエラー → Task 6 で解消。

- [ ] **Step 5: コミット**

```bash
git add src/entities/Tower.ts
git commit -m "refactor: rename BasicTower to OctopusTower, make cooldown/target protected"
```

---

## Task 3: Tower.ts — CrabTower の追加

**Files:**
- Modify: `src/entities/Tower.ts`

CrabTower は OctopusTower クラスの直後に追記する。

- [ ] **Step 1: CrabTower クラスを追加**

```typescript
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
```

- [ ] **Step 2: ビルド確認**

```bash
npm run build 2>&1 | grep -E 'error|warning|built' | tail -10
```

期待: CrabTower 自体のエラーなし。`createTower` 呼び出しエラーはまだ残存。

- [ ] **Step 3: コミット**

```bash
git add src/entities/Tower.ts
git commit -m "feat: add CrabTower with horizontal patrol and direct claw attack"
```

---

## Task 4: Tower.ts — HermitCrabTower の追加

**Files:**
- Modify: `src/entities/Tower.ts`

CrabTower クラスの直後に追記する。

- [ ] **Step 1: HermitCrabTower クラスを追加**

```typescript
// ── Hermit Crab Tower ─────────────────────────────────────────────────────────

type HermitCrabState = 'hidden' | 'emerging' | 'attacking' | 'retreating';

export class HermitCrabTower extends Tower {
  private hcState:   HermitCrabState = 'hidden';
  private stateTimer = 0;
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
          this.hcState    = 'attacking';
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
      case 'hidden':    return 0;
      case 'emerging':  return this.stateTimer / HermitCrabTower.EMERGE_TIME;
      case 'attacking': return 1;
      case 'retreating':
        return 1 - this.stateTimer / HermitCrabTower.RETREAT_TIME;
    }
  }

  get currentHcState(): HermitCrabState { return this.hcState; }

  override draw(renderer: Renderer): void {
    const ctx     = renderer.context;
    const cx      = this.position.x;
    const cy      = this.position.y;
    const prog    = this.emergeProgress;

    // Range aura
    renderer.drawCircle(
      this.position, this.range, 'rgba(0,0,0,0)',
      prog > 0 ? 'rgba(142,107,34,0.25)' : 'rgba(142,107,34,0.08)', 1,
    );

    // ── Shell (hidden → fades slightly as crab emerges) ───────────────────────
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
        const snapping  = this.target !== null;
        const clawGap   = snapping ? 3 : 8;
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
```

- [ ] **Step 2: ビルド確認**

```bash
npm run build 2>&1 | grep -E 'error|built' | tail -10
```

- [ ] **Step 3: コミット**

```bash
git add src/entities/Tower.ts
git commit -m "feat: add HermitCrabTower with emerge/attack/retreat state machine"
```

---

## Task 5: Tower.ts — EelTower の追加

**Files:**
- Modify: `src/entities/Tower.ts`

HermitCrabTower クラスの直後に追記する。

- [ ] **Step 1: EelTower クラスを追加**

```typescript
// ── Eel Tower ─────────────────────────────────────────────────────────────────

type EelState = 'idle' | 'stretching' | 'biting' | 'retracting';

export class EelTower extends Tower {
  private eelState:       EelState = 'idle';
  private stretchProgress = 0;
  private biteTimer       = 0;
  private stretchTarget:  Enemy | null  = null;
  private stretchDir:     Vector2D      = Vector2D.zero();
  private stretchMaxDist  = 0;

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
            this.stretchTarget  = nearest;
            const toEnemy       = nearest.pos.subtract(this.position);
            this.stretchMaxDist = Math.min(toEnemy.magnitude(), this.range);
            this.stretchDir     = toEnemy.normalize();
            this.stretchProgress = 0;
            this.eelState       = 'stretching';
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
          this.eelState = 'biting';
          this.biteTimer = 0;
          // 完全伸展時にダメージ付与
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
          this.cooldown      = 1 / this.fireRate; // cooldown 開始
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

    // Range aura
    renderer.drawCircle(
      this.position, this.range, 'rgba(0,0,0,0)',
      state !== 'idle' ? 'rgba(39,174,96,0.25)' : 'rgba(39,174,96,0.08)', 1,
    );

    if (state === 'idle') {
      // Coiled S-curve body
      ctx.beginPath();
      ctx.moveTo(cx, cy + 10);
      ctx.bezierCurveTo(cx + 13, cy + 4,  cx - 13, cy,      cx,      cy - 5);
      ctx.bezierCurveTo(cx + 13, cy - 10, cx + 8,  cy - 18, cx,      cy - 18);
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth   = 6;
      ctx.lineCap     = 'round';
      ctx.stroke();
      // Head (coiled position)
      ctx.beginPath();
      ctx.ellipse(cx, cy - 18, 6, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle   = '#1e8449';
      ctx.fill();
      ctx.strokeStyle = '#145a32';
      ctx.lineWidth   = 1;
      ctx.stroke();
      return;
    }

    // Stretching / biting / retracting
    const head = this.headPos;

    // Body (bezier from base to head with slight curve)
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

    // Base coil remnant
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#1e8449';
    ctx.fill();

    // Head at tip
    const headAngle = Math.atan2(this.stretchDir.y, this.stretchDir.x);
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(headAngle);
    // Head body
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle   = state === 'biting' ? '#e74c3c' : '#1e8449';
    ctx.fill();
    ctx.strokeStyle = '#145a32';
    ctx.lineWidth   = 1;
    ctx.stroke();
    // Open mouth
    ctx.beginPath();
    ctx.moveTo(8, -4);
    ctx.lineTo(13, 0);
    ctx.lineTo(8, 4);
    ctx.closePath();
    ctx.fillStyle = state === 'biting' ? '#c0392b' : '#1a1a1a';
    ctx.fill();
    // Eye
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
```

- [ ] **Step 2: ビルド確認**

```bash
npm run build 2>&1 | grep -E 'error|built' | tail -10
```

- [ ] **Step 3: コミット**

```bash
git add src/entities/Tower.ts
git commit -m "feat: add EelTower with stretch-bite-retract animation and direct damage"
```

---

## Task 6: Tower.ts — createTower ファクトリの更新

**Files:**
- Modify: `src/entities/Tower.ts`

ファイル末尾の `createTower` / `towerCost` 関数を置換する。

- [ ] **Step 1: createTower を更新**

```typescript
// ── Factory ───────────────────────────────────────────────────────────────────

export function createTower(
  kind:     TowerKind,
  col:      number,
  row:      number,
  mapGrid?: MapGrid,
): Tower {
  switch (kind) {
    case TowerKind.Octopus:
      return new OctopusTower(col, row);

    case TowerKind.Crab: {
      // 配置 col から左右に連続する PATH タイルを収集
      const patrolCols: number[] = [];
      if (mapGrid) {
        let left  = col;
        let right = col;
        while (left  > 0                && mapGrid.isPathTile(left  - 1, row)) left--;
        while (right < mapGrid.cols - 1 && mapGrid.isPathTile(right + 1, row)) right++;
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

export function towerCost(): number {
  return 1;
}
```

- [ ] **Step 2: ビルド確認**

```bash
npm run build 2>&1 | grep -E 'error|built' | tail -20
```

期待: Game.ts 側の `createTower` 呼び出しで型エラーが出る（引数変更のため）。次 Task で修正。

- [ ] **Step 3: コミット**

```bash
git add src/entities/Tower.ts
git commit -m "feat: update createTower factory to accept TowerKind and optional MapGrid"
```

---

## Task 7: Game.ts — 5種対応への更新

**Files:**
- Modify: `src/core/Game.ts`

- [ ] **Step 1: import を更新**

[src/core/Game.ts](src/core/Game.ts) の Tower import 行を以下に変更:

```typescript
import { Tower, createTower, TowerKind } from '../entities/Tower.ts';
```

- [ ] **Step 2: placeAtSpot を更新**

`placeAtSpot` メソッド内の if/else を switch に置換:

```typescript
private placeAtSpot(spot: PlacementSpot): void {
  const key = `${spot.col},${spot.row}`;
  if (this.occupiedSpots.has(key)) return;
  if (this.crackedEggs < 1) return;

  this.crackedEggs -= 1;

  switch (spot.kind) {
    case 'octopus':
      this.towers.push(createTower(TowerKind.Octopus, spot.col, spot.row));
      break;
    case 'crab':
      this.towers.push(createTower(TowerKind.Crab, spot.col, spot.row, this.mapGrid));
      break;
    case 'hermit_crab':
      this.towers.push(createTower(TowerKind.HermitCrab, spot.col, spot.row));
      break;
    case 'eel':
      this.towers.push(createTower(TowerKind.Eel, spot.col, spot.row));
      break;
    case 'coral':
      this.corals.push(new CoralWall(spot.col, spot.row));
      break;
  }

  this.occupiedSpots.add(key);
}
```

- [ ] **Step 3: drawSpots を更新**

`drawSpots` 内のカラー判定を更新:

```typescript
private drawSpots(): void {
  const r = this.renderer;
  for (const spot of this.mapGrid.allSpots) {
    if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
    if (this.previewSpot && spot.col === this.previewSpot.col && spot.row === this.previewSpot.row) continue;
    const center = this.mapGrid.spotCenter(spot.col, spot.row);
    // BUILDABLE 系 → 白、PATH 系 → オレンジ
    const color = (spot.kind === 'octopus' || spot.kind === 'eel')
      ? 'rgba(255, 255, 255, 0.80)'
      : 'rgba(255, 140, 100, 0.90)';
    r.drawCircle(center, 5, color);
  }
}
```

- [ ] **Step 4: previewEntity ヘルパーと drawProximityPreview を更新**

`drawProximityPreview` メソッドを以下に置換（ヘルパー関数 `previewEntityDraw` も同メソッド内で処理）:

```typescript
private drawProximityPreview(): void {
  if (!this.previewSpot) return;
  const ctx = this.renderer.context;
  ctx.save();
  ctx.globalAlpha = PREVIEW_ALPHA;
  this.drawSpotEntity(this.previewSpot);
  ctx.restore();
}

/** スポット種別に応じたエンティティを描画（プレビュー・ホールド共用） */
private drawSpotEntity(spot: PlacementSpot): void {
  switch (spot.kind) {
    case 'octopus':
      createTower(TowerKind.Octopus, spot.col, spot.row).draw(this.renderer);
      break;
    case 'crab':
      // プレビュー時は mapGrid なし → patrolCols=[col] で静止描画
      createTower(TowerKind.Crab, spot.col, spot.row).draw(this.renderer);
      break;
    case 'hermit_crab':
      createTower(TowerKind.HermitCrab, spot.col, spot.row).draw(this.renderer);
      break;
    case 'eel':
      createTower(TowerKind.Eel, spot.col, spot.row).draw(this.renderer);
      break;
    case 'coral':
      new CoralWall(spot.col, spot.row).draw(this.renderer);
      break;
  }
}
```

- [ ] **Step 5: drawHoldPreview の描画部分を更新**

`drawHoldPreview` 内の以下の部分を見つける:

```typescript
  if (this.holdSpot.kind === 'tower') {
    createTower(this.holdSpot.col, this.holdSpot.row).draw(this.renderer);
  } else {
    new CoralWall(this.holdSpot.col, this.holdSpot.row).draw(this.renderer);
  }
```

以下に置換:

```typescript
  this.drawSpotEntity(this.holdSpot);
```

- [ ] **Step 6: ビルド成功を確認**

```bash
npm run build 2>&1
```

期待出力例:
```
✓ 18 modules transformed.
out/index.html  ...
✓ built in XXXms
```

エラーがあれば修正してから次へ。

- [ ] **Step 7: コミット**

```bash
git add src/core/Game.ts
git commit -m "feat: update Game to handle 5 SpotKind values for placement and preview"
```

---

## Task 8: 動作確認（煙テスト）

**Files:** なし（確認のみ）

- [ ] **Step 1: 開発サーバー起動**

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

- [ ] **Step 2: 各タワーを配置して動作確認**

確認項目:
1. マーリン（プレーヤー）をスポットに近づけると、各種プレビュードット（白 = octopus/eel、オレンジ = crab/hermit_crab/coral）が表示される
2. 2秒長押しで各タワーを配置できる（ひびわれ卵が1消費）
3. **OctopusTower**: 紫のタコが表示され、弾丸でサメを攻撃する
4. **CrabTower** (row 4 のスポット): 橙色のカニが row 4 を左右に往復移動し、サメが近づくとハサミをスナップして攻撃する
5. **HermitCrabTower** (row 2 の hermit_crab スポット): 貝殻だけが表示され、サメが近づくと貝殻から出てきてハサミで攻撃し、また戻る
6. **EelTower** (eel スポット): 暗緑色のウツボがBUILDABLEタイルに静止し、サメが射程内に入ると体を伸ばして噛みついて攻撃する
7. **CoralWall**: 赤い珊瑚が表示され、近くのサメが減速する

- [ ] **Step 3: Wave を開始して攻撃を確認**

「▶」ボタンで Wave 1 を開始し、全タワーが機能していることを確認する。

- [ ] **Step 4: ビルドが通ることを最終確認**

```bash
npm run build 2>&1 | tail -5
```

期待: `✓ built in XXXms` で完了。

---

## 完了条件チェックリスト

- [ ] OctopusTower (既存) が正常動作
- [ ] CrabTower が row 4 を横移動しサメを直接攻撃
- [ ] HermitCrabTower が貝殻から出てサメを攻撃し引っ込む
- [ ] EelTower が体を伸ばしてサメを攻撃
- [ ] CoralWall が引き続き機能
- [ ] `npm run build` が成功
- [ ] ひびわれ卵が設置時に1消費される

---

## 設計ドキュメント

詳細は [docs/superpowers/specs/2026-05-07-new-towers-design.md](../specs/2026-05-07-new-towers-design.md) を参照。
