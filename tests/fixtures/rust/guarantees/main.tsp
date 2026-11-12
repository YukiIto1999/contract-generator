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
