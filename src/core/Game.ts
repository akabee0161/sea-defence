import { Renderer } from './Renderer.ts';
import { WaveManager } from './WaveManager.ts';
import { MapGrid, PlacementSpot, GOAL_COLS, GOAL_ROW, INITIAL_GOAL_IDX, TILE_SIZE } from '../level/MapGrid.ts';
import { CoralWall, CORAL_COST } from '../entities/CoralWall.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import { Enemy, EnemyKind } from '../entities/Enemy.ts';
import { Tower, createTower, towerCost } from '../entities/Tower.ts';
import { Bullet } from '../entities/Bullet.ts';
import { Particle } from '../entities/Particle.ts';
import { Player } from '../entities/Player.ts';
import { ObjectPool } from '../utils/ObjectPool.ts';

const FIXED_TIMESTEP  = 1000 / 60;           // ms — 60 Hz logic tick
const MAX_ACCUMULATED = FIXED_TIMESTEP * 5;  // spiral-of-death guard

const EGGS_PER_GOAL        = 3; // eggs at each goal (HP per goal)
const INITIAL_CRACKED_EGGS = 3; // building resource at game start

const DAMAGE_FLASH_DURATION = 0.4; // seconds — red screen flash on HP loss
const HOLD_DURATION         = 2.0; // seconds to hold pointer before placing
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

  // Player marlin — purely cosmetic for now (no gameplay effect)
  private readonly player: Player;
  private readonly playerHome: Vector2D;
  private playerDragPointerId: number | null = null;
  private playerDragStart: Vector2D | null = null;

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
  private eggPlacingPhase = false; // true after wave clear, until player places egg
  private gameOver        = false;


  // Lifecycle controls
  private _isPaused = false;

  // Long-press placement state
  private holdSpot:  PlacementSpot | null = null;
  private holdTimer  = 0;

  // Spot revealed by marlin proximity (nearest unoccupied spot within range)
  private previewSpot: PlacementSpot | null = null;

  // Visual feedback
  private damageFlashTimer = 0; // counts down from DAMAGE_FLASH_DURATION after HP loss

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
      (kind: EnemyKind) => {
        const activeArr = [...this.activeGoalIndices];
        const pathIdx   = activeArr[Math.floor(Math.random() * activeArr.length)];
        this.enemies.push(new Enemy(this.mapGrid.paths[pathIdx], kind));
      },
      () => {
        // Remaining eggs → cracked eggs (building resource)
        this.crackedEggs += this.playerHp;
        // Refill all active goals to EGGS_PER_GOAL for the next wave
        for (const gi of this.activeGoalIndices) {
          this.goalEggs[gi] = EGGS_PER_GOAL;
        }
        if (!this.waveManager.isGameClear) {
          this.eggPlacingPhase = true; // player must place next egg before building
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
    this.gameOver          = false;
    this._isPaused        = false;
    this.accumulated      = 0;
    this.damageFlashTimer = 0;
    this.holdSpot         = null;
    this.holdTimer        = 0;
    this.previewSpot      = null;

    this.enemies = [];
    this.towers  = [];
    this.corals  = [];
    this.occupiedSpots.clear();
    this.bulletPool.releaseAll();
    this.particlePool.releaseAll();
    this.waveManager.reset();
    this.player.resetTo(this.playerHome.x, this.playerHome.y);
    this.playerDragPointerId = null;
    this.playerDragStart     = null;
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  /** Called by the Start Wave button in the UI. */
  startNextWave(): void { this.waveManager.startWave(); }

  get currentWave(): number  { return this.waveManager.currentWave; }
  get totalWaves(): number   { return this.waveManager.totalWaves; }
  get isInterWave(): boolean { return this.waveManager.isInterWave; }
  get isGameClear(): boolean { return this.waveManager.isGameClear; }
  get isPaused(): boolean      { return this._isPaused; }
  get isEggPlacing(): boolean  { return this.eggPlacingPhase; }

  // ── Main loop ───────────────────────────────────────────────────────────────

  // Arrow function keeps `this` bound across rAF callbacks
  private loop = (timestamp: number): void => {
    if (!this.running) return;

    const elapsed = Math.min(timestamp - this.lastTimestamp, MAX_ACCUMULATED);
    this.lastTimestamp = timestamp;

    // Advance simulation only when not paused, game-over, or cleared
    if (!this.gameOver && !this._isPaused && !this.waveManager.isGameClear) {
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

    // 7. Penalise player for enemies that reached a goal (eat one egg there)
    let hpLost = 0;
    for (const enemy of this.enemies) {
      if (!enemy.isActive && enemy.hasReachedExit) {
        const exitCol = Math.round((enemy.pos.x - TILE_SIZE / 2) / TILE_SIZE);
        const gi      = GOAL_COLS.indexOf(exitCol);
        if (gi >= 0 && this.goalEggs[gi] > 0) {
          this.goalEggs[gi]--;
          hpLost++;
        }
      }
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

    // 9. Player marlin — purely cosmetic, follows pointer drag
    this.player.update(deltaTime);

    // 10. Refresh nearest-spot preview based on the marlin's position
    this.updatePreviewSpot();
  }

  private updatePreviewSpot(): void {
    if (this.eggPlacingPhase || this.crackedEggs < 1) {
      this.previewSpot = null;
      return;
    }
    let best: PlacementSpot | null = null;
    let bestDist = PLAYER_PREVIEW_RADIUS;
    for (const spot of this.mapGrid.allSpots) {
      if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
      const center = this.mapGrid.spotCenter(spot.col, spot.row);
      const d = this.player.pos.distanceTo(center);
      if (d < bestDist) {
        best = spot;
        bestDist = d;
      }
    }
    this.previewSpot = best;
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

    // Egg placing overlay — player must choose a new goal location
    if (this.eggPlacingPhase) {
      this.drawEggPlacingOverlay();
    }

    // Marlin-proximity preview — shown when no hold is in progress
    if (this.holdSpot === null) {
      this.drawProximityPreview();
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
    if (this.gameOver || this._isPaused || this.waveManager.isGameClear) return;

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

    // No build hold — start following the pointer immediately
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

    if (!this.holdSpot) {
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

  private placeAtSpot(spot: PlacementSpot): void {
    const key = `${spot.col},${spot.row}`;
    if (this.occupiedSpots.has(key)) return;

    if (this.crackedEggs < 1) return;
    this.crackedEggs -= 1;
    if (spot.kind === 'tower') {
      this.towers.push(createTower(spot.col, spot.row));
    } else {
      this.corals.push(new CoralWall(spot.col, spot.row));
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

    // Semi-transparent entity preview
    ctx.save();
    ctx.globalAlpha = 0.40;
    if (this.holdSpot.kind === 'tower') {
      createTower(this.holdSpot.col, this.holdSpot.row).draw(this.renderer);
    } else {
      new CoralWall(this.holdSpot.col, this.holdSpot.row).draw(this.renderer);
    }
    ctx.restore();

    // Progress ring — white arc from top, fills clockwise
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      center.x, center.y,
      22,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress,
    );
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();

    // Gold cost indicator just above the spot
    this.drawBuildCostIndicator(center.x, center.y);
  }

  private drawBuildCostIndicator(spotX: number, spotY: number): void {
    if (!this.holdSpot) return;
    const cost   = this.holdSpot.kind === 'tower' ? towerCost() : CORAL_COST;
    const ctx    = this.renderer.context;

    const COIN_R = 9;
    const GAP    = 5;
    const STEP   = COIN_R * 2 + GAP;
    const totalW = cost * STEP - GAP;
    const startX = spotX - totalW / 2 + COIN_R;
    // Place pill above the progress ring (ring radius = 22) with 8px gap
    const coinY  = spotY - 22 - 8 - COIN_R;
    const PAD_H  = 9;
    const PAD_W  = 16;
    const pillX  = startX - COIN_R - PAD_W;
    const pillY  = coinY - COIN_R - PAD_H;
    const pillW  = totalW + PAD_W * 2;
    const pillH  = COIN_R * 2 + PAD_H * 2;
    const pillR  = pillH / 2;

    ctx.save();

    // Pill background (manual rounded rect for compatibility)
    ctx.beginPath();
    ctx.moveTo(pillX + pillR, pillY);
    ctx.lineTo(pillX + pillW - pillR, pillY);
    ctx.quadraticCurveTo(pillX + pillW, pillY,        pillX + pillW, pillY + pillR);
    ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
    ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
    ctx.lineTo(pillX + pillR, pillY + pillH);
    ctx.quadraticCurveTo(pillX, pillY + pillH,         pillX, pillY + pillH - pillR);
    ctx.lineTo(pillX, pillY + pillR);
    ctx.quadraticCurveTo(pillX, pillY,                 pillX + pillR, pillY);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(0, 0, 0, 0.68)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 185, 55, 0.55)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Cracked egg icon — cost is always 1 cracked egg
    this.drawHudCrackedEggIcon(ctx, startX, coinY, COIN_R);

    ctx.restore();
  }

  private drawSpots(): void {
    const r = this.renderer;
    for (const spot of this.mapGrid.allSpots) {
      if (this.occupiedSpots.has(`${spot.col},${spot.row}`)) continue;
      // The marlin-revealed spot is rendered as a translucent preview instead
      if (this.previewSpot && spot.col === this.previewSpot.col && spot.row === this.previewSpot.row) continue;
      const center = this.mapGrid.spotCenter(spot.col, spot.row);
      const color  = spot.kind === 'tower'
        ? 'rgba(255, 255, 255, 0.80)'
        : 'rgba(255, 140, 100, 0.90)'; // coral-coloured dot for coral spots
      r.drawCircle(center, 5, color);
    }
  }

  private drawProximityPreview(): void {
    if (!this.previewSpot) return;
    const ctx = this.renderer.context;
    ctx.save();
    ctx.globalAlpha = PREVIEW_ALPHA;
    if (this.previewSpot.kind === 'tower') {
      createTower(this.previewSpot.col, this.previewSpot.row).draw(this.renderer);
    } else {
      new CoralWall(this.previewSpot.col, this.previewSpot.row).draw(this.renderer);
    }
    ctx.restore();
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

    // ── Next-wave enemy preview (inline, always visible when data exists) ────
    const nextEnemies = this.waveManager.nextWaveEnemies;
    if (nextEnemies.length > 0) {
      // Vertical separator
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(162, 9);
      ctx.lineTo(162, 41);
      ctx.stroke();
      ctx.restore();

      // Enemy icons + ×count, left-to-right
      let ex = 168;
      for (const { kind, count } of nextEnemies) {
        const SR = 6;
        this.drawMiniShark(ctx, ex + SR, CY, kind, SR);
        ex += SR * 2 + 4;

        ctx.save();
        ctx.fillStyle    = '#eeeeee';
        ctx.font         = 'bold 12px monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`×${count}`, ex, CY);
        ctx.restore();

        ex += (count >= 10 ? 28 : 20) + 8;
      }
    }
  }

  private drawHudCrackedEggIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    this.drawHudEggIcon(ctx, cx, cy, r);
    // Crack line overlay
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth   = Math.max(1, r * 0.14);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.15, cy - r * 0.80);
    ctx.lineTo(cx + r * 0.10, cy - r * 0.20);
    ctx.lineTo(cx - r * 0.10, cy + r * 0.20);
    ctx.lineTo(cx + r * 0.15, cy + r * 0.80);
    ctx.stroke();
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

  private drawGameClear(): void {
    const r  = this.renderer;
    const cx = r.width  / 2;
    const cy = r.height / 2;

    r.context.fillStyle = 'rgba(0, 40, 80, 0.80)';
    r.context.fillRect(0, 0, r.width, r.height);

    r.context.font      = 'bold 72px monospace';
    r.context.fillStyle = '#f1c40f';
    r.context.textAlign = 'center';
    r.context.fillText('CLEAR!', cx, cy - 10);

    r.context.font      = '22px monospace';
    r.context.fillStyle = '#5dade2';
    r.context.fillText('All sharks defeated!', cx, cy + 36);

    r.context.font      = '16px monospace';
    r.context.fillStyle = 'rgba(255,255,255,0.5)';
    r.context.fillText(`Towers: ${this.towers.length}`, cx, cy + 70);

    r.context.font      = '14px monospace';
    r.context.fillStyle = 'rgba(255,255,255,0.35)';
    r.context.fillText('Tap ↩ Restart to play again', cx, cy + 106);

    r.context.textAlign = 'left';
  }

  private drawGameOver(): void {
    const r  = this.renderer;
    const cx = r.width  / 2;
    const cy = r.height / 2;

    // Dark overlay
    r.context.fillStyle = 'rgba(0, 0, 0, 0.72)';
    r.context.fillRect(0, 0, r.width, r.height);

    // "GAME OVER" text
    r.context.font      = 'bold 64px monospace';
    r.context.fillStyle = '#e74c3c';
    r.context.textAlign = 'center';
    r.context.fillText('GAME OVER', cx, cy - 10);

    // Sub-text
    r.context.font      = '20px monospace';
    r.context.fillStyle = 'rgba(255,255,255,0.6)';
    r.context.fillText(
      `Wave ${this.waveManager.currentWave}   Towers: ${this.towers.length}`,
      cx,
      cy + 36,
    );

    // Restart hint
    r.context.font      = '14px monospace';
    r.context.fillStyle = 'rgba(255,255,255,0.35)';
    r.context.fillText('Tap ↩ Restart to play again', cx, cy + 72);

    // Reset textAlign (Renderer assumes left-aligned)
    r.context.textAlign = 'left';
  }
}
