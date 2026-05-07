import { Renderer } from './Renderer.ts';
import { WaveManager } from './WaveManager.ts';
import { MapGrid, PlacementSpot, GOAL_COLS, GOAL_ROW, INITIAL_GOAL_IDX, TILE_SIZE } from '../level/MapGrid.ts';
import { CoralWall } from '../entities/CoralWall.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import { Enemy, EnemyKind, EATING_INTERVAL } from '../entities/Enemy.ts';
import { Tower, createTower, TowerKind } from '../entities/Tower.ts';
import { Bullet } from '../entities/Bullet.ts';
import { Particle } from '../entities/Particle.ts';
import { Player } from '../entities/Player.ts';
import { ObjectPool } from '../utils/ObjectPool.ts';
import { findPath } from '../utils/Pathfinding.ts';

const FIXED_TIMESTEP  = 1000 / 60;           // ms — 60 Hz logic tick
const MAX_ACCUMULATED = FIXED_TIMESTEP * 5;  // spiral-of-death guard

const EGGS_PER_GOAL        = 3; // eggs at each goal (HP per goal)
const INITIAL_CRACKED_EGGS = 3; // building resource at game start

const DAMAGE_FLASH_DURATION = 0.4; // seconds — red screen flash on HP loss
const HOLD_DURATION         = 2.0; // seconds to hold pointer before placing
const ATTACK_COOLDOWN       = 2.0; // seconds between player dash attacks
const ATTACK_DAMAGE         = 50;  // damage dealt per dash
const ATTACK_SPEED          = 600; // px/s during dash
const ATTACK_HIT_DIST       = 8;   // px beyond radii sum to register a hit
const CORAL_SLOW_RADIUS     = 30;  // px — enemies within this range are slowed
const PLAYER_PREVIEW_RADIUS = 75;  // px — marlin reveals nearest spot within this range
const PREVIEW_ALPHA         = 0.40;
// px — half-extent of the square area around a previewed spot where long-press
// triggers a build (cell itself + half-tile margin in each direction)
const BUILD_TAP_HALF        = TILE_SIZE;
// px — once the pointer slides past this distance from its press point, any
// in-progress build hold is cancelled and the marlin begins following.
const DRAG_CANCEL_THRESHOLD = 8;

// Particle counts per event
const PARTICLES_HIT  = 5;
const PARTICLES_KILL = 8;

// Particle colors
const COLOR_HIT  = '#6c3483'; // ink splash on impact
const COLOR_KILL = '#4a235a'; // ink burst on kill

export class Game {
  private readonly renderer: Renderer;
  private readonly mapGrid: MapGrid;
  private readonly canvas: HTMLCanvasElement;
  private readonly waveManager: WaveManager;

  private enemies: Enemy[]     = [];
  private towers:  Tower[]     = [];
  private corals:  CoralWall[] = [];
  private readonly occupiedSpots = new Set<string>(); // 'col,row'
  private readonly bulletPool:   ObjectPool<Bullet>;
  private readonly particlePool: ObjectPool<Particle>;

  // Player marlin
  private readonly player: Player;
  private readonly playerHome: Vector2D;
  private playerDragPointerId: number | null = null;
  private playerDragStart: Vector2D | null = null;

  // Dash attack state
  private attackTarget:     Enemy | null = null;
  private attackCooldown    = 0;
  private isPlayerAttacking = false;

  // Player state
  // goalEggs[gi] = remaining eggs at goal slot gi (0–EGGS_PER_GOAL)
  private goalEggs          = [EGGS_PER_GOAL, 0, 0, 0, 0] as number[];
  private crackedEggs       = INITIAL_CRACKED_EGGS;
  private activeGoalIndices = new Set<number>([INITIAL_GOAL_IDX]);

  /** Total eggs remaining across all active goals — used as HP. */
  private get playerHp(): number {
    let total = 0;
    for (const gi of this.activeGoalIndices) total += this.goalEggs[gi];
    return total;
  }
  private eggPlacingPhase  = false; // true after wave clear overlay dismissed, until player places egg
  private waveClearPhase   = false; // true after wave clear, until player taps NEXT WAVE
  private gameOver         = false;


  // Lifecycle controls
  private _isPaused = false;

  // Long-press placement state
  private holdSpot:  PlacementSpot | null = null;
  private holdTimer  = 0;

  // Spot / spawn revealed by marlin proximity — at most one active at a time
  private previewSpot:  PlacementSpot | null = null;
  private previewSpawn: number | null        = null; // spawnIdx, or null

  // Visual feedback
  private damageFlashTimer = 0; // counts down from DAMAGE_FLASH_DURATION after HP loss

  // Score tracking
  private totalScore = 0;
  private currentWaveEnemiesDefeated = 0;
  private currentWaveStartTime = 0;
  private lastWaveScoreDetails: { enemyScore: number; eggScore: number; timeBonus: number; total: number; crackedEggsEarned: number } | null = null;

  // Loop internals
  private lastTimestamp = 0;
  private accumulated   = 0;
  private rafId         = 0;
  private running       = false;


  constructor(canvas: HTMLCanvasElement) {
    this.canvas   = canvas;
    this.renderer = new Renderer(canvas);
    this.mapGrid  = new MapGrid();
    this.bulletPool   = new ObjectPool<Bullet>(() => new Bullet());
    this.particlePool = new ObjectPool<Particle>(() => new Particle());
    this.waveManager  = new WaveManager(
      (kind: EnemyKind, spawnIdx: number) => {
        const spawnCell = this.mapGrid.spawnCells[spawnIdx];
        if (!spawnCell) {
          console.warn(`Unknown spawnIdx ${spawnIdx}`);
          return;
        }
        // A*: find shortest path to each active goal with eggs remaining, pick nearest
        let bestWaypoints: Vector2D[] | null = null;
        let bestGoalIdx = -1;
        let bestLen = Infinity;
        for (const gi of this.activeGoalIndices) {
          if (this.goalEggs[gi] <= 0) continue; // skip depleted goals
          const goalCell = { col: GOAL_COLS[gi], row: GOAL_ROW };
          const cells = findPath(
            spawnCell,
            goalCell,
            (c, r) => this.mapGrid.isPathTile(c, r),
          );
          if (cells && cells.length < bestLen) {
            bestLen = cells.length;
            bestWaypoints = cells.map(cell => this.mapGrid.tileCenter(cell.col, cell.row));
            bestGoalIdx = gi;
          }
        }
        // Fallback: if all active goals are empty, pick any active goal
        if (!bestWaypoints) {
          for (const gi of this.activeGoalIndices) {
            const goalCell = { col: GOAL_COLS[gi], row: GOAL_ROW };
            const cells = findPath(
              spawnCell,
              goalCell,
              (c, r) => this.mapGrid.isPathTile(c, r),
            );
            if (cells && cells.length < bestLen) {
              bestLen = cells.length;
              bestWaypoints = cells.map(cell => this.mapGrid.tileCenter(cell.col, cell.row));
              bestGoalIdx = gi;
            }
          }
        }
        if (!bestWaypoints) {
          console.warn(`No path from spawnIdx ${spawnIdx} to any active goal`);
          return;
        }
        this.enemies.push(new Enemy(bestWaypoints, kind, bestGoalIdx));
      },
      (waveNumber: number) => {
        // Calculate wave scores BEFORE refilling eggs
        const enemyScore      = this.currentWaveEnemiesDefeated * 100;
        const eggScore        = this.playerHp * 50;
        const elapsedMs       = performance.now() - this.currentWaveStartTime;
        const timeBonus       = this.calculateTimeBonus(waveNumber, elapsedMs);
        const waveTotal       = enemyScore + eggScore + timeBonus;
        const crackedEggsEarned = this.playerHp; // captured before refill
        this.lastWaveScoreDetails = { enemyScore, eggScore, timeBonus, total: waveTotal, crackedEggsEarned };
        this.totalScore += waveTotal;

        // Remaining eggs → cracked eggs (building resource)
        this.crackedEggs += crackedEggsEarned;
        // Refill all active goals to EGGS_PER_GOAL for the next wave
        for (const gi of this.activeGoalIndices) {
          this.goalEggs[gi] = EGGS_PER_GOAL;
        }
        if (!this.waveManager.isGameClear) {
          this.waveClearPhase = true; // show wave clear overlay; player taps NEXT WAVE to proceed
        }
      },
    );
    // Spawn player marlin in the lower-middle area, away from the HUD bar
    this.playerHome = new Vector2D(canvas.width / 2, canvas.height - 80);
    this.player     = new Player(this.playerHome.x, this.playerHome.y);

    canvas.addEventListener('pointerdown',   this.handlePointerDown);
    canvas.addEventListener('pointermove',   this.handlePointerMove);
    canvas.addEventListener('pointerup',     this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave',  this.handlePointerUp);
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
    this.canvas.removeEventListener('pointerdown',   this.handlePointerDown);
    this.canvas.removeEventListener('pointermove',   this.handlePointerMove);
    this.canvas.removeEventListener('pointerup',     this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave',  this.handlePointerUp);
  }

  // ── Public controls ──────────────────────────────────────────────────────────

  togglePause(): void { this._isPaused = !this._isPaused; }

  /** Reset the game to its initial state, keeping the same canvas/renderer. */
  restart(): void {
    this.goalEggs          = [EGGS_PER_GOAL, 0, 0, 0, 0];
    this.crackedEggs       = INITIAL_CRACKED_EGGS;
    this.activeGoalIndices = new Set([INITIAL_GOAL_IDX]);
    this.mapGrid.reset();
    this.eggPlacingPhase   = false;
    this.waveClearPhase    = false;
    this.gameOver          = false;
    this._isPaused        = false;
    this.accumulated      = 0;
    this.damageFlashTimer = 0;
    this.holdSpot         = null;
    this.holdTimer        = 0;
    this.previewSpot      = null;
    this.previewSpawn     = null;
    this.totalScore                = 0;
    this.currentWaveEnemiesDefeated = 0;
    this.currentWaveStartTime      = 0;
    this.lastWaveScoreDetails      = null;

    this.enemies = [];
    this.towers  = [];
    this.corals  = [];
    this.occupiedSpots.clear();
    this.bulletPool.releaseAll();
    this.particlePool.releaseAll();
    this.waveManager.reset();
    this.player.resetTo(this.playerHome.x, this.playerHome.y);
    this.player.setAttacking(false);
    this.playerDragPointerId = null;
    this.playerDragStart     = null;
    this.attackTarget      = null;
    this.attackCooldown    = 0;
    this.isPlayerAttacking = false;
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  /** Called by the Start Wave / NEXT WAVE button in the UI. */
  startNextWave(): void {
    if (this.waveClearPhase) {
      // Dismiss wave clear overlay → move to egg placing phase
      this.waveClearPhase  = false;
      this.eggPlacingPhase = true;
      return;
    }
    this.currentWaveStartTime = performance.now();
    this.currentWaveEnemiesDefeated = 0;
    this.waveManager.startWave();
  }

  get currentWave(): number  { return this.waveManager.currentWave; }
  get totalWaves(): number   { return this.waveManager.totalWaves; }
  get isInterWave(): boolean { return this.waveManager.isInterWave; }
  get isGameClear(): boolean { return this.waveManager.isGameClear; }
  get isPaused(): boolean      { return this._isPaused; }
  get isEggPlacing(): boolean  { return this.eggPlacingPhase; }
  get isWaveClear(): boolean   { return this.waveClearPhase; }

  // ── Main loop ───────────────────────────────────────────────────────────────

  // Arrow function keeps `this` bound across rAF callbacks
  private loop = (timestamp: number): void => {
    if (!this.running) return;

    const elapsed = Math.min(timestamp - this.lastTimestamp, MAX_ACCUMULATED);
    this.lastTimestamp = timestamp;

    // Advance simulation only when not paused, game-over, cleared, or showing wave clear overlay
    if (!this.gameOver && !this._isPaused && !this.waveManager.isGameClear && !this.waveClearPhase) {
      this.accumulated += elapsed;
      while (this.accumulated >= FIXED_TIMESTEP) {
        this.update(FIXED_TIMESTEP / 1000); // ms → s
        this.accumulated -= FIXED_TIMESTEP;
      }
    }

    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ─── Update ────────────────────────────────────────────────────────────────

  update(deltaTime: number): void {
    // 0. Advance long-press hold timer
    if (this.holdSpot !== null) {
      this.holdTimer += deltaTime;
      if (this.holdTimer >= HOLD_DURATION) {
        this.placeAtSpot(this.holdSpot);
        this.holdSpot  = null;
        this.holdTimer = 0;
      }
    }

    // 1. Advance wave manager (spawning happens via callback)
    this.waveManager.update(deltaTime, this.enemies.length);

    // 2. Apply coral slow effect and move enemies
    for (const enemy of this.enemies) {
      const slowed = this.corals.some(c => enemy.pos.distanceTo(c.pos) < CORAL_SLOW_RADIUS);
      enemy.setSpeedMultiplier(slowed ? 0.35 : 1.0);
      enemy.update(deltaTime);
    }

    // 3. Update towers — targeting + firing into the pool
    for (const tower of this.towers) {
      tower.update(deltaTime, this.enemies, this.bulletPool);
    }

    // 4. Move active bullets
    for (const bullet of this.bulletPool.all) {
      if (bullet.isActive) bullet.update(deltaTime);
    }

    // 5. Bullet ↔ Enemy collision
    for (const bullet of this.bulletPool.all) {
      if (!bullet.isActive) continue;
      for (const enemy of this.enemies) {
        if (!enemy.isActive) continue;
        if (bullet.pos.distanceTo(enemy.pos) <= bullet.radius + enemy.radius) {
          enemy.takeDamage(bullet.damage);
          this.spawnParticles(enemy.pos.x, enemy.pos.y, COLOR_HIT, PARTICLES_HIT);
          if (!enemy.isActive) {
            this.currentWaveEnemiesDefeated += enemy.reward;
            this.spawnParticles(enemy.pos.x, enemy.pos.y, COLOR_KILL, PARTICLES_KILL);
          }
          this.bulletPool.release(bullet);
          break; // bullet consumed — move to next bullet
        }
      }
    }

    // 6. Update particles
    for (const particle of this.particlePool.all) {
      if (particle.isActive) particle.update(deltaTime);
    }

    // 7. Enemies at goal eat eggs on a 2-second interval; redirect when goal is depleted
    let hpLost = 0;
    const toRedirect = new Set<Enemy>();

    for (const enemy of this.enemies) {
      if (!enemy.isActive) continue;

      if (enemy.isAtGoal) {
        const gi = enemy.currentGoalIdx;
        // Arrived at a goal that is already empty — redirect immediately
        if (gi < 0 || this.goalEggs[gi] <= 0) {
          toRedirect.add(enemy);
          continue;
        }
        enemy.eatingTimer -= deltaTime;
        if (enemy.eatingTimer <= 0) {
          this.goalEggs[gi]--;
          hpLost++;
          enemy.eatingTimer += EATING_INTERVAL; // += avoids timer drift
          if (this.goalEggs[gi] === 0) {
            toRedirect.add(enemy);
          }
        }
      } else {
        // Still en route — redirect if target goal was depleted by another enemy
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

    // Decrement damage flash timer
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - deltaTime);
    }

    if (this.playerHp <= 0) {
      this.gameOver = true;
    }

    // 8. Purge inactive enemies
    this.enemies = this.enemies.filter(e => e.isActive);

    // 9. Player marlin — follows pointer; handles dash attack
    this.player.update(deltaTime);
    if (this.isPlayerAttacking) {
      if (!this.attackTarget || !this.attackTarget.isActive) {
        this.endAttack();
      } else {
        const toTarget = this.attackTarget.pos.subtract(this.player.pos);
        const dist     = toTarget.magnitude();
        const hitDist  = this.attackTarget.radius + ATTACK_HIT_DIST;
        if (dist <= hitDist) {
          this.attackTarget.takeDamage(ATTACK_DAMAGE);
          this.spawnParticles(this.attackTarget.pos.x, this.attackTarget.pos.y, COLOR_HIT, PARTICLES_HIT);
          if (!this.attackTarget.isActive) {
            this.currentWaveEnemiesDefeated += this.attackTarget.reward;
            this.spawnParticles(this.attackTarget.pos.x, this.attackTarget.pos.y, COLOR_KILL, PARTICLES_KILL);
          }
          this.endAttack();
        } else {
          const dir    = toTarget.normalize();
          const step   = Math.min(ATTACK_SPEED * deltaTime, dist);
          const newPos = this.player.pos.add(dir.scale(step));
          this.player.setPosition(newPos.x, newPos.y);
          this.player.setFacing(Math.atan2(dir.y, dir.x));
        }
      }
    }
    if (this.attackCooldown > 0) {
      this.attackCooldown = Math.max(0, this.attackCooldown - deltaTime);
    }

    // 10. Refresh proximity preview (build spot or spawn warning)
    this.updatePreview();
  }

  /**
   * Determine what the marlin is close enough to reveal:
   * either a build spot (previewSpot) or a spawn warning (previewSpawn).
   * When both are within range, the closer one wins (spec §D-2).
   */
  private updatePreview(): void {
    // ── Build spot candidate ──────────────────────────────────────────────────
    let bestSpot: PlacementSpot | null = null;
    let bestSpotDist = Infinity;
    if (!this.eggPlacingPhase && this.crackedEggs >= 1) {
      for (const spot of this.mapGrid.allSpots) {
        if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
        const center = this.mapGrid.spotCenter(spot.col, spot.row);
        const d = this.player.pos.distanceTo(center);
        if (d < bestSpotDist) { bestSpot = spot; bestSpotDist = d; }
      }
    }

    // ── Spawn marker candidate ────────────────────────────────────────────────
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
        if (d < bestSpawnDist) { bestSpawn = i; bestSpawnDist = d; }
      }
    }

    // ── Resolve: nearer wins; must be within radius ───────────────────────────
    if (bestSpotDist <= bestSpawnDist) {
      this.previewSpot  = bestSpotDist  < PLAYER_PREVIEW_RADIUS ? bestSpot  : null;
      this.previewSpawn = null;
    } else {
      this.previewSpot  = null;
      this.previewSpawn = bestSpawnDist < PLAYER_PREVIEW_RADIUS ? bestSpawn : null;
    }
  }

  // ─── Draw ──────────────────────────────────────────────────────────────────

  draw(): void {
    this.renderer.clear();
    this.mapGrid.draw(this.renderer);
    this.mapGrid.drawGoalMarkers(this.renderer, this.activeGoalIndices, this.goalEggs);
    this.drawSpots();

    for (const coral of this.corals) {
      coral.draw(this.renderer);
    }
    for (const tower of this.towers) {
      tower.draw(this.renderer);
    }
    for (const enemy of this.enemies) {
      enemy.draw(this.renderer);
    }
    for (const bullet of this.bulletPool.all) {
      bullet.draw(this.renderer);
    }
    // Particles on top of all game objects, below HUD
    for (const particle of this.particlePool.all) {
      particle.draw(this.renderer);
    }
    // Player marlin — drawn above gameplay layer, below HUD/overlays
    this.player.draw(this.renderer);
    if (this.attackCooldown > 0) {
      this.player.drawCooldown(this.renderer, 1 - this.attackCooldown / ATTACK_COOLDOWN);
    }

    // Egg placing overlay — player must choose a new goal location
    if (this.eggPlacingPhase) {
      this.drawEggPlacingOverlay();
    }

    // Spawn warning markers on active spawn cells (inter-wave only)
    this.drawSpawnMarkers();

    // Marlin-proximity preview — shown when no hold is in progress
    if (this.holdSpot === null) {
      this.drawProximityPreview();
      this.drawSpawnProximityPreview();
    }

    // Long-press preview — drawn above game objects, below HUD
    if (this.holdSpot !== null) {
      this.drawHoldPreview();
    }

    // Damage flash — drawn above game objects, below HUD text
    if (this.damageFlashTimer > 0) {
      this.drawDamageFlash();
    }

    this.drawHUD();

    if (this._isPaused && !this.gameOver && !this.waveManager.isGameClear) {
      this.drawPausedOverlay();
    }

    if (this.waveClearPhase && !this.gameOver && !this.waveManager.isGameClear) {
      this.drawWaveClearOverlay();
    }

    if (this.gameOver) {
      this.drawGameOver();
    } else if (this.waveManager.isGameClear) {
      this.drawGameClear();
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private spawnParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      this.particlePool.acquire().init(x, y, color);
    }
  }

  /**
   * Find the nearest active goal that still has eggs and redirect the enemy to it.
   * Uses A* from the enemy's current grid position; skips the enemy's current goal.
   */
  private redirectEnemyToNextGoal(enemy: Enemy): void {
    const startCell = this.mapGrid.pixelToGrid(enemy.pos);
    let bestWaypoints: Vector2D[] | null = null;
    let bestGoalIdx = -1;
    let bestLen = Infinity;

    for (const gi of this.activeGoalIndices) {
      if (gi === enemy.currentGoalIdx) continue; // skip the depleted goal
      if (this.goalEggs[gi] <= 0) continue;      // skip other empty goals
      const goalCell = { col: GOAL_COLS[gi], row: GOAL_ROW };
      const cells = findPath(
        startCell,
        goalCell,
        (c, r) => this.mapGrid.isPathTile(c, r),
      );
      if (cells && cells.length < bestLen) {
        bestLen = cells.length;
        bestWaypoints = cells.map(cell => this.mapGrid.tileCenter(cell.col, cell.row));
        bestGoalIdx = gi;
      }
    }

    if (bestWaypoints && bestGoalIdx >= 0) {
      enemy.setNewPath(bestWaypoints, bestGoalIdx);
    }
  }

  private pointerToCanvas(e: PointerEvent): Vector2D {
    const rect   = this.canvas.getBoundingClientRect();
    const scaleX = this.renderer.width  / rect.width;
    const scaleY = this.renderer.height / rect.height;
    return new Vector2D(
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top)  * scaleY,
    );
  }

  private pointerToTile(e: PointerEvent): { col: number; row: number } {
    return this.mapGrid.pixelToGrid(this.pointerToCanvas(e));
  }

  private clampToCanvas(v: Vector2D): Vector2D {
    const r = this.player.hitRadius * 0.6;
    const x = Math.max(r, Math.min(this.renderer.width  - r, v.x));
    const y = Math.max(r, Math.min(this.renderer.height - r, v.y));
    return new Vector2D(x, y);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.gameOver || this._isPaused || this.waveManager.isGameClear || this.waveClearPhase) return;

    const canvasPt = this.pointerToCanvas(e);

    // ── Egg placing phase: tap an inactive goal slot to activate it ──────────
    if (this.eggPlacingPhase) {
      const { col, row } = this.pointerToTile(e);
      for (let gi = 0; gi < GOAL_COLS.length; gi++) {
        if (this.activeGoalIndices.has(gi)) continue;
        if (row === GOAL_ROW && col === GOAL_COLS[gi]) {
          this.activeGoalIndices.add(gi);
          this.goalEggs[gi] = EGGS_PER_GOAL;
          this.eggPlacingPhase = false;
          break;
        }
      }
      return; // no building / dragging during egg placing
    }

    // ── Begin pointer interaction: tap-and-slide controls the marlin from
    //    anywhere; if the press lands inside a previewed build area, defer
    //    marlin movement and start a hold timer instead. Sliding past the
    //    cancel threshold (handled in pointermove) reverts to drag-only. ─────
    this.playerDragPointerId = e.pointerId;
    this.playerDragStart     = canvasPt.clone();
    this.canvas.setPointerCapture?.(e.pointerId);

    if (this.previewSpot && this.crackedEggs >= 1) {
      const center = this.mapGrid.spotCenter(this.previewSpot.col, this.previewSpot.row);
      const dx = Math.abs(canvasPt.x - center.x);
      const dy = Math.abs(canvasPt.y - center.y);
      if (dx <= BUILD_TAP_HALF && dy <= BUILD_TAP_HALF) {
        this.holdSpot  = this.previewSpot;
        this.holdTimer = 0;
        return; // marlin stays still while the user holds to build
      }
    }

    // No build hold — attack nearest enemy if wave is active and cooldown ready
    if (!this.waveManager.isInterWave && this.attackCooldown <= 0 && !this.isPlayerAttacking) {
      const target = this.findNearestEnemy();
      if (target) {
        this.startAttack(target);
        return;
      }
    }
    // Otherwise follow pointer
    this.player.setTarget(canvasPt.x, canvasPt.y);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.playerDragPointerId !== e.pointerId) return;
    const pt = this.clampToCanvas(this.pointerToCanvas(e));

    // Slide past the threshold cancels any in-progress build hold and lets
    // the marlin start following the pointer.
    if (this.holdSpot && this.playerDragStart) {
      const dx = pt.x - this.playerDragStart.x;
      const dy = pt.y - this.playerDragStart.y;
      if (dx * dx + dy * dy > DRAG_CANCEL_THRESHOLD * DRAG_CANCEL_THRESHOLD) {
        this.holdSpot  = null;
        this.holdTimer = 0;
      }
    }

    if (!this.holdSpot && !this.isPlayerAttacking) {
      this.player.setTarget(pt.x, pt.y);
    }
  };

  private handlePointerUp = (e?: PointerEvent): void => {
    if (e && this.playerDragPointerId === e.pointerId) {
      this.canvas.releasePointerCapture?.(e.pointerId);
      this.playerDragPointerId = null;
      this.playerDragStart     = null;
    }
    this.holdSpot  = null;
    this.holdTimer = 0;
  };

  private findNearestEnemy(): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.isActive) continue;
      const d = this.player.pos.distanceTo(enemy.pos);
      if (d < nearestDist) { nearestDist = d; nearest = enemy; }
    }
    return nearest;
  }

  private startAttack(target: Enemy): void {
    this.attackTarget      = target;
    this.isPlayerAttacking = true;
    this.player.setAttacking(true);
  }

  private endAttack(): void {
    this.isPlayerAttacking = false;
    this.player.setAttacking(false);
    this.attackCooldown = ATTACK_COOLDOWN;
    this.attackTarget   = null;
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

  private drawEggPlacingOverlay(): void {
    const ctx   = this.renderer.context;
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 280);

    // Highlight each inactive goal slot with a pulsing ring + faint egg
    for (let gi = 0; gi < GOAL_COLS.length; gi++) {
      if (this.activeGoalIndices.has(gi)) continue;
      const { x, y } = this.mapGrid.spotCenter(GOAL_COLS[gi], GOAL_ROW);

      // Pulsing ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 185, 55, ${pulse.toFixed(2)})`;
      ctx.lineWidth   = 3;
      ctx.stroke();
      ctx.restore();

      // Faint egg silhouette
      ctx.save();
      ctx.globalAlpha = 0.35;
      this.drawHudEggIcon(ctx, x, y, 9);
      ctx.restore();

      // "TAP" label
      ctx.save();
      ctx.fillStyle    = `rgba(255, 220, 100, ${pulse.toFixed(2)})`;
      ctx.font         = 'bold 10px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TAP', x, y);
      ctx.restore();
    }

    // Hint banner — just above the goal row
    const r       = this.renderer;
    const bannerY = r.height - 94; // sits above the bottom goal tiles
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.60)';
    ctx.fillRect(0, bannerY, r.width, 44);
    ctx.fillStyle    = '#ffbb33';
    ctx.font         = 'bold 13px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('次の卵の場所を選んでください', r.width / 2, bannerY + 22);
    ctx.restore();
  }

  private drawMiniShark(ctx: CanvasRenderingContext2D, x: number, y: number, kind: EnemyKind, sizeOverride?: number): void {
    const r         = sizeOverride ?? (kind === 'boss' ? 10 : kind === 'medium' ? 8 : 6);
    const bodyColor = kind === 'boss' ? '#e74c3c' : kind === 'medium' ? '#f4d03f' : '#5dade2';
    const finColor  = kind === 'boss' ? '#922b21' : kind === 'medium' ? '#b7950b' : '#2471a3';

    ctx.save();
    ctx.translate(x, y);

    // Tail fin
    ctx.beginPath();
    ctx.moveTo(-r * 0.95, 0);
    ctx.lineTo(-r * 1.6,  -r * 0.55);
    ctx.lineTo(-r * 1.3,   0);
    ctx.lineTo(-r * 1.6,   r * 0.55);
    ctx.closePath();
    ctx.fillStyle = finColor;
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.3, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.strokeStyle = finColor;
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Dorsal fin
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.71);
    ctx.lineTo( r * 0.35, -r * 0.71);
    ctx.lineTo( r * 0.12, -r * 1.40);
    ctx.closePath();
    ctx.fillStyle = finColor;
    ctx.fill();

    ctx.restore();
  }

  private drawHoldPreview(): void {
    if (!this.holdSpot) return;

    const ctx      = this.renderer.context;
    const center   = this.mapGrid.spotCenter(this.holdSpot.col, this.holdSpot.row);
    const progress = Math.min(this.holdTimer / HOLD_DURATION, 1);

    // Birthing egg animation — same transparency as the entity
    ctx.save();
    ctx.globalAlpha = 0.25 + progress * 0.30;
    this.drawBirthingEgg(ctx, center.x, center.y, progress);
    ctx.restore();

    // Entity floats up from the crack, semi-transparent
    const floatOffset = (1 - progress) * TILE_SIZE * 0.4;
    ctx.save();
    ctx.globalAlpha = 0.25 + progress * 0.30;
    ctx.translate(0, floatOffset);
    this.drawSpotEntity(this.holdSpot);
    ctx.restore();

    // Progress ring surrounding the birthing egg
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      center.x, center.y,
      26,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress,
    );
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  private drawBirthingEgg(ctx: CanvasRenderingContext2D, cx: number, cy: number, progress: number): void {
    const eggR        = 18;
    // Pivot below egg center — top of each half swings wider than bottom (kusudama effect)
    const pivotOffset = eggR * 0.65;
    const maxAngle    = progress * Math.PI * 0.42;

    ctx.save();

    // Glow grows with progress (unchanged)
    const glowAlpha = 0.30 + progress * 0.55;
    const glowR     = eggR * (0.5 + progress * 0.9);
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grd.addColorStop(0,   `rgba(255, 255, 200, ${glowAlpha.toFixed(2)})`);
    grd.addColorStop(0.5, `rgba(255, 220, 80,  ${(glowAlpha * 0.5).toFixed(2)})`);
    grd.addColorStop(1,   'rgba(255, 200, 50, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Left half — rotates counterclockwise around pivot below center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(-maxAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, eggR, Math.PI / 2, 3 * Math.PI / 2); // bottom→left→top arc
    ctx.closePath();
    ctx.fillStyle   = 'rgba(255, 185, 55, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.70)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();

    // Right half — rotates clockwise around pivot below center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(maxAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, eggR, -Math.PI / 2, Math.PI / 2); // top→right→bottom arc
    ctx.closePath();
    ctx.fillStyle   = 'rgba(255, 210, 90, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.70)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(eggR * 0.25, -eggR * 0.35, eggR * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.60)';
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  private drawSpots(): void {
    const r = this.renderer;
    for (const spot of this.mapGrid.allSpots) {
      if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
      // The marlin-revealed spot is rendered as a translucent preview instead
      if (this.previewSpot && spot.col === this.previewSpot.col && spot.row === this.previewSpot.row) continue;
      const center = this.mapGrid.spotCenter(spot.col, spot.row);
      const color  = 'rgba(255, 255, 255, 0.80)';
      r.drawCircle(center, 5, color);
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

  private drawDamageFlash(): void {
    const alpha = (this.damageFlashTimer / DAMAGE_FLASH_DURATION) * 0.4;
    const ctx = this.renderer.context;
    ctx.fillStyle = `rgba(231, 76, 60, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, this.renderer.width, this.renderer.height);
  }

  // ─── HUD ───────────────────────────────────────────────────────────────────

  private drawHUD(): void {
    const r   = this.renderer;
    const ctx = r.context;
    const CY  = 25; // vertical centre of 50px HUD bar

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, r.width, 50);

    // ── Regular egg HP: icon + ×N ────────────────────────────────────────────
    this.drawHudEggIcon(ctx, 18, CY, 9);
    r.drawText(`×${this.playerHp}`, new Vector2D(31, 30), '#ffbb33', 'bold 15px monospace');

    // ── Cracked egg resource: icon + ×N ──────────────────────────────────────
    this.drawHudCrackedEggIcon(ctx, 67, CY, 9);
    r.drawText(`×${this.crackedEggs}`, new Vector2D(80, 30), '#c8e88a', 'bold 15px monospace');

    // ── Wave counter: shark icon + N/5 ───────────────────────────────────────
    this.drawMiniShark(ctx, 120, CY, 'small', 6);
    r.drawText(
      `${this.waveManager.currentWave}/${this.waveManager.totalWaves}`,
      new Vector2D(133, 30), '#7ec8e3', 'bold 15px monospace',
    );

    // ── Center-right: total score (always visible) ───────────────────────────
    // HTML ボタンバーはCSS固定ピクセルだがキャンバスは画面幅にスケールされるため、
    // 余裕を持たせて右端から160px（canvas座標）に右揃えで配置する。
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'right';
    ctx.font         = 'bold 13px monospace';
    ctx.fillStyle    = '#f1c40f';
    ctx.fillText(`SCORE: ${this.totalScore}`, r.width - 160, CY);
    ctx.restore();
  }

  private drawHudCrackedEggIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const pivotOffset = r * 0.65;
    const openAngle   = Math.PI * 0.42;

    ctx.save();

    // Glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1);
    grd.addColorStop(0,   'rgba(255, 255, 200, 0.85)');
    grd.addColorStop(0.5, 'rgba(255, 220, 80,  0.50)');
    grd.addColorStop(1,   'rgba(255, 200, 50,  0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Left half — rotated counterclockwise around pivot below center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(-openAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI / 2, 3 * Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(255, 185, 55, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();

    // Right half — rotated clockwise around pivot below center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.translate(0, pivotOffset);
    ctx.rotate(openAngle);
    ctx.translate(0, -pivotOffset);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(255, 210, 90, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 0.25, -r * 0.35, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  private drawHudEggIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.save();

    // Egg body
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 185, 55, 0.92)';
    ctx.fill();

    // Translucent inner layer (depth)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 230, 130, 0.45)';
    ctx.fill();

    // Outline
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Specular highlight
    ctx.beginPath();
    ctx.arc(cx - r * 0.30, cy - r * 0.32, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
    ctx.fill();

    ctx.restore();
  }

  private drawPausedOverlay(): void {
    const r  = this.renderer;
    const cx = r.width  / 2;
    const cy = r.height / 2;

    // Dim the scene
    r.context.fillStyle = 'rgba(0,0,0,0.35)';
    r.context.fillRect(0, 0, r.width, r.height);

    // "PAUSED" label
    r.context.font      = 'bold 52px monospace';
    r.context.fillStyle = 'rgba(255,255,255,0.85)';
    r.context.textAlign = 'center';
    r.context.fillText('PAUSED', cx, cy + 18);
    r.context.textAlign = 'left';
  }

  private drawWaveClearOverlay(): void {
    const r   = this.renderer;
    const ctx = r.context;
    const cx  = r.width  / 2;
    const cy  = r.height / 2;

    ctx.fillStyle = 'rgba(0, 50, 20, 0.84)';
    ctx.fillRect(0, 0, r.width, r.height);

    ctx.font      = 'bold 52px monospace';
    ctx.fillStyle = '#2ecc71';
    ctx.textAlign = 'center';
    ctx.fillText('WAVE CLEAR!', cx, cy - 78);

    ctx.font      = '18px monospace';
    ctx.fillStyle = '#5dade2';
    ctx.fillText(`Wave ${this.waveManager.currentWave} Complete`, cx, cy - 48);

    if (this.lastWaveScoreDetails !== null) {
      const d = this.lastWaveScoreDetails;

      ctx.font      = '13px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('── Wave Score ──', cx, cy - 18);

      ctx.font      = '15px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`Enemies:    +${d.enemyScore}`, cx, cy + 6);
      ctx.fillText(`Eggs:       +${d.eggScore}`,   cx, cy + 26);
      ctx.fillText(`Time bonus: +${d.timeBonus}`,  cx, cy + 46);

      ctx.font      = '13px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('────────────────────', cx, cy + 62);

      ctx.font      = 'bold 16px monospace';
      ctx.fillStyle = '#f1c40f';
      ctx.fillText(`Wave Total: +${d.total}`, cx, cy + 82);

      // Cracked eggs earned
      this.drawHudCrackedEggIcon(ctx, cx - 52, cy + 106, 8);
      ctx.font      = '15px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`+${d.crackedEggsEarned}  GET!`, cx + 8, cy + 106);
    }

    ctx.font      = '12px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('Tap NEXT WAVE to continue', cx, cy + 136);

    ctx.textAlign = 'left';
  }

  private drawGameClear(): void {
    const r   = this.renderer;
    const ctx = r.context;
    const cx  = r.width  / 2;
    const cy  = r.height / 2;

    ctx.fillStyle = 'rgba(0, 40, 80, 0.80)';
    ctx.fillRect(0, 0, r.width, r.height);

    ctx.font      = 'bold 72px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.textAlign = 'center';
    ctx.fillText('CLEAR!', cx, cy - 65);

    ctx.font      = '22px monospace';
    ctx.fillStyle = '#5dade2';
    ctx.fillText('All sharks defeated!', cx, cy - 20);

    if (this.lastWaveScoreDetails !== null) {
      const d = this.lastWaveScoreDetails;
      ctx.font      = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('── Last Wave Score ──', cx, cy + 15);

      ctx.font      = '16px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`Enemies:     +${d.enemyScore}`, cx, cy + 40);
      ctx.fillText(`Eggs:        +${d.eggScore}`, cx, cy + 62);
      ctx.fillText(`Time bonus:  +${d.timeBonus}`, cx, cy + 84);

      ctx.font      = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('──────────────────────', cx, cy + 100);
    }

    ctx.font      = 'bold 20px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`FINAL SCORE: ${this.totalScore}`, cx, cy + 122);

    ctx.font      = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('Tap ↩ Restart to play again', cx, cy + 152);

    ctx.textAlign = 'left';
  }

  // ─── Spawn markers & proximity preview ────────────────────────────────────

  /** Red warning triangles on every spawn cell that has enemies in the next wave. */
  private drawSpawnMarkers(): void {
    if (!this.waveManager.isInterWave) return;
    if (this.eggPlacingPhase || this.waveClearPhase || this.gameOver || this.waveManager.isGameClear) return;
    if (this.waveManager.nextWaveEnemies.length === 0) return;

    const ctx    = this.renderer.context;
    const cells  = this.mapGrid.spawnCells;
    const pulse  = 0.55 + 0.45 * Math.sin(Date.now() / 320);

    for (let i = 0; i < cells.length; i++) {
      if (this.waveManager.nextWaveEnemiesBySpawn(i).length === 0) continue;
      const { x, y } = this.mapGrid.tileCenter(cells[i].col, cells[i].row);
      const r = 13;

      ctx.save();
      ctx.globalAlpha = 0.55 + 0.35 * pulse;

      // Triangle (apex up)
      ctx.beginPath();
      ctx.moveTo(x,            y - r);
      ctx.lineTo(x + r * 0.87, y + r * 0.5);
      ctx.lineTo(x - r * 0.87, y + r * 0.5);
      ctx.closePath();
      ctx.fillStyle   = '#e74c3c';
      ctx.fill();
      ctx.strokeStyle = '#922b21';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // "!" label
      ctx.globalAlpha    = 1;
      ctx.fillStyle      = '#ffffff';
      ctx.font           = `bold ${r}px monospace`;
      ctx.textAlign      = 'center';
      ctx.textBaseline   = 'middle';
      ctx.fillText('!', x, y + r * 0.1);

      ctx.restore();
    }
  }

  /** Pill popup below a spawn cell when the marlin is close enough. */
  private drawSpawnProximityPreview(): void {
    if (this.previewSpawn === null) return;
    const cells   = this.mapGrid.spawnCells;
    const cell    = cells[this.previewSpawn];
    if (!cell) return;
    const enemies = this.waveManager.nextWaveEnemiesBySpawn(this.previewSpawn);
    if (enemies.length === 0) return;

    const ctx    = this.renderer.context;
    const center = this.mapGrid.tileCenter(cell.col, cell.row);

    const ROW_H  = 22;
    const PAD_X  = 12;
    const PAD_Y  = 8;
    const SHARK_R = 7;
    const TEXT_GAP = 4;
    const countWidth = (count: number) => (count >= 10 ? 22 : 16);

    // Measure pill width from widest row
    const rowWidth = () => SHARK_R * 2 + TEXT_GAP + 18; // fixed min
    const pillW  = Math.max(...enemies.map(() => rowWidth())) + PAD_X * 2 + 8;
    const pillH  = enemies.length * ROW_H + PAD_Y * 2;
    const pillX  = center.x - pillW / 2;
    const pillY  = center.y + TILE_SIZE * 0.5 + 4; // below spawn cell
    const pillR  = 8;

    ctx.save();
    ctx.globalAlpha = 0.88;

    // Rounded rectangle background
    ctx.beginPath();
    ctx.moveTo(pillX + pillR, pillY);
    ctx.lineTo(pillX + pillW - pillR, pillY);
    ctx.quadraticCurveTo(pillX + pillW, pillY,          pillX + pillW, pillY + pillR);
    ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
    ctx.quadraticCurveTo(pillX + pillW, pillY + pillH,  pillX + pillW - pillR, pillY + pillH);
    ctx.lineTo(pillX + pillR, pillY + pillH);
    ctx.quadraticCurveTo(pillX, pillY + pillH,          pillX, pillY + pillH - pillR);
    ctx.lineTo(pillX, pillY + pillR);
    ctx.quadraticCurveTo(pillX, pillY,                  pillX + pillR, pillY);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(10, 20, 50, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.60)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Draw each enemy row
    for (let idx = 0; idx < enemies.length; idx++) {
      const { kind, count } = enemies[idx];
      const rowY = pillY + PAD_Y + idx * ROW_H + ROW_H / 2;
      const sharkX = pillX + PAD_X + SHARK_R;
      ctx.globalAlpha = 1;
      this.drawMiniShark(ctx, sharkX, rowY, kind, SHARK_R);

      const tw = countWidth(count);
      const textX = sharkX + SHARK_R + TEXT_GAP + tw / 2 + 4;
      ctx.fillStyle      = '#eeeeee';
      ctx.font           = 'bold 13px monospace';
      ctx.textAlign      = 'center';
      ctx.textBaseline   = 'middle';
      ctx.fillText(`×${count}`, textX, rowY);
    }

    ctx.restore();
  }

  private drawGameOver(): void {
    const r   = this.renderer;
    const ctx = r.context;
    const cx  = r.width  / 2;
    const cy  = r.height / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, r.width, r.height);

    ctx.font      = 'bold 64px monospace';
    ctx.fillStyle = '#e74c3c';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', cx, cy - 65);

    ctx.font      = '20px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(
      `Wave ${this.waveManager.currentWave} / ${this.waveManager.totalWaves}   Towers: ${this.towers.length}`,
      cx, cy - 20,
    );

    if (this.lastWaveScoreDetails !== null) {
      const d = this.lastWaveScoreDetails;
      ctx.font      = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('── Last Wave Score ──', cx, cy + 15);

      ctx.font      = '16px monospace';
      ctx.fillStyle = '#c8e88a';
      ctx.fillText(`Enemies:     +${d.enemyScore}`, cx, cy + 40);
      ctx.fillText(`Eggs:        +${d.eggScore}`, cx, cy + 62);
      ctx.fillText(`Time bonus:  +${d.timeBonus}`, cx, cy + 84);

      ctx.font      = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('──────────────────────', cx, cy + 100);
    }

    ctx.font      = 'bold 18px monospace';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`FINAL SCORE: ${this.totalScore}`, cx, cy + 122);

    ctx.font      = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('Tap ↩ Restart to play again', cx, cy + 152);

    ctx.textAlign = 'left';
  }

  private calculateTimeBonus(waveNumber: number, elapsedMs: number): number {
    const sec     = elapsedMs / 1000;
    const targets = [45, 60, 90, 120, 150]; // fast-clear thresholds per wave (seconds)
    const target  = targets[Math.min(waveNumber - 1, targets.length - 1)];
    if (sec <= target)      return 500;
    if (sec <= target * 2)  return 200;
    return 0;
  }
}
