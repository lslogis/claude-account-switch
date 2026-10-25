# Account Switch

[English](README.md) · [한국어](README.ko.md) · **日本語**

複数の Claude サブスクリプションアカウントを、**実行中のセッションの中でそのまま**切り替える Claude Code の mod です。再起動も新しいウィンドウも要りません。次のメッセージから、選んだアカウントで送信されます。

```
/account            アカウント画面：使用中のアカウントは緑の枠内、ほかは下の一覧から選ぶ
/account remove     一覧から選んでアカウントを削除
/account check      診断：フォルダ、ファイル、サーバーの応答、有効期限
```


### Claude デスクトップアプリでは

デスクトップアプリはログインをセッションに直接渡すため、アプリ内では `/account` でその場の切り替えはできません。代わりにデスクトップアプリでは**入力欄の上に帯を 1 本**描きます。

- セッションの状態：フォルダーと git ブランチ、セッション時間、プロンプト数と費用、直前のターンのモデル・時間・キャッシュ率、待機時間、圧縮回数、実行中のエージェントとワークフロー
- Windows ではアカウント部分：コンテキスト、プランの 5 時間・週間の上限、**アカウントボタン**。別のアカウントを選ぶとデスクトップアプリがそのアカウントで再起動します（実行中の作業は止まります）。**Manage accounts…** で追加・名前変更・削除ができ、新しいアカウントへの最初の切り替えで Claude のログイン画面が開きます
- `/account` は同じアカウント一覧を開きます

使用上限の 80%・95% で通知が届きます。この帯はデスクトップアプリでだけ描かれ、ターミナルでは動きません。ターミナル側もデスクトップアプリでは動きません。

---

## インストール

**必要なもの**
- Claude Code 2.1.306 以降
- Claude サブスクリプションのログイン（Pro または Max）
- Windows、macOS、Linux。Windows（Claude Code 2.1.309）、macOS（2.1.306）、Ubuntu 26.04（2.1.309）で動作を確認しています。

Claude Code のセッションの入力欄で：

```
/plugin install account-switch --marketplace lslogis/claude-account-switch
```

マーケットプレイスを追加するか聞かれたら `y`、スコープは user を Enter で選びます。すぐに有効になります。

シェルからインストールする場合：

```sh
claude plugin install account-switch --marketplace lslogis/claude-account-switch
```

確認：`claude plugin list` に `account-switch` が `✔ enabled` と表示されていれば完了です。

## はじめて使うとき

設定は不要です。

1. セッションが始まると、ログイン中のアカウントを自動で登録します。
2. ステータスラインに `● メールアドレス · プラン` が表示されます。
3. ほかのアカウントを追加するには、`/account` を開いて **`+ Log in to another account`** を選び、ブラウザでそのアカウントにログインします。一覧に追加され、そのアカウントが使用中になります。`/login` を直接入力しても同じように登録されます。

## 使い方

### `/account`：選んで切り替える

```
╭─────────────────────────────────╮
│ ● IN USE  you@example.com · Pro │           ← 緑の枠
╰─────────────────────────────────╯
Switch to — ↑↓/Tab then Enter · Esc closes

○ work@example.com · Max                      ← 青。選択中の行は反転表示

+ Log in to another account                   ← オレンジ
```

- **選び方：** ↑↓ または Tab で移動して Enter を押すと、すぐに切り替わり、結果がトーストで表示されます。
- **反映されるタイミング：** **次のメッセージから**です。すでに生成中の返答は、元のアカウントのまま終わります。
- **期限切れのログイン：** ログインの期限が切れたアカウントを選ぶと、切り替えずに**ログイン画面**を開きます。
- **狭いターミナル：** 画面を開けない場合は、一覧をテキストで表示します。

### そのほかのコマンド

| コマンド | 動作 |
|---|---|
| `/account <メールアドレス>` | 画面を開かずにすぐ切り替えます。先頭の一部だけでも構いません（`/account work`）。複数が一致した場合は、もう少し長く入力するよう案内します。 |
| `/account remove` | アカウントを選んで確認すると、一覧から削除します。使用中のアカウントは表示されません。サーバー側のログインには触れません。 |
| `/account list` | 一覧をテキストで表示します。 |
| `/account check` | 診断情報を表示します（「トラブルシューティング」参照）。 |

### ステータスラインと警告

- ステータスラインには常に `● メールアドレス · プラン` が表示されます。
- ログインの期限が切れる 3 日前から `⚠ login expires in Nd` が付きます。期限が切れると `⚠ login expired — log in again` に変わります。一覧にも同じ表示が出ます。

---

## 仕組み

```
~/.claude/.credentials.json        ← Claude が読む場所（使用中のアカウント 1 つ）
                                     macOS ではキーチェーン項目「Claude Code-credentials」
~/.claude/account-switch.json      ← 保管庫：メールアドレスごとのサブスクリプションログイン
~/.claude/account-switch.json.bak  ← 保管庫の直前の状態（自動で書き込み）
```

- **再起動なしで切り替わる理由：** Claude Code は API を呼ぶ前に `.credentials.json` の更新時刻を確認し、変わっていればトークンを読み直します（2.1.309 の実行ファイルで確認）。そのため、ファイル内のサブスクリプションログインを差し替えるだけで、実行中のセッションがそのまま新しいアカウントに移ります。
- **macOS：** macOS の Claude Code はログインをキーチェーンに保存するため、mod は `security` コマンドでその項目を読み書きします。実行中のセッションがログインを読み直すかどうかは、macOS でも `~/.claude/.credentials.json` の更新時刻で判断されるので、キーチェーンに書き込んだあと、そのファイルの時刻だけを更新します（`touch`、内容はそのまま）。Claude はキーチェーンの読み取りを最大 30 秒キャッシュするため、macOS では切り替えが次のメッセージに反映されるまでその程度かかることがあります。
- **差し替える範囲：** そのファイル内の `claudeAiOauth` だけです。同じファイルにある MCP サーバーのログイン（`mcpOAuth`）はそのまま残します。
- **アカウントの見分け方：** 誰のトークンかを Claude のサーバー（`/api/oauth/profile`）に問い合わせ、そのメールアドレスで保存します。
- **最新のトークンを保つ：** セッションは約 8 時間有効なアクセストークンを更新し、`.credentials.json` に書き戻します。mod はメッセージを送るたびと切り替えの直前に、その最新のトークンを該当アカウントの保管庫に保存します。そのため、別のアカウントから戻ってきても最新のトークンで戻れます。
- **設定フォルダ：** `CLAUDE_CONFIG_DIR` が設定されている場合は、`~/.claude` の代わりにそのフォルダを使います。

## あらかじめ対処している問題

| 状況 | mod の動作 |
|---|---|
| 保管庫のファイルが壊れている | `.bak`（直前の状態）から読み込み、そのことを知らせます。両方とも壊れている場合は**何も書き込まずに止まります**。空の一覧で上書きしてトークンを失うことを防ぎます。 |
| `.credentials.json` が壊れている | 切り替えを拒否し、ファイルを上書きしません。MCP のログインを守るためです。 |
| 使用中のトークンが誰のものか、サーバーが答えない（ネットワーク） | 推測でどこかのアカウントに保存したりせず、切り替えも拒否します（「しばらくしてから再試行」）。メッセージごとの確認は、失敗すると 5 分間は問い合わせ直しません。 |
| 切り替え先のトークンが無効になっている（別の場所でログアウトしたなど） | 切り替える前にサーバーで確認します。拒否された場合は切り替えず、ログインし直すよう案内します。 |
| 切り替え先のログインの期限が切れている | 切り替えずに、ログイン画面を開きます。 |
| 切り替えの瞬間に、セッションが更新したトークンを書き込んだ | 書き込んだ直後に読み直して確認し、競合で負けていた場合は「もう一度」と知らせます。 |
| 別の Claude ウィンドウが同時に保管庫に書き込む | 保存の直前に読み直し、アカウントごとに新しいほうを残します。 |
| `ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN` が設定されている | これらはサブスクリプションのログインより優先されるため、切り替えても効果がありません。切り替えを拒否して知らせます。 |
| `/login` を途中でキャンセルした | 何も変わりません。「Account saved」は、アカウントが実際に変わったときだけ表示されます。 |
| サーバーの応答が遅い | 最大 8 秒までしか待ちません。 |
| Linux のファイル権限 | 保管庫とバックアップを書き込むたびに `chmod 600` を実行し、本人だけが読めるようにします。 |

## 知っておくこと

- **同じ設定フォルダを使うほかのウィンドウも一緒に切り替わります。** ログインの場所はフォルダごとに 1 つなので、あるウィンドウで切り替えると、同じフォルダを使うほかの Claude ウィンドウも次のメッセージから新しいアカウントを使います。
- **アカウントごとに、月に 1 回ほどログインし直す必要があるかもしれません。** サーバーが決めるログインの有効期限（現在は約 4 週間）は、トークンを更新しても延びませんでした（サーバーの応答で確認）。その日に実際にログインが切れるかどうかは、まだ確認できていません。mod は 3 日前から知らせ、期限切れのアカウントを選ぶとログイン画面を開きます。
- **同じアカウントを別の PC や別の設定フォルダでも使っている場合、** そちらでのトークン更新によって、ここに保存したトークンが無効になることがあります。切り替えが拒否されたら、そのアカウントでログインし直してください。
- **Claude 自体の画面（`/status` など）のメールアドレス**は Claude が別に保存している値なので、切り替え後も古いメールアドレスのまま表示されることがあります。実際に使われているアカウントは、mod のステータスラインと `/account check` の「Server says」の行で確認してください。
- **`account-switch.json` と `.bak` にはログイントークンが入っています。** 共有したりコミットしたりしないでください。

## トラブルシューティング

まず `/account check` を実行してください。

```
Config folder  C:\Users\you/.claude
Login file     C:\Users\you/.claude/.credentials.json — subscription login present
Account store  C:\Users\you/.claude/account-switch.json — 2 account(s)
In use         you@example.com
Server says    you@example.com                      ← 実際に使われているアカウント
  you@example.com · Pro — login expires 2026-11-22
  work@example.com · Max — login expires 2026-11-20
```

| 症状 / メッセージ | 対処 |
|---|---|
| `/account` が Unknown command になる | `/reload-plugins` を実行します。それでも駄目なら、`claude plugin list` で有効になっているか確認し、なければインストールし直します。 |
| 「Could not confirm the current account's token」 | ネットワークの問題です。しばらくしてから再試行してください。 |
| 「token … was refused」または「login … has expired」 | `/account` を開き、そのアカウントか `+ Log in to another account` を選んで、そのアカウントでログインします。 |
| 「try once more」 | 同じコマンドをもう一度実行します。 |
| 「The account store … and its backup are both broken」 | `~/.claude/account-switch.json` と `.bak` を開いて確認します。直せない場合は両方を削除し、アカウントごとにログインし直します。 |
| API キーまたは `CLAUDE_CODE_OAUTH_TOKEN` の警告 | その環境変数を削除して、claude を起動し直します。 |
| 切り替えたのに、まだ古いアカウントのように見える | `/account check` の「Server says」の行を見てください。新しいアカウントが表示されていれば切り替えは成功しており、古いメールアドレスは Claude の表示が残っているだけです。 |
| ステータスラインに「No account」と出る | ログアウトした状態です。`/account` で選ぶか、`/login` を実行します。 |
| 「Could not read the macOS Keychain … is it locked?」 | キーチェーンがロックされています（SSH セッションなど）。Mac の画面上のターミナルで claude を起動してください。 |
| macOS で切り替えが次のメッセージに反映されない | 30 秒ほど待ってからもう一度送ってください。Claude はキーチェーンの読み取りをその程度キャッシュします。 |

## アンインストール

```sh
claude plugin uninstall account-switch
```

保管庫 `~/.claude/account-switch.json`（と `.bak`）は残ります。不要なら手動で削除してください。ログイン中のアカウントはそのまま維持されます。

## 開発

クローンしたフォルダから mod を直接読み込んでセッションを起動します。

```sh
claude --plugin-dir /path/to/claude-account-switch
```

`hooks/register.tsx` を編集したら、そのセッションで `/reload-plugins` を実行します。Claude Code 2.1.309 より前のバージョンは `/reload-plugins` でフォルダを読み直さないため、claude を再起動してください。`claude plugin validate .` でマニフェストとモジュールを検査でき、Claude Code が mod を一度読み込んだあとは `tsc -p .` で型チェックができます。

```
.claude-plugin/plugin.json        mod のマニフェスト
.claude-plugin/marketplace.json   このリポジトリを /plugin install でインストールできるようにする
hooks/hooks.json                  モジュールの一覧
hooks/register.tsx                接続: 各フックをターミナル側かデスクトップ側へ送る
hooks/cli/account.tsx             ターミナル: /account コマンド、画面、同期、切り替え、診断
hooks/desktop/                    Claude Desktop: アカウント切り替え(Windows)と帯のステータス部分
scripts/                          Claude Desktop のサインインを入れ替える PowerShell モジュール(Windows)
types/index.d.ts                  mod の状態の定義
tsconfig.json                     型チェックの設定
```

## ライセンス

MIT。デスクトップのアカウント部分（`status.tsx` を除く `hooks/desktop/` と `scripts/`）は plexxed の [claude-desktop-account-switcher](https://github.com/plexxed/claude-desktop-account-switcher)、状態部分（`hooks/desktop/status.tsx`）は George Liu の [desktop-statusline](https://github.com/centminmod/claude-plugins) から取り込んだもので、どちらも MIT です。元のライセンスは `licenses/` にあります。保存済みのデスクトップのログインは、単体の switcher と同じ `~/.claude/plugins/data/account-switcher/` に残ります。
