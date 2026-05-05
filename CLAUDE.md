# Tower Defence — CLAUDE.md

プロジェクトの実装記録。Claude Code との会話を跨いで状態を引き継ぐためのドキュメント。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| 言語 | TypeScript (strict モード、isolatedModules: true) |
| バンドラー | Vite 5 |
| 描画 | HTML5 Canvas API (2D Context) |
| パッケージマネージャー | npm |
| 外部ゲームライブラリ | なし（フルスクラッチ） |

---

## プロジェクト構造

```
/
├── index.html
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts              # エントリポイント・UI ボタン配線・syncUI rAF ループ
    ├── style.css            # レスポンシブレイアウト（モバイル対応）
    ├── core/
    │   ├── Game.ts          # ゲームループ・状態管理・フェーズ制御
    │   ├── Renderer.ts      # Canvas 描画の抽象化レイヤー
    │   └── WaveManager.ts   # 5Wave 固定構成・手動スタート・次Wave予告
    ├── entities/
    │   ├── GameObject.ts    # 全エンティティの抽象基底クラス
    │   ├── Enemy.ts         # サメ敵: EnemyKind・サメ形状描画・speedMultiplier
    │   ├── Tower.ts         # BasicTower（タコ）: 索敵・発射・オクトパス描画
    │   ├── CoralWall.ts     # 珊瑚壁: PATH タイル設置・静的構造物
    │   ├── Bullet.ts        # 墨弾: ホーミング移動・オブジェクトプール対応
    │   └── Particle.ts      # 墨パーティクル: 爆発エフェクト・プール対応
    ├── level/
    │   └── MapGrid.ts       # グリッド管理・5経路定義・配置スポット・卵描画
    └── utils/
        ├── Vector2D.ts      # 2D ベクトル演算（イミュータブル）
        └── ObjectPool.ts    # ジェネリックオブジェクトプール（releaseAll() 付き）
```

---

## ゲーム設計（現在の状態）

### テーマ・対象
幼児向け海テーマタワーディフェンス。敵=サメ、タワー=タコ、壁=珊瑚、守るもの=卵。

### レイアウト（モバイル対応）

- HTML: `#game-wrapper` 内にキャンバス＋`#top-bar`（3ボタンオーバーレイ）
- Canvas: CSS `width:100%; aspect-ratio:800/600; touch-action:none` でレスポンシブ
- ボタン: `⏸`（Pause）、`↩`（Restart）、`▶`（Start、横 76px、目立つ緑）を左から右へ
- サイドパネルなし。全UI は HUD（Canvas 上部 50px バー）＋ボタンオーバーレイで完結

### マップ

- Canvas: **800×600 px**、タイル: **50px**、16列×12行
- タイル色: BUILDABLE=海草緑 `#1a6b42`、PATH=海青 `#1565c0`、OBSTACLE=深海 `#071a2e`
- **5本の独立した経路**（row 1/3/5/7/9 に配置、各経路は1行下に dip する S字形）

#### 経路定義

| 経路 | 主要行 | dip行 | dipコル範囲 | ゴール |
|---|---|---|---|---|
| 0 | row 1 | row 2 | cols 5–10 | (15,1) |
| 1 | row 3 | row 4 | cols 3–8  | (15,3) |
| 2 | row 5 | row 6 | cols 6–11 | (15,5) |
| 3 | row 7 | row 8 | cols 4–9  | (15,7) |
| 4 | row 9 | row 10| cols 7–12 | (15,9) |

ウェイポイント例（経路0）: (0,1)→(5,1)→(5,2)→(10,2)→(10,1)→(15,1)

### 配置スポット（2秒長押しで設置）

#### タコ（tower）スポット 10箇所（BUILDABLE タイル）

| col | row | 位置 |
|---|---|---|
| 3 | 0 | 経路1上方 |
| 8 | 0 | 経路1上方（dip付近） |
| 2 | 2 | 経路1-2間（左） |
| 12 | 2 | 経路1-2間（右） |
| 1 | 4 | 経路2-3間（左） |
| 11 | 4 | 経路2-3間（右） |
| 3 | 6 | 経路3-4間（左） |
| 13 | 6 | 経路3-4間（右） |
| 2 | 8 | 経路4-5間（左） |
| 11 | 8 | 経路4-5間（右） |

#### 珊瑚（coral）スポット 5箇所（PATH タイル、各経路1箇所）

| col | row | 経路 |
|---|---|---|
| 3 | 1 | 経路0 |
| 6 | 4 | 経路1 |
| 8 | 6 | 経路2 |
| 6 | 8 | 経路3 |
| 9 | 10 | 経路4 |

### ゲームフロー

```
ゲーム開始: 経路0 アクティブ、卵7個、ひび割れ卵3個
  ↓
【ビルドフェーズ】（inter-wave）ひび割れ卵でタコ/珊瑚を設置
  ↓
▶ ボタン → Wave 1 開始
  ↓
【Waveフェーズ】サメが有効経路からランダムに出現
  ↓
Wave クリア → crackedEggs += playerHp → eggPlacingPhase = true
  ↓
【卵置きフェーズ】右端の未開放ゴールタイルをタップ → 経路追加
  ↓
【ビルドフェーズ】追加設置
  ↓
Wave 2〜5 繰り返し → Wave 5 クリアで CLEAR!
```

### 資源システム

| 資源 | 役割 | 初期値 | 増加タイミング |
|---|---|---|---|
| 通常卵（playerHp） | HP。サメに取られる | 7 | なし |
| ひび割れ卵（crackedEggs） | 建設コスト。Wave クリア報酬 | 3 | Wave クリア時 +playerHp |

- 建設コスト: タコ=1・珊瑚=1（ひび割れ卵を消費）
- 敵撃破報酬: なし
- playerHp が 0 → ゲームオーバー

### ウェーブ（WaveManager）

| Wave | 内容 |
|---|---|
| 1 | 小 ×10 |
| 2 | 小 ×10 + 中 ×4 |
| 3 | 小 ×6 + 中 ×10 |
| 4 | 中 ×12 |
| 5 | 小 ×6 + 中 ×4 + ボス ×2 |

- SPAWN_INTERVAL = 1.5s
- Wave 5 クリア後に `'clear'` フェーズ → CLEAR! 画面

---

## 各ファイルの責務と API

### `src/utils/Vector2D.ts`

```
Vector2D { x, y }  ← 全メソッドはイミュータブル
  .add / .subtract / .scale / .magnitude / .normalize / .distanceTo / .clone
  Vector2D.zero()
```

---

### `src/utils/ObjectPool.ts`

```
ObjectPool<T extends Poolable>(factory: () => T)
  .acquire() / .release(obj) / .releaseAll()
  .all: readonly T[] / .activeCount
```

---

### `src/core/Renderer.ts`

```
Renderer(canvas)  ← clear デフォルト背景色 = #0a1f3d
  .clear(color?) / .drawRect / .drawCircle / .drawLine / .drawText
  .context: CanvasRenderingContext2D / .width / .height
```

---

### `src/level/MapGrid.ts`

#### タイル種別

```
BUILDABLE = 0  // #1a6b42
PATH      = 1  // #1565c0
OBSTACLE  = 2  // #071a2e
```

#### 公開 API

```ts
MapGrid
  .allPathWaypoints: Vector2D[][]   // 5経路分のウェイポイント配列
  .cols / .rows
  .getTile(col, row): TileType
  .getSpot(col, row): PlacementSpot | undefined
  .allSpots: readonly PlacementSpot[]
  .spotCenter(col, row): Vector2D
  .pixelToGrid(pos): {col, row}
  .draw(renderer, activePaths: Set<number>): void
  .drawGoalEggs(renderer, playerHp, activePaths: Set<number>): void
```

- `draw`: 有効経路のみ waypoint トレイル＋ノードを描画
- `drawGoalEggs`: 有効ゴール全てに playerHp を均等分配して卵クラスターを描画

---

### `src/entities/Enemy.ts`

```ts
type EnemyKind = 'small' | 'medium' | 'boss';

small:  { radius:11, speed:180, maxHp:60,  reward:0, bodyColor:'#5dade2', finColor:'#2471a3' }
medium: { radius:17, speed:120, maxHp:200, reward:0, bodyColor:'#f4d03f', finColor:'#b7950b' }
boss:   { radius:30, speed:80,  maxHp:800, reward:0, bodyColor:'#e74c3c', finColor:'#922b21' }

Enemy(waypoints, kind='small')
  setSpeedMultiplier(m) / takeDamage(n)
  .hasReachedExit / .currentHp
```

---

### `src/entities/Tower.ts`

```ts
createTower(col, row): Tower   // BasicTower（タコ）
towerCost(): number            // 固定 1（ひび割れ卵）
```

---

### `src/entities/CoralWall.ts`

```ts
CoralWall(col, row)
export const CORAL_COST = 1;  // ひび割れ卵 1個
```

---

### `src/core/WaveManager.ts`

```ts
WaveManager(onSpawn, onWaveClear?)
  update(dt, activeEnemyCount)
  startWave() / reset()
  get currentWave / totalWaves / isInterWave / isGameClear / waveProgress
  get nextWaveEnemies: { kind: EnemyKind; count: number }[]  // 次Wave予告
```

---

### `src/core/Game.ts`

#### フィールド

```
enemies / towers / corals / occupiedSpots: Set<string>
bulletPool / particlePool
playerHp=7 / crackedEggs=3 / gameOver=false / _isPaused=false
activePathIndices: Set<number>   // プレイヤーが選んだ有効経路番号
eggPlacingPhase: boolean         // true = 卵置きフェーズ中
holdSpot: PlacementSpot | null / holdTimer: number
damageFlashTimer / accumulated
```

#### 定数

```
INITIAL_HP = 7
INITIAL_CRACKED_EGGS = 3
HOLD_DURATION = 2.0s
CORAL_SLOW_RADIUS = 30px
DAMAGE_FLASH_DURATION = 0.4s
```

#### update() の流れ

```
0. holdTimer += dt → HOLD_DURATION 超えたら placeAtSpot()
1. waveManager.update(dt, enemies.length)
2. 珊瑚減速判定 + enemy.update(dt)
3. tower.update(dt, enemies, bulletPool)
4. bullet.update(dt)
5. 弾 ↔ 敵 当たり判定 → takeDamage → particles（撃破報酬なし）
6. particle.update(dt)
7. exit 判定 → playerHp-- → damageFlashTimer
8. enemies.filter(isActive)
```

#### draw() の順序

```
clear
→ mapGrid.draw(activePaths)
→ mapGrid.drawGoalEggs(playerHp, activePaths)
→ drawSpots（タワー/珊瑚スポット点）
→ corals / towers / enemies / bullets / particles
→ [drawEggPlacingOverlay]    ← eggPlacingPhase 時
→ [drawHoldPreview]          ← 長押し中
→ [drawDamageFlash]
→ drawHUD
→ [pausedOverlay] / [gameOver] / [gameClear]
```

#### フェーズ制御

```
eggPlacingPhase:
  pointerdown → 未開放ゴールタイル(col=15)をタップ検出
              → activePathIndices.add(p) → eggPlacingPhase=false
  drawEggPlacingOverlay(): 未開放ゴールにパルスリング+TAP表示
                           画面下部にガイドバナー

WaveClear callback:
  crackedEggs += playerHp
  eggPlacingPhase = true（最終Wave以外）
```

#### 長押し設置

```
pointerdown → eggPlacingPhase なら卵配置処理のみ
           → getSpot() → crackedEggs >= 1 → holdSpot セット
pointerup/cancel/leave → holdSpot クリア
drawHoldPreview():
  globalAlpha=0.40 でエンティティ仮描画
  + 白い進捗弧
  + ひび割れ卵アイコン 1個（コスト表示）
```

#### 公開メソッド/ゲッター

```
startNextWave() / togglePause() / restart()
currentWave / totalWaves / isInterWave / isGameClear / isPaused / isEggPlacing
```

#### HUD 構成

```
[卵アイコン]×N  [ひび割れ卵アイコン]×N  [小サメアイコン] N/5  | [敵アイコン×数 ...]
     ↑HP              ↑建設資源                ↑Wave進捗       ↑次Wave予告
```

---

### `src/main.ts`

```
canvas サイズ設定(800×600) → Game インスタンス → game.start()
DOM refs: btnStartWave, btnPause, btnRestart

syncUI() [rAF]:
  btnStartWave.disabled = !isInterWave || isPaused || isGameClear || isEggPlacing
  btnPause: テキスト切り替え（⏸ / ▶）+ .active クラス
```

---

## 開発コマンド

```bash
npm install       # 初回のみ
npm run dev       # 開発サーバー → http://localhost:5173
npm run build     # 本番ビルド (tsc + vite build)
npm run preview   # 本番ビルドのプレビュー
```

---

## 今後の実装アイデア

- サメのアニメーション（ひれを動かすなど）
- ボス登場時の演出（BGM・画面揺れ）
- ハイスコア記録（localStorage）
- 卵置き時のアニメーション演出

---

## 拡張時の指針

- `Game.update()` / `Game.draw()` 内でエンティティ配列をループする。
- エンティティ間の参照は直接持たず、`Game` クラスが仲介役（Mediator）を担う。
- `GameObject.active === false` のオブジェクトはループ末尾で配列から除去する。
- 新エンティティを追加する場合は `ObjectPool` を使い GC 負荷を抑える。
- `TileType` は `enum`（`const enum` 不可、isolatedModules: true のため）。
