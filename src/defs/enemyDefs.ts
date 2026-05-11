export interface EnemyDef {
  id: string;
  radius: number;
  speed: number;
  maxHp: number;
  reward: number;
  bodyColor: string;
  finColor: string;
}

/**
 * 敵の種類定義。
 * 新たな敵を追加するには、このオブジェクトにエントリを追加するだけでよい。
 */
export const ENEMY_DEFS: Record<string, EnemyDef> = {
  small: {
    id: 'small',
    radius: 11,
    speed: 180,
    maxHp: 80,
    reward: 1,
    bodyColor: '#5dade2',
    finColor: '#2471a3',
  },
  medium: {
    id: 'medium',
    radius: 17,
    speed: 120,
    maxHp: 320,
    reward: 1,
    bodyColor: '#f4d03f',
    finColor: '#b7950b',
  },
  boss: {
    id: 'boss',
    radius: 30,
    speed: 80,
    maxHp: 1200,
    reward: 1,
    bodyColor: '#e74c3c',
    finColor: '#922b21',
  },
};
