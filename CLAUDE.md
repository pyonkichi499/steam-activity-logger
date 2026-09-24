# CLAUDE.md

Steam のプレイセッションを Google Apps Script + Google スプレッドシートで記録するツール。

## 構成
- `src/` は clasp の rootDir。GAS ではすべてのファイルが1つのグローバルスコープで実行される
- `src/core.js` は GAS に依存しない純粋ロジック（セッション判定・集計）。変更したら `test/core.test.js` にテストを追加する
- GAS の API を使う処理は `steam.js` / `store.js` / `main.js` に置く

## コマンド
- `npm test`: 単体テスト（Node 22+ の標準テストランナー）
- `npm run push`: clasp で GAS に反映（手動デプロイ。main へのマージ後に行う）

## 規約
- コミットメッセージは Conventional Commits 形式。type と scope は英語、説明と本文は日本語
  - 例: `feat(core): 日別集計に取得失敗数を追加`
- コミットにも PR にも Co-Authored-By や「Generated with Claude Code」などの署名を付けない
- コミットは意味のあるまとまりで分ける（細かすぎず、無関係な変更を混ぜない）
- `.clasp.json` と `.clasprc.json` はコミットしない
- push の前に `npm test` を通す
