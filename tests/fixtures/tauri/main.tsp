import "../../../lib/main.tsp";
using ContractGenerator;
namespace DesktopProbe;

@minLength(1)
@maxLength(4)
scalar Label extends string;

@minValue(1)
@maxValue(3)
scalar Amount extends int32;

model Receipt {
  label: string;
  total: int32;
  writes: int32;
}

@error
model Refused {
  code: "blocked";
}

@outcomes
union RecordOutcome {
  recorded: Receipt,
  refused: Refused,
}

@outcomes
union InspectOutcome {
  inspected: Receipt,
}

op `record`(label: Label, @providerDefault(2) amount?: Amount): RecordOutcome;
op inspect(): InspectOutcome;

@@publish(`record`, #["ipc"]);
@@ipcBinding(`record`, "record");
@@ipcResult(`record`, "recorded", "recorded");
@@ipcResult(`record`, "refused", "refused");
@@publish(inspect, #["ipc"]);
@@ipcBinding(inspect, "inspect");
@@ipcResult(inspect, "inspected", "inspected");
