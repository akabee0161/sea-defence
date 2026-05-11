import { WAVE_DEFS } from '../defs/waveDefs.ts';

export interface WaveScoreDetails {
  enemyScore:       number;
  eggScore:         number;
  timeBonus:        number;
  total:            number;
  crackedEggsEarned: number;
}

export class ScoreManager {
  private _total               = 0;
  private _waveEnemiesDefeated = 0;
  private _waveStartTime       = 0;
  private _lastWaveDetails: WaveScoreDetails | null = null;

  startWave(): void {
    this._waveStartTime       = performance.now();
    this._waveEnemiesDefeated = 0;
  }

  recordKill(reward: number): void {
    this._waveEnemiesDefeated += reward;
  }

  /**
   * ウェーブ終了時にスコアを集計する。
   * @param waveNumber  完了したウェーブ番号（1始まり）
   * @param currentHp   残り HP（卵の総数）
   */
  finalizeWave(waveNumber: number, currentHp: number): WaveScoreDetails {
    const enemyScore       = this._waveEnemiesDefeated * 100;
    const eggScore         = currentHp * 50;
    const elapsedMs        = this._waveStartTime > 0
      ? performance.now() - this._waveStartTime
      : 0;
    const timeBonus        = this.calcTimeBonus(waveNumber, elapsedMs);
    const total            = enemyScore + eggScore + timeBonus;
    const crackedEggsEarned = currentHp;

    this._lastWaveDetails = { enemyScore, eggScore, timeBonus, total, crackedEggsEarned };
    this._total          += total;
    return this._lastWaveDetails;
  }

  private calcTimeBonus(waveNumber: number, elapsedMs: number): number {
    const idx    = Math.min(Math.max(0, waveNumber - 1), WAVE_DEFS.length - 1);
    const target = WAVE_DEFS[idx]?.timeBonusTargetSec ?? 90;
    const sec    = elapsedMs / 1000;
    if (sec <= target)      return 500;
    if (sec <= target * 2)  return 200;
    return 0;
  }

  get total(): number                             { return this._total; }
  get enemiesDefeated(): number                   { return this._waveEnemiesDefeated; }
  get lastDetails(): WaveScoreDetails | null      { return this._lastWaveDetails; }

  reset(): void {
    this._total               = 0;
    this._waveEnemiesDefeated = 0;
    this._waveStartTime       = 0;
    this._lastWaveDetails     = null;
  }
}
