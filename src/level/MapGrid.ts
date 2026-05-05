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

/** Pixel offset from canvas top — reserves space for the HUD bar. */
export const GRID_OFFSET_Y = 50;

/** Row at col=15 for each goal slot (index = pathIdx / goalIdx). */
export const GOAL_ROWS        = [1, 3, 5, 7, 9];
/** Path that is active when the game begins (index into GOAL_ROWS / RAW_PATHS). */
export const INITIAL_GOAL_IDX = 0;

/**
 * 5 independent winding paths, each defined as [col, row] grid-coordinate
 * waypoints from the left edge (col=0) to the right edge (col=15).
 * Path i ends at (15, GOAL_ROWS[i]).
 * Row 0 = first visible row directly below the HUD.
 */
const RAW_PATHS: [number, number][][] = [
  // Path 0 → goal row 1  (zigzag rows 0–3, top area)
  [[0,0],[3,0],[3,3],[7,3],[7,0],[11,0],[11,3],[14,3],[14,1],[15,1]],
  // Path 1 → goal row 3  (zigzag rows 2–5, upper-middle)
  [[0,2],[2,2],[2,5],[6,5],[6,2],[10,2],[10,5],[13,5],[13,3],[15,3]],
  // Path 2 → goal row 5  (zigzag rows 5–8, lower-middle)
  [[0,5],[3,5],[3,8],[7,8],[7,5],[11,5],[11,8],[14,8],[14,5],[15,5]],
  // Path 3 → goal row 7  (zigzag rows 4–7, crosses paths 1 & 2)
  [[0,7],[2,7],[2,4],[6,4],[6,7],[9,7],[9,4],[12,4],[12,7],[15,7]],
  // Path 4 → goal row 9  (zigzag rows 6–9, bottom area)
  [[0,9],[4,9],[4,6],[8,6],[8,9],[11,9],[11,6],[14,6],[14,9],[15,9]],
];

// Tower spots must be BUILDABLE (not on any path).
// Coral spots must be PATH tiles (on a path).
const PLACEMENT_SPOTS: PlacementSpot[] = [
  // ── Tower spots ───────────────────────────────────────────────────────────
  { col:  1, row:  1, kind: 'tower' }, // top-left gap
  { col:  5, row:  1, kind: 'tower' }, // top centre-left gap
  { col:  9, row:  1, kind: 'tower' }, // top centre-right gap
  { col: 13, row:  1, kind: 'tower' }, // top-right gap
  { col:  1, row:  4, kind: 'tower' }, // mid-left, between paths 1 & 3
  { col:  8, row:  4, kind: 'tower' }, // mid-centre, between paths 1 & 3
  { col:  5, row:  7, kind: 'tower' }, // lower-mid-left, between paths 3 & 4
  { col: 10, row:  7, kind: 'tower' }, // lower-mid-right
  { col:  3, row: 10, kind: 'tower' }, // bottom-left
  { col: 10, row: 10, kind: 'tower' }, // bottom-right
  // ── Coral spots (on PATH tiles) ───────────────────────────────────────────
  { col:  2, row:  0, kind: 'coral' }, // path 0, top row
  { col:  1, row:  2, kind: 'coral' }, // path 1, left horizontal
  { col:  1, row:  5, kind: 'coral' }, // path 2, left horizontal
  { col:  4, row:  4, kind: 'coral' }, // path 3, upper horizontal
  { col:  2, row:  9, kind: 'coral' }, // path 4, left horizontal
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
const ROWS = 11;

function tileCenter(col: number, row: number): Vector2D {
  return new Vector2D(
    col * TILE_SIZE + TILE_SIZE / 2,
    row * TILE_SIZE + TILE_SIZE / 2 + GRID_OFFSET_Y,
  );
}

function markPath(grid: TileType[][], waypoints: [number, number][]): void {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [c0, r0] = waypoints[i];
    const [c1, r1] = waypoints[i + 1];
    if (r0 === r1) {
      const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
      for (let c = minC; c <= maxC; c++) grid[r0][c] = TileType.PATH;
    } else {
      const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
      for (let r = minR; r <= maxR; r++) grid[r][c0] = TileType.PATH;
    }
  }
}

export class MapGrid {
  private tiles: TileType[][];

  /** Waypoints for each of the 5 paths (index = pathIdx = goalIdx). */
  readonly paths: readonly Vector2D[][];

  readonly cols = COLS;
  readonly rows = ROWS;

  constructor() {
    this.paths = RAW_PATHS.map(wp => wp.map(([c, r]) => tileCenter(c, r)));
    this.tiles = this.buildInitialTiles();
  }

  private buildInitialTiles(): TileType[][] {
    const grid = Array.from({ length: ROWS }, () =>
      new Array<TileType>(COLS).fill(TileType.BUILDABLE),
    );
    for (const rawPath of RAW_PATHS) {
      markPath(grid, rawPath);
    }
    return grid;
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
      row: Math.floor((pos.y - GRID_OFFSET_Y) / TILE_SIZE),
    };
  }

  draw(renderer: Renderer): void {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const type = this.tiles[row][col];
        const pos  = new Vector2D(col * TILE_SIZE, row * TILE_SIZE + GRID_OFFSET_Y);
        renderer.drawRect(pos, TILE_SIZE, TILE_SIZE, TILE_COLORS[type]);
      }
    }

    const gridColor = 'rgba(255, 255, 255, 0.07)';
    for (let col = 0; col <= COLS; col++) {
      renderer.drawLine(
        new Vector2D(col * TILE_SIZE, GRID_OFFSET_Y),
        new Vector2D(col * TILE_SIZE, GRID_OFFSET_Y + ROWS * TILE_SIZE),
        gridColor,
      );
    }
    for (let row = 0; row <= ROWS; row++) {
      renderer.drawLine(
        new Vector2D(0, GRID_OFFSET_Y + row * TILE_SIZE),
        new Vector2D(COLS * TILE_SIZE, GRID_OFFSET_Y + row * TILE_SIZE),
        gridColor,
      );
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
