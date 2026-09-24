# steam-activity-logger

Steam で「いつ・何を・どれだけ」遊んだかを、Google Apps Script と Google スプレッドシートだけで記録するツールです。

[Steamでゲームをプレイした時間を「Google Apps Script」で記録する](https://maruhoi.com/steam/record-playtime-as-google-app-script-and-google-spreadsheet/) の仕組みをベースに、次の点を変えています。

| 記事 | このリポジトリ |
| --- | --- |
| プロフィールページをスクレイピング | Steam Web API（`GetPlayerSummaries`）を使用 |
| 毎分1行を記録 | 連続したプレイを「セッション」にまとめて1行で記録 |
| 取得失敗は未処理 | 失敗を `Errors` シートに記録し、3分以内の抜けはつなげる |
| 集計は手作業のピボット | 日別集計と曜日×時間帯ヒートマップを毎日自動で作成 |

## 仕組み

- 1分ごとに Steam のステータスを取得します。遊んでいるゲームが同じ間は、1つのセッションとして扱います。
- 途中のセッションは Script Properties に保存し、終わった時点で `Sessions` シートに1行書き込みます（シートの行数は「遊んだ回数」程度で済みます）。
- 1日の区切りは **午前4時** です（例：25日 3:00 のプレイは 24日分）。
- 記録の抜けが3分以内なら同じセッションとみなします。それより長いと別のセッションになります。

### シート

| シート | 内容 |
| --- | --- |
| `Sessions` | 開始・終了・ゲーム日・AppID・ゲーム名・分 |
| `Daily` | ゲーム日ごとの合計時間・遊んだ回数・取得失敗回数（毎朝4時過ぎに再生成） |
| `Heatmap` | 曜日 × 時間帯ごとの1日あたり平均プレイ時間（分） |
| `Errors` | API 取得に失敗した日時と内容 |

## ディレクトリ構成

```
src/                  clasp の rootDir（GAS に反映されるのはここだけ）
  appsscript.json     マニフェスト
  config.js           設定値（間隔・区切り時刻・許容時間・シート定義）
  core.js             セッション判定と集計の純粋ロジック（GAS 非依存）
  steam.js            Steam Web API 呼び出し
  store.js            状態保存とシートの読み書き
  main.js             トリガー・メニューから呼ばれる入口
test/core.test.js     core.js の単体テスト
```

## セットアップ

1. **Steam 側の準備**
   - [Steam Web API キー](https://steamcommunity.com/dev/apikey) を取得します。
   - 自分の SteamID（17桁の数字）を調べます。
   - プロフィールの公開設定を「公開」にします。非公開だとプレイ中のゲームを取得できません。
2. **スプレッドシートを作成**し、「拡張機能 > Apps Script」を開きます。
3. **コードを反映**します。
   - 手動の場合：`src/` 以下の各ファイルを、同じ名前で Apps Script エディタに貼り付けます。
   - clasp の場合：
     ```sh
     npm install -g @google/clasp
     clasp login
     cp .clasp.json.example .clasp.json   # scriptId を「プロジェクトの設定」の スクリプト ID に書き換える
     npm run push
     ```
4. Apps Script の「プロジェクトの設定 > スクリプト プロパティ」に次の2つを追加します。
   - `STEAM_API_KEY`
   - `STEAM_ID`
5. スプレッドシートを開き直します。メニュー **Steam Logger > 設定を確認** で接続を確かめ、**記録を開始** を選びます（初回は権限の承認が必要です）。

記録をやめるときは **記録を停止** を選びます。進行中のセッションもその時点で書き込まれます。

## 制約

- Steam の外で起動したゲーム（Epic など）や、Steam を「オフライン表示」にしている間は記録されません。
- 起動したまま離席した時間もプレイ時間に含まれます。
- 1分ごとのトリガーは、無料アカウントのトリガー実行時間（1日90分）の一部を使います。1回あたりの処理は API 1回と状態の保存だけに抑えています。
- 記録は開始した時点からで、過去のプレイはさかのぼれません。

## 開発

```sh
npm test   # Node 18+ の標準テストランナーで core.js をテスト
```

- PR と main への push では、GitHub Actions が `npm test` を実行します。
- GAS への反映は手動です。main にマージした後、手元で `npm run push`（clasp）を実行するか、エディタに貼り付けます。
