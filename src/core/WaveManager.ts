import { EnemyKind } from '../entities/Enemy.ts';

/** Called each time an enemy should spawn; receives kind and origin spawn-cell index. */
export type SpawnCallback = (kind: EnemyKind, spawnIdx: number) => void;

/** Called when all enemies of a wave are cleared; receives the completed wave number. */
export type WaveClearCallback = (waveNumber: number) => void;

export type SpawnEntry = { kind: EnemyKind; spawnIdx: number; delay?: number };

const SPAWN_INTERVAL = 1.5; // default seconds between spawns

// Fixed 5-wave progression.
// spawnIdx → spawn cell: 0=(0,0) 1=(7,0) 2=(1,0) 3=(5,0) 4=(3,0)
const WAVE_DEFS: { spawns: SpawnEntry[] }[] = [
  // Wave 1 — path 0 only (initial unlock), 10 small
  { spawns: [
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
    { kind: 'small', spawnIdx: 0 },
  ]},
  // Wave 2 — small ×10 (spawnIdx 0), medium ×4 (spawnIdx 1)
  { spawns: [
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 0 },
  ]},
  // Wave 3 — small ×6 (spawnIdx 0,2), medium ×10 (spawnIdx 0,1,2)
  { spawns: [
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 2 },
    { kind: 'small',  spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 2 },
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'medium', spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 2 },
  ]},
  // Wave 4 — medium ×12, spawnIdx round-robin 0–3
  { spawns: [
    { kind: 'medium', spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'medium', spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 3 },
    { kind: 'medium', spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'medium', spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 3 },
    { kind: 'medium', spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'medium', spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 3 },
  ]},
  // Wave 5 — small ×6, medium ×4, boss ×2; bosses on spawnIdx 0
  { spawns: [
    { kind: 'small',  spawnIdx: 0 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 3 },
    { kind: 'boss',   spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 4 },
    { kind: 'medium', spawnIdx: 1 },
    { kind: 'small',  spawnIdx: 2 },
    { kind: 'medium', spawnIdx: 3 },
    { kind: 'boss',   spawnIdx: 0 },
    { kind: 'small',  spawnIdx: 4 },
    { kind: 'small',  spawnIdx: 2 },
  ]},
];

export const TOTAL_WAVES = WAVE_DEFS.length; // 5

export class WaveManager {
  private waveNumber = 0;
  private queueIndex = 0;
  private spawnTimer = 0;
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
    if (this.phase === 'interval') return;

    // phase === 'wave'
    const spawns = WAVE_DEFS[this.waveNumber - 1].spawns;
    if (this.queueIndex < spawns.length) {
      this.spawnTimer -= deltaTime;
      if (this.spawnTimer <= 0) {
        const entry = spawns[this.queueIndex];
        // Delay for the *next* entry; first spawn uses 0 (already handled at wave start).
        const nextDelay = this.queueIndex + 1 < spawns.length
          ? (spawns[this.queueIndex + 1].delay ?? SPAWN_INTERVAL)
          : SPAWN_INTERVAL;
        this.spawnTimer = nextDelay;
        this.onSpawn(entry.kind, entry.spawnIdx);
        this.queueIndex++;
      }
    } else if (activeEnemyCount === 0) {
      this.onWaveClear?.(this.waveNumber);
      if (this.waveNumber >= TOTAL_WAVES) {
        this.phase = 'clear';
      } else {
        this.phase = 'interval';
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
    this.spawnTimer = 0; // first enemy spawns immediately
    this.phase      = 'wave';
  }

  // ── Public queries ─────────────────────────────────────────────────────────

  get currentWave(): number  { return this.waveNumber; }
  get totalWaves():  number  { return TOTAL_WAVES; }
  get isInterWave(): boolean { return this.phase === 'interval'; }
  get isGameClear(): boolean { return this.phase === 'clear'; }

  /** Aggregated enemy composition of the upcoming wave (empty if no more waves). */
  get nextWaveEnemies(): { kind: EnemyKind; count: number }[] {
    const next = this.waveNumber + 1;
    if (next > TOTAL_WAVES) return [];
    const counts = new Map<EnemyKind, number>();
    for (const s of WAVE_DEFS[next - 1].spawns) {
      counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  }

  /** Per-spawn-cell enemy composition of the upcoming wave. */
  nextWaveEnemiesBySpawn(spawnIdx: number): { kind: EnemyKind; count: number }[] {
    const next = this.waveNumber + 1;
    if (next > TOTAL_WAVES) return [];
    const counts = new Map<EnemyKind, number>();
    for (const s of WAVE_DEFS[next - 1].spawns) {
      if (s.spawnIdx !== spawnIdx) continue;
      counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  }

  get waveProgress(): number {
    const spawns = this.waveNumber >= 1
      ? WAVE_DEFS[this.waveNumber - 1].spawns.length
      : 0;
    if (spawns === 0) return 0;
    return this.queueIndex / spawns;
  }

  reset(): void {
    this.waveNumber = 0;
    this.queueIndex = 0;
    this.spawnTimer = 0;
    this.phase      = 'interval';
  }
}
