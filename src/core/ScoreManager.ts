export interface WaveScoreDetails {
  eggScore: number;
  timeBonus: number;
  total: number;
  crackedEggsEarned: number;
}

export class ScoreManager {
  private _total = 0;
  private _lastWaveDetails: WaveScoreDetails | null = null;

  finalizeWave(
    _waveNumber: number,
    currentHp: number,
    spawnCompletedAt: number | null,
  ): WaveScoreDetails {
    const eggScore = currentHp * 50;
    const timeBonus = this.calcTimeBonus(spawnCompletedAt);
    const total = eggScore + timeBonus;
    const crackedEggsEarned = currentHp;

    this._lastWaveDetails = { eggScore, timeBonus, total, crackedEggsEarned };
    this._total += total;
    return this._lastWaveDetails;
  }

  private calcTimeBonus(spawnCompletedAt: number | null): number {
    if (spawnCompletedAt === null) return 0;
    const elapsedSec = (performance.now() - spawnCompletedAt) / 1000;
    return Math.max(0, 1000 - Math.floor(elapsedSec / 2) * 50);
  }

  get total(): number {
    return this._total;
  }
  get lastDetails(): WaveScoreDetails | null {
    return this._lastWaveDetails;
  }

  reset(): void {
    this._total = 0;
    this._lastWaveDetails = null;
  }
}
