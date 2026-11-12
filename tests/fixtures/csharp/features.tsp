import "../../../lib/main.tsp";
using ContractGenerator;
namespace Features;

@preserveLexical
scalar ExactAmount extends decimal;
@@bindingEncoding(ExactAmount, "http", "string");
@@bindingEncoding(ExactAmount, "ipc", "json");

@preserveLexical
scalar ExactInteger extends integer;

@preserveLexical
scalar ExactOffset extends offsetDateTime;

@distinct
scalar CustomerRole extends string;
@minLength(1)
scalar NonemptyCustomer extends CustomerRole;
@distinct
scalar OtherCustomer extends string;

model Numbers {
  wide: int64;
  unsigned: uint64;
  integer: ExactInteger;
  amount: ExactAmount;
  instant: ExactOffset;
}

enum Mode {
  fast: "fast",
  slow: "slow",
}

model Kinds {
  flag: boolean;
  ratio: float64;
  small: float32;
  day: plainDate;
  clock: plainTime;
  span: duration;
  at: utcDateTime;
  mode: Mode;
  fixed: "fixed";
  seven: 7;
  mixed: "a" | 1 | true;
  maybe?: string | null;
  names: string[];
  pairs: Payload[];
}

model Payload { value: string; }
@error model Refused { reason: "blocked"; }
@outcomes union Results { first: Payload, second: Payload, nil: null, done: void, refused: Refused }
op choose(): Results;
@@publish(choose, #["http", "ipc"]);
@@httpBinding(choose, "GET", "/choose");
@@httpResult(choose, "first", 201, "application/json", #{`x-case`: "first"});
@@httpResult(choose, "second", 201, "application/json", #{`x-case`: "second"});
@@httpResult(choose, "nil", 202, "application/json");
@@httpResult(choose, "done", 204);
@@httpResult(choose, "refused", 503, "application/json");
@@ipcBinding(choose, "choose");
@@ipcResult(choose, "first", "first");
@@ipcResult(choose, "second", "second");
@@ipcResult(choose, "nil", "nil");
@@ipcResult(choose, "done", "done");
@@ipcResult(choose, "refused", "refused");

@outcomes union Routed { matched: Payload }
op route(pathId: string, token: string, @providerDefault("default") search?: string, input?: Payload | null): Routed;
@@publish(route, #["http"]);
@@httpBinding(route, "POST", "/route/{id}", "input");
@@httpParameter(route, "pathId", "path", "id");
@@httpParameter(route, "token", "header", "X-Token");
@@httpParameter(route, "search", "query", "q");
@@httpResult(route, "matched", 200, "application/json");

@outcomes union Uploaded { stored: Payload }
op upload(binary: bytes): Uploaded;
@@publish(upload, #["http"]);
@@httpBinding(upload, "POST", "/upload", "binary");
@@httpResult(upload, "stored", 200, "application/json");

model Codec { value: string; }

@outcomes union ImageOutcomes { loaded: bytes }
op image(): ImageOutcomes;
@@publish(image, #["http"]);
@@httpBinding(image, "GET", "/image");
@@httpResult(image, "loaded", 200, "image/png");

scalar FlagText extends boolean;
@@bindingEncoding(FlagText, "http", "string");
scalar CountText extends int32;
@@bindingEncoding(CountText, "http", "string");

model Leaf {
  name: string;
  @providerDefault(#[1, 2, 255]) blob?: bytes;
  @providerDefault(true) enabled?: FlagText;
  @providerDefault(7) count?: CountText;
  @providerDefault(duration.fromISO("P2W")) span?: duration;
  @providerDefault(utcDateTime.fromISO("2024-02-29T12:00:00Z")) at?: utcDateTime;
}
model SolidShape { kind: "solid"; leaf: Leaf; }
model PlainShape { kind: "plain"; @providerDefault("fallback") note?: string; }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Shape { solid: SolidShape, plain: PlainShape }
model Branch { leaf: Leaf; leaves: Leaf[]; shapes: Shape[]; }

@outcomes union Defaulted { seen: Payload }
op defaults(branch: Branch): Defaulted;
@@publish(defaults, #["http", "ipc"]);
@@httpBinding(defaults, "POST", "/defaults");
@@httpResult(defaults, "seen", 200, "application/json");
@@ipcBinding(defaults, "defaults");
@@ipcResult(defaults, "seen", "seen");

@outcomes union Merged { done: Payload }
op merge(id: string, label: string): Merged;
@@publish(merge, #["http"]);
@@httpBinding(merge, "POST", "/merge/{id}");
@@httpParameter(merge, "id", "path", "id");
@@httpResult(merge, "done", 200, "application/json");

@outcomes union Archived { archived: Payload }
op archive(tenant: string, item: string, token: string): Archived;
@@publish(archive, #["http"]);
@@httpBinding(archive, "GET", "/{tenant}/{item}/archive", "-");
@@httpParameter(archive, "tenant", "path", "tenant");
@@httpParameter(archive, "item", "path", "item");
@@httpParameter(archive, "token", "header", "X-Token");
@@httpResult(archive, "archived", 200, "application/json");

@outcomes union Pinged { pong: void }
op ping(): Pinged;
@@publish(ping, #["http"]);
@@httpBinding(ping, "GET", "/ping");
@@httpResult(ping, "pong", 200);
