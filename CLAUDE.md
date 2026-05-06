# Sea Defence — CLAUDE.md

## 技術スタック

| 項目 | 内容 |
|---|---|
| 言語 | TypeScript (strict, isolatedModules: true) |
| バンドラー | Vite 5（成果物は `out/` へ出力） |
| 描画 | HTML5 Canvas API (800×600px) |
| 外部ゲームライブラリ | なし（フルスクラッチ） |

## ゲーム概要

幼児向け海テーマのタワーディフェンス。敵＝サメ、タワー＝タコ、壁＝珊瑚、守るもの＝卵。

- **マップ**：16×11 タイル。上部 50px は HUD バー（`GRID_OFFSET_Y = 50`）。
- **経路**：5本の独立したジグザグ経路（`RAW_PATHS` in MapGrid.ts）。最初は経路0のみ有効。
- **資源**：通常卵（HP）とひび割れ卵（建設コスト）の2種。Wave クリアでひび割れ卵が増える。
- **設置**：2秒長押しでタコ/珊瑚を設置（コスト: ひび割れ卵1個）。
- **フロー**：ビルドフェーズ → Wave → Wave クリア後に卵を右端のゴールタップで経路追加 → 繰り返し（5Wave でクリア）。

## 開発コマンド

```bash
npm run dev      # 開発サーバー → http://localhost:5173
npm run build    # 本番ビルド（out/ へ出力）
npm run preview  # 本番ビルドのプレビュー
```

## 拡張時の注意

- エンティティ間の参照は `Game` クラスが仲介（Mediator パターン）。
- `GameObject.active === false` のオブジェクトはループ末尾で除去。
- 新エンティティは `ObjectPool` を使い GC 負荷を抑える。
- `TileType` は `enum`（`const enum` 不可、isolatedModules: true のため）。
- ピクセル座標はタイル座標に `GRID_OFFSET_Y` を加算すること（Tower・CoralWall 参照）。
- `noUnusedLocals` / `noUnusedParameters` が有効。未使用の変数・引数はビルドエラーになる。
- **デプロイパス**：Vite `base` は `/labs/games/sea-defence/` 固定。静的アセット参照時に注意。
