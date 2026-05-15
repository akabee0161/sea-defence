# Sea Defence — CLAUDE.md

## 技術スタック

| 項目 | 内容 |
|---|---|
| 言語 | TypeScript (strict, isolatedModules: true) |
| バンドラー | Vite 5（成果物は `out/` へ出力） |
| 描画 | HTML5 Canvas API (400×700px) |
| 外部ゲームライブラリ | なし（フルスクラッチ） |

## ゲーム概要

幼児向け海テーマのタワーディフェンス。敵＝サメ、タワー＝タコ、壁＝珊瑚、守るもの＝卵。

- **マップ**：8×13 タイル（`TILE_SIZE = 50px`）。上部 50px は HUD バー（`GRID_OFFSET_Y = 50`）。canvas は 400×700px。
- **経路**：5本の独立したジグザグ経路（`MAP_DEF.paths` in mapDefs.ts）。最初は経路0のみ有効。
- **資源**：通常卵（HP）とひび割れ卵（建設コスト）の2種。Wave クリアでひび割れ卵が増える。
- **タワー**：Octopus（射撃）/ Crab（パトロール＋爪攻撃）/ HermitCrab（出現＋攻撃）/ Eel（伸び噛み）/ Coral（ブロック壁・HP制）の5種。
- **設置**：2秒長押しで設置（コスト: ひび割れ卵1個）。
- **フロー**：ビルドフェーズ → Wave → Wave クリア後に卵を右端のゴールタップで経路追加 → 繰り返し（5Wave でクリア）。

## 開発コマンド

```bash
npm run dev      # 開発サーバー → http://localhost:5173
npm run build    # 本番ビルド（out/ へ出力）
npm run preview  # 本番ビルドのプレビュー
npm run lint     # Biome lint チェック（src/ 対象）
npm run format   # Biome フォーマット自動修正（src/ 対象）
```

## 拡張時の注意

- エンティティ間の参照は `Game` クラスが仲介（Mediator パターン）。
- `GameObject.active === false` のオブジェクトはループ末尾で除去。ただし `CoralWall` は Wave 間の復活のため `active` でなく `broken` フラグで破壊状態を管理する。
- 新エンティティは `ObjectPool` を使い GC 負荷を抑える（既存の管理対象: `Bullet`, `Particle`）。
- `TileType` は `enum`（`const enum` 不可、isolatedModules: true のため）。
- ピクセル座標はタイル座標に `GRID_OFFSET_Y` を加算すること（Tower・CoralWall 参照）。
- `noUnusedLocals` / `noUnusedParameters` が有効。未使用の変数・引数はビルドエラーになる。
- **デプロイパス**：Vite `base` は `/labs/games/sea-defence/` 固定。静的アセット参照時に注意。
