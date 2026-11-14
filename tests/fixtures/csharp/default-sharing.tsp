import "../../../lib/main.tsp";
using ContractGenerator;
namespace DefaultSharing;

model Leaf { @providerDefault("fallback") note?: string; }
model Leaves is Array<Leaf>;
model MarkedTag { kind: "marked"; @providerDefault("fallback") note?: string; }
model PlainTag { kind: "plain"; label: string; }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Tagged { marked: MarkedTag, plain: PlainTag }

model Sharing {
  first: Leaf;
  second: Leaf;
  distinct: Leaf;
  settled: Leaf;
  maybe?: Leaf | null;
  nothing?: Leaf | null;
  firstLeaves: Leaves;
  secondLeaves: Leaves;
  distinctLeaves: Leaves;
  settledLeaves: Leaves;
  firstTag: Tagged;
  secondTag: Tagged;
  distinctTag: Tagged;
  settledTag: Tagged;
}

model Rung { @providerDefault("fallback") note?: string; below?: Rung; also?: Rung; }
model Step { @providerDefault("fallback") note?: string; below: Steps; }
model Steps is Array<Step>;
model ForkTag { kind: "fork"; @providerDefault("fallback") note?: string; left: Tier; right: Tier; }
model EndTag { kind: "end"; label: string; }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Tier { fork: ForkTag, end: EndTag }

model Receipt { label: string; }
@outcomes union Settlement { done: Receipt }
op settle(sharing?: Sharing, rung?: Rung, ladder?: Step, tier?: Tier): Settlement;
@@publish(settle, #["http"]);
@@httpBinding(settle, "POST", "/settle");
@@httpResult(settle, "done", 200, "application/json");
