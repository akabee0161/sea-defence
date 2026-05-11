export type SpotKind = 'octopus' | 'crab' | 'hermit_crab' | 'eel' | 'coral';

export interface PlacementSpot {
  col: number;
  row: number;
  kind: SpotKind;
}

export interface MapDef {
  cols: number;
  rows: number;
  tileSize: number;
  gridOffsetY: number;
  /**
   * 各パスのウェイポイント列（[col, row] 座標）。
   * paths[i] の終端が goalCols[i] の位置に対応する。
   */
  paths: readonly (readonly [number, number])[][];
  goalCols: readonly number[];
  goalRow: number;
  initialGoalIdx: number;
  placementSpots: readonly PlacementSpot[];
}

/**
 * マップ定義。
 * パス・ゴール位置・建設スポットなどをここで一元管理する。
 * 新たなパスやスポットを追加するには、この定義を編集するだけでよい。
 */
export const MAP_DEF: MapDef = {
  cols: 8,
  rows: 13,
  tileSize: 50,
  gridOffsetY: 50,

  // 5本の独立したジグザグ経路（上端 row=0 → 下端 row=12）
  // paths[i] の終端ゴール列 = goalCols[i]
  paths: [
    [[0,0],[0,4],[4,4],[4,8],[0,8],[0,12]],  // Path 0 → goal col 0
    [[7,0],[7,4],[3,4],[3,8],[7,8],[7,12]],  // Path 1 → goal col 7
    [[1,0],[1,4],[5,4],[5,8],[3,8],[3,12]],  // Path 2 → goal col 3
    [[5,0],[5,3],[1,3],[1,8],[5,8],[5,12]],  // Path 3 → goal col 5
    [[3,0],[3,4],[6,4],[6,8],[2,8],[2,12]],  // Path 4 → goal col 2
  ],

  goalCols: [0, 7, 3, 5, 2],
  goalRow: 12,
  initialGoalIdx: 0,

  placementSpots: [
    // ── BUILDABLE スポット ─────────────────────────────────────────────────────
    { col: 2, row:  2, kind: 'octopus' },
    { col: 4, row:  2, kind: 'eel' },
    { col: 6, row:  1, kind: 'octopus' },
    { col: 6, row:  3, kind: 'eel' },
    { col: 0, row:  6, kind: 'octopus' },
    { col: 2, row:  6, kind: 'eel' },
    { col: 7, row:  6, kind: 'octopus' },
    { col: 1, row: 10, kind: 'eel' },
    { col: 4, row: 10, kind: 'octopus' },
    { col: 6, row: 10, kind: 'eel' },
    { col: 4, row: 12, kind: 'octopus' },
    { col: 1, row: 11, kind: 'octopus' },
    // ── PATH スポット: Coral ──────────────────────────────────────────────────
    { col: 0, row:  2, kind: 'coral' },
    { col: 7, row:  2, kind: 'coral' },
    { col: 1, row:  5, kind: 'coral' },
    { col: 1, row:  7, kind: 'coral' },
    { col: 0, row:  9, kind: 'coral' },
    { col: 2, row: 11, kind: 'coral' },
    { col: 3, row:  9, kind: 'coral' },
    { col: 5, row: 10, kind: 'coral' },
    { col: 7, row:  8, kind: 'coral' },
    // ── PATH スポット: HermitCrab ─────────────────────────────────────────────
    { col: 1, row:  3, kind: 'hermit_crab' },
    { col: 3, row:  5, kind: 'hermit_crab' },
    { col: 5, row:  7, kind: 'hermit_crab' },
    // ── PATH スポット: Crab ────────────────────────────────────────────────────
    { col: 2, row:  4, kind: 'crab' },
    { col: 5, row:  4, kind: 'crab' },
    { col: 1, row:  8, kind: 'crab' },
    { col: 6, row:  8, kind: 'crab' },
  ],
};
