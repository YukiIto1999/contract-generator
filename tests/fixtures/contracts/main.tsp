import "../../../lib/main.tsp";
using ContractGenerator;

namespace Sample;

@doc("Request identifier independent of the record identifier")
@distinct
@format("uuid")
scalar RequestId extends string;

@doc("Record identifier independent of the request identifier")
@distinct
@format("uuid")
scalar RecordId extends string;

alias CorrelationId = RequestId;

@minLength(1)
@maxLength(3)
scalar ShortLabel extends string;

@minValue(1)
@maxValue(3)
scalar SmallCount extends int32;

@preserveLexical
@encode(string)
scalar ExactDecimal extends decimal;

@preserveLexical
scalar ExactTimestamp extends offsetDateTime;

model TextItem {
  kind: "text";
  text: ShortLabel;
}

model BinaryItem {
  kind: "binary";
  bytes: bytes;
}

@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Item {
  text: TextItem,
  binary: BinaryItem,
}

model Envelope {
  requestId: RequestId;
  recordId: RecordId;
  correlationId: CorrelationId;
  label: ShortLabel;
  count: SmallCount;
  amount: ExactDecimal;
  occurredAt: ExactTimestamp;
  nullableText: string | null;
  optionalText?: string;
  optionalNullable?: string | null;
  @minItems(1)
  items: Item[];
}

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
  queued: Receipt,
  completed: void,
  rejected: Rejected,
}

@doc("Submission with provider-owned omission handling")
op submit(input: Envelope, @providerDefault(3) limit?: SmallCount): SubmitOutcome;

@@publish(submit, #["http", "ipc"]);
@@httpBinding(submit, "POST", "/submit");
@@httpResult(submit, "created", 201, "application/json");
@@httpResult(submit, "queued", 202, "application/json");
@@httpResult(submit, "completed", 204);
@@httpResult(submit, "rejected", 400, "application/json");
@@ipcBinding(submit, "submit");
@@ipcResult(submit, "created", "created");
@@ipcResult(submit, "queued", "queued");
@@ipcResult(submit, "completed", "completed");
@@ipcResult(submit, "rejected", "rejected");

@outcomes
union DownloadOutcome {
  downloaded: bytes,
  rejected: Rejected,
}

op download(): DownloadOutcome;
@@publish(download, #["http", "ipc"]);
@@httpBinding(download, "GET", "/download");
@@httpResult(download, "downloaded", 200, "application/octet-stream");
@@httpResult(download, "rejected", 404, "application/json");
@@ipcBinding(download, "download");
@@ipcResult(download, "downloaded", "downloaded");
@@ipcResult(download, "rejected", "rejected");
