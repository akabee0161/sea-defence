import { WAVE_DEFS } from '../defs/waveDefs.ts';
import type { EnemyKind } from '../entities/Enemy.ts';

export type { SpawnEntry, WaveDef } from '../defs/waveDefs.ts';

/** Called each time an enemy should spawn; receives kind and origin spawn-cell index. */
export type SpawnCallback = (kind: EnemyKind, spawnIdx: number) => void;

/** Called when all enemies of a wave are cleared; receives the completed wave number. */
export type WaveClearCallback = (waveNumber: number) => void;

const SPAWN_INTERVAL = 1.5; // default seconds between spawns

export const TOTAL_WAVES = WAVE_DEFS.length;

export class WaveManager {
  private waveNumber = 0;
  private queueIndex = 0;
  private spawnTimer = 0;
  private phase: 'interval' | 'wave' | 'clear' = 'interval';
  private allEnemiesSpawnedTimestamp: number | null = null;

  private readonly onSpawn: SpawnCallback;
  private readonly onWaveClear: WaveClearCallback | null;

  constructor(
    onSpawn: SpawnCallback,
    onWaveClear: WaveClearCallback | null = null,
  ) {
    this.onSpawn = onSpawn;
    this.onWaveClear = onWaveClear;
  }

  /**
   * Advance the wave state machine.
   * @param deltaTime        seconds since last tick
   * @param activeEnemyCount number of enemies currently alive on the map
   */
  update(deltaTime: number, activeEnemyCount: number): void {
    if (this.phase === 'clear') return;
    if (this.phase === 'interval') return;

    const spawns = WAVE_DEFS[this.waveNumber - 1].spawns;
    if (this.queueIndex < spawns.length) {
      this.spawnTimer -= deltaTime;
      if (this.spawnTimer <= 0) {
        const entry = spawns[this.queueIndex];
        const nextDelay =
          this.queueIndex + 1 < spawns.length
            ? (spawns[this.queueIndex + 1].delay ?? SPAWN_INTERVAL)
            : SPAWN_INTERVAL;
        this.spawnTimer = nextDelay;
        this.onSpawn(entry.enemyId, entry.spawnIdx);
        this.queueIndex++;
      }
    } else {
      if (this.allEnemiesSpawnedTimestamp === null) {
        this.allEnemiesSpawnedTimestamp = performance.now();
      }
      if (activeEnemyCount === 0) {
        this.onWaveClear?.(this.waveNumber);
        if (this.waveNumber >= TOTAL_WAVES) {
          this.phase = 'clear';
        } else {
          this.phase = 'interval';
        }
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
    this.queueIndex = 0;
    this.spawnTimer = 0;
    this.phase = 'wave';
  }

  getAllEnemiesSpawnedTimestamp(): number | null {
    return this.allEnemiesSpawnedTimestamp;
  }

  // ── Public queries ─────────────────────────────────────────────────────────

  get currentWave(): number {
    return this.waveNumber;
  }
  get totalWaves(): number {
    return TOTAL_WAVES;
  }
  get isInterWave(): boolean {
    return this.phase === 'interval';
  }
  get isGameClear(): boolean {
    return this.phase === 'clear';
  }

  /** Aggregated enemy composition of the upcoming wave (empty if no more waves). */
  get nextWaveEnemies(): { kind: EnemyKind; count: number }[] {
    const next = this.waveNumber + 1;
    if (next > TOTAL_WAVES) return [];
    const counts = new Map<EnemyKind, number>();
    for (const s of WAVE_DEFS[next - 1].spawns) {
      counts.set(s.enemyId, (counts.get(s.enemyId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  }

  /** Per-spawn-cell enemy composition of the upcoming wave. */
  nextWaveEnemiesBySpawn(
    spawnIdx: number,
  ): { kind: EnemyKind; count: number }[] {
    const next = this.waveNumber + 1;
    if (next > TOTAL_WAVES) return [];
    const counts = new Map<EnemyKind, number>();
    for (const s of WAVE_DEFS[next - 1].spawns) {
      if (s.spawnIdx !== spawnIdx) continue;
      counts.set(s.enemyId, (counts.get(s.enemyId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  }

  get waveProgress(): number {
    const spawns =
      this.waveNumber >= 1 ? WAVE_DEFS[this.waveNumber - 1].spawns.length : 0;
    if (spawns === 0) return 0;
    return this.queueIndex / spawns;
  }

  reset(): void {
    this.waveNumber = 0;
    this.queueIndex = 0;
    this.spawnTimer = 0;
    this.phase = 'interval';
    this.allEnemiesSpawnedTimestamp = null;
  }
}
