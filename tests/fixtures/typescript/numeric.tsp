import "../../../lib/main.tsp";
using ContractGenerator;
namespace Numeric;

@preserveLexical
scalar ExactAmount extends decimal;
@@bindingEncoding(ExactAmount, "http", "string");
@@bindingEncoding(ExactAmount, "ipc", "json");

@preserveLexical
scalar ExactInteger extends integer;

@preserveLexical
scalar ExactOffset extends offsetDateTime;

scalar UnixInstant extends utcDateTime;
@@bindingEncoding(UnixInstant, "http", "unixTimestamp");
@@bindingEncoding(UnixInstant, "ipc", "rfc3339");

@preserveLexical
scalar LexicalUnix extends utcDateTime;
@@bindingEncoding(LexicalUnix, "http", "unixTimestamp");
@@bindingEncoding(LexicalUnix, "ipc", "rfc3339");

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
  epoch: UnixInstant;
  lexicalEpoch: LexicalUnix;
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
model ChooseSuccess { value: string; }

@outcomes union ImageOutcomes { loaded: bytes }
op image(): ImageOutcomes;
@@publish(image, #["http"]);
@@httpBinding(image, "GET", "/image");
@@httpResult(image, "loaded", 200, "image/png");

@outcomes union Relayed { relayed: Payload }
op relay(pathId: string, token: string, note: string): Relayed;
@@publish(relay, #["http"]);
@@httpBinding(relay, "POST", "/relay/{id}");
@@httpParameter(relay, "pathId", "path", "id");
@@httpParameter(relay, "token", "header", "X-Token");
@@httpResult(relay, "relayed", 200, "application/json");

@outcomes union InlineOutcomes { loaded: bytes }
op inline(): InlineOutcomes;
@@publish(inline, #["http"]);
@@httpBinding(inline, "GET", "/inline");
@@httpResult(inline, "loaded", 200, "application/json");
