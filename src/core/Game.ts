import { ENEMY_DEFS } from '../defs/enemyDefs.ts';
import type { PlacementSpot } from '../defs/mapDefs.ts';
import { Bullet } from '../entities/Bullet.ts';
import { CoralWall } from '../entities/CoralWall.ts';
import { EATING_INTERVAL, Enemy, type EnemyKind } from '../entities/Enemy.ts';
import { Particle } from '../entities/Particle.ts';
import { Player } from '../entities/Player.ts';
import { createTower, type Tower, TowerKind } from '../entities/Tower.ts';
import {
  GOAL_COLS,
  GOAL_ROW,
  INITIAL_GOAL_IDX,
  MapGrid,
  TILE_SIZE,
} from '../level/MapGrid.ts';
import { ObjectPool } from '../utils/ObjectPool.ts';
import { findPath } from '../utils/Pathfinding.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import { HOLD_DURATION, InputHandler } from './InputHandler.ts';
import { Renderer } from './Renderer.ts';
import { ScoreManager } from './ScoreManager.ts';
import { WaveManager } from './WaveManager.ts';

const FIXED_TIMESTEP = 1000 / 60;
const MAX_ACCUMULATED = FIXED_TIMESTEP * 5;

const EGGS_PER_GOAL = 3;
const INITIAL_CRACKED_EGGS = 3;

const DAMAGE_FLASH_DURATION = 0.4;
const ATTACK_COOLDOWN = 2.0;
const ATTACK_DAMAGE = 50;
const ATTACK_SPEED = 600;
const ATTACK_HIT_DIST = 8;
const CORAL_BLOCK_RADIUS = 28;
const CORAL_DAMAGE_PER_SECOND = 30;
const PLAYER_PREVIEW_RADIUS = 75;
const PREVIEW_ALPHA = 0.4;

const PARTICLES_HIT = 5;
const PARTICLES_KILL = 8;

const COLOR_HIT = '#6c3483';
const COLOR_KILL = '#4a235a';

export class Game {
  private readonly renderer: Renderer;
  private readonly mapGrid: MapGrid;
  private readonly waveManager: WaveManager;
  private readonly scoreManager: ScoreManager;
  private readonly inputHandler: InputHandler;

  private enemies: Enemy[] = [];
  private towers: Tower[] = [];
  private corals: CoralWall[] = [];
  private readonly occupiedSpots = new Set<string>();
  private readonly bulletPool: ObjectPool<Bullet>;
  private readonly particlePool: ObjectPool<Particle>;

  private readonly player: Player;
  private readonly playerHome: Vector2D;

  private attackTarget: Enemy | null = null;
  private attackCooldown = 0;
  private isPlayerAttacking = false;

  private goalEggs = [EGGS_PER_GOAL, 0, 0, 0, 0] as number[];
  private crackedEggs = INITIAL_CRACKED_EGGS;
  private activeGoalIndices = new Set<number>([INITIAL_GOAL_IDX]);

  private get playerHp(): number {
    let total = 0;
    for (const gi of this.activeGoalIndices) total += this.goalEggs[gi];
    return total;
  }

  private eggPlacingPhase = false;
  private waveClearPhase = false;
  private gameOver = false;

  private _isPaused = false;

  private previewSpot: PlacementSpot | null = null;
  private previewSpawn: number | null = null;

  private damageFlashTimer = 0;

  private lastWaveScoreDetails: ReturnType<
    ScoreManager['finalizeWave']
  > | null = null;

  private lastTimestamp = 0;
  private accumulated = 0;
  private rafId = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.mapGrid = new MapGrid();
    this.bulletPool = new ObjectPool<Bullet>(() => new Bullet());
    this.particlePool = new ObjectPool<Particle>(() => new Particle());
    this.scoreManager = new ScoreManager();

    this.waveManager = new WaveManager(
      (kind: EnemyKind, spawnIdx: number) => {
        this.spawnEnemy(kind, spawnIdx);
      },
      (waveNumber: number) => {
        this.onWaveClear(waveNumber);
      },
    );

    this.playerHome = new Vector2D(canvas.width / 2, canvas.height - 80);
    this.player = new Player(this.playerHome.x, this.playerHome.y);

    this.inputHandler = new InputHandler(canvas, this.renderer, this.mapGrid, {
      getPreviewSpot: () => this.previewSpot,
      getCrackedEggs: () => this.crackedEggs,
      isEggPlacing: () => this.eggPlacingPhase,
      isInterWave: () => this.waveManager.isInterWave,
      isPlayerAttacking: () => this.isPlayerAttacking,
      hasAttackCooldown: () => this.attackCooldown > 0,

      onEggPlaced: (col, row) => {
        this.handleEggPlaced(col, row);
      },
      onBuildComplete: (spot) => {
        this.placeAtSpot(spot);
      },
      onPlayerMove: (x, y) => {
        this.player.setTarget(x, y);
      },
      onAttack: () => {
        const target = this.findNearestEnemy();
        if (target) this.startAttack(target);
      },
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.inputHandler.destroy();
  }

  togglePause(): void {
    this._isPaused = !this._isPaused;
  }

  restart(): void {
    this.goalEggs = [EGGS_PER_GOAL, 0, 0, 0, 0];
    this.crackedEggs = INITIAL_CRACKED_EGGS;
    this.activeGoalIndices = new Set([INITIAL_GOAL_IDX]);
    this.mapGrid.reset();
    this.eggPlacingPhase = false;
    this.waveClearPhase = false;
    this.gameOver = false;
    this._isPaused = false;
    this.accumulated = 0;
    this.damageFlashTimer = 0;
    this.previewSpot = null;
    this.previewSpawn = null;
    this.lastWaveScoreDetails = null;

    this.enemies = [];
    this.towers = [];
    this.corals = [];
    this.occupiedSpots.clear();
    this.bulletPool.releaseAll();
    this.particlePool.releaseAll();
    this.waveManager.reset();
    this.scoreManager.reset();
    this.inputHandler.reset();
    this.player.resetTo(this.playerHome.x, this.playerHome.y);
    this.player.setAttacking(false);
    this.attackTarget = null;
    this.attackCooldown = 0;
    this.isPlayerAttacking = false;
  }

  startNextWave(): void {
    if (this.waveClearPhase) {
      this.waveClearPhase = false;
      this.eggPlacingPhase = true;
      return;
    }
    this.scoreManager.startWave();
    this.waveManager.startWave();
  }

  get currentWave(): number {
    return this.waveManager.currentWave;
  }
  get totalWaves(): number {
    return this.waveManager.totalWaves;
  }
  get isInterWave(): boolean {
    return this.waveManager.isInterWave;
  }
  get isGameClear(): boolean {
    return this.waveManager.isGameClear;
  }
  get isPaused(): boolean {
    return this._isPaused;
  }
  get isEggPlacing(): boolean {
    return this.eggPlacingPhase;
  }
  get isWaveClear(): boolean {
    return this.waveClearPhase;
  }

  // ── Main loop ───────────────────────────────────────────────────────────────

  private loop = (timestamp: number): void => {
    if (!this.running) return;

    const elapsed = Math.min(timestamp - this.lastTimestamp, MAX_ACCUMULATED);
    this.lastTimestamp = timestamp;

    if (
      !this.gameOver &&
      !this._isPaused &&
      !this.waveManager.isGameClear &&
      !this.waveClearPhase
    ) {
      this.accumulated += elapsed;
      while (this.accumulated >= FIXED_TIMESTEP) {
        this.update(FIXED_TIMESTEP / 1000);
        this.accumulated -= FIXED_TIMESTEP;
      }
    }

    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ── Update ─────────────────────────────────────────────────────────────────

  update(deltaTime: number): void {
    // 0. 長押しタイマー更新（InputHandler に委譲）
    this.inputHandler.update(deltaTime);

    // 1. ウェーブマネージャ更新（スポーン発生）
    this.waveManager.update(deltaTime, this.enemies.length);

    // 2. 珊瑚ダメージ適用（接触中の敵の数だけ毎秒削れる）
    for (const coral of this.corals) {
      if (coral.isBroken) continue;
      let justBroke = false;
      for (const enemy of this.enemies) {
        if (!enemy.isActive || enemy.isDying) continue;
        if (enemy.pos.distanceTo(coral.pos) < CORAL_BLOCK_RADIUS) {
          if (coral.takeDamage(CORAL_DAMAGE_PER_SECOND * deltaTime)) {
            justBroke = true;
          }
        }
      }
      if (justBroke) {
        this.spawnParticles(coral.pos.x, coral.pos.y, '#c0392b', PARTICLES_KILL);
      }
    }

    // 2b. 珊瑚ブロック適用 + 敵移動
    for (const enemy of this.enemies) {
      if (!enemy.isDying) {
        const blocked = this.corals.some(
          (c) => !c.isBroken && enemy.pos.distanceTo(c.pos) < CORAL_BLOCK_RADIUS,
        );
        enemy.setSpeedMultiplier(blocked ? 0 : 1.0);
      }
      enemy.update(deltaTime);
    }

    // 3. タワー更新（ターゲット選択・発射）
    for (const tower of this.towers) {
      tower.update(deltaTime, this.enemies, this.bulletPool);
    }

    // 4. 弾丸移動
    for (const bullet of this.bulletPool.all) {
      if (bullet.isActive) bullet.update(deltaTime);
    }

    // 5. 弾丸↔敵 衝突判定
    for (const bullet of this.bulletPool.all) {
      if (!bullet.isActive) continue;
      for (const enemy of this.enemies) {
        if (!enemy.isActive || enemy.isDying) continue;
        if (bullet.pos.distanceTo(enemy.pos) <= bullet.radius + enemy.radius) {
          enemy.takeDamage(bullet.damage);
          this.spawnParticles(
            enemy.pos.x,
            enemy.pos.y,
            COLOR_HIT,
            PARTICLES_HIT,
          );
          if (enemy.isDying) {
            this.scoreManager.recordKill(enemy.reward);
          }
          this.bulletPool.release(bullet);
          break;
        }
      }
    }

    // 6. パーティクル更新
    for (const particle of this.particlePool.all) {
      if (particle.isActive) particle.update(deltaTime);
    }

    // 7. ゴールで卵を食べる
    let hpLost = 0;
    const toRedirect = new Set<Enemy>();

    for (const enemy of this.enemies) {
      if (!enemy.isActive || enemy.isDying) continue;

      if (enemy.isAtGoal) {
        const gi = enemy.currentGoalIdx;
        if (gi < 0 || this.goalEggs[gi] <= 0) {
          toRedirect.add(enemy);
          continue;
        }
        enemy.eatingTimer -= deltaTime;
        if (enemy.eatingTimer <= 0) {
          this.goalEggs[gi]--;
          hpLost++;
          enemy.eatingTimer += EATING_INTERVAL;
          if (this.goalEggs[gi] === 0) {
            toRedirect.add(enemy);
          }
        }
      } else {
        const gi = enemy.currentGoalIdx;
        if (gi >= 0 && this.goalEggs[gi] <= 0) {
          toRedirect.add(enemy);
        }
      }
    }

    for (const enemy of toRedirect) {
      this.redirectEnemyToNextGoal(enemy);
    }

    if (hpLost > 0) {
      this.damageFlashTimer = DAMAGE_FLASH_DURATION;
    }

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - deltaTime);
    }

    if (this.playerHp <= 0) {
      this.gameOver = true;
    }

    // 8. 死亡アニメーション完了した敵のバーストを生成してから除去
    for (const enemy of this.enemies) {
      if (!enemy.isActive) {
        this.spawnParticles(enemy.pos.x, enemy.pos.y, COLOR_KILL, PARTICLES_KILL);
      }
    }
    this.enemies = this.enemies.filter((e) => e.isActive);

    // 9. プレイヤー更新・ダッシュアタック
    this.player.update(deltaTime);
    if (this.isPlayerAttacking) {
      if (!this.attackTarget?.isActive || this.attackTarget.isDying) {
        this.endAttack();
      } else {
        const toTarget = this.attackTarget.pos.subtract(this.player.pos);
        const dist = toTarget.magnitude();
        const hitDist = this.attackTarget.radius + ATTACK_HIT_DIST;
        if (dist <= hitDist) {
          this.attackTarget.takeDamage(ATTACK_DAMAGE);
          this.spawnParticles(
            this.attackTarget.pos.x,
            this.attackTarget.pos.y,
            COLOR_HIT,
            PARTICLES_HIT,
          );
          if (this.attackTarget.isDying) {
            this.scoreManager.recordKill(this.attackTarget.reward);
          }
          this.endAttack();
        } else {
          const dir = toTarget.normalize();
          const step = Math.min(ATTACK_SPEED * deltaTime, dist);
          const newPos = this.player.pos.add(dir.scale(step));
          this.player.setPosition(newPos.x, newPos.y);
          this.player.setFacing(Math.atan2(dir.y, dir.x));
        }
      }
    }
    if (this.attackCooldown > 0) {
      this.attackCooldown = Math.max(0, this.attackCooldown - deltaTime);
    }

    // 10. 近接プレビュー更新
    this.updatePreview();
  }

  // ── Spawn / wave helpers ───────────────────────────────────────────────────

  private spawnEnemy(kind: EnemyKind, spawnIdx: number): void {
    const spawnCell = this.mapGrid.spawnCells[spawnIdx];
    if (!spawnCell) {
      console.warn(`Unknown spawnIdx ${spawnIdx}`);
      return;
    }

    let bestWaypoints: Vector2D[] | null = null;
    let bestGoalIdx = -1;
    let bestLen = Infinity;

    for (const gi of this.activeGoalIndices) {
      if (this.goalEggs[gi] <= 0) continue;
      const goalCell = { col: GOAL_COLS[gi], row: GOAL_ROW };
      const cells = findPath(spawnCell, goalCell, (c, r) =>
        this.mapGrid.isPathTile(c, r),
      );
      if (cells && cells.length < bestLen) {
        bestLen = cells.length;
        bestWaypoints = cells.map((cell) =>
          this.mapGrid.tileCenter(cell.col, cell.row),
        );
        bestGoalIdx = gi;
      }
    }

    if (!bestWaypoints) {
      for (const gi of this.activeGoalIndices) {
        const goalCell = { col: GOAL_COLS[gi], row: GOAL_ROW };
        const cells = findPath(spawnCell, goalCell, (c, r) =>
          this.mapGrid.isPathTile(c, r),
        );
        if (cells && cells.length < bestLen) {
          bestLen = cells.length;
          bestWaypoints = cells.map((cell) =>
            this.mapGrid.tileCenter(cell.col, cell.row),
          );
          bestGoalIdx = gi;
        }
      }
    }

    if (!bestWaypoints) {
      console.warn(`No path from spawnIdx ${spawnIdx} to any active goal`);
      return;
    }
    this.enemies.push(new Enemy(bestWaypoints, kind, bestGoalIdx));
  }

  private onWaveClear(waveNumber: number): void {
    const spawnCompletedAt = this.waveManager.getAllEnemiesSpawnedTimestamp();
    const details = this.scoreManager.finalizeWave(
      waveNumber,
      this.playerHp,
      spawnCompletedAt,
    );
    this.lastWaveScoreDetails = details;

    this.crackedEggs += details.crackedEggsEarned;
    for (const gi of this.activeGoalIndices) {
      this.goalEggs[gi] = EGGS_PER_GOAL;
    }

    // 破壊された珊瑚を全て復活させる
    for (const coral of this.corals) {
      coral.restore();
    }

    if (!this.waveManager.isGameClear) {
      this.waveClearPhase = true;
    }
  }

  private handleEggPlaced(col: number, row: number): void {
    const goalCols = GOAL_COLS;
    for (let gi = 0; gi < goalCols.length; gi++) {
      if (this.activeGoalIndices.has(gi)) continue;
      if (row === GOAL_ROW && col === goalCols[gi]) {
        this.activeGoalIndices.add(gi);
        this.goalEggs[gi] = EGGS_PER_GOAL;
        this.eggPlacingPhase = false;
        break;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private spawnParticles(
    x: number,
    y: number,
    color: string,
    count: number,
  ): void {
    for (let i = 0; i < count; i++) {
      this.particlePool.acquire().init(x, y, color);
    }
  }

  private redirectEnemyToNextGoal(enemy: Enemy): void {
    const startCell = this.mapGrid.pixelToGrid(enemy.pos);
    let bestWaypoints: Vector2D[] | null = null;
    let bestGoalIdx = -1;
    let bestLen = Infinity;

    for (const gi of this.activeGoalIndices) {
      if (gi === enemy.currentGoalIdx) continue;
      if (this.goalEggs[gi] <= 0) continue;
      const goalCell = { col: GOAL_COLS[gi], row: GOAL_ROW };
      const cells = findPath(startCell, goalCell, (c, r) =>
        this.mapGrid.isPathTile(c, r),
      );
      if (cells && cells.length < bestLen) {
        bestLen = cells.length;
        bestWaypoints = cells.map((cell) =>
          this.mapGrid.tileCenter(cell.col, cell.row),
        );
        bestGoalIdx = gi;
      }
    }

    if (bestWaypoints && bestGoalIdx >= 0) {
      enemy.setNewPath(bestWaypoints, bestGoalIdx);
    }
  }

  /**
   * マーリンの近接プレビューを更新する。
   * 建設スポットとスポーン警告のどちらか近い方を選択する。
   */
  private updatePreview(): void {
    let bestSpot: PlacementSpot | null = null;
    let bestSpotDist = Infinity;
    if (!this.eggPlacingPhase && this.crackedEggs >= 1) {
      for (const spot of this.mapGrid.allSpots) {
        if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
        const center = this.mapGrid.spotCenter(spot.col, spot.row);
        const d = this.player.pos.distanceTo(center);
        if (d < bestSpotDist) {
          bestSpot = spot;
          bestSpotDist = d;
        }
      }
    }

    let bestSpawn: number | null = null;
    let bestSpawnDist = Infinity;
    const spawnVisible =
      this.waveManager.isInterWave &&
      !this.eggPlacingPhase &&
      !this.gameOver &&
      !this.waveManager.isGameClear &&
      this.waveManager.nextWaveEnemies.length > 0;
    if (spawnVisible) {
      const cells = this.mapGrid.spawnCells;
      for (let i = 0; i < cells.length; i++) {
        if (this.waveManager.nextWaveEnemiesBySpawn(i).length === 0) continue;
        const center = this.mapGrid.tileCenter(cells[i].col, cells[i].row);
        const d = this.player.pos.distanceTo(center);
        if (d < bestSpawnDist) {
          bestSpawn = i;
          bestSpawnDist = d;
        }
      }
    }

    if (bestSpotDist <= bestSpawnDist) {
      this.previewSpot = bestSpotDist < PLAYER_PREVIEW_RADIUS ? bestSpot : null;
      this.previewSpawn = null;
    } else {
      this.previewSpot = null;
      this.previewSpawn =
        bestSpawnDist < PLAYER_PREVIEW_RADIUS ? bestSpawn : null;
    }
  }

  private findNearestEnemy(): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.isActive || enemy.isDying) continue;
      const d = this.player.pos.distanceTo(enemy.pos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = enemy;
      }
    }
    return nearest;
  }

  private startAttack(target: Enemy): void {
    this.attackTarget = target;
    this.isPlayerAttacking = true;
    this.player.setAttacking(true);
  }

  private endAttack(): void {
    this.isPlayerAttacking = false;
    this.player.setAttacking(false);
    this.attackCooldown = ATTACK_COOLDOWN;
    this.attackTarget = null;
  }

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
        this.towers.push(
          createTower(TowerKind.Crab, spot.col, spot.row, this.mapGrid),
        );
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

  // ── Draw ────────────────────────────────────────────────────────────────────

  draw(): void {
    this.renderer.clear();
    this.mapGrid.draw(this.renderer);
    this.mapGrid.drawGoalMarkers(
      this.renderer,
      this.activeGoalIndices,
      this.goalEggs,
    );
    this.drawSpots();

    for (const coral of this.corals) coral.draw(this.renderer);
    for (const tower of this.towers) tower.draw(this.renderer);
    for (const enemy of this.enemies) enemy.draw(this.renderer);
    for (const bullet of this.bulletPool.all) bullet.draw(this.renderer);
    for (const particle of this.particlePool.all) particle.draw(this.renderer);

    this.player.draw(this.renderer);
    if (this.attackCooldown > 0) {
      this.player.drawCooldown(
        this.renderer,
        1 - this.attackCooldown / ATTACK_COOLDOWN,
      );
    }

    if (this.eggPlacingPhase) this.drawEggPlacingOverlay();
    this.drawSpawnMarkers();

    if (this.inputHandler.holdSpot === null) {
      this.drawProximityPreview();
      this.drawSpawnProximityPreview();
    }
    if (this.inputHandler.holdSpot !== null) {
      this.drawHoldPreview();
    }

    if (this.damageFlashTimer > 0) this.drawDamageFlash();

    this.drawHUD();

    if (this._isPaused && !this.gameOver && !this.waveManager.isGameClear) {
      this.drawPausedOverlay();
    }
    if (
      this.waveClearPhase &&
      !this.gameOver &&
      !this.waveManager.isGameClear
    ) {
      this.drawWaveClearOverlay();
    }
    if (this.gameOver) {
      this.drawGameOver();
    } else if (this.waveManager.isGameClear) {
      this.drawGameClear();
    }
  }

  // ── Draw helpers ──────────────────────────────────────────────────────────

  private drawSpots(): void {
    const r = this.renderer;
    for (const spot of this.mapGrid.allSpots) {
      if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
      if (
        this.previewSpot &&
        spot.col === this.previewSpot.col &&
        spot.row === this.previewSpot.row
      )
        continue;
      const center = this.mapGrid.spotCenter(spot.col, spot.row);
      r.drawCircle(center, 5, 'rgba(255, 255, 255, 0.80)');
    }
  }

  private drawProximityPreview(): void {
    if (!this.previewSpot) return;
    const ctx = this.renderer.context;
    ctx.save();
    ctx.globalAlpha = PREVIEW_ALPHA;
    this.drawSpotEntity(this.previewSpot);
    ctx.restore();
  }

  private drawSpotEntity(spot: PlacementSpot): void {
    switch (spot.kind) {
      case 'octopus':
        createTower(TowerKind.Octopus, spot.col, spot.row).draw(this.renderer);
        break;
      case 'crab':
        createTower(TowerKind.Crab, spot.col, spot.row).draw(this.renderer);
        break;
      case 'hermit_crab':
        createTower(TowerKind.HermitCrab, spot.col, spot.row).draw(
          this.renderer,
        );
        break;
      case 'eel':
        createTower(TowerKind.Eel, spot.col, spot.row).draw(this.renderer);
        break;
      case 'coral':
        new CoralWall(spot.col, spot.row).draw(this.renderer);
        break;
    }
  }

  private drawHoldPreview(): void {
    const spot = this.inputHandler.holdSpot;
    if (!spot) return;

    const ctx = this.renderer.context;
    const center = this.mapGrid.spotCenter(spot.col, spot.row);
    const progress = Math.min(this.inputHandler.holdTimer / HOLD_DURATION, 1);

    ctx.save();
    ctx.globalAlpha = 0.25 + progress * 0.3;
    this.drawBirthingEgg(ctx, center.x, center.y, progress);
    ctx.restore();

    const floatOffset = (1 - progress) * TILE_SIZE * 0.4;
    ctx.save();
    ctx.globalAlpha = 0.25 + progress * 0.3;
    ctx.translate(0, floatOffset);
    this.drawSpotEntity(spot);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(
      center.x,
      center.y,
      26,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress,
    );
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  private drawBirthingEgg(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    progress: number,
  ): void {
    const eggR = 18;
    const pivotOffset = eggR * 0.65;
    const maxAngle = progress * Math.PI * 0.42;

    ctx.save();

    const glowAlpha = 0.3 + progress * 0.55;
    const glowR = eggR * (0.5 + progress * 0.9);
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grd.addColorStop(0, `rgba(255, 255, 200, ${glowAlpha.toFixed(2)})`);
    grd.addColorStop(
      0.5,
      `rgba(255, 220, 80,  ${(glowAlpha * 0.5).toFixed(2)})`,
    );
    grd.addColorStop(1, 'rgba(255, 200, 50, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(-maxAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, eggR, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 185, 55, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.70)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(maxAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, eggR, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 210, 90, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.70)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(eggR * 0.25, -eggR * 0.35, eggR * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.60)';
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  private drawDamageFlash(): void {
    const alpha = (this.damageFlashTimer / DAMAGE_FLASH_DURATION) * 0.4;
    const ctx = this.renderer.context;
    ctx.fillStyle = `rgba(231, 76, 60, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, this.renderer.width, this.renderer.height);
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  private drawHUD(): void {
    const r = this.renderer;
    const ctx = r.context;
    const CY = 25;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, r.width, 50);

    this.drawHudCrackedEggIcon(ctx, 18, CY, 9);
    r.drawText(
      `×${this.crackedEggs}`,
      new Vector2D(31, 30),
      '#c8e88a',
      'bold 15px monospace',
    );

    this.drawMiniShark(ctx, 67, CY, 'small', 6);
    r.drawText(
      `${this.waveManager.currentWave}/${this.waveManager.totalWaves}`,
      new Vector2D(80, 30),
      '#7ec8e3',
      'bold 15px monospace',
    );

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`SCORE: ${this.scoreManager.total}`, r.width - 160, CY);
    ctx.restore();
  }

  private drawMiniShark(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    kind: EnemyKind,
    sizeOverride?: number,
  ): void {
    const def = ENEMY_DEFS[kind];
    const r = sizeOverride ?? def?.radius ?? 6;
    const bodyColor = def?.bodyColor ?? '#5dade2';
    const finColor = def?.finColor ?? '#2471a3';

    ctx.save();
    ctx.translate(x, y);

    ctx.beginPath();
    ctx.moveTo(-r * 0.95, 0);
    ctx.lineTo(-r * 1.6, -r * 0.55);
    ctx.lineTo(-r * 1.3, 0);
    ctx.lineTo(-r * 1.6, r * 0.55);
    ctx.closePath();
    ctx.fillStyle = finColor;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.3, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.strokeStyle = finColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.71);
    ctx.lineTo(r * 0.35, -r * 0.71);
    ctx.lineTo(r * 0.12, -r * 1.4);
    ctx.closePath();
    ctx.fillStyle = finColor;
    ctx.fill();

    ctx.restore();
  }

  private drawHudCrackedEggIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
  ): void {
    const pivotOffset = r * 0.65;
    const openAngle = Math.PI * 0.42;

    ctx.save();

    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1);
    grd.addColorStop(0, 'rgba(255, 255, 200, 0.85)');
    grd.addColorStop(0.5, 'rgba(255, 220, 80,  0.50)');
    grd.addColorStop(1, 'rgba(255, 200, 50,  0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(-openAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 185, 55, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(openAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 210, 90, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 0.25, -r * 0.35, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  private drawHudEggIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
  ): void {
    ctx.save();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 185, 55, 0.92)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 230, 130, 0.45)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.32, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
    ctx.fill();

    ctx.restore();
  }

  private drawPausedOverlay(): void {
    const r = this.renderer;
    const cx = r.width / 2;
    const cy = r.height / 2;

    r.context.fillStyle = 'rgba(0,0,0,0.35)';
    r.context.fillRect(0, 0, r.width, r.height);

    r.context.font = 'bold 52px monospace';
    r.context.fillStyle = 'rgba(255,255,255,0.85)';
    r.context.textAlign = 'center';
    r.context.fillText('PAUSED', cx, cy + 18);
    r.context.textAlign = 'left';
  }

  private drawWaveClearOverlay(): void {
    const r = this.renderer;
    const ctx = r.context;
    const cx = r.width / 2;
    const cy = r.height / 2;

    ctx.fillStyle = 'rgba(0, 50, 20, 0.84)';
    ctx.fillRect(0, 0, r.width, r.height);

    ctx.font = 'bold 52px monospace';
    ctx.fillStyle = '#2ecc71';
    ctx.textAlign = 'center';
    ctx.fillText('WAVE CLEAR!', cx, cy - 78);

    ctx.font = '18px monospace';
    ctx.fillStyle = '#5dade2';
    ctx.fillText(`Wave ${this.waveManager.currentWave} Complete`, cx, cy - 48);

    if (this.lastWaveScoreDetails !== null) {
      const d = this.lastWaveScoreDetails;

      ctx.font = '13px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('── Wave Score ──', cx, cy - 18);

      ctx.font = '15px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`Enemies:    +${d.enemyScore}`, cx, cy + 6);
      ctx.fillText(`Eggs:       +${d.eggScore}`, cx, cy + 26);
      ctx.fillText(`Time bonus: +${d.timeBonus}`, cx, cy + 46);

      ctx.font = '13px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('────────────────────', cx, cy + 62);

      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#f1c40f';
      ctx.fillText(`Wave Total: +${d.total}`, cx, cy + 82);

      this.drawHudCrackedEggIcon(ctx, cx - 52, cy + 106, 8);
      ctx.font = '15px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`+${d.crackedEggsEarned}  GET!`, cx + 8, cy + 106);
    }

    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('Tap NEXT WAVE to continue', cx, cy + 136);

    ctx.textAlign = 'left';
  }

  private drawGameClear(): void {
    const r = this.renderer;
    const ctx = r.context;
    const cx = r.width / 2;
    const cy = r.height / 2;

    ctx.fillStyle = 'rgba(0, 40, 80, 0.80)';
    ctx.fillRect(0, 0, r.width, r.height);

    ctx.font = 'bold 72px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.textAlign = 'center';
    ctx.fillText('CLEAR!', cx, cy - 65);

    ctx.font = '22px monospace';
    ctx.fillStyle = '#5dade2';
    ctx.fillText('All sharks defeated!', cx, cy - 20);

    if (this.lastWaveScoreDetails !== null) {
      const d = this.lastWaveScoreDetails;
      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('── Last Wave Score ──', cx, cy + 15);

      ctx.font = '16px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`Enemies:     +${d.enemyScore}`, cx, cy + 40);
      ctx.fillText(`Eggs:        +${d.eggScore}`, cx, cy + 62);
      ctx.fillText(`Time bonus:  +${d.timeBonus}`, cx, cy + 84);

      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('──────────────────────', cx, cy + 100);
    }

    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`FINAL SCORE: ${this.scoreManager.total}`, cx, cy + 122);

    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('Tap ↩ Restart to play again', cx, cy + 152);

    ctx.textAlign = 'left';
  }

  private drawSpawnMarkers(): void {
    if (!this.waveManager.isInterWave) return;
    if (
      this.eggPlacingPhase ||
      this.waveClearPhase ||
      this.gameOver ||
      this.waveManager.isGameClear
    )
      return;
    if (this.waveManager.nextWaveEnemies.length === 0) return;

    const ctx = this.renderer.context;
    const cells = this.mapGrid.spawnCells;
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 320);

    for (let i = 0; i < cells.length; i++) {
      if (this.waveManager.nextWaveEnemiesBySpawn(i).length === 0) continue;
      const { x, y } = this.mapGrid.tileCenter(cells[i].col, cells[i].row);
      const r = 13;

      ctx.save();
      ctx.globalAlpha = 0.55 + 0.35 * pulse;

      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.87, y + r * 0.5);
      ctx.lineTo(x - r * 0.87, y + r * 0.5);
      ctx.closePath();
      ctx.fillStyle = '#e74c3c';
      ctx.fill();
      ctx.strokeStyle = '#922b21';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${r}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', x, y + r * 0.1);

      ctx.restore();
    }
  }

  private drawSpawnProximityPreview(): void {
    if (this.previewSpawn === null) return;
    const cells = this.mapGrid.spawnCells;
    const cell = cells[this.previewSpawn];
    if (!cell) return;
    const enemies = this.waveManager.nextWaveEnemiesBySpawn(this.previewSpawn);
    if (enemies.length === 0) return;

    const ctx = this.renderer.context;
    const center = this.mapGrid.tileCenter(cell.col, cell.row);

    const ROW_H = 22;
    const PAD_X = 12;
    const PAD_Y = 8;
    const SHARK_R = 7;
    const TEXT_GAP = 4;

    const rowWidth = () => SHARK_R * 2 + TEXT_GAP + 18;
    const pillW = Math.max(...enemies.map(() => rowWidth())) + PAD_X * 2 + 8;
    const pillH = enemies.length * ROW_H + PAD_Y * 2;
    const pillX = center.x - pillW / 2;
    const pillY = center.y + TILE_SIZE * 0.5 + 4;
    const pillR = 8;

    ctx.save();
    ctx.globalAlpha = 0.88;

    ctx.beginPath();
    ctx.moveTo(pillX + pillR, pillY);
    ctx.lineTo(pillX + pillW - pillR, pillY);
    ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
    ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
    ctx.quadraticCurveTo(
      pillX + pillW,
      pillY + pillH,
      pillX + pillW - pillR,
      pillY + pillH,
    );
    ctx.lineTo(pillX + pillR, pillY + pillH);
    ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
    ctx.lineTo(pillX, pillY + pillR);
    ctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 20, 50, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.60)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (let idx = 0; idx < enemies.length; idx++) {
      const { kind, count } = enemies[idx];
      const rowY = pillY + PAD_Y + idx * ROW_H + ROW_H / 2;
      const sharkX = pillX + PAD_X + SHARK_R;
      ctx.globalAlpha = 1;
      this.drawMiniShark(ctx, sharkX, rowY, kind, SHARK_R);

      const tw = count >= 10 ? 22 : 16;
      const textX = sharkX + SHARK_R + TEXT_GAP + tw / 2 + 4;
      ctx.fillStyle = '#eeeeee';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${count}`, textX, rowY);
    }

    ctx.restore();
  }

  private drawEggPlacingOverlay(): void {
    const ctx = this.renderer.context;
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 280);
    const goalCols = GOAL_COLS;

    for (let gi = 0; gi < goalCols.length; gi++) {
      if (this.activeGoalIndices.has(gi)) continue;
      const { x, y } = this.mapGrid.spotCenter(goalCols[gi], GOAL_ROW);

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 185, 55, ${pulse.toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.35;
      this.drawHudEggIcon(ctx, x, y, 9);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = `rgba(255, 220, 100, ${pulse.toFixed(2)})`;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TAP', x, y);
      ctx.restore();
    }

    const r = this.renderer;
    const bannerY = r.height - 94;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.60)';
    ctx.fillRect(0, bannerY, r.width, 44);
    ctx.fillStyle = '#ffbb33';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('次の卵の場所を選んでください', r.width / 2, bannerY + 22);
    ctx.restore();
  }

  private drawGameOver(): void {
    const r = this.renderer;
    const ctx = r.context;
    const cx = r.width / 2;
    const cy = r.height / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, r.width, r.height);

    ctx.font = 'bold 64px monospace';
    ctx.fillStyle = '#e74c3c';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', cx, cy - 65);

    ctx.font = '20px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(
      `Wave ${this.waveManager.currentWave} / ${this.waveManager.totalWaves}   Towers: ${this.towers.length}`,
      cx,
      cy - 20,
    );

    if (this.lastWaveScoreDetails !== null) {
      const d = this.lastWaveScoreDetails;
      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('── Last Wave Score ──', cx, cy + 15);

      ctx.font = '16px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`Enemies:     +${d.enemyScore}`, cx, cy + 40);
      ctx.fillText(`Eggs:        +${d.eggScore}`, cx, cy + 62);
      ctx.fillText(`Time bonus:  +${d.timeBonus}`, cx, cy + 84);

      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('──────────────────────', cx, cy + 100);
    }

    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`FINAL SCORE: ${this.scoreManager.total}`, cx, cy + 122);

    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('Tap ↩ Restart to play again', cx, cy + 152);

    ctx.textAlign = 'left';
  }
}
