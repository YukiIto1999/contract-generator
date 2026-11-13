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

Node は 24.11 以降の 24 系か 26 以降を使い、`@typespec/compiler` は 1.17.0 を使う。

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

経路は、空でなく、`.` でも `..` でもない segment からなる絶対 path にする。
`.` と `..` は、百分率符号化した綴りも拒否する。
空の segment は、末尾の slash に限って許し、placeholder は segment の全体を占める。
生成した client は、設定した origin の外へ要求を送らない。
path に置く値が空、`.`、`..` のいずれかであるとき、または header に置く値が水平 tab 以外の制御文字を含むとき、その値には wire の形がないので、送信する前に通信の失敗を返す。

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
公開処理は、隣接する `.<output>.contract-generator.lock` で、同じ規約を使う生成器の所有を排他的にする。
競合する生成や drift 検査は `output-conflict` で失敗し、待機も所有の奪取もしない。
置き換えでは旧い出力を退避してから新しい出力を配置するため、この規約に参加しない reader からは、その間だけ出力がないように見えることがある。
原子的な swap や、電源断に対する永続性の保証ではない。
通常の終了では所有を解放するが、process を強制終了すると所有の印と旧い出力が残ることがある。
emitter は印を削除せず競合を報告し、復旧には所有者が残っていないことの確認と、報告された退避先の保全を済ませてから残存した印を取り除く必要がある。
排他的な所有を得た通常の生成は、出力がなく、検証済みで未編集の旧い出力が一つだけ残っている場合に、それを復元してから処理を続ける。
利用側のリポジトリの検証入口で `check: true` を付けて実行すると、所有の取得や中断からの復旧を行わずに drift を検出できる。

## 出力

| path                                                               | 内容                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript/contract.ts`                                           | 型、構築、codec。`ts-results-es`、`lossless-json`、`@streamparser/json` 0.0.26、`@scure/base` と、pattern がある場合だけ `re2js` に依存する |
| `typescript/provider.ts`、`typescript/client.ts`                   | handler の Interface と dispatch、HTTP と IPC の client                                                                                     |
| `csharp/types/`、`csharp/provider/`、`csharp/client/`              | 三つの project で、types の project は TypeModeling だけを参照する                                                                          |
| `rust/types/`、`rust/transport/`、`rust/provider/`、`rust/client/` | 四つの crate で、types の crate は HTTP にも非同期 runtime にも依存しない                                                                   |
| `schemas/`、`http/openapi.json`、`docs/reference.md`               | 参照用の投影で、完全な検証 schema でも生成の入力でもない                                                                                    |

生成する handler の Interface は、接続のうち契約側の口である。
手書きの adapter がそれを実装して application を呼ぶので、application は生成コードに依存しない。
生成した提供側は、不正な入力、未知の操作、取り消しを型付きの結果として host へ返し、応答は host が決める。
未知の項目の診断は、その項目を含む object を `path` の JSON pointer で、項目の名前を `key` で示す。

TypeScript の `create`、`decode`、`fromWire`、提供側の入力受理は、失敗時に `BoundaryRejection` を返す。
既知の項目の違反は `error.violations`、未知の項目の診断は `error.diagnostics` から読む。
既知の項目が不正な場合も診断は残すが、未知の値はいずれの配列にも含めない。
`encode` と `toWire` の失敗型は、引き続き違反の配列である。

TypeScript の codec は、深さの上限を契約に設けず、呼出し stack に依存しない同期処理を行う。
構築済みの不変な子は再利用し、宣言した項目をたどって祖先へ戻る循環は拒否するが、同じ子の共有は拒否しない。
未知のローカル項目の値は読み取らない。
`encode` は JSON を直接書き出し、`toWire` は独立して所有できる binding の値を作る。
入力を受け入れる前の byte 数の制限と送信前の出力制限は、host が担う。

JSON の wire profile は、値が等しい場合、escape を解くと名前が等しくなる場合、未知の部分にある場合も含め、object の項目名の重複を拒否する。
文字列と UTF-8 byte 列の入口はいずれも、先頭の BOM と不正な Unicode を置換せずに拒否する。
文字列や項目名の中の U+FEFF、ほかの正しい Unicode、数値の厳密な綴りは、正規化や binary64 の範囲制限を加えずに保つ。
これらの規則で曖昧になる入力は、修復も正規化もせずに拒否する。

## 言語ごとの接続

### TypeScript

生成コードは `ts-results-es` の `Result` と `AsyncResult` を返し、effect の型を自分では定義しない。
`typescript-effect-module` で指定した module は、`(env, signal, deadlineAt) => AsyncResult<A, E>` として呼べる `Effect<Env, E, A>` と、その形の関数を受け取る `deferEffect` を export する。
`createFetchTransport` は signal を引き渡し、timer を足さない。

生成した module の実行時依存は、利用する application に直接 install する。

```sh
npm install --save-exact ts-results-es@7.1.0 lossless-json@4.3.3 @streamparser/json@0.0.26 @scure/base@2.4.0
```

pattern を含む生成 module を使う application は、自身の `package.json` に `"re2js": "2.10.0"` を直接の実行時依存として宣言する。
生成器の推移的な依存の install に頼らない。
生成するのは TypeScript の source であり、consumer の package manifest ではない。
pattern のない module は RE2JS を import しない。
生成器も pattern の事前検査と定数の検証に RE2JS を使う。
`@eslint-community/regexpp` 4.12.3 は生成器だけが使う parser の依存であり、生成コードは import しない。

### C#

生成する project は、[TypeModeling `v0.3.0`](https://github.com/YukiIto1999/typemodeling-dotnet/tree/v0.3.0) と [EffectSystem `v0.3.0`](https://github.com/YukiIto1999/effectsystem-dotnet/tree/v0.3.0) の source を参照する。
二つの checkout は `typemodeling-dotnet/` と `effectsystem-dotnet/` の名前で隣に並べる。
project の絶対 path は、MSBuild の property `TypeModelingProjectPath` と `EffectSystemProjectPath` として、command line の global property か環境変数で渡す。
利用側の `.csproj` だけに置いた property は参照先へ伝わらない。
共有する `Directory.Build.props` から渡す場合は、生成した project にもその設定が適用される配置にする。
生成する三つの project は `csharp/Contract.Analysis.props` を import し、既存の `TypeModeling.Analyzers` を参照して網羅性の診断をエラーにする。
analyzer の assembly は実行時の依存には含めない。
MSBuild の project 参照では analyzer の参照と警告の方針が伝播しないため、利用側の各 project も同じ生成ファイルを import する。
利用側の SDK project 内で、`GeneratedContractRoot` をその project から見た生成出力への相対 path とし、次を追加する。

```xml
<PropertyGroup>
  <GeneratedContractRoot>../generated</GeneratedContractRoot>
</PropertyGroup>
<Import Project="$(GeneratedContractRoot)/csharp/Contract.Analysis.props" />
<ItemGroup>
  <ProjectReference Include="$(GeneratedContractRoot)/csharp/types/Contract.Types.csproj" />
</ItemGroup>
```

利用側の project の directory から次を実行し、`/absolute/path` は二つの source checkout がある directory に置き換える。

```sh
dotnet build Consumer.csproj \
  -p:TypeModelingProjectPath=/absolute/path/typemodeling-dotnet/src/TypeModeling/TypeModeling.csproj \
  -p:EffectSystemProjectPath=/absolute/path/effectsystem-dotnet/src/EffectSystem/EffectSystem.csproj
```

types の単位だけを使う consumer では、`EffectSystemProjectPath` を省ける。
生成する provider と client は、`EffectSystem.Analyzers` を参照して利用規則の診断をエラーにする `csharp/Contract.EffectAnalysis.props` も import する。
`Effect` を使う consumer は、`Contract.Analysis.props` の後に次の import を加える。

```xml
<Import Project="$(GeneratedContractRoot)/csharp/Contract.EffectAnalysis.props" />
```

どちらの import も、analyzer の assembly を実行時の依存には含めない。
共有した import は、analyzer の project がない場合に検査を黙って省かず、エラーにする。
閉じた型の switch は全 variant を列挙し、default・discard の arm を置かない。
生成する global analyzer configuration は `TYPMOD021` を有効にし、閉じた型に対する明示的な catchall arm を拒否する。
利用側にも `Contract.Analysis.props` を通して設定が届くため、新しい variant には明示的な case の追加が必要になる。
Effect を組み立てる method は deadline 引数を持たない。
composition root が clock、期限の診断先、絶対期限 `Deadline`、期限超過時の failure factory を `EffectRuntime` に渡し、native effect は `Try` から同じ期限を受け取る。
IPC transport は `Deadline` と末尾の cancellation token を受け取り、HTTP handler は `ContractClient.DeadlineOption` の `HttpRequestOptionsKey<Deadline>` から期限を読む。
配列は `ImmutableArray<T>` を内部に持つ nominal な immutable wrapper `<ArrayName>Codec.Value` になる。
codec の内部に型を置くため、契約の最上位名に新しい除外を設けない。
構造体の default 値は無効であり、factory が呼び出し側の collection をコピーして要素を検証する。
object、配列、union、provider default の走査には private な作業 stack を使い、契約上の深さ制限を設けない。
変更のない受理済みの子は同じ値を再利用する。
object と provider の受理済み model は、再帰的な等価性や `with` による複製を持つ record ではなく、get-only property を持つ sealed class であり、等価性は参照で決まる。
配列の値は、不変な内部 storage の同一性で比較する。
union と outcome の record は網羅できる case を保つが、複合 payload の比較・hash・文字列化では object graph を再帰的にたどらない。
これらを wire 上の値の同値判定には使わず、値の構築と入出力には生成した factory と codec を使う。
JSON の受理では、未知の値の内部も含めて、重複名、先頭の BOM、不正な Unicode を拒否する。
有効な文字と数値の意味は保持し、入力 byte 数や出力サイズの制限は host が所有する。

### Rust

生成する crate は、標準の `Result` と future を使い、取り消しには `tokio-util` の `CancellationToken` を使う。
server は host が所有し、要求ごとに `dispatch_http` か `dispatch_ipc` を呼んで、返された `ProviderFailure` を自分の応答へ対応付ける。
IPC host は元の UTF-8 JSON `String` をそのまま `dispatch_ipc` へ渡し、生成した envelope の text を返す。
`IpcTransport` も同じ text の境界を使う。
Tauri command は汎用の JSON DOM ではなく文字列を受け取り、framework による先行 parse の深さ制限や数値の正規化を避ける。
再帰する値の構築、decode、encode、default、等価性、debug 表示、clone、解放は、値の深さに比例する呼出し stack を使わない。
不変な複合 payload を共有し、借用や clone で子孫の graph をコピーしない。
文字列と UTF-8 byte 列の decode は、未知の部分にある重複名も含め、前述の JSON wire profile を検査する。
生成した Rust README は、宣言の graph から求めた `recursion_limit` を consumer の各 crate root に指定する。
この compiler の許容量は実行時の JSON の深さとは別であり、依存先から継承されない。
生成型を所有する独立した binary や結合 test の root にも指定する。
manifest は architecture-standard の lint を持ち、Rust 1.94.0 以降の互換性のある compiler を要求する。
サポートの下限は固定した native 受入環境に合わせている。
edition の下限は、その compiler での動作を確認した値ではないため、サポートの下限にしない。
最低版の証明は、既存の Rust native の検証群を `RUST_CONTRACT_EXACT_MINIMUM=1` で一度だけ実行することであり、rustc と Cargo の両方が 1.94.0 そのものでなければ失敗する。
この検証群が、三つの固定契約の全依存単位を build し、公開した構築と codec の結果を観測する。
この指定のない通常の native build は、より新しい互換性のある compiler も受け入れる。

## 制限

次のものは、emitter が宣言の位置で報告し、何も生成しない。

| 制限                                                                           | 対象                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `unixTimestamp` の encoding                                                    | C#、Rust                                                            |
| 下記の安全な共通 profile に含まれない `@pattern`                               | Rust だけを生成する場合も含め、全言語                               |
| 共通 profile 内の `@pattern`                                                   | C# は引き続き未対応。Rust は `regex` に等価な表現がある場合だけ対応 |
| boolean か bytes の scalar に付けた `@preserveLexical`                         | Rust                                                                |
| 標準の九つの method 以外の HTTP method                                         | Rust                                                                |
| path・query・header に置いた nullable な引数                                   | 全言語                                                              |
| nullable な raw binary の body                                                 | 全言語                                                              |
| `const` か alias を経由して参照した、binary64 の範囲を越える相異なる二つの数値 | 全言語(TypeSpec 1.17 が元の綴りを公開しないため)                    |

要求 body 自体が bytes の場合は、bytes のまま送る。
JSON で運ぶ場合は、`model Upload { data: bytes; }` のように object の field に bytes を置く。
body は JSON になり、その field は宣言した wire encoding に従う。

`@providerDefault` の中で入れ子にした binary64 の範囲を越える数値(`#{n: 9007199254740993}` など)は、emitter が動く前に TypeSpec 1.17 の compiler を停止させる。

### 安全な pattern の profile

`@pattern` は任意の機能であり、ECMAScript の Unicode (`u`) の意味を持つ、明示した部分集合だけに対応する。
他の flag は使わない。
この制限は TypeScript の生成部だけでなく、共通の記述 profile 全体に適用する。
Rust の engine で実行できる式でも、Rust だけを生成する前に拒否されることがある。
C# は引き続き全 pattern を拒否し、Rust には生成先固有の追加制限が残る。

対応するのは、Unicode scalar の literal と escape（正しく対になった surrogate escape を含む）、連結、空の選択肢を含む選択、通常・非捕捉・名前付きの group、および engine の compile 制限内の貪欲・非貪欲な `?`、`*`、`+`、回数指定である。
検証結果は真偽値だけなので、捕捉と捕捉名は除去する。
非 multiline の厳密な `^` と `$`、dot、文字 class と範囲、class の和集合と補集合（空 class とその否定を含む）、`\d`、`\D`、`\w`、`\W`、`\s`、`\S` にも対応する。
dot が除くのは LF、CR、U+2028、U+2029 だけであり、数字は ASCII の `0–9`、word 文字は ASCII の英字・数字・underscore である。
空白の集合は U+0009–000D、U+0020、U+00A0、U+1680、U+2000–200A、U+2028–2029、U+202F、U+205F、U+3000、U+FEFF に限り、大文字の escape は対応する集合の補集合を表す。
Unicode 正規化や暗黙の全文一致は行わない。
式 `a` は `"ba"` に一致し、`^a$` は `"a\n"` に一致しない。

後方参照、全ての先読み・後読み、文字 class 外の単語境界 assertion (`\b`、`\B`)、Unicode property escape、inline flag、孤立 surrogate の literal、および他の未対応構文は拒否する。
engine の compile 制限により、構文上は正しい `a{1001}` や `(a{40}){40}` も拒否する。
この制限は入力文字列の長さ制限ではない。
不正な構文は `invalid-pattern`、正しい構文でも未対応の式は宣言位置付きの `unsupported-pattern` となる。
これらは既定値の正規化・検証や有限値域の評価より前に判定し、選択した全出力の公開を止める。
TypeScript の直接 render も、同じ適格性検査に失敗した式を `typescript-pattern` として拒否する。

生成 TypeScript は元の文字列を同期的に RE2JS で照合する。
異なる pattern source ごとに生成 module 内で一度 compile し、全文一致の `.matches` ではなく `.test` を呼ぶ。
生成器が所有する既定値と literal・enum の値域検査も同じ安全な実行器を使い、いずれも契約に書かれた式を native `RegExp` で実行せず、そこへ fallback しない。
受理した固定の式に対する破局的なバックトラッキングを除く保証であり、任意に長い入力、多数の field、多数の式に対する総作業量の上限を保証するものではない。
要求サイズの制限、scheduling、resource budget は host が所有する。
保証の境界は生成器が所有する profile と実行経路から始まる。
emitter の事前検査より前に、TypeSpec 1.17.0 の `@pattern` decorator は native `RegExp(pattern)` を構築して構文を調べ、元の source を保存する。
この decorator 自体は照合しない。
生成器が所有する照合を置き換えても、frontend の native 正規表現の parse はなくならず、任意の悪意ある compiler 入力に対する処理全体の resource 上限を保証するものではない。

値の種類を調べた後、その値の code point 長や UUID の検査に違反があれば、同じ値の pattern 検査を省ける。
その違反は残し、兄弟項目と独立した field の検証は続ける。
一つの値で失敗する全規則を列挙する保証はない。
pattern を実行して不一致だった場合は、引き続き `format` 違反となる。
pattern の検証にも共通の結果型を使う。
成功は受理した値と未知項目の診断を持ち、失敗は違反と検出済みの診断を保持して、部分的に受理した値を返さない。

内部モデルと JSON Schema・OpenAPI の投影には、翻訳後の RE2JS の式ではなく元の ECMAScript source を残す。
外部 schema validator の実行安全性はその利用側が所有し、生成 runtime の保証は引き継がれない。
browser や Tauri の互換性は、生成物と必要な依存を組み込んだ対象環境で確かめる。

IPC の binding は、host が供給する transport の上の要求と応答である。
fixture には、汎用の別 process 間 transport と、生成した TypeScript consumer から Rust の provider dispatch へ接続する[実 Tauri/Wry webview](./tests/fixtures/tauri/README.md)がある。
desktop fixture の対象は GTK3 と WebKitGTK 4.1 を使う Linux であり、Windows、macOS、mobile での受入を示すものではない。

## 検証

リポジトリの root で `npm run verify` を実行すると、作業単位の build・型・format・lint・module 境界・Small の test と、local compiler・公開処理の受入を確認する。
push と release の準備の前には、準備済みの開発環境で `npm run verify:push` を実行する。
検査ごとの同じ入力の証跡を再利用し、不足する検査と生成 TypeScript・C#・Rust・実 WebView の受入を実行し、必要な tool がなければ skip ではなく失敗する。
C# の依存準備では、オンラインで package の依存を監査し、隔離した受入で照合する hash を記録する。
この記録は監査時点の情報であるため、release の検証前には `npm run audit:native` で更新する。
`npm test` は build を作り直し、証跡を再利用せず全 test collection を size 別 runner で実行する。
同じ一式を重複して実行する `verify:full` の別名は置かない。
準備・test の size と sandbox 化した runner・証跡の失効・資源上限は、[CONTRIBUTING](./CONTRIBUTING.md#検証) に記載する。

## アーキテクチャの標準

architecture-standard は `/home/nixos/environment/architecture-standard` にある。
適合は、つねに標準の現在の本文に照らして判定する。
現行の契約と読み手向けの文書は、この README から辿る。

## ライセンス

MIT
