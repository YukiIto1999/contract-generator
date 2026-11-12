import "../../../../lib/main.tsp";
using ContractGenerator;

namespace Wide;

@doc("Opaque record key independent of every other string")
@distinct
scalar RecordKey extends string;

@minValue(0)
scalar Offset extends int64;

@minValue(0)
@maxValue(18446744073709551615)
scalar Counter extends uint64;

@minValue(0)
@maxValue(100.5)
scalar Rate extends decimal;

@minValue(-100000000000000000000)
@maxValue(100000000000000000000)
scalar BigCount extends integer;

enum Mode {
  fast: "fast",
  safe: "safe",
}

model Row {
  id: int64;
  counter: Counter;
  weight: float64;
  ratio: float32;
  day: plainDate;
  time: plainTime;
  span: duration;
  stamp: utcDateTime;
  flag: boolean;
  mode: Mode;
  tags: string[];
  note: string | null;
  fixed: 7;
  rate: Rate;
  big: BigCount;
}

model Page {
  @minItems(1)
  @maxItems(3)
  rows: Row[];
  next: Offset | null;
}

@error
model Missing {
  key: RecordKey;
}

@error
model Unavailable {
  retryAfter: int32;
}

@outcomes
union LookupOutcome {
  primary: Row,
  replica: Row,
  missing: Missing,
  unavailable: Unavailable,
}

@doc("Path, query and header placement with result selection by header value")
op lookup(key: RecordKey, verbose?: boolean, limit?: int32, traceId?: string): LookupOutcome;

@@publish(lookup, #["http", "ipc"]);
@@httpBinding(lookup, "GET", "/records/{key}");
@@httpParameter(lookup, "key", "path", "key");
@@httpParameter(lookup, "verbose", "query", "verbose");
@@httpParameter(lookup, "limit", "query", "limit");
@@httpParameter(lookup, "traceId", "header", "x-trace-id");
@@httpResult(lookup, "primary", 200, "application/json", #{`x-source`: "primary"});
@@httpResult(lookup, "replica", 200, "application/json", #{`x-source`: "replica"});
@@httpResult(lookup, "missing", 404, "application/json");
@@httpResult(lookup, "unavailable", 503, "application/json");
@@ipcBinding(lookup, "lookup");
@@ipcResult(lookup, "primary", "primary");
@@ipcResult(lookup, "replica", "replica");
@@ipcResult(lookup, "missing", "missing");
@@ipcResult(lookup, "unavailable", "unavailable");

@outcomes
union StoreOutcome {
  stored: void,
  conflict: Missing,
}

@doc("Raw binary request body with a path placement")
op store(key: RecordKey, data: bytes): StoreOutcome;

@@publish(store, #["http", "ipc"]);
@@httpBinding(store, "PUT", "/uploads/{key}", "data");
@@httpParameter(store, "key", "path", "key");
@@httpResult(store, "stored", 204);
@@httpResult(store, "conflict", 409, "application/json");
@@ipcBinding(store, "store");
@@ipcResult(store, "stored", "stored");
@@ipcResult(store, "conflict", "conflict");

@outcomes
union BatchOutcome {
  done: Page,
  empty: void,
  refused: Unavailable,
}

@doc("JSON body carrying every scalar kind with a provider default beyond the safe integer range")
op batch(rows: Row[], mode: Mode, note: string | null, @providerDefault(9007199254740993) cursor?: Offset): BatchOutcome;

@@publish(batch, #["http", "ipc"]);
@@httpBinding(batch, "POST", "/batch");
@@httpResult(batch, "done", 200, "application/json");
@@httpResult(batch, "empty", 204);
@@httpResult(batch, "refused", 502, "application/json");
@@ipcBinding(batch, "batch");
@@ipcResult(batch, "done", "done");
@@ipcResult(batch, "empty", "empty");
@@ipcResult(batch, "refused", "refused");
