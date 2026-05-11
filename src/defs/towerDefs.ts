export interface TowerDef {
  id: string;
  range: number;
  fireRate: number;
  cost: number;
  damage: number;
  bulletSpeed: number;
}

/**
 * タワーの種類定義。
 * 新たなタワーを追加するには、このオブジェクトにエントリを追加し、
 * Tower.ts にサブクラスを実装するだけでよい。
 */
export const TOWER_DEFS: Record<string, TowerDef> = {
  octopus: {
    id: 'octopus',
    range: 150,
    fireRate: 2,
    cost: 1,
    damage: 20,
    bulletSpeed: 250,
  },
  crab: {
    id: 'crab',
    range: 45,
    fireRate: 2.0,
    cost: 1,
    damage: 60,
    bulletSpeed: 0,
  },
  hermit_crab: {
    id: 'hermit_crab',
    range: 70,
    fireRate: 1.5,
    cost: 1,
    damage: 45,
    bulletSpeed: 0,
  },
  eel: {
    id: 'eel',
    range: 200,
    fireRate: 0.4,
    cost: 1,
    damage: 45,
    bulletSpeed: 0,
  },
};
