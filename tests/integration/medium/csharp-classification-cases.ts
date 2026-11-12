import { httpResponse } from "./csharp-peers.js";

/** One hand-written HTTP response scenario of the Sample client */
export type HttpScenario = readonly [
  name: string,
  operation: "submit" | "download",
  response: Buffer | undefined,
  expected: Record<string, unknown>,
];

/** Media type header of a JSON body */
const json = { "Content-Type": "application/json" };
/** Media type header of a binary body */
const octet = { "Content-Type": "application/octet-stream" };
/** Valid Receipt payload text */
const receipt = '{"value":"wire"}';
/** Valid declared rejection payload text */
const rejection = '{"code":"invalid","message":"wire"}';
/** Contract defect observation */
const defect = { exit: "defected" };
/** Communication failure observation */
const transport = { exit: "transport" };

/** Submit results that selection by status and media type must separate
 * @returns Scenarios for the submit operation
 */
function submitSelection(): readonly HttpScenario[] {
  const created = { exit: "succeeded", case: "Created", value: "wire" };
  return [
    ["201 selects Created", "submit", httpResponse(201, json, receipt), created],
    [
      "202 with the same body selects Queued",
      "submit",
      httpResponse(202, json, receipt),
      { ...created, case: "Queued" },
    ],
    [
      "204 selects the void Completed",
      "submit",
      httpResponse(204, {}, "", null),
      { exit: "succeeded", case: "Completed" },
    ],
    [
      "400 JSON selects the declared rejection",
      "submit",
      httpResponse(400, json, rejection),
      { exit: "declared", code: "invalid" },
    ],
    [
      "media types compare by normalized essence",
      "submit",
      httpResponse(201, { "Content-Type": "Application/JSON; charset=utf-8" }, receipt),
      created,
    ],
    ["an undeclared 200 is not a 2xx success", "submit", httpResponse(200, json, receipt), defect],
    [
      "a declared status with another media type is a defect",
      "submit",
      httpResponse(201, { "Content-Type": "text/plain" }, receipt),
      defect,
    ],
    [
      "a declared status without a media type is a defect",
      "submit",
      httpResponse(201, {}, receipt),
      defect,
    ],
    ["an undeclared 500 is a defect", "submit", httpResponse(500, json, receipt), defect],
    ["an undeclared 404 is a defect", "submit", httpResponse(404, json, rejection), defect],
  ];
}

/** Submit payloads that decoding must refuse
 * @returns Scenarios for the submit operation
 */
function submitPayloads(): readonly HttpScenario[] {
  return [
    ["an absent body is not a payload", "submit", httpResponse(201, json, ""), defect],
    ["JSON null is not a payload", "submit", httpResponse(201, json, "null"), defect],
    ["an empty object is not a payload", "submit", httpResponse(201, json, "{}"), defect],
    [
      "a payload of the wrong shape is a defect",
      "submit",
      httpResponse(201, json, '{"value":1}'),
      defect,
    ],
    ["malformed JSON is a defect", "submit", httpResponse(201, json, "{"), defect],
    [
      "a rejection status with an undeclared body is a defect",
      "submit",
      httpResponse(400, json, '{"code":"other","message":"wire"}'),
      defect,
    ],
  ];
}

/** Relayed and truncated responses that are communication failures
 * @returns Scenarios for the submit operation
 */
function submitCommunication(): readonly HttpScenario[] {
  return [
    [
      "a relayed 502 carrying a rejection-shaped body is a communication failure",
      "submit",
      httpResponse(502, json, rejection),
      transport,
    ],
    [
      "a relayed 503 with an unrelated body is a communication failure",
      "submit",
      httpResponse(503, { "Content-Type": "text/html" }, "<html></html>"),
      transport,
    ],
    [
      "a relayed 504 without a body is a communication failure",
      "submit",
      httpResponse(504, {}, ""),
      transport,
    ],
    [
      "a body cut off mid-transfer is a communication failure",
      "submit",
      httpResponse(201, json, '{"val', 100),
      transport,
    ],
    [
      "a closed connection without a response is a communication failure",
      "submit",
      Buffer.alloc(0),
      transport,
    ],
    ["an unreachable peer is a communication failure", "submit", undefined, transport],
  ];
}

/** Download failures and declared rejection
 * @returns Scenarios for the download operation
 */
function downloadFailures(): readonly HttpScenario[] {
  return [
    [
      "a binary status with a JSON media type is a defect",
      "download",
      httpResponse(200, json, "[]"),
      defect,
    ],
    [
      "404 JSON selects the declared download rejection",
      "download",
      httpResponse(404, json, rejection),
      { exit: "declared" },
    ],
    [
      "a binary body cut off mid-transfer is a communication failure",
      "download",
      httpResponse(200, octet, Buffer.from([1, 2]), 10),
      transport,
    ],
    [
      "a relayed 503 on download is a communication failure",
      "download",
      httpResponse(503, {}, ""),
      transport,
    ],
  ];
}

/** Binary download results
 * @returns Scenarios for the download operation
 */
function downloadScenarios(): readonly HttpScenario[] {
  const bytes = (text: string): Record<string, unknown> => ({
    exit: "succeeded",
    case: "Downloaded",
    bytes: text,
  });
  return [
    [
      "an empty binary body is a success distinct from absence",
      "download",
      httpResponse(200, octet, ""),
      bytes(""),
    ],
    [
      "binary bytes pass without text conversion",
      "download",
      httpResponse(200, octet, Buffer.from([0x00, 0xff])),
      bytes("AP8="),
    ],
    [
      "media type parameters do not change the binary result",
      "download",
      httpResponse(
        200,
        { "Content-Type": "application/octet-stream; foo=bar" },
        Buffer.from([0xff]),
      ),
      bytes("/w=="),
    ],
    ...downloadFailures(),
  ];
}

/** Every hand-written HTTP response scenario of the Sample client
 * @returns Scenarios in report order
 */
export function httpScenarios(): readonly HttpScenario[] {
  return [
    ...submitSelection(),
    ...submitPayloads(),
    ...submitCommunication(),
    ...downloadScenarios(),
  ];
}

/** One scripted IPC peer scenario of the Sample client */
export type IpcScenario = readonly [
  name: string,
  operation: "submit" | "download",
  peer: string,
  expected: Record<string, unknown>,
];

/** Every scripted IPC peer scenario of the Sample client
 * @returns Scenarios in report order
 */
export function ipcScenarios(): readonly IpcScenario[] {
  return [
    [
      "an independently written queued envelope selects Queued",
      "submit",
      "queued",
      { exit: "succeeded", case: "Queued", value: "wire" },
    ],
    [
      "a body-free envelope selects the void Completed",
      "submit",
      "completed",
      { exit: "succeeded", case: "Completed" },
    ],
    [
      "a rejected tag is the declared rejection",
      "submit",
      "rejected",
      { exit: "declared", code: "invalid" },
    ],
    [
      "a downloaded envelope carries the bytes",
      "download",
      "downloaded",
      { exit: "succeeded", case: "Downloaded", bytes: "AP8=" },
    ],
    ["a peer that ends without a response is a communication failure", "submit", "eof", transport],
    [
      "a response cut off before its terminator is a communication failure",
      "submit",
      "truncated",
      transport,
    ],
    ["a non-JSON response is a defect", "submit", "garbage", defect],
    ["an undeclared tag is a defect", "submit", "unknown-tag", defect],
    ["a void tag with a body, including null, is a defect", "submit", "void-with-body", defect],
    ["a payload tag without a body is a defect", "submit", "missing-body", defect],
    ["a payload of the wrong shape is a defect", "submit", "wrong-body", defect],
    ["a tag undeclared for the operation is a defect", "download", "queued", defect],
  ];
}
