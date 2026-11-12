import "../../../lib/main.tsp";
using ContractGenerator;
namespace Exhaustiveness;

model TextValue { kind: "text"; value: string; }
model NumberValue { kind: "number"; value: int32; }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Choice { text: TextValue, number: NumberValue }
enum Mixed { text: "yes", number: 1 }

model Receipt { value: string; }
@error model Refused { reason: string; }
@error model Missing { reason: string; }
@outcomes union Outcomes {
  created: Receipt,
  completed: void,
  refused: Refused,
  missing: Missing,
}
op choose(choice: Choice, mixed: Mixed): Outcomes;
@@publish(choose, #["http", "ipc"]);
@@httpBinding(choose, "POST", "/choose");
@@httpResult(choose, "created", 201, "application/json");
@@httpResult(choose, "completed", 204);
@@httpResult(choose, "refused", 400, "application/json");
@@httpResult(choose, "missing", 404, "application/json");
@@ipcBinding(choose, "choose");
@@ipcResult(choose, "created", "created");
@@ipcResult(choose, "completed", "completed");
@@ipcResult(choose, "refused", "refused");
@@ipcResult(choose, "missing", "missing");
