import { Vector2D } from '../utils/Vector2D.ts';
import { Renderer } from '../core/Renderer.ts';

// ── Placement spots ───────────────────────────────────────────────────────────

export type SpotKind = 'tower' | 'coral';

export interface PlacementSpot {
  col: number;
  row: number;
  kind: SpotKind;
}

// ── Route / map constants ─────────────────────────────────────────────────────

/** Row indices of the 3 fixed enemy spawn points (col=0). */
export const START_ROWS       = [2, 6, 10];
/** Row indices of the 5 goal slots (col=15). Index = goalIdx (0–4). */
export const GOAL_ROWS        = [2, 4, 6, 8, 10];
/** Goal that is active when the game begins (index into GOAL_ROWS). */
export const INITIAL_GOAL_IDX = 0;
/** Column of the vertical spine that all routes share. */
export const SPINE_COL        = 7;

// 10 tower spots (BUILDABLE tiles) + 4 coral spots (always-active PATH tiles)
const PLACEMENT_SPOTS: PlacementSpot[] = [
  // ── Tower spots ───────────────────────────────────────────────────────────
  { col:  2, row:  0, kind: 'tower' }, // above start A
  { col:  2, row:  4, kind: 'tower' }, // between starts A and B
  { col:  2, row:  8, kind: 'tower' }, // between starts B and C
  { col:  2, row: 11, kind: 'tower' }, // below start C
  { col:  6, row:  4, kind: 'tower' }, // near spine, between A and B
  { col:  6, row:  8, kind: 'tower' }, // near spine, between B and C
  { col: 10, row:  1, kind: 'tower' }, // right side, above goal rows
  { col: 10, row:  3, kind: 'tower' }, // right side, between goal rows 2 and 4
  { col: 10, row:  7, kind: 'tower' }, // right side, between goal rows 6 and 8
  { col: 10, row: 11, kind: 'tower' }, // right side, below goal rows
  // ── Coral spots (on always-active PATH tiles) ─────────────────────────────
  { col: 3, row:  2, kind: 'coral' }, // start A branch
  { col: 3, row:  6, kind: 'coral' }, // start B branch
  { col: 3, row: 10, kind: 'coral' }, // start C branch
  { col: 7, row:  6, kind: 'coral' }, // spine centre
];

export enum TileType {
  BUILDABLE = 0,
  PATH      = 1,
  OBSTACLE  = 2,
}

const TILE_COLORS: Record<TileType, string> = {
  [TileType.BUILDABLE]: '#1a6b42',
  [TileType.PATH]:      '#1565c0',
  [TileType.OBSTACLE]:  '#071a2e',
};

export const TILE_SIZE = 50;

const COLS = 16;
const ROWS = 12;

function tileCenter(col: number, row: number): Vector2D {
  return new Vector2D(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2);
}

export class MapGrid {
  private tiles: TileType[][];

  /**
   * allRouteWaypoints[startIdx][goalIdx] → 4 waypoints describing the L-shaped route:
   *   (col=0, startRow) → (SPINE_COL, startRow) → (SPINE_COL, goalRow) → (col=15, goalRow)
   */
  readonly allRouteWaypoints: Vector2D[][][];

  readonly cols = COLS;
  readonly rows = ROWS;

  constructor() {
    this.tiles = this.buildInitialTiles();

    // Pre-compute all 15 routes (3 starts × 5 goals)
    this.allRouteWaypoints = START_ROWS.map(startRow =>
      GOAL_ROWS.map(goalRow => [
        tileCenter(0,         startRow),
        tileCenter(SPINE_COL, startRow),
        tileCenter(SPINE_COL, goalRow),
        tileCenter(15,        goalRow),
      ]),
    );
  }

  private buildInitialTiles(): TileType[][] {
    const grid = Array.from({ length: ROWS }, () =>
      new Array<TileType>(COLS).fill(TileType.BUILDABLE),
    );

    // Start branches: cols 0–SPINE_COL for each start row
    for (const startRow of START_ROWS) {
      for (let c = 0; c <= SPINE_COL; c++) {
        grid[startRow][c] = TileType.PATH;
      }
    }

    // Vertical spine: SPINE_COL, rows 2–10
    for (let r = 2; r <= 10; r++) {
      grid[r][SPINE_COL] = TileType.PATH;
    }

    // Initial goal branch
    this.applyGoalBranch(grid, INITIAL_GOAL_IDX);

    return grid;
  }

  private applyGoalBranch(grid: TileType[][], goalIdx: number): void {
    const goalRow = GOAL_ROWS[goalIdx];
    for (let c = SPINE_COL + 1; c < COLS; c++) {
      grid[goalRow][c] = TileType.PATH;
    }
  }

  /** Mark goal branch tiles as PATH — call when player activates a new goal. */
  activateGoalBranch(goalIdx: number): void {
    this.applyGoalBranch(this.tiles, goalIdx);
  }

  /** Rebuild tiles to initial state — call on game restart. */
  reset(): void {
    this.tiles = this.buildInitialTiles();
  }

  getTile(col: number, row: number): TileType {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return TileType.OBSTACLE;
    return this.tiles[row][col];
  }

  getSpot(col: number, row: number): PlacementSpot | undefined {
    return PLACEMENT_SPOTS.find(s => s.col === col && s.row === row);
  }

  get allSpots(): readonly PlacementSpot[] { return PLACEMENT_SPOTS; }

  spotCenter(col: number, row: number): Vector2D { return tileCenter(col, row); }

  pixelToGrid(pos: Vector2D): { col: number; row: number } {
    return {
      col: Math.floor(pos.x / TILE_SIZE),
      row: Math.floor(pos.y / TILE_SIZE),
    };
  }

  draw(renderer: Renderer, activeGoalIndices: Set<number>): void {
    // Draw all tiles
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const type = this.tiles[row][col];
        const pos  = new Vector2D(col * TILE_SIZE, row * TILE_SIZE);
        renderer.drawRect(pos, TILE_SIZE, TILE_SIZE, TILE_COLORS[type]);
      }
    }

    // Grid lines
    const gridColor = 'rgba(255, 255, 255, 0.07)';
    for (let col = 0; col <= COLS; col++) {
      renderer.drawLine(
        new Vector2D(col * TILE_SIZE, 0),
        new Vector2D(col * TILE_SIZE, ROWS * TILE_SIZE),
        gridColor,
      );
    }
    for (let row = 0; row <= ROWS; row++) {
      renderer.drawLine(
        new Vector2D(0, row * TILE_SIZE),
        new Vector2D(COLS * TILE_SIZE, row * TILE_SIZE),
        gridColor,
      );
    }

    const trailColor = 'rgba(100, 220, 255, 0.80)';

    // Start branch trails + "S" entrance markers (always visible)
    for (const startRow of START_ROWS) {
      const startPt = tileCenter(0, startRow);
      const spinePt = tileCenter(SPINE_COL, startRow);
      renderer.drawLine(startPt, spinePt, trailColor, 3, true);
      renderer.drawCircle(startPt, 10, trailColor);
      renderer.drawText('S', new Vector2D(startPt.x - 5, startPt.y + 5), '#071a2e', 'bold 12px monospace');
    }

    // Active goal branch trails (spine junction → goal)
    for (const gi of activeGoalIndices) {
      const goalRow = GOAL_ROWS[gi];
      const spinePt = tileCenter(SPINE_COL, goalRow);
      const goalPt  = tileCenter(15, goalRow);
      renderer.drawLine(spinePt, goalPt, trailColor, 3, true);
    }
  }

  /**
   * Draw egg clusters at each active goal reflecting actual remaining egg count (0–3).
   * @param goalEggs array indexed by goalIdx; each value is 0–3
   */
  drawGoalMarkers(renderer: Renderer, activeGoalIndices: Set<number>, goalEggs: number[]): void {
    const ctx    = renderer.context;
    const EGG_R  = 6;
    const RING_R = 12;
    const OFFSETS: [number, number][] = [
      [0, 0],
      [-RING_R * 0.866, -RING_R * 0.5],
      [ RING_R * 0.866, -RING_R * 0.5],
    ];

    for (const gi of activeGoalIndices) {
      const { x, y } = tileCenter(15, GOAL_ROWS[gi]);
      const count    = Math.max(0, Math.min(3, goalEggs[gi] ?? 0));

      // Glow (always visible so player can see the goal even when empty)
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 22);
      glow.addColorStop(0, count > 0 ? 'rgba(255, 200, 80, 0.35)' : 'rgba(150, 150, 150, 0.25)');
      glow.addColorStop(1, 'rgba(255, 200, 80, 0)');
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // Eggs — only draw as many as remain
      for (const [dx, dy] of OFFSETS.slice(0, count)) {
        const ex = x + dx;
        const ey = y + dy;

        ctx.beginPath();
        ctx.arc(ex, ey, EGG_R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 185, 55, 0.92)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ex, ey, EGG_R * 0.65, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 230, 130, 0.45)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ex, ey, EGG_R, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 110, 10, 0.60)';
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ex - EGG_R * 0.30, ey - EGG_R * 0.32, EGG_R * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
        ctx.fill();
      }
    }
  }
}
