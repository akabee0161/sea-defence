# 新タワー追加 — 設計ドキュメント

**日付**: 2026-05-07  
**対象**: CrabTower / HermitCrabTower / EelTower の追加と既存タワーシステムの拡張

---

## 1. 型システム

### MapGrid.ts

```typescript
// 変更前
export type SpotKind = 'tower' | 'coral';

// 変更後
export type SpotKind = 'octopus' | 'crab' | 'hermit_crab' | 'eel' | 'coral';
```

### Tower.ts

```typescript
export enum TowerKind {
  Octopus    = 'octopus',
  Crab       = 'crab',
  HermitCrab = 'hermit_crab',
  Eel        = 'eel',
}
```

- `BasicTower` → `OctopusTower` にリネーム（挙動変更なし）
- Tower 基底クラスの `private cooldown / target` → `protected` に変更

---

## 2. 配置スポット (PLACEMENT_SPOTS)

### BUILDABLE スポット (10個 → 変更なし)

| col | row | kind |
|-----|-----|------|
| 2 | 2 | octopus |
| 4 | 2 | eel |
| 6 | 1 | octopus |
| 6 | 3 | eel |
| 0 | 6 | octopus |
| 2 | 6 | eel |
| 7 | 6 | octopus |
| 1 | 10 | eel |
| 4 | 10 | octopus |
| 6 | 10 | eel |

### PATH スポット (5個 → 7個に拡張)

| col | row | kind | 備考 |
|-----|-----|------|------|
| 0 | 2 | coral | 既存→継続 |
| 7 | 2 | coral | 既存→継続 |
| 1 | 2 | hermit_crab | 既存→再割当 |
| 3 | 2 | hermit_crab | 既存→再割当 |
| 5 | 2 | hermit_crab | 既存→再割当 |
| 2 | 4 | crab | **新規追加**（row4 全列PATH → 400px巡回） |
| 5 | 4 | crab | **新規追加**（同上） |

> **row4 が全列PATHな理由**: Path 0〜4 の水平セグメントが重複し col 0〜7 全てを覆う。  
> CrabTower は連続するPATHタイルのみ巡回するため、row4 では最大幅 400px の往復移動が可能。

---

## 3. CrabTower

### 役割
PATH タイルを横方向に往復し、接触した敵をハサミで攻撃する前衛型タワー。

### 攻撃スタット
| パラメータ | 値 |
|----------|-----|
| range | 45 px |
| damage | 35 |
| fireRate | 2.0 攻撃/秒 |
| 弾薬 | なし（直接ダメージ） |

### コンストラクタ引数
```typescript
new CrabTower(col: number, row: number, patrolCols: number[])
```
- `patrolCols`: 配置時点で `createTower` が MapGrid を走査して確定した巡回可能な col の配列  
- 算出アルゴリズム: 配置 col から左右に線形スキャンし、連続する PATH タイルを収集  
- 初期インデックス: `patrolCols.indexOf(col)` で配置 col から巡回開始

### 移動ロジック
- 速度: 60 px/s
- 巡回: `patrolCols` の先頭 ↔ 末尾を往復（端に達したら反転）
- 攻撃: `this.cooldown <= 0` かつ `range` 内に敵が存在 → `enemy.takeDamage(damage)` 直接呼び出し

### ビジュアル
- 本体: 横長楕円（橙赤色）
- 両ハサミ: 左右に伸びる腕 + 開閉するクロー（攻撃時にスナップ）
- 移動方向に応じて左右反転

---

## 4. HermitCrabTower

### 役割
PATH タイルに静止し、敵が近づくと貝殻から出てハサミで攻撃し、その後貝殻に戻る待機型タワー。

### 攻撃スタット
| パラメータ | 値 |
|----------|-----|
| range | 70 px |
| damage | 25 |
| fireRate | 1.5 攻撃/秒（ATTACKING フェーズ中のみ） |
| 弾薬 | なし（直接ダメージ） |

### ステートマシン

```
HIDDEN → EMERGING(0.4s) → ATTACKING(0.8s) → RETREATING(0.6s) → HIDDEN
          │ stateTimer       │ cooldown管理       │ stateTimer
          │ 0→0.4            │ 直接ダメージ      │ 0→0.6
```

- **HIDDEN**: `stateTimer=0`。毎フレーム range 内の敵をチェック。敵検知 → EMERGING（RETREATING 後、追加クールダウンなしで即座に再待機）
- **EMERGING**: `stateTimer += dt`。0.4s 経過 → ATTACKING
- **ATTACKING**: `cooldown` で攻撃。0.8s の攻撃ウィンドウ経過 → RETREATING
- **RETREATING**: `stateTimer += dt`。0.6s 経過 → HIDDEN

### ビジュアル
- HIDDEN: 貝殻（楕円＋螺旋模様）のみ描画
- EMERGING: `stateTimer/0.4` の progress でカニ本体が貝殻下から浮上
- ATTACKING: 完全なカニ本体＋ハサミが伸展
- RETREATING: EMERGING の逆アニメーション

---

## 5. EelTower

### 役割
BUILDABLE タイルに静止し、体を伸ばして遠距離の敵に噛み付く長射程型タワー。

### 攻撃スタット
| パラメータ | 値 |
|----------|-----|
| range | 200 px |
| damage | 60 |
| fireRate | 0.4 攻撃/秒（1 回の攻撃サイクルは ~1.1s＋cooldown） |
| 弾薬 | なし（ストレッチ完了時に直接ダメージ） |

### ストレッチ攻撃シーケンス

```
IDLE → STRETCHING(0.5s, progress 0→1) → BITING(0.2s) → RETRACTING(0.4s) → IDLE
```

- **IDLE**: cooldown 管理。`cooldown <= 0` かつ range 内に敵 → 最近敵をロック → STRETCHING
- **STRETCHING**: `stretchProgress += dt/0.5`。頭部が敵方向へ移動。progress=1 → BITING
- **BITING**: ターゲットが生存していれば `enemy.takeDamage(damage)` 呼び出し。0.2s → RETRACTING
- **RETRACTING**: `stretchProgress -= dt/0.4`。progress=0 → IDLE（cooldown リセット）

### ビジュアル
- 静止時: 本体を BUILDABLE タイル内に蛇行したSカーブで描画（暗緑色）
- 攻撃時: ベジェ曲線で本体から敵方向へ頭部をストレッチ（`stretchProgress` に比例）
- 頭部: 三角形状の口が開いて攻撃（BITING 時に赤いフラッシュ）

---

## 6. createTower ファクトリ変更

```typescript
// 新シグネチャ
export function createTower(
  kind:     TowerKind,
  col:      number,
  row:      number,
  mapGrid?: MapGrid,
): Tower

// MapGrid は CrabTower の巡回範囲算出にのみ使用
// プレビュー描画時は mapGrid を省略 → patrolCols = [col] で静止描画
```

---

## 7. Game.ts 変更箇所

### placeAtSpot()
```typescript
switch (spot.kind) {
  case 'octopus':    this.towers.push(createTower(TowerKind.Octopus, col, row)); break;
  case 'crab':       this.towers.push(createTower(TowerKind.Crab, col, row, this.mapGrid)); break;
  case 'hermit_crab':this.towers.push(createTower(TowerKind.HermitCrab, col, row)); break;
  case 'eel':        this.towers.push(createTower(TowerKind.Eel, col, row)); break;
  case 'coral':      this.corals.push(new CoralWall(col, row)); break;
}
```

### drawProximityPreview() / drawHoldPreview()
- 同様に `spot.kind` で分岐し、一時インスタンスを生成して `draw()` 呼び出し
- CrabTower のプレビューは `mapGrid` 省略（静止描画）

---

## 8. 影響なし確認

- `CoralWall` の挙動変更なし
- `Enemy.takeDamage()` はすでに public → 直接ダメージに使用可能
- `ObjectPool<Bullet>` は新タワーには不使用（`null` 渡し）
- `towers: Tower[]` 型は変更なし（ポリモーフィズムで吸収）
- ビルドコマンド `npm run build` (= `tsc && vite build`) で型チェック付きビルド可能
