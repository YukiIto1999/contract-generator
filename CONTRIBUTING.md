# CONTRIBUTING

この文書の読み手は、このリポジトリを変更する開発者である。

## 開発環境

devenv が Node、.NET SDK、Rust と clippy、C の toolchain を管理する。
作業前に、リポジトリの root で `devenv shell` を実行し、`npm ci` で依存を導入する。

生成した C# を build する検証は、TypeModeling と EffectSystem の source を使う。
`npm run prepare:native` は、`devenv.lock` に固定した二つの source を `work/native-dependencies/` へ書き込み可能な写しとして用意する。
このコマンドは写しを build 出力ごと作り直すので、依存の restore より前に実行する。

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

フックはマージコミットにも一行の `型: 要約` を求めるので、`develop` へは `--no-ff` でマージし、マージコミットを `chore: <作業名>の枝を統合` と書く。
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
| `tests/fixtures/`           | 共有の契約と、生成コードを呼び出す言語ごとの driver             |
| `tests/integration/medium/` | compiler、filesystem、別 process、localhost を使う検証          |

TypeSpec の decorator を解釈するのは `src/profile/` だけであり、生成部は契約モデルだけを読む。
生成部が意味を保てない宣言は、黙って落とさず、元の宣言位置を持つ診断として返す。

## 検証

検証は、`devenv shell` の中で、リポジトリの root から `npm run verify` として実行する。
環境の検証の門は、devenv の `scripts.verify` を通じて同じ入口を `devenv shell -- verify` で呼ぶ。
この入口は、build、型検査、format と lint の検査、test を順に実行する。
lint は警告を失敗として扱い、file は 300 行、関数は 50 行、ネストは 4 段を上限とする。
上限は抑止の指示で回避せず、責務ごとに file と関数を分ける。

生成した C# と Rust を build して実行する test は、`devenv shell` の中で、`npm run prepare:native` を済ませた状態でだけ動く。
toolchain が無い環境では、それらの test は skip され、実行していないことを stderr へ出力する。
skip された実行を、生成物の検証が済んだ結果として扱わない。

Rust の test は、crate を offline で build する。
最初の一回だけ、`RUST_CONTRACT_FETCH=1` を付けて依存を取得する。

生成部を変えたら、`lib/main.tsp` が読み込む `dist/` を `npm run build` で作り直してから、`tsp compile` を使う検証を実行する。

期待値は契約から定め、生成器の関数や生成物の出力から計算しない。
生成コードへ入力を中継する driver は、生成コードを呼び出すだけにし、生成器と同じ検証を driver の中に実装しない。
利用側の言語で書く契約の test は、契約から定めた期待値を持ち、保証の一つひとつを個別の test として報告する。
同一 process で完結する test は対象のコードと同じ場所に置き、filesystem、別 process、socket を使う test を `tests/integration/medium/` に置く。

## 文書

公開する文書は、README(英語)、README.ja(日本語)、CHANGELOG(英語)、CONTRIBUTING、LICENSE、spec.md である。
README は英語版を正本とし、日本語版を同じ変更で正本に合わせる。
生成器が保証する内容を変えるときは、同じ変更で `spec.md` の受入条件を改める。
日本語の文書は、architecture-standard の `principles/documentation/sentence-endings.md` に従い、段落と箇条書きを句点で終わる完結した文で書き、一つの文を一行に置く。
継続する読み手のための文書は `docs/` に置いて Git で追跡し、計画、調査、実験、下書きは Git の追跡対象から除外した `work/` に置く。
設計判断の理由は、`work/` だけに残さず、コード、テスト、commit、実装コメントから辿れるようにする。

## リリース

1. `develop` で、`devenv shell` の中から `npm run verify` を実行し、C# と Rust の test が skip されていないことを確かめる。
2. `CHANGELOG.md` に、セマンティックバージョニングに従う該当バージョンの節を追記する。
3. `chore: X.Y.Z のリリースを準備` でコミットし、`develop` へマージする。
4. `main` を該当コミットへ進め、`vX.Y.Z` タグを付ける。

registry へは配布せず、利用側は checkout したリポジトリのリリースタグを参照する。
