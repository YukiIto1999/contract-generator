---
mechanism: contract-generator
---

# Contract Generator

公開契約の作者が、操作、入出力、値の制約、型の役割と通信上の対応をTypeSpecで記述し、その意味を保つC#・Rust・TypeScriptのコードを生成するためのライブラリである。
業務モデル、application Interface、業務判断は入力にも生成物にも含めない。
生成したhandler Interfaceとapplication Interfaceの対応は、利用側の手書きAdapterが所有する。

## 生成の境界

TypeSpec compilerが構文解析と型解決を所有する。
このライブラリは明示したprofileの意味を解釈し、非公開の契約モデルへ一度だけ正規化する。
各言語の生成部は、そのモデルから公開型、検証付き構築、codec、提供側の受理とdispatch、利用側の通信処理を生成する。
OpenAPI・JSON Schema・参照文書は投影であり、生成の中間形式にはしない。
投影で表せない保証を完全な検証契約と誤認させず、用途と欠落を出力へ明記する。

CLIを別に作らず、TypeSpecの`tsp compile`からemitterを呼ぶ。
一つの公開namespaceを設定で選び、対象言語を明示する。
操作が要求するbindingと、生成対象の言語の組をすべて生成できた場合だけ更新を成功させる。
出力先は生成器が所有すると確認できるディレクトリに限り、失敗した生成で利用者のファイルや直前の成功した出力を上書きしない。
同じ出力を更新する生成器は、所有確認と中断からの復旧を含めて排他的に動作する。
別の更新が所有している出力は競合として拒否し、残存した所有を時刻やprocess IDだけで奪わない。
driftの検査は所有の取得・解放や中断からの復旧を行わず、更新中の出力も競合として拒否する。
ディレクトリの入れ替えは二段階であり、任意の外部readerに対する原子的な可視性や電源断時の永続性を保証しない。
同じ入力とtoolchainからの生成結果に、時刻、絶対パス、宣言の探索順を含めない。
契約の説明文、項目名、tag、literalの値は、生成した各言語のcode内でもデータとして扱う。
説明文は、改行や行区切りの文字によって文書の外へ出さず、文字列literalは宣言した値を変えずに表す。
説明文に含まれるコードブロックを、生成物のbuildや試験で実行しない。

## 型と値

型の役割の違いは相互代入できない型で表し、aliasは同じ型への参照として扱う。
fieldの通常の制約だけを理由にwrapperを増やさない。
C#の閉じた結果の分岐は、既存analyzerで網羅性を検査するswitch式を使い、default・discardで未処理のvariantを隠さない。
網羅性のanalyzer参照とエラー設定は、生成したprojectと利用側のprojectが同じ生成済みの設定をimportして適用する。
検証専用の設定で利用側への配布不足を補わない。
Effectを使うC#の公開単位とそのconsumerは、同じ生成済みの設定からEffectSystem.Analyzersも適用し、未構築のEffectなどの利用規則違反をcompile時のエラーにする。
任意精度の数値や日時の字句保持に必要な表現は、役割を区別する型とは別の判断として選ぶ。
必要なprofileには、object、配列、判別子付きunion、literal、nullable、optional、UUID、Unicode code point単位の長さ、整数の値域、正確な十進数、offset付き日時、bytesを含める。
安全整数範囲外の整数、小数秒の精度、日時のoffset、年0000、うるう秒を生成先の既定型の都合で欠落させない。
encodingはbindingごとに解釈し、異なるbindingの指定を後勝ちで上書きしない。
三言語の構築とdecodeは、同じ値を受理し、同じ値を拒否する。
`utcDateTime`はoffsetが零の表記だけを受理し、`offsetDateTime`は任意のoffsetを保つ。
`duration`は、日時の形式に加えて、単独の`PnW`の形式を受理する。

構築とdecodeは、受理した値と診断、または位置と規則を持つ違反と検出済みの診断をResultとして返す。
通常の入力違反を例外で返さず、違反と同時に部分的に有効化した値を返さない。
両者は内部の完成処理を共有し、decode済みのgraphを公開constructorへ戻して再検証しない。
受理した複合値は外部の可変aliasから独立し、不変な子を不要に複製しない。
型消去や言語の既定値による迂回は送信前に拒否する。

有限の正規値を、言語のcall stackの深さによって拒否しない。
構築、decode、既定値の適用、wireへの変換、encode、破棄を含め、公開するclone・比較・hash・表示の既存の意味も深い値で維持する。
可変入力の循環は拒否し、独立した枝が同じ子を共有するDAGは循環と扱わず、それぞれのwire位置へ出力する。
入力と出力のbyte数の予算はhostが所有し、生成物に独自の深さ上限や予算の結果型を足さない。

JSONのwire profileは、未知項目のsubtreeも含めて重複する項目名を拒否する。
同じ値を持つ重複も、escapeを解釈した後に同じ名前となる重複も拒否する。
先頭のBOM、不正なUTF-8、対応のないUTF-16 surrogateを拒否し、置換文字による修復を行わない。
文字列や項目名の中のU+FEFFと有効なUnicode noncharacterは保持し、Unicodeの正規化やI-JSONの数値制限を加えない。
項目名の重複や数値の字句を失った外部DOMを、元のwire profileの検証の代用にしない。

未知のobject項目は既知の項目を検証した上で受容し、位置とキー名だけを診断へ残す。
診断の位置は未知項目を含むobjectを指し、キー名は項目の名前とする。
未知項目の値は保持も再送もしない。
未知のvariantは拒否する。
必須項目の欠落、明示的なnull、任意項目の欠落を区別する。
TypeScriptの明示的なundefinedを欠落として受理しない。

### 任意のpattern制約

`@pattern`の共通profileは、ECMAScript Unicode (`u`)・他のflagなしの意味を厳密に保てる閉じた部分集合とする。
この共通profileは、Rustだけを選択する場合にも適用する。
C#のpattern未対応は変えず、Rustは共通profileに加えて自身の`regex`への等価な変換を要求する。

受理する構文は次に限り、RE2JS 2.10.0でcompileできることも条件とする。

- Unicode scalarのliteralとescape。正しく対になったsurrogate escapeは一つのscalarとして扱う。
- 連結、空の選択肢を含む選択、通常・非捕捉・名前付きgroup。捕捉結果を公開しないので捕捉名と捕捉を除去する。
- 貪欲・非貪欲な`?`、`*`、`+`と回数指定。
- 非multilineの厳密な先頭`^`と末尾`$`。末尾の改行直前を末尾として受理しない。
- dot、文字class、範囲、和集合、補集合、空class、否定した空class、`\d`、`\D`、`\w`、`\W`、`\s`、`\S`。

dotはLF・CR・U+2028・U+2029だけを除く。
`\d`はASCIIの数字、`\w`はASCIIの英字・数字・underscoreだけに一致する。
`\s`はU+0009–000D、U+0020、U+00A0、U+1680、U+2000–200A、U+2028–2029、U+202F、U+205F、U+3000、U+FEFFだけに一致する。
大文字のescapeは対応する集合の補集合であり、class内でも和集合と補集合の意味を保つ。
空source・空の選択肢・空classの意味を混同せず、Unicode正規化や暗黙の全文一致を足さない。

後方参照、全ての先読み・後読み、class外の単語境界assertion、Unicode property escape、inline flag、孤立surrogateを表すliteral、列挙していない構文は拒否する。
engineのcompile能力を越える`a{1001}`や`(a{40}){40}`なども拒否し、native engineへfallbackしない。
これは式の能力制限であり、入力のmaxLengthや時間上限を新設するものではない。

生成器は`@eslint-community/regexpp` 4.12.3のASTからこの部分集合だけを翻訳し、RE2JSで事前compileする。
不正な構文は`invalid-pattern`、構文上正しくても未対応の式は`unsupported-pattern`として宣言位置と理由を報告する。
この判定を既定値の正規化・検証と有限値域の評価より前に行い、拒否した式を評価せず、選択した全出力の公開を止める。
正規化を経ないモデルのTypeScript直接renderでも同じ適格性を調べ、失敗を`typescript-pattern`とする。
既定値とliteral・enumの値域検査にも同じ安全な実行器を使い、契約に書かれたpatternをnative `RegExp`で実行しない。
この保証は生成器が所有する処理に限る。
TypeSpec 1.17.0の`@pattern` decoratorは、emitterの事前検査より前にnative `RegExp(pattern)`を構築して構文を検査し、元のsourceを保持するが、そのdecoratorでは照合しない。
生成器の照合の置換によってfrontendのnative正規表現のparseまで除去したと扱わず、任意の悪意あるcompiler入力に対する処理全体のresource上限を保証しない。

patternを含むTypeScript moduleだけがRE2JSをimportし、異なるsourceごとに一度compileして元の文字列に同期的な`.test`を行う。全文一致の`.matches`へ置き換えない。
固定した受理済みpatternの破局的なバックトラッキングを除くが、任意の入力サイズ・field数・pattern数に対する総作業量の上限は保証しない。
hostのresource budgetやschedulingを代行せず、browser・Tauriでの実際の生成物の動作確認をengine選択だけから主張しない。
利用applicationは`re2js`の`2.10.0`を直接の実行時依存として宣言し、生成器の推移的依存に頼らない。
`regexpp`は生成器だけの依存であり、生成コードへ持ち込まない。

値の種類の検証後、同じ値に適用するcode point長・UUIDの安価な検査が失敗した場合だけ、その値のpattern検査を省ける。
先行する別fieldの違反でpatternを省かず、兄弟項目と独立したfieldの検証を続ける。
実行したpatternの不一致は`format`違反とし、同じ値の全ての違反を列挙する契約にはしない。
既存のResultの形、成功時の未知項目診断、失敗時の違反、部分的な受理の禁止、不変な受理済み値の保持を変えない。
非公開の契約モデルとJSON Schema・OpenAPIのpatternには元のECMAScript sourceを保ち、engine用の翻訳を流出させない。
投影を使う外部validatorの実行安全性はその利用側の責任であり、この実行器の保証の対象外とする。

## 操作の接続

成功と宣言した拒否を、operationの別の結果経路に置く。
提供側では要求のdecode、未指定の入力への既定値の適用、handlerへのdispatch、結果のencodeを生成する。
同じ言語からの直接呼出しも同じ受理処理を通す。
通常のcodecと利用側clientは既定値を補わず、不正値やnullを既定値で修復しない。
既定値は、入れ子のobject、配列の要素、unionのvariantの中の任意項目にも、同じ受理処理で適用する。
profileが受理した既定値は、どの生成先でも実行時に構築へ失敗しない。

HTTPはmethod・path・要求の配置と、結果ごとのstatus・media type・明示したselectorを対応付ける。
利用側は識別情報を先に照合し、選んだ結果のbodyをdecodeする。
同じbodyを返す201と202を区別し、宣言していない200を成功として扱わない。
本文の不在、JSON null、空object、空bytesを区別する。
本文を持たない結果は、本文もmedia typeも持たない応答だけに対応させる。
bytesのpayloadは、media typeがJSONのときbindingのencodingによるJSON文字列で運び、それ以外のときbytesのまま運ぶ。
nullableな引数はbodyにだけ置け、path・query・headerへの配置は拒否する。
path・query・headerへ配置した引数と同じ名前のbodyの項目は、未知の項目として扱い、配置した値を上書きしない。
routeは、空でも`.`・`..`(百分率符号化した綴りを含む)でもないsegmentからなり、placeholderはsegmentの全体を占める。
空・`.`・`..`のpath値、および水平tabを除くASCII制御文字（DELを含む）を持つheader値は、正規値として有効でもwireの形を持たず、送信前に通信失敗を返す。
headerはplatformによる正規化前の元の文字列を検査する。
生成したclientは、設定したoriginの外へ要求を送らない。
同一originを含めredirectは追わず、3xxとbrowserの`opaqueredirect`は未宣言の応答として契約のdefectにする。
同梱のtransportがredirectを無効にし、hostが実装するtransportにも同じ契約を求める。
応答の読取りと検証が終わるまで成功を返さない。

IPCはhostが供給するtransport上の要求と応答として定義し、操作名と結果tagで識別する。
Tauri固有のwindow・state・command登録を、公開契約やcoreの型へ混入させない。
transportの実装、接続先、認証、再試行と時間上限の方針はhost側が所有する。
生成物は渡された取り消しと期限を通信へ引き継ぐ。
生成した提供側は、不正な入力、未知の操作、取り消しを型付きの結果としてhostへ返し、独自の応答を作らない。

宣言した拒否は想定内失敗、契約不一致は欠陥、通信不能と本文の途中切断は通信失敗として区別する。
502・503・504の本文が宣言した拒否に一致しない場合は通信失敗とし、一致する場合は宣言した拒否とする。
取消や期限を設けていない層が、独自のtimeoutや取消の判定方針を足さない。
完了済みの結果を、後から観測した取消で上書きしない。
handlerの完了後に出力の変換や送信が失敗しても、完了済みの業務処理を取り消したことにせず、生成物から再実行しない。

型・構築・codec、提供側、利用側は別の依存単位とする。
型とcodecだけの利用には、HTTP client、Effect runtime、接続設定を要求しない。
Result、Effect、JSON parser、HTTP clientをこのライブラリ内で再実装しない。
C#は互換性を確認したTypeModelingとEffectSystem、TypeScriptはts-results-esと利用側が所有するEffectの入口、Rustは標準のResultと非同期実行基盤へ接続する。
Rust の最低サポート版は `src/targets/rust/dependencies.ts` の `rustMinimumVersion` を正本とする。
生成 manifest と利用手順は同じ値を参照し、最低版の受入は、既存の Rust native の検証群を `RUST_CONTRACT_EXACT_MINIMUM=1` で一度だけ実行して行う。
この指定では rustc と Cargo が最低版そのものでなければ検証群が失敗し、全依存単位の build と公開 codec・構築の実行は同じ検証群が担うので別の検査で繰り返さない。
通常の native build は最低版以上の互換性のある compiler を許し、固定した版を最新 stable へ自動追随する宣言とは扱わない。

## 生成時の拒否

空の値域、不正な既定値、重複した判別子、bindingの欠落、曖昧な結果対応を生成前に拒否する。
未対応の意味を黙って無視せず、元の宣言位置、対象出力と理由を診断へ含める。
説明用の注釈は登録したものだけを説明用として扱う。
未対応を診断できることを、上記の必要なprofileを生成できることの代わりにしない。
公開型と異なる同義のDTO、生成後の手編集、実行時の任意predicateを使う抜け道を設けない。

## 受入条件

期待値は契約から定め、生成物と生成器の同じ関数で期待値を計算しない。

| ID  | 入力・操作                                                                                                                            | 観測する公開境界と期待結果                                                                                                                                            | 検出する誤実装                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| G1  | 同じ表現を持つ二つの役割と、その一方へのalias                                                                                         | 三言語の型検査で役割の交換を拒否し、同じ型への参照を受理する                                                                                                          | aliasまで別の役割にする生成と役割の消失                                                                             |
| G2  | Unicodeの補助平面文字を含む長さの上下境界                                                                                             | 構築とdecodeがcode pointの数に従って同じ受理・拒否を返す                                                                                                              | UTF-16の長さとUTF-8のbyte数による判定                                                                               |
| G3  | 安全整数範囲外の整数、長い十進数、小数秒、offset、年0000、うるう秒                                                                    | 受理からencodeまで宣言した値と必要な表現を保つ                                                                                                                        | binary64、DateTime、UTC正規化への無条件な縮退                                                                       |
| G4  | 必須nullableの欠落、任意非nullableのnull、任意nullableのnull、undefined                                                               | 三言語の公開codecと構築でpresenceを区別する                                                                                                                           | 欠落とnullとundefinedの混同                                                                                         |
| G5  | 既知variantの入れ子にある未知項目と、既知項目の違反                                                                                   | 未知項目の位置と名前を検知し、既知違反を拒否し、未知値を再送しない                                                                                                    | 未知項目検知による検証の迂回と値の保持                                                                              |
| G6  | 未知tag、tagとpayloadの不一致、構築後の配列・objectの変更、不正な既定値                                                               | 公開構築とcodecと送信入口で不正状態を受理しない                                                                                                                       | 可変aliasと型消去からの迂回                                                                                         |
| G7  | 未指定、明示値、null、違反値を持つ操作入力                                                                                            | HTTP・IPC・直接呼出しのhandlerへ同じ既定値規則を適用する                                                                                                              | client側だけの補完と不正入力の修復                                                                                  |
| G8  | 同じbodyの201・202、204、空binary、未宣言200、誤ったmedia type・selector                                                              | 成功case・拒否・欠陥を識別情報に従って区別する                                                                                                                        | body順の試行と2xx範囲による成功判定                                                                                 |
| G9  | 宣言した拒否、502・503・504の宣言一致と不一致、本文の途中切断                                                                         | 既存の失敗・欠陥の経路に別々の結果を返す                                                                                                                              | 全例外の同一化と中継者の本文の誤分類                                                                                |
| G10 | 開始前の取消、通信中の取消、完了後の取消、hostの期限                                                                                  | 所有する層に終了理由を残し、完了済みの結果を保持する                                                                                                                  | 独自timeoutと終了理由の上書き                                                                                       |
| G11 | 違反する宣言、追加結果のbinding欠落、重なるselector、未解釈の注釈、空・dot・部分placeholderのsegmentを持つroute                       | 宣言位置付きの生成診断を返し、直前の成功した出力を保つ                                                                                                                | 部分生成の成功扱いと意味の黙示的な脱落                                                                              |
| G12 | 異なる作業pathと宣言の列挙順から同じ契約を生成する                                                                                    | 全生成ファイルのbytesが一致する                                                                                                                                       | 絶対パス・時刻・探索順への依存                                                                                      |
| G13 | 型・codecだけを参照する三言語のプログラム                                                                                             | HTTP・Effect runtimeなしに構築・decode・encodeを実行できる                                                                                                            | 依存単位の分離不足                                                                                                  |
| G14 | 実HTTP接続と別processのIPC接続                                                                                                        | 生成した両端で要求からhandlerの結果までを往復できる                                                                                                                   | 型とstubだけで通信できたとみなす判定                                                                                |
| G15 | 生成したC#の直和の全variantを扱うconsumerと、一つ欠くconsumer                                                                         | 全列挙だけがcompileに成功し、欠落は網羅性の診断で失敗する                                                                                                             | analyzer未接続とcatchallによる未処理variantの隠蔽                                                                   |
| G16 | 別processから同じ出力への生成・drift検査、更新中断、親directoryのalias                                                                | 同時更新を競合として拒否し、出力と残存した所有を保ち、drift検査は書き込まない                                                                                         | 進行中の退避の誤復旧と二重更新                                                                                      |
| G17 | C#のconsumerが実行関数を持たないEffectをdefaultで返す                                                                                 | 依存側analyzerのEFFSYS008によってcompileに失敗する                                                                                                                    | runtime参照だけで利用規則の検査も伝播するとみなす設定                                                               |
| G18 | 最低サポート版と同じ rustc・Cargo で三つの固定契約を生成する                                                                          | 全 Rust 依存単位を build し、公開構築・codec の受理と拒否を実行できる                                                                                                 | 宣言した最低版を別の compiler で検証したとみなす判定                                                                |
| G19 | Linux の実 Wry webview から Tauri command を通して生成済みの両端を呼ぶ                                                                | 成功・宣言した拒否・不正入力の拒否と状態不変・準備前と停止後の拒否・進行中の取消後の回収を観測し、実 event loop を正常終了する                                        | mock Runtime や frame の往復だけを実 Tauri の接続とみなす判定                                                       |
| G20 | 空・dotのpath値、制御文字を含むheader値、同一・別originへのredirect                                                                   | 値にwireの形がなければ送信前に通信失敗を返し、redirectは追わずdefectにし、転送先は要求を受け取らない                                                                  | platformの正規化によるheader検査の迂回、framingの注入、originやrouteの逸脱                                          |
| G21 | 全ての行末文字、XMLで許されない制御文字、双方向制御文字、escapeに見える字句、引用符、コードブロックを含む説明文・項目名・tag・literal | 三言語の生成物をbuildまたは型検査でき、説明は文書の文字として残り、literalは宣言した値だけを受理し、説明に含めたcodeは実行されない                                    | 行末文字・制御文字による文書外へのcodeの混入、literalの字句の化け、説明のdoctest実行                                |
| G22 | 受理するpatternの長い一致・不一致文字列、部分集合外の式、不正な既定値、独立したfieldの違反                                            | 部分集合外の式は宣言位置付きで生成を拒否し、受理した式は共通の安全な実行器で部分一致の意味を保ち、別fieldの違反があっても検証する                                     | 生成時と実行時のpatternの意味の差、native engineへのfallback、先行する違反による独立した検証の省略                  |
| G23 | 深いobject・配列・union、共有する子、循環する可変入力、未知項目と既知違反、重複名・BOM・不正Unicodeを含むJSON                         | 三言語の構築・codec・既定値適用・終了処理をcall stackの深さに依存せず実行し、既定値適用後も共有と別個の子の区別を保ち、拒否時には違反・診断と直前の受理済み状態を保つ | 隠れた深さ上限、再帰によるprocess終了、DAGの循環扱いや木への展開、未知subtreeでのwire検査の迂回、拒否時の診断の消失 |

PBTはこの実装の不変条件の検証に用いる。
業務oracleの生成、MBTと形式手法の体系化はこのライブラリの責務に含めない。
