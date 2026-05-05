import { EnemyKind } from '../entities/Enemy.ts';

/** Called each time an enemy should spawn; receives the enemy kind. */
export type SpawnCallback = (kind: EnemyKind) => void;

/** Called when all enemies of a wave are cleared; receives the completed wave number. */
export type WaveClearCallback = (waveNumber: number) => void;

type EnemySpec = { kind: EnemyKind; count: number };

// Fixed 5-wave progression for a kids-friendly game
const WAVE_DEFS: { enemies: EnemySpec[] }[] = [
  { enemies: [{ kind: 'small', count: 10 }] },
  { enemies: [{ kind: 'small', count: 10 }, { kind: 'medium', count: 4 }] },
  { enemies: [{ kind: 'small', count: 6  }, { kind: 'medium', count: 10 }] },
  { enemies: [{ kind: 'medium', count: 12 }] },
  { enemies: [{ kind: 'small', count: 6  }, { kind: 'medium', count: 4 }, { kind: 'boss', count: 2 }] },
];

export const TOTAL_WAVES = WAVE_DEFS.length; // 5

const SPAWN_INTERVAL = 1.5; // seconds between spawns within a wave

export class WaveManager {
  private waveNumber  = 0;
  private spawnQueue: EnemyKind[] = [];
  private queueIndex  = 0;
  private spawnTimer  = 0;
  private phase: 'interval' | 'wave' | 'clear' = 'interval';

  private readonly onSpawn:     SpawnCallback;
  private readonly onWaveClear: WaveClearCallback | null;

  constructor(
    onSpawn: SpawnCallback,
    onWaveClear: WaveClearCallback | null = null,
  ) {
    this.onSpawn     = onSpawn;
    this.onWaveClear = onWaveClear;
  }

  /**
   * Advance the wave state machine.
   * @param deltaTime        seconds since last tick
   * @param activeEnemyCount number of enemies currently alive on the map
   */
  update(deltaTime: number, activeEnemyCount: number): void {
    if (this.phase === 'clear') return;

    // 'interval' phase: wait for the player to press Start — do nothing
    if (this.phase === 'interval') return;

    // phase === 'wave'
    if (this.queueIndex < this.spawnQueue.length) {
      this.spawnTimer -= deltaTime;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = SPAWN_INTERVAL;
        this.onSpawn(this.spawnQueue[this.queueIndex]);
        this.queueIndex++;
      }
    } else if (activeEnemyCount === 0) {
      // All spawned and cleared
      this.onWaveClear?.(this.waveNumber);
      if (this.waveNumber >= TOTAL_WAVES) {
        this.phase = 'clear';
      } else {
        this.phase = 'interval'; // wait for player to start next wave
      }
    }
  }

  /** Called by the player (via UI button) to begin the next wave. */
  startWave(): void {
    if (this.phase !== 'interval') return;
    this.beginNextWave();
  }

  private beginNextWave(): void {
    this.waveNumber++;
    const def = WAVE_DEFS[this.waveNumber - 1];
    this.spawnQueue = def.enemies.flatMap(spec =>
      Array.from({ length: spec.count }, () => spec.kind),
    );
    this.queueIndex = 0;
    this.spawnTimer = 0; // spawn first enemy immediately
    this.phase      = 'wave';
  }

  // ── Public queries ─────────────────────────────────────────────────────────

  /** Current wave number (0 = not started yet). */
  get currentWave(): number { return this.waveNumber; }

  /** Total number of waves in this game. */
  get totalWaves(): number { return TOTAL_WAVES; }

  /** True while waiting for the player to press Start (between waves or at game start). */
  get isInterWave(): boolean { return this.phase === 'interval'; }

  /** True when all 5 waves have been cleared — game complete. */
  get isGameClear(): boolean { return this.phase === 'clear'; }

  /** Enemy composition of the upcoming wave (empty if no more waves). */
  get nextWaveEnemies(): { kind: EnemyKind; count: number }[] {
    const next = this.waveNumber + 1;
    if (next > TOTAL_WAVES) return [];
    return WAVE_DEFS[next - 1].enemies.map(s => ({ kind: s.kind, count: s.count }));
  }

  /** Progress through the current wave's spawning (0–1). */
  get waveProgress(): number {
    if (this.spawnQueue.length === 0) return 0;
    return this.queueIndex / this.spawnQueue.length;
  }

  /** Restore all state to pre-game initial values. */
  reset(): void {
    this.waveNumber = 0;
    this.spawnQueue = [];
    this.queueIndex = 0;
    this.spawnTimer = 0;
    this.phase      = 'interval';
  }
}
