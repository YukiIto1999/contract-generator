import "../../../../lib/main.tsp";
using ContractGenerator;

namespace Guarantees;

@doc("Integer written as a string on the IPC binding only")
@bindingEncoding("ipc", "string")
scalar IpcCount extends int32;

@doc("Boolean written as a string on the IPC binding only")
@bindingEncoding("ipc", "string")
scalar IpcFlag extends boolean;

@preserveLexical
scalar Exact64 extends int64;

@preserveLexical
scalar ExactRatio extends float64;

model Exact {
  whole: Exact64;
  ratio: ExactRatio;
}

model Item {
  @providerDefault("unnamed") label?: string;
}

model Named {
  kind: "named";
  @providerDefault("anon") name?: string;
}

model Anonymous {
  kind: "anonymous";
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Choice {
  named: Named,
  anonymous: Anonymous,
}

model Settings {
  @providerDefault(5) retries?: int32;
  items: Item[];
  choice: Choice;
}

model Receipt {
  value: string;
}

model Row {
  id: int32;
}

model Tree {
  label: string;
  child?: Tree | null;
  children: Tree[];
}

model Num {
  kind: "num";
  value: int32;
}

model Add {
  kind: "add";
  left: Expr;
  right: Expr;
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Expr {
  num: Num,
  add: Add,
}

@outcomes
union ConfigureOutcome {
  done: Receipt,
}

@doc("Provider defaults at every depth, with bytes, string-encoded and week-duration defaults")
op configure(
  settings: Settings,
  @providerDefault(7) count?: IpcCount,
  @providerDefault(duration.fromISO("P2W")) span?: duration,
  @providerDefault(#[1, 2, 255]) blob?: bytes,
  @providerDefault(true) flag?: IpcFlag,
): ConfigureOutcome;

@@publish(configure, #["http", "ipc"]);
@@httpBinding(configure, "POST", "/configure");
@@httpResult(configure, "done", 200, "application/json");
@@ipcBinding(configure, "configure");
@@ipcResult(configure, "done", "done");

@outcomes
union FetchOutcome {
  found: bytes,
}

@doc("Bytes under a JSON media type travel as a JSON string")
op fetch(): FetchOutcome;

@@publish(fetch, #["http", "ipc"]);
@@httpBinding(fetch, "GET", "/fetch");
@@httpResult(fetch, "found", 200, "application/json");
@@ipcBinding(fetch, "fetch");
@@ipcResult(fetch, "found", "found");

@outcomes
union ProbeOutcome {
  absent: void,
  present: Row,
}

@doc("A bodyless result and a JSON result share one status")
op probe(): ProbeOutcome;

@@publish(probe, #["http", "ipc"]);
@@httpBinding(probe, "GET", "/probe");
@@httpResult(probe, "absent", 200);
@@httpResult(probe, "present", 200, "application/json");
@@ipcBinding(probe, "probe");
@@ipcResult(probe, "absent", "absent");
@@ipcResult(probe, "present", "present");

@outcomes
union GrowOutcome {
  grown: Tree,
}

@doc("Recursion through an optional nullable member and an array")
op grow(tree: Tree): GrowOutcome;

@@publish(grow, #["http", "ipc"]);
@@httpBinding(grow, "POST", "/grow");
@@httpResult(grow, "grown", 200, "application/json");
@@ipcBinding(grow, "grow");
@@ipcResult(grow, "grown", "grown");

@outcomes
union EvaluateOutcome {
  evaluated: Expr,
}

@doc("Recursion through a union case")
op evaluate(expr: Expr): EvaluateOutcome;

@@publish(evaluate, #["http", "ipc"]);
@@httpBinding(evaluate, "POST", "/evaluate");
@@httpResult(evaluate, "evaluated", 200, "application/json");
@@ipcBinding(evaluate, "evaluate");
@@ipcResult(evaluate, "evaluated", "evaluated");

@outcomes
union NoteOutcome {
  noted: void,
}

@doc("A string placed in a header may have no wire form")
op note(text: string): NoteOutcome;

@@publish(note, #["http", "ipc"]);
@@httpBinding(note, "POST", "/note", "-");
@@httpParameter(note, "text", "header", "x-note");
@@httpResult(note, "noted", 204);
@@ipcBinding(note, "note");
@@ipcResult(note, "noted", "noted");

@outcomes
union ArchiveOutcome {
  archived: void,
}

@doc("Path strings that a single URL segment may be unable to carry")
op archive(tenant: string, item: string, label: string): ArchiveOutcome;

@@publish(archive, #["http", "ipc"]);
@@httpBinding(archive, "GET", "/{tenant}/{item}/archive", "-");
@@httpParameter(archive, "tenant", "path", "tenant");
@@httpParameter(archive, "item", "path", "item");
@@httpParameter(archive, "label", "header", "x-label");
@@httpResult(archive, "archived", 204);
@@ipcBinding(archive, "archive");
@@ipcResult(archive, "archived", "archived");

@outcomes
union EchoOutcome {
  echoed: Exact,
}

@doc("Numeric scalars that retain their source spelling")
op echo(value: Exact): EchoOutcome;

@@publish(echo, #["http", "ipc"]);
@@httpBinding(echo, "POST", "/echo");
@@httpResult(echo, "echoed", 200, "application/json");
@@ipcBinding(echo, "echo");
@@ipcResult(echo, "echoed", "echoed");

model DefaultTree {
  @providerDefault("branch") label?: string;
  child?: DefaultTree;
}

@outcomes
union NormalizeOutcome {
  normalized: DefaultTree,
}

op normalize(tree: DefaultTree): NormalizeOutcome;

@@publish(normalize, #["http", "ipc"]);
@@httpBinding(normalize, "POST", "/normalize");
@@httpResult(normalize, "normalized", 200, "application/json");
@@ipcBinding(normalize, "normalize");
@@ipcResult(normalize, "normalized", "normalized");


model ArrayTree {
  label: string;
  children: ArrayTree[];
}

model Chain000 { child: Chain001; }
model Chain001 { child: Chain002; }
model Chain002 { child: Chain003; }
model Chain003 { child: Chain004; }
model Chain004 { child: Chain005; }
model Chain005 { child: Chain006; }
model Chain006 { child: Chain007; }
model Chain007 { child: Chain008; }
model Chain008 { child: Chain009; }
model Chain009 { child: Chain010; }
model Chain010 { child: Chain011; }
model Chain011 { child: Chain012; }
model Chain012 { child: Chain013; }
model Chain013 { child: Chain014; }
model Chain014 { child: Chain015; }
model Chain015 { child: Chain016; }
model Chain016 { child: Chain017; }
model Chain017 { child: Chain018; }
model Chain018 { child: Chain019; }
model Chain019 { child: Chain020; }
model Chain020 { child: Chain021; }
model Chain021 { child: Chain022; }
model Chain022 { child: Chain023; }
model Chain023 { child: Chain024; }
model Chain024 { child: Chain025; }
model Chain025 { child: Chain026; }
model Chain026 { child: Chain027; }
model Chain027 { child: Chain028; }
model Chain028 { child: Chain029; }
model Chain029 { child: Chain030; }
model Chain030 { child: Chain031; }
model Chain031 { child: Chain032; }
model Chain032 { child: Chain033; }
model Chain033 { child: Chain034; }
model Chain034 { child: Chain035; }
model Chain035 { child: Chain036; }
model Chain036 { child: Chain037; }
model Chain037 { child: Chain038; }
model Chain038 { child: Chain039; }
model Chain039 { child: Chain040; }
model Chain040 { child: Chain041; }
model Chain041 { child: Chain042; }
model Chain042 { child: Chain043; }
model Chain043 { child: Chain044; }
model Chain044 { child: Chain045; }
model Chain045 { child: Chain046; }
model Chain046 { child: Chain047; }
model Chain047 { child: Chain048; }
model Chain048 { child: Chain049; }
model Chain049 { child: Chain050; }
model Chain050 { child: Chain051; }
model Chain051 { child: Chain052; }
model Chain052 { child: Chain053; }
model Chain053 { child: Chain054; }
model Chain054 { child: Chain055; }
model Chain055 { child: Chain056; }
model Chain056 { child: Chain057; }
model Chain057 { child: Chain058; }
model Chain058 { child: Chain059; }
model Chain059 { child: Chain060; }
model Chain060 { child: Chain061; }
model Chain061 { child: Chain062; }
model Chain062 { child: Chain063; }
model Chain063 { child: Chain064; }
model Chain064 { child: Chain065; }
model Chain065 { child: Chain066; }
model Chain066 { child: Chain067; }
model Chain067 { child: Chain068; }
model Chain068 { child: Chain069; }
model Chain069 { child: Chain070; }
model Chain070 { child: Chain071; }
model Chain071 { child: Chain072; }
model Chain072 { child: Chain073; }
model Chain073 { child: Chain074; }
model Chain074 { child: Chain075; }
model Chain075 { child: Chain076; }
model Chain076 { child: Chain077; }
model Chain077 { child: Chain078; }
model Chain078 { child: Chain079; }
model Chain079 { child: Chain080; }
model Chain080 { child: Chain081; }
model Chain081 { child: Chain082; }
model Chain082 { child: Chain083; }
model Chain083 { child: Chain084; }
model Chain084 { child: Chain085; }
model Chain085 { child: Chain086; }
model Chain086 { child: Chain087; }
model Chain087 { child: Chain088; }
model Chain088 { child: Chain089; }
model Chain089 { child: Chain090; }
model Chain090 { child: Chain091; }
model Chain091 { child: Chain092; }
model Chain092 { child: Chain093; }
model Chain093 { child: Chain094; }
model Chain094 { child: Chain095; }
model Chain095 { child: Chain096; }
model Chain096 { child: Chain097; }
model Chain097 { child: Chain098; }
model Chain098 { child: Chain099; }
model Chain099 { child: Chain100; }
model Chain100 { child: Chain101; }
model Chain101 { child: Chain102; }
model Chain102 { child: Chain103; }
model Chain103 { child: Chain104; }
model Chain104 { child: Chain105; }
model Chain105 { child: Chain106; }
model Chain106 { child: Chain107; }
model Chain107 { child: Chain108; }
model Chain108 { child: Chain109; }
model Chain109 { child: Chain110; }
model Chain110 { child: Chain111; }
model Chain111 { child: Chain112; }
model Chain112 { child: Chain113; }
model Chain113 { child: Chain114; }
model Chain114 { child: Chain115; }
model Chain115 { child: Chain116; }
model Chain116 { child: Chain117; }
model Chain117 { child: Chain118; }
model Chain118 { child: Chain119; }
model Chain119 { child: Chain120; }
model Chain120 { child: Chain121; }
model Chain121 { child: Chain122; }
model Chain122 { child: Chain123; }
model Chain123 { child: Chain124; }
model Chain124 { child: Chain125; }
model Chain125 { child: Chain126; }
model Chain126 { child: Chain127; }
model Chain127 { child: Chain128; }
model Chain128 { child: Chain129; }
model Chain129 { child: Chain130; }
model Chain130 { child: Chain131; }
model Chain131 { child: Chain132; }
model Chain132 { child: Chain133; }
model Chain133 { child: Chain134; }
model Chain134 { child: Chain135; }
model Chain135 { child: Chain136; }
model Chain136 { child: Chain137; }
model Chain137 { child: Chain138; }
model Chain138 { child: Chain139; }
model Chain139 { child: Chain140; }
model Chain140 { child: Chain141; }
model Chain141 { child: Chain142; }
model Chain142 { child: Chain143; }
model Chain143 { child: Chain144; }
model Chain144 { child: Chain145; }
model Chain145 { child: Chain146; }
model Chain146 { child: Chain147; }
model Chain147 { child: Chain148; }
model Chain148 { child: Chain149; }
model Chain149 { child: Chain150; }
model Chain150 { child: Chain151; }
model Chain151 { child: Chain152; }
model Chain152 { child: Chain153; }
model Chain153 { child: Chain154; }
model Chain154 { child: Chain155; }
model Chain155 { child: Chain156; }
model Chain156 { child: Chain157; }
model Chain157 { child: Chain158; }
model Chain158 { child: Chain159; }
model Chain159 { child: Chain160; }
model Chain160 { child: Chain161; }
model Chain161 { child: Chain162; }
model Chain162 { child: Chain163; }
model Chain163 { child: Chain164; }
model Chain164 { child: Chain165; }
model Chain165 { child: Chain166; }
model Chain166 { child: Chain167; }
model Chain167 { child: Chain168; }
model Chain168 { child: Chain169; }
model Chain169 { child: Chain170; }
model Chain170 { child: Chain171; }
model Chain171 { child: Chain172; }
model Chain172 { child: Chain173; }
model Chain173 { child: Chain174; }
model Chain174 { child: Chain175; }
model Chain175 { child: Chain176; }
model Chain176 { child: Chain177; }
model Chain177 { child: Chain178; }
model Chain178 { child: Chain179; }
model Chain179 { child: Chain180; }
model Chain180 { child: Chain181; }
model Chain181 { child: Chain182; }
model Chain182 { child: Chain183; }
model Chain183 { child: Chain184; }
model Chain184 { child: Chain185; }
model Chain185 { child: Chain186; }
model Chain186 { child: Chain187; }
model Chain187 { child: Chain188; }
model Chain188 { child: Chain189; }
model Chain189 { child: Chain190; }
model Chain190 { child: Chain191; }
model Chain191 { child: Chain192; }
model Chain192 { child: Chain193; }
model Chain193 { child: Chain194; }
model Chain194 { child: Chain195; }
model Chain195 { child: Chain196; }
model Chain196 { child: Chain197; }
model Chain197 { child: Chain198; }
model Chain198 { child: Chain199; }
model Chain199 { child: Chain200; }
model Chain200 { child: Chain201; }
model Chain201 { child: Chain202; }
model Chain202 { child: Chain203; }
model Chain203 { child: Chain204; }
model Chain204 { child: Chain205; }
model Chain205 { child: Chain206; }
model Chain206 { child: Chain207; }
model Chain207 { child: Chain208; }
model Chain208 { child: Chain209; }
model Chain209 { child: Chain210; }
model Chain210 { child: Chain211; }
model Chain211 { child: Chain212; }
model Chain212 { child: Chain213; }
model Chain213 { child: Chain214; }
model Chain214 { child: Chain215; }
model Chain215 { child: Chain216; }
model Chain216 { child: Chain217; }
model Chain217 { child: Chain218; }
model Chain218 { child: Chain219; }
model Chain219 { child: Chain220; }
model Chain220 { child: Chain221; }
model Chain221 { child: Chain222; }
model Chain222 { child: Chain223; }
model Chain223 { child: Chain224; }
model Chain224 { child: Chain225; }
model Chain225 { child: Chain226; }
model Chain226 { child: Chain227; }
model Chain227 { child: Chain228; }
model Chain228 { child: Chain229; }
model Chain229 { child: Chain230; }
model Chain230 { child: Chain231; }
model Chain231 { child: Chain232; }
model Chain232 { child: Chain233; }
model Chain233 { child: Chain234; }
model Chain234 { child: Chain235; }
model Chain235 { child: Chain236; }
model Chain236 { child: Chain237; }
model Chain237 { child: Chain238; }
model Chain238 { child: Chain239; }
model Chain239 { child: Chain240; }
model Chain240 { child: Chain241; }
model Chain241 { child: Chain242; }
model Chain242 { child: Chain243; }
model Chain243 { child: Chain244; }
model Chain244 { child: Chain245; }
model Chain245 { child: Chain246; }
model Chain246 { child: Chain247; }
model Chain247 { child: Chain248; }
model Chain248 { child: Chain249; }
model Chain249 { child: Chain250; }
model Chain250 { child: Chain251; }
model Chain251 { child: Chain252; }
model Chain252 { child: Chain253; }
model Chain253 { child: Chain254; }
model Chain254 { child: Chain255; }
model Chain255 { leaf: string; }

@outcomes
union TopologyOutcome {
  inspected: void,
}

op topology(arrays: ArrayTree, chain: Chain000): TopologyOutcome;

@@publish(topology, #["http", "ipc"]);
@@httpBinding(topology, "POST", "/topology");
@@httpResult(topology, "inspected", 204);
@@ipcBinding(topology, "topology");
@@ipcResult(topology, "inspected", "inspected");
