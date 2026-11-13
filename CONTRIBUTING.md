# CONTRIBUTING

この文書の読み手は、このリポジトリを変更する開発者である。

## 開発環境

devenv が Node、.NET SDK、Rust と clippy、C の toolchain を管理する。
作業前に、リポジトリの root で `devenv shell` を実行し、`npm ci` で依存を導入する。

生成した C# を build する検証は、TypeModeling と EffectSystem の source を使う。
`npm run prepare:native` は、`devenv.lock` に固定した二つの source を `work/native-dependencies/` へ書き込み可能な写しとして用意し、NuGet の依存を restore して脆弱性を監査する。
写しを build 出力ごと作り直すため、C# の受入を始める前に実行する。
監査は外部への接続を要するため、Medium の sandbox の外で実行する。
SDK の報告で全 project の監査が実行されたことを確かめ、監査に通った package の名前・版・SHA-512 と監査時刻を、追跡対象外の `work/native-package-audit.json` に記録する。
`npm run audit:native` は、写しを作り直さずに監査だけを実行して記録を更新する。

## ブランチ

統合ブランチは `develop`、リリースブランチは `main` である。
変更は `develop` から枝を切り、作業後に `develop` へ戻す。
`main` へは直接コミットしない。

ブランチ名には、commit の型と同じ prefix を付ける。

| prefix      | 用途                         |
| ----------- | ---------------------------- |
| `feat/`     | 機能追加                     |
| `fix/`      | バグ修正                     |
| `refactor/` | 挙動を変えない構造改善       |
| `docs/`     | ドキュメント                 |
| `test/`     | テスト                       |
| `style/`    | 挙動に影響しない表記の統一   |
| `chore/`    | 雑務・依存更新・リリース準備 |
| `ci/`       | CI 設定                      |

## コミット

commit の件名は `型: 要約` の一行で書き、型はブランチの prefix に揃え、本文は付けない。
要約の書き方は、[README](./README.ja.md#アーキテクチャの標準) が宣言する architecture-standard の `principles/documentation/commit-purpose.md` と `principles/documentation/sentence-endings.md` に従う。
一つのコミットには一つの関心だけを含め、無関係な変更は分ける。
`Co-authored-by` のような自動生成の痕跡は残さず、`commit-msg` フックがそれを拒否する。

## マージ

フックはマージコミットにも一行の `型: 要約` を求めるので、`develop` へは `--no-ff` でマージし、マージコミットを `chore: <作業名>の枝の統合` と書く。
作業ブランチは、マージした後に削除する。

## 構成

| path                        | 内容                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `lib/main.tsp`              | 契約の作者が import する profile の宣言                         |
| `src/profile/`              | TypeSpec の意味情報を解釈し、非公開の契約モデルへ正規化する処理 |
| `src/model/`                | 各言語の生成部が共有する非公開の契約モデル                      |
| `src/targets/<言語>/`       | 契約モデルからその言語のコードを生成する処理                    |
| `src/projections/`          | 参照用の JSON Schema、OpenAPI、文書の投影                       |
| `src/publication/`          | 出力ディレクトリの所有の確認と、全体を一度に置き換える公開処理  |
| `src/profile/tests/medium/` | 実 TypeSpec compiler と標準 library を使う profile の検証       |
| `tests/fixtures/`           | 共有の契約と、生成コードを呼び出す言語ごとの driver             |
| `tests/arch/medium/`        | 公開 export と生成器の依存境界の検証                            |
| `tests/integration/medium/` | compiler、filesystem、別 process、localhost を使う検証          |
| `scripts/verification/`     | 検証入口、collection の分類、size 別 runner と証跡の照合        |

TypeSpec の decorator を解釈するのは `src/profile/` だけであり、生成部は契約モデルだけを読む。
生成部が意味を保てない宣言は、黙って落とさず、元の宣言位置を持つ診断として返す。

## 検証

検証は、`devenv shell` の中で、リポジトリの root にある package scripts を入口にする。
作業単位の確定前には T1 を、push と release の前には T2 を使う。
環境の T1 の門と pre-push hook は、devenv の `scripts.verify` と `scripts.verify-push` を通じて、同じ入口を `devenv shell -- verify` と `devenv shell -- verify-push` で呼ぶ。
この二つの script は package scripts を呼ぶだけであり、検査の定義は package scripts だけに置く。

| 段                 | 入口                  | 確認する保証                                                                                                                                                              |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1                 | `npm run verify`      | build、型検査、format・lint、公開 export と生成器の依存境界、Small の test、実 compiler を使う profile・生成・公開・復旧・所有権と fixture 準備の test                    |
| T2                 | `npm run verify:push` | T1 の有効な証跡の照合と不足分、宣言した Rust 最小版での生成 Rust の実 compile と実行、生成 TypeScript・C# の実 compile と実行、HTTP・別 process の IPC、実 WebView の受入 |
| 全 test の明示実行 | `npm test`            | build と全 collection を size 別 runner で一度ずつ実行する検査であり、証跡の再利用はしない                                                                                |

T2 は T1 や全 test の入口を再帰的に呼ばず、検査ごとに証跡を照合する。
独立した継続評価の workload は採用していないため、同じ全 test を再実行するだけの T3 と `verify:full` は定義しない。
pre-push hook は `devenv shell -- verify-push` を通じて T2 を呼び、CI から呼ぶ場合も devenv の中で `npm run verify:push` を使い、その環境に必要な受入の証跡がなければ実行する。
このリポジトリは Git の global hook 設定を変更しない。

### 選択と失敗

[`scripts/verification/suites.ts`](./scripts/verification/suites.ts) が、`src/`、`tests/`、`scripts/` の全 `.test.ts` を重複のない collection へ分類する。

| collection                              | size   | 段  | 置き場                                                               |
| --------------------------------------- | ------ | --- | -------------------------------------------------------------------- |
| `small`                                 | Small  | T1  | `src/` と `scripts/` の対象のコードと同じ場所                        |
| `profile`                               | Medium | T1  | `src/profile/tests/medium/`                                          |
| `arch`                                  | Medium | T1  | `tests/arch/medium/`                                                 |
| `local`                                 | Medium | T1  | `tests/integration/medium/` の emitter・公開・fixture 準備・検証入口 |
| `typescript`、`csharp`、`rust`、`tauri` | Medium | T2  | `tests/integration/medium/` の言語ごとの受入                         |

新しい test が未分類の場合と、必須 collection が空の場合は失敗する。
選択した module の集合と実行結果を照合し、runner が返す native test ID が全て passed でなければ失敗する。
skip、未完了、収集時の失敗、実行件数 0 は合格にしない。
collection は順に実行する。
`vp test run` を直接使う局所の実行は T0 の feedback であり、size 別 runner の隔離も証跡も持たない。

### size 別 runner

Small の collection は `unshare --user --map-current-user --net` の中で実行し、loopback を含む全ての network へ接続できない。
test を実行する Vitest の worker は、読取りを一つも許可しない Node の permission model で動き、filesystem の読み書き、別 process、worker thread、native addon、内部 binding を使えない。
worker の entry は存在しない仮想 path であり、Node が entry に与える読取りの許可もどの file にも届かない。
worker の起動に要る Vitest の module と、選択した test の実行時依存 package は、[`runner-snapshot.ts`](./scripts/verification/runner-snapshot.ts) が実行前に Node の resolver で literal の import・require の閉包を解決して source ごと集め、[`small-pool.ts`](./scripts/verification/small-pool.ts) が標準入力で worker へ渡す。
worker の [`memory-loader.ts`](./scripts/verification/memory-loader.ts) はこの固定した snapshot だけから module を解決して読み込み、snapshot にない module は見つからない module として失敗させ、filesystem へ問い合わせない。
test の module と、その依存の package は Vitest の本体が変換し、IPC で worker へ渡す。
変換後にも残る CommonJS の require は、この事前に集めた package の閉包から読み込み、型だけの import は閉包へ含めない。
CommonJS の snapshot は directive prologue を保ったまま Node の `createRequire` を接続し、ESM から読み込んだ場合も同期 hook を通して依存を解決する。
snapshot file は読み書きできず、Small の test が snapshot を保存しようとすると失敗する。

Medium の collection は `bwrap` の中で実行し、root を読取り専用で bind し、repository、sandbox 専用の `/tmp` と `/dev/shm`、既存の呼び出し元の `TMPDIR`・`TMP`・`TEMP`・XDG の cache・Cargo・NuGet・.NET の cache だけを書込み可能にする。
入口は許可した非秘密の変数だけを検査へ渡し、devenv が設定した native の library path、compiler・linker の flags と、それらを有効にする Nix の host-target marker をその値のまま渡す。
network と PID の namespace を分けるため、loopback だけに接続でき、外部の network への経路を持たず、sandbox の終了時に中の process は全て終わる。
`bwrap` と `unshare` は追加の capability を要求しない。
入口は直接の子 process が閉じた後も所有する process group の終了を観測し、終了済みで回収を待つ zombie は実行中の子孫に数えない。
実行中の子孫の終了は段全体の残り時間と最大 2 秒の範囲で待ち、それでも残れば失敗とし、SIGTERM から必要に応じて SIGKILL へ進めて終了を確認する。

入口は collection を実行する前に、同じ wrapper の中で [`sandbox-probe.ts`](./scripts/verification/sandbox-probe.ts) を実行する。
この probe は、RFC 5737 の `192.0.2.1` への接続が `ENETUNREACH` で拒否されることと、loopback への接続が Medium では成功し Small では拒否されることを観測する。
Small では、同じ引数と loader で起動した worker で、repository・test runner・依存の package の読取り、一時領域への書込み、別 process と worker thread の起動、内部 binding の利用が `ERR_ACCESS_DENIED` になることも観測する。
観測が一つでも合わなければ、その collection を実行せずに失敗する。

T2 は `devenv shell`、`npm ci`、`npm run prepare:native` と必要な依存 cache の準備を前提とする。
Medium の受入は外部の network へ接続できないため、NuGet・Cargo の依存と WebView の Cargo の依存は事前に取得する。
必要な toolchain、sandbox の道具、source project、GUI 用の native library がない場合は、skip ではなく失敗する。
C# の隔離した restore は監査を繰り返さず、解決した全 package の名前・版・SHA-512 が監査記録と一致することを確かめてから build する。
監査記録がない場合と内容が一致しない場合は失敗する。
この記録は監査時点の脆弱性情報を表し、現在も脆弱性がないことの保証ではないため、公開前にはオンラインで再監査する。
`npm run verify:push` の `rust` collection は、実行の前に `RUSTC` を尊重した `rustc` と `cargo` が `src/targets/rust/dependencies.ts` の `rustMinimumVersion` と完全に同じ版であることを確かめ、`RUST_CONTRACT_EXACT_MINIMUM=1` を付けて実行する。
この変数を受けた collection の fixture helper も同じ版を要求し、合わなければ全ての Rust の test file が読み込みの時点で失敗する。
新しい版、古い版、版を読み取れない出力は失敗とし、確かめた版は証跡の環境に記録する。
証跡の照合は、この要求を含む環境で記録した結果だけを `verify:push` の `rust` の証跡として使い、新しい compiler や `npm test` で記録した結果は使わない。
Rust の最小版のための別の test は置かず、同じ `rust` collection の既存の test が、その版の実際の compiler で生成 crate を build して実行する。
`npm test` と開発中の fixture helper は、この変数がなければ `rustMinimumVersion` 以上の版を受け入れる。
Rust と WebView の初回の依存取得は受入走行と分け、[fixture の手順](./tests/fixtures/tauri/README.md) に従う。
検証入口は `RUST_CONTRACT_FETCH=0` を設定し、受入の途中で Rust の依存を取得しない。

### 証跡の再利用

成功の証跡と走行記録は、Git の追跡対象外の `work/verification/` に置く。
証跡には command、source の依存閉包と動的に読む fixture、設定、依存、toolchain・sandbox の道具と非秘密の実行環境、native test ID、結果の出所と経過時間を残す。
呼び出し元の session を表す値は検査の結果を変えないため、証跡の照合から除く。
除く値は `PATH`、`USER`、`LOGNAME`、`TMPDIR`・`TMP`・`TEMP`、`DISPLAY`・`WAYLAND_DISPLAY`・`XDG_RUNTIME_DIR`・`DBUS_SESSION_BUS_ADDRESS`、`CARGO_BUILD_JOBS`・`NIX_BUILD_CORES` であり、変数ごとの理由は [`environment.ts`](./scripts/verification/environment.ts) の `callerVariables` に書く。
`PATH` を除く代わりに、検査が名前で起動する実行 file を呼び出し元の `PATH` で解決し、その real path を照合に含めるため、別の tool へ入れ替わった実行は再利用しない。
対象の名前は [`executables.ts`](./scripts/verification/executables.ts) が検査ごとに列挙し、`git` は `check` が file の一覧を問うだけでどの git でも結果が変わらないため、実行 file でなく版だけを確かめる。
インストールした npm の依存、C# の写した依存 source と props・analyzer は内容で照合する。
`node_modules/.vitest-cache` は Vitest が実行中に作る変換結果であり、インストールした依存の内容には含めない。
package 内の source は、同名の directory を含めて引き続き照合する。
Cargo と NuGet の package cache は、版ごとに不変な package の名前と版の一覧と、NuGet の package hash で照合する。
build は `dist/` の内容も照合し、生成物の削除や編集で失効させる。
source と入力は検査の前後で照合し、途中で変わった検査に成功の証跡を作らない。

たとえば C# の生成部の変更はその生成部に到達する検査を失効させ、C# の依存 source の変更は C# の受入を失効させる。
無関係な README の変更だけでは native の証跡を失効させないが、format の入力が変わるため `check` は再実行する。
tool の存在と版は再利用の前にも調べ、必要な tool が消えた実行を過去の成功で通さない。
解決できない user・親 directory の native tool 設定は内容に秘密を含み得るため hash せず、その設定を読む検査の再利用だけを止める。
C# の検査は、user の NuGet 設定（`~/.nuget/NuGet/NuGet.Config`、`~/.config/NuGet/NuGet.Config`）と、依存 source の親 directory にある MSBuild・NuGet の設定で再利用を止める。
Rust の検査は、`$CARGO_HOME` の Cargo 設定（`config.toml`、`config`）で再利用を止める。
NuGet の設定は Rust の検査に、Cargo の設定は C# の検査に関わらないため、互いの再利用を止めない。
WebView の受入は、実行時に作る Xvfb・D-Bus と描画経路の状態を source の同一性で保証できないため、毎回実行する。
証跡は同じ local 実行者の結果の再利用用であり、署名済みの CI attestation や第三者の結果の信頼検証ではない。

失敗・中断した検査は成功の証跡を作らず、新しい試行の前にその検査の古い証跡を外す。
再実行では、修正の影響が届く検査と未完了の検査だけを選び、影響のない成功は再利用する。
入口は自動 retry を行わず、原因への修正や環境の回復を確かめてから再開する。
証跡を破棄しても source は失われず、次の走行が必要な検査を実行する。

### 時間と資源

一走行の資源保護の上限と feedback の目標は、[`tiergate.json`](./tiergate.json) を正本とする。
key は npm の script 名ではなく環境の段の名前であり、`verify` の上限は `verify`、`verify:push` と `npm test` の上限は `verify-push` に置く。
上限は Node の起動・入力の照合・build・検査・資源待ち・結果確定を含む tier 全体に適用し、外側の runner も同じ `seconds` を使う。
上限に達した検査と caller の取り消しでは、所有する process group を停止し、直接の子 process の終了を回収してから失敗を返す。
Medium の sandbox では、PID namespace の終了が中の全ての process を終わらせる。
停止の猶予は上限の延長や追加の検査時間ではない。
走行の開始後に上限を延ばさず、未実行と中断を成功へ書き換えない。
`attempts.jsonl` は中断や失敗を含めた各走行の経過時間と選択を残す。
T2 の上限は、証跡が一つも再利用できない走行の実測から 1200 秒にした。
初期の 900 秒は、以前の全 native 走行が準備済み WSL2 で約9分だったことを根拠としていた。
証跡が無い状態の `verify:push` を同じ WSL2 で 5 回測ると、build から typescript までが 32〜34 秒、csharp が 168〜182 秒、rust が 569〜651 秒、tauri が 105〜118 秒だった。
rust が 681 秒を超えて切れた回があるため、合計は約 890 秒から 1,015 秒以上であり、900 秒では 1 回が 891 秒で通り、4 回が rust の途中か tauri の開始後に切れた。
1200 秒は、この最大に約 2 割の余裕を足した値である。
上限の延長だけで時間の問題を解決したとはせず、通常の走行は証跡の再利用で収め、feedback の目標を 600 秒に置く。
C# の検査が毎回走っても、証跡が再利用できる走行は 272〜290 秒だった。
T1 の上限と目標は分割後の初回計測の前に置いた値であり、`attempts.jsonl` の実測で見直す。
`npm test` は T2 と同じ上限を使う。
累積時間は重複・固定費・競合を見直す材料とし、有効な修正後の再開を累積消費だけで止めない。

lint は警告を失敗として扱い、file は 300 行、関数は 50 行、ネストは 4 段を上限とする。
上限は抑止の指示で回避せず、責務ごとに file と関数を分ける。
root の型検査と lint は、WebView の受入を起動する Node 側の `tests/fixtures/tauri/` の module も対象にする。
期待値は契約から定め、生成器の関数や生成物の出力から計算しない。
生成コードへ入力を中継する driver は、生成コードを呼び出すだけにし、生成器と同じ検証を driver の中に実装しない。
利用側の言語で書く契約の test は、契約から定めた期待値を持ち、保証の一つひとつを個別の test として報告する。

## 文書

公開する文書は、README(英語)、README.ja(日本語)、CHANGELOG(英語)、CONTRIBUTING、LICENSE、spec.md である。
README は英語版を正本とし、日本語版を同じ変更で正本に合わせる。
生成器が保証する内容を変えるときは、同じ変更で `spec.md` の受入条件を改める。
日本語の文書は、architecture-standard の `principles/documentation/sentence-endings.md` に従い、段落と箇条書きを句点で終わる完結した文で書き、一つの文を一行に置く。
継続する読み手のための文書は `docs/` に置いて Git で追跡し、計画、調査、実験、下書きは Git の追跡対象から除外した `work/` に置く。
設計判断の理由は、`work/` だけに残さず、コード、テスト、commit、実装コメントから辿れるようにする。

## リリース

1. `develop` の `devenv shell` で、外部へ接続できる状態で `npm run audit:native && npm run verify:push` を実行し、再監査と全ての受入の成立を確かめる。
2. `CHANGELOG.md` に、セマンティックバージョニングに従う該当バージョンの節を追記する。
3. `chore: X.Y.Z のリリース準備` でコミットし、`develop` へマージする。
4. `main` を該当コミットへ進め、`vX.Y.Z` タグを付ける。

registry へは配布せず、利用側は checkout したリポジトリのリリースタグを参照する。
