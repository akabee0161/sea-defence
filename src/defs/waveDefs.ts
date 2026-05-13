import type { EnemyKind } from './enemyDefs.ts';

export interface SpawnEntry {
  /** ENEMY_DEFS のキー（例: 'small', 'medium', 'boss'）*/
  enemyId: EnemyKind;
  spawnIdx: number;
  /** 次のエントリまでの待機秒数。省略時は SPAWN_INTERVAL を使用 */
  delay?: number;
}

export interface WaveDef {
  spawns: SpawnEntry[];
  /**
   * タイムボーナスの基準秒数。
   * クリアタイム <= target なら +500、<= target*2 なら +200、それ以上は +0。
   */
  timeBonusTargetSec: number;
}

/**
 * ウェーブ構成定義。
 * 新たなウェーブを追加するには、この配列にエントリを追加するだけでよい。
 * spawnIdx → スポーン位置: 0=(0,0) 1=(7,0) 2=(1,0) 3=(5,0) 4=(3,0)
 */
export const WAVE_DEFS: WaveDef[] = [
  // Wave 1 — path 0 のみ（初期解放）、small ×5
  {
    timeBonusTargetSec: 45,
    spawns: [
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
    ],
  },
  // Wave 2 — small ×8 (spawnIdx 0)、medium ×3 (spawnIdx 1)
  {
    timeBonusTargetSec: 60,
    spawns: [
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
    ],
  },
  // Wave 3 — small ×7 (spawnIdx 0,2)、medium ×9 (spawnIdx 0,1,2)
  {
    timeBonusTargetSec: 90,
    spawns: [
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 2 },
      { enemyId: 'small', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 2 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'medium', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 2 },
    ],
  },
  // Wave 4 — small ×7、medium ×12、boss ×1、spawnIdx round-robin 0–4
  {
    timeBonusTargetSec: 120,
    spawns: [
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 4 },
      { enemyId: 'medium', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 3 },
      { enemyId: 'small', spawnIdx: 1 },
      { enemyId: 'medium', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 1 },
      { enemyId: 'medium', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 3 },
      { enemyId: 'boss', spawnIdx: 3 },
      { enemyId: 'medium', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 1 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'medium', spawnIdx: 2 },
      { enemyId: 'small', spawnIdx: 3 },
      { enemyId: 'medium', spawnIdx: 3 },
      { enemyId: 'small', spawnIdx: 4 },
    ],
  },
  // Wave 5 — small ×6、medium ×4、boss ×4; boss は spawnIdx 0,1,4
  {
    timeBonusTargetSec: 150,
    spawns: [
      { enemyId: 'boss', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 0 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 3 },
      { enemyId: 'boss', spawnIdx: 0 },
      { enemyId: 'small', spawnIdx: 4 },
      { enemyId: 'medium', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 2 },
      { enemyId: 'medium', spawnIdx: 3 },
      { enemyId: 'boss', spawnIdx: 1 },
      { enemyId: 'small', spawnIdx: 4 },
      { enemyId: 'small', spawnIdx: 2 },
      { enemyId: 'boss', spawnIdx: 4 },
    ],
  },
];
