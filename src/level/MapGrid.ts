import { Vector2D } from '../utils/Vector2D.ts';
import { Renderer } from '../core/Renderer.ts';
import { MAP_DEF } from '../defs/mapDefs.ts';
import type { PlacementSpot } from '../defs/mapDefs.ts';

// ── 型・定数の再エクスポート（他ファイルの既存 import を維持するため）──────────
export type { SpotKind, PlacementSpot } from '../defs/mapDefs.ts';

export const TILE_SIZE    = MAP_DEF.tileSize;
export const GRID_OFFSET_Y = MAP_DEF.gridOffsetY;
export const GOAL_COLS    = MAP_DEF.goalCols;
export const GOAL_ROW     = MAP_DEF.goalRow;
export const INITIAL_GOAL_IDX = MAP_DEF.initialGoalIdx;

// ── タイル種別 ────────────────────────────────────────────────────────────────

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

const COLS = MAP_DEF.cols;
const ROWS = MAP_DEF.rows;

function tileCenter(col: number, row: number): Vector2D {
  return new Vector2D(
    col * TILE_SIZE + TILE_SIZE / 2,
    row * TILE_SIZE + TILE_SIZE / 2 + GRID_OFFSET_Y,
  );
}

/** Derive the spawn cell (first tile) for each path. Order matches MAP_DEF.paths index. */
const SPAWN_CELLS: ReadonlyArray<{ readonly col: number; readonly row: number }> =
  MAP_DEF.paths.map(wp => ({ col: wp[0][0], row: wp[0][1] }));

function markPath(grid: TileType[][], waypoints: readonly (readonly [number, number])[]): void {
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

  /** Waypoints for each of the paths (index = pathIdx = goalIdx). */
  readonly paths: readonly Vector2D[][];

  readonly cols = COLS;
  readonly rows = ROWS;

  constructor() {
    this.paths = MAP_DEF.paths.map(wp => wp.map(([c, r]) => tileCenter(c, r)));
    this.tiles = this.buildInitialTiles();
  }

  private buildInitialTiles(): TileType[][] {
    const grid = Array.from({ length: ROWS }, () =>
      new Array<TileType>(COLS).fill(TileType.BUILDABLE),
    );
    for (const rawPath of MAP_DEF.paths) {
      markPath(grid, rawPath);
    }
    return grid;
  }

  reset(): void {
    this.tiles = this.buildInitialTiles();
  }

  getTile(col: number, row: number): TileType {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return TileType.OBSTACLE;
    return this.tiles[row][col];
  }

  get allSpots(): readonly PlacementSpot[] { return MAP_DEF.placementSpots as readonly PlacementSpot[]; }

  getSpot(col: number, row: number): PlacementSpot | undefined {
    return MAP_DEF.placementSpots.find(s => s.col === col && s.row === row);
  }

  /** Spawn cell (col, row) for each path, indexed by spawnIdx (= pathIdx). */
  get spawnCells(): ReadonlyArray<{ readonly col: number; readonly row: number }> {
    return SPAWN_CELLS;
  }

  /** True when the tile at (col, row) is a PATH tile (blue, walkable by enemies). */
  isPathTile(col: number, row: number): boolean {
    return this.getTile(col, row) === TileType.PATH;
  }

  /** Pixel-centre of the tile at (col, row), including GRID_OFFSET_Y. */
  tileCenter(col: number, row: number): Vector2D { return tileCenter(col, row); }

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
      const { x, y } = tileCenter(GOAL_COLS[gi], GOAL_ROW);
      const count    = Math.max(0, Math.min(3, goalEggs[gi] ?? 0));

      const glow = ctx.createRadialGradient(x, y, 2, x, y, 22);
      glow.addColorStop(0, count > 0 ? 'rgba(255, 200, 80, 0.35)' : 'rgba(150, 150, 150, 0.25)');
      glow.addColorStop(1, 'rgba(255, 200, 80, 0)');
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

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
