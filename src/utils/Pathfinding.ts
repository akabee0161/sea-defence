export interface GridCell {
  col: number;
  row: number;
}

/** Neighbour expansion order — must stay fixed for deterministic tiebreak. */
const NEIGHBOUR_DELTAS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

interface ANode {
  col: number;
  row: number;
  g: number;
  h: number;
  f: number;
  insertOrder: number;
  parent: ANode | null;
}

/**
 * A* on a grid with deterministic tiebreaking.
 *
 * Tiebreak rules (mandatory for reproducibility):
 *   1. Neighbour expansion: fixed order above (left, right, up, down).
 *   2. Open-set extraction: smallest f → smallest h → earliest insertion (FIFO).
 *   3. Heuristic: Manhattan distance (admissible for 4-neighbour grids).
 *   4. Edge cost: 1 for every walkable-to-walkable move.
 *
 * @returns Array of cells from start to goal inclusive, or null if unreachable.
 */
export function findPath(
  start: GridCell,
  goal: GridCell,
  isWalkable: (col: number, row: number) => boolean,
): GridCell[] | null {
  if (!isWalkable(start.col, start.row) || !isWalkable(goal.col, goal.row))
    return null;

  const open: ANode[] = [];
  const closed: Set<string> = new Set();
  const inOpen: Map<string, ANode> = new Map();
  let insertCounter = 0;

  const h0 = manhattan(start, goal);
  const startNode: ANode = {
    col: start.col,
    row: start.row,
    g: 0,
    h: h0,
    f: h0,
    insertOrder: insertCounter++,
    parent: null,
  };
  open.push(startNode);
  inOpen.set(nodeKey(start.col, start.row), startNode);

  while (open.length > 0) {
    const idx = pickBest(open);
    const cur = open.splice(idx, 1)[0];
    inOpen.delete(nodeKey(cur.col, cur.row));
    closed.add(nodeKey(cur.col, cur.row));

    if (cur.col === goal.col && cur.row === goal.row) {
      return reconstructPath(cur);
    }

    for (const [dc, dr] of NEIGHBOUR_DELTAS) {
      const nc = cur.col + dc;
      const nr = cur.row + dr;
      if (!isWalkable(nc, nr)) continue;
      const k = nodeKey(nc, nr);
      if (closed.has(k)) continue;
      const tentativeG = cur.g + 1;
      const existing = inOpen.get(k);
      if (existing) {
        if (tentativeG < existing.g) {
          existing.g = tentativeG;
          existing.f = tentativeG + existing.h;
          existing.parent = cur;
          // insertOrder is preserved to maintain FIFO for equal-f, equal-h nodes
        }
      } else {
        const h = manhattan({ col: nc, row: nr }, goal);
        const node: ANode = {
          col: nc,
          row: nr,
          g: tentativeG,
          h,
          f: tentativeG + h,
          insertOrder: insertCounter++,
          parent: cur,
        };
        open.push(node);
        inOpen.set(k, node);
      }
    }
  }
  return null;
}

/** Pick index of the node with lowest f, then lowest h, then lowest insertOrder. */
function pickBest(open: ANode[]): number {
  let best = 0;
  for (let i = 1; i < open.length; i++) {
    const a = open[i];
    const b = open[best];
    if (a.f < b.f) {
      best = i;
      continue;
    }
    if (a.f > b.f) continue;
    if (a.h < b.h) {
      best = i;
      continue;
    }
    if (a.h > b.h) continue;
    if (a.insertOrder < b.insertOrder) best = i;
  }
  return best;
}

function manhattan(a: GridCell, b: GridCell): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function nodeKey(col: number, row: number): string {
  return `${col},${row}`;
}

function reconstructPath(end: ANode): GridCell[] {
  const path: GridCell[] = [];
  let cur: ANode | null = end;
  while (cur !== null) {
    path.push({ col: cur.col, row: cur.row });
    cur = cur.parent;
  }
  return path.reverse();
}
