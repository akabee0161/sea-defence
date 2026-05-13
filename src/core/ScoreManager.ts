export interface WaveScoreDetails {
  enemyScore: number;
  eggScore: number;
  timeBonus: number;
  total: number;
  crackedEggsEarned: number;
}

export class ScoreManager {
  private _total = 0;
  private _waveEnemiesDefeated = 0;
  private _lastWaveDetails: WaveScoreDetails | null = null;

  startWave(): void {
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
  finalizeWave(
    _waveNumber: number,
    currentHp: number,
    spawnCompletedAt: number | null,
  ): WaveScoreDetails {
    const enemyScore = this._waveEnemiesDefeated * 100;
    const eggScore = currentHp * 50;
    const timeBonus = this.calcTimeBonus(spawnCompletedAt);
    const total = enemyScore + eggScore + timeBonus;
    const crackedEggsEarned = currentHp;

    this._lastWaveDetails = {
      enemyScore,
      eggScore,
      timeBonus,
      total,
      crackedEggsEarned,
    };
    this._total += total;
    return this._lastWaveDetails;
  }

  private calcTimeBonus(spawnCompletedAt: number | null): number {
    if (spawnCompletedAt === null) return 0;
    const elapsedSec = (performance.now() - spawnCompletedAt) / 1000;
    return Math.max(0, 500 - Math.floor(elapsedSec * 10));
  }

  get total(): number {
    return this._total;
  }
  get enemiesDefeated(): number {
    return this._waveEnemiesDefeated;
  }
  get lastDetails(): WaveScoreDetails | null {
    return this._lastWaveDetails;
  }

  reset(): void {
    this._total = 0;
    this._waveEnemiesDefeated = 0;
    this._lastWaveDetails = null;
  }
}
