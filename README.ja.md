[English](README.md) | [日本語](README.ja.md)

# Contract Generator

Contract Generator は、一つの公開契約から、契約の意味を保つ C#・Rust・TypeScript のコードを生成する TypeSpec の emitter である。
言語ごとに、公開型、検証付きの構築、codec、提供側の受理と dispatch、利用側の通信処理を生成し、通信は HTTP と、host が供給する IPC の transport に対応する。
この README の読み手は、契約を記述し、生成されたコードを自分のプロジェクトで使う開発者である。

## 保証する内容

| 領域       | 保証                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 役割       | `@distinct` を付けた scalar は互いに代入できない型になり、alias は同じ型のままである                          |
| 値         | 長さは Unicode の code point で数え、±(2^53−1) を越える整数と長い十進数は値を保ち、日時は精度と offset を保つ |
| 有無       | 項目の欠落、明示的な `null`、TypeScript の `undefined` を、三つの別の入力として扱う                           |
| 構築       | local な構築と wire からの decode は一つの完成処理を共有し、受理した値か、位置と規則を持つ違反を返す          |
| 未知の入力 | 未知の object 項目は受容して位置と名前を報告し、値は捨て、未知の variant は拒否する                           |
| 既定値     | 既定値は提供側だけが、省略された項目に、HTTP・IPC・直接呼出しのいずれでも同じ規則で適用する                   |
| 結果       | 応答は、body を decode する前に、status、media type、宣言した header で選ぶ                                   |
| 失敗       | 宣言した拒否、契約の不一致、通信の失敗、取り消しを混ぜない                                                    |
| 出力       | 選んだ言語をすべて生成するか、直前の出力に手を付けないかのどちらかであり、同じ入力からは同じ bytes を生成する |

これらは [spec.md](./spec.md) に受入条件として定めてある。

## 導入

リポジトリを同じ workspace に checkout し、依存を導入して build する。
package は registry へ配布しない。

```sh
npm ci
npm run build
```

Node 24.11 以降と `@typespec/compiler` 1.17.0 が要る。

## 契約の記述

profile を import し、契約を一つの namespace に宣言する。

```typespec
import "../contract-generator/lib/main.tsp";
using ContractGenerator;

namespace Sample;

@distinct
@format("uuid")
scalar RequestId extends string;

@minLength(1)
@maxLength(3)
scalar ShortLabel extends string;

model Receipt {
  value: string;
}

@error
model Rejected {
  code: "invalid";
  message: string;
}

@outcomes
union SubmitOutcome {
  created: Receipt,
  completed: void,
  rejected: Rejected,
}

op submit(id: RequestId, label: ShortLabel, @providerDefault(3) limit?: int32): SubmitOutcome;

@@publish(submit, #["http", "ipc"]);
@@httpBinding(submit, "POST", "/submit");
@@httpResult(submit, "created", 201, "application/json");
@@httpResult(submit, "completed", 204);
@@httpResult(submit, "rejected", 400, "application/json");
@@ipcBinding(submit, "submit");
@@ipcResult(submit, "created", "created");
@@ipcResult(submit, "completed", "completed");
@@ipcResult(submit, "rejected", "rejected");
```

操作は `@outcomes` を付けた名前付きの union を返し、payload の model に `@error` を付けると、その結果は宣言した拒否になる。
成功の結果は 2xx の status に、宣言した拒否は 4xx か 5xx の status に対応付ける。

| decorator                                                 | 意味                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@distinct`                                               | その scalar を独立した役割にする                                                              |
| `@preserveLexical`                                        | その scalar は値に加えて元の綴りを保つ                                                        |
| `@outcomes`                                               | その union は操作の結果の一覧である                                                           |
| `@providerDefault(value)`                                 | 任意の項目が省略されたとき、提供側がその値を使う                                              |
| `@@publish(op, #["http", "ipc"])`                         | 列挙した binding のすべてで、その操作を生成する                                               |
| `@@httpBinding(op, method, path, body?)`                  | 経路を定め、`body` には引数名、残りの引数を表す `"*"`、body なしを表す `"-"` のいずれかを書く |
| `@@httpParameter(op, parameter, location, wireName)`      | scalar の引数を `path`・`query`・`header` のいずれかに置く                                    |
| `@@httpResult(op, outcome, status, mediaType?, headers?)` | 一つの結果を識別する status、media type、header の厳密な値を定める                            |
| `@@ipcBinding(op, command)`                               | host の transport へ渡す command 名を定める                                                   |
| `@@ipcResult(op, outcome, tag)`                           | 一つの結果を識別する応答の tag を定める                                                       |
| `@@bindingEncoding(target, binding, encoding)`            | 一つの binding に限って wire の encoding を定める                                             |

組み込みの制約、`@doc`、`@encode`、model の `@discriminator`、union の `@discriminated` は、TypeSpec の意味のまま使える。
既定値は `@providerDefault` で書き、組み込みの `= value` による既定値は拒否される。
単純な識別子でない header の key は、``#{`x-kind`: "a"}`` のように backtick で囲む。

## 生成

emitter は checkout した path で指定し、option は package 名を key にして書く。

```yaml
emit:
  - "../contract-generator"
options:
  "@yukiito1999/contract-generator":
    emitter-output-dir: "{project-root}/generated"
    namespace: Sample
    targets: [typescript, csharp, rust]
    typescript-effect-module: "./effect.js"
```

```sh
tsp compile main.tsp
```

| option                     | 必須                            | 意味                                                   |
| -------------------------- | ------------------------------- | ------------------------------------------------------ |
| `namespace`                | 必須                            | 生成する公開 namespace                                 |
| `targets`                  | 必須                            | すべて成功させる言語                                   |
| `typescript-effect-module` | TypeScript で操作を生成するとき | `Effect` と `deferEffect` を export する module        |
| `csharp-namespace`         | 任意                            | C# の namespace で、省略時は契約の namespace           |
| `rust-crate-prefix`        | 任意                            | Rust の crate 名の prefix                              |
| `check`                    | 任意                            | 公開済みの出力と比較し、差があれば書き込まずに失敗する |

出力先のディレクトリは emitter が所有する。
自分が生成していないディレクトリと、手で編集された生成ファイルは、上書きせずに拒否する。
ディレクトリは全体を一度に置き換え、置き換えが中断された場合は、次の実行で直前の出力を復元する。
利用側のリポジトリの検証入口で `check: true` を付けて実行すると、drift を検出できる。

## 出力

| path                                                               | 内容                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `typescript/contract.ts`                                           | 型、構築、codec で、依存は `ts-results-es`、`lossless-json`、`@scure/base` だけである |
| `typescript/provider.ts`、`typescript/client.ts`                   | handler の Interface と dispatch、HTTP と IPC の client                               |
| `csharp/types/`、`csharp/provider/`、`csharp/client/`              | 三つの project で、types の project は TypeModeling だけを参照する                    |
| `rust/types/`、`rust/transport/`、`rust/provider/`、`rust/client/` | 四つの crate で、types の crate は HTTP にも非同期 runtime にも依存しない             |
| `schemas/`、`http/openapi.json`、`docs/reference.md`               | 参照用の投影で、完全な検証 schema でも生成の入力でもない                              |

生成する handler の Interface は、接続のうち契約側の口である。
手書きの adapter がそれを実装して application を呼ぶので、application は生成コードに依存しない。
生成した提供側は、不正な入力、未知の操作、取り消しを型付きの結果として host へ返し、応答は host が決める。
未知の項目の診断は、その項目を含む object を `path` の JSON pointer で、項目の名前を `key` で示す。

## 言語ごとの接続

### TypeScript

生成コードは `ts-results-es` の `Result` と `AsyncResult` を返し、effect の型を自分では定義しない。
`typescript-effect-module` で指定した module は、`(env, signal, deadlineAt) => AsyncResult<A, E>` として呼べる `Effect<Env, E, A>` と、その形の関数を受け取る `deferEffect` を export する。
`createFetchTransport` は signal を引き渡し、timer を足さない。

### C#

生成する project は、TypeModeling と EffectSystem を、`v0.2.0` の tag の source checkout から参照する。
二つの checkout は `typemodeling-dotnet/` と `effectsystem-dotnet/` の名前で隣に並べる。
project の path は、MSBuild の property `TypeModelingProjectPath` と `EffectSystemProjectPath` で渡す。
EffectSystem `v0.2.0` には期限の型がないので、各操作は `DateTimeOffset? deadline` を受け取ってそのまま引き渡し、timer は host が所有する。

### Rust

生成する crate は、標準の `Result` と future を使い、取り消しには `tokio-util` の `CancellationToken` を使う。
server は host が所有し、要求ごとに `dispatch_http` か `dispatch_ipc` を呼んで、返された `ProviderFailure` を自分の応答へ対応付ける。
IPC の text を受け取る host は、数値の綴りを保つ生成済みの `parse_json` で parse する。
manifest は architecture-standard の lint を持ち、Rust 1.85 を宣言し、build、clippy の lint、test は Rust 1.94.0 で行っている。

## 制限

次のものは、emitter が宣言の位置で報告し、何も生成しない。

| 制限                                                                           | 対象                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `unixTimestamp` の encoding                                                    | C#、Rust                                         |
| `@pattern`                                                                     | C# と、`regex` crate に等価な表現がない式の Rust |
| boolean か bytes の scalar に付けた `@preserveLexical`                         | Rust                                             |
| 標準の九つの method 以外の HTTP method                                         | Rust                                             |
| path・query・header に置いた nullable な引数                                   | 全言語                                           |
| nullable な raw binary の body                                                 | 全言語                                           |
| `const` か alias を経由して参照した、binary64 の範囲を越える相異なる二つの数値 | 全言語(TypeSpec 1.17 が元の綴りを公開しないため) |

要求 body 自体が bytes の場合は、bytes のまま送る。
JSON で運ぶ場合は、`model Upload { data: bytes; }` のように object の field に bytes を置く。
body は JSON になり、その field は宣言した wire encoding に従う。

`@providerDefault` の中で入れ子にした binary64 の範囲を越える数値(`#{n: 9007199254740993}` など)は、emitter が動く前に TypeSpec 1.17 の compiler を停止させる。

IPC の binding は、host が供給する transport の上の要求と応答であり、別 process の間で test している。
Tauri の application の中では test していない。

## アーキテクチャの標準

architecture-standard は `/home/nixos/environment/architecture-standard` にある。
適合は、つねに標準の現在の本文に照らして判定する。
現行の契約と読み手向けの文書は、この README から辿る。

## ライセンス

MIT
