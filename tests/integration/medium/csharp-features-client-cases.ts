import { httpResponse } from "./csharp-peers.js";

/** One hand-written response scenario of the Features client */
export type Response = readonly [name: string, response: Buffer, expected: Record<string, unknown>];

/** Media type header of a JSON body */
const jsonHeader = { "Content-Type": "application/json" };
/** Contract defect observation */
const defect = { exit: "defected" };
/** Communication failure observation */
const transport = { exit: "transport" };

/** Same-status selection by header and by status
 * @returns Responses for the choose operation
 */
function selectorResponses(): readonly Response[] {
  const first = (header: Record<string, string>): Buffer =>
    httpResponse(201, { ...jsonHeader, ...header }, '{"value":"one"}');
  return [
    [
      "the declared header value selects the first same-status result",
      first({ "x-case": "first" }),
      { exit: "succeeded", case: "First", value: "one" },
    ],
    [
      "header names compare case-insensitively",
      httpResponse(201, { ...jsonHeader, "X-CASE": "second" }, '{"value":"two"}'),
      { exit: "succeeded", case: "Second", value: "two" },
    ],
    ["header values compare exactly", first({ "x-case": "FIRST" }), defect],
    ["a missing selector header is a defect", first({}), defect],
    ["an undeclared selector value is a defect", first({ "x-case": "third" }), defect],
    [
      "202 JSON null selects the null result",
      httpResponse(202, jsonHeader, "null"),
      { exit: "succeeded", case: "Nil", value: null },
    ],
    ["202 with any other JSON is a defect", httpResponse(202, jsonHeader, '"x"'), defect],
    ["202 without a body is a defect", httpResponse(202, jsonHeader, ""), defect],
    [
      "204 selects the void result",
      httpResponse(204, {}, "", null),
      { exit: "succeeded", case: "Done" },
    ],
    [
      "an undeclared 500 is a defect",
      httpResponse(500, jsonHeader, '{"reason":"blocked"}'),
      defect,
    ],
  ];
}

/** Declared 503 rejection and relayed failures
 * @returns Responses for the choose operation
 */
function gatewayResponses(): readonly Response[] {
  return [
    [
      "503 whose body matches the declared rejection is that rejection",
      httpResponse(503, jsonHeader, '{"reason":"blocked"}'),
      { exit: "declared", reason: "blocked" },
    ],
    [
      "503 whose body differs from the declared rejection is a communication failure",
      httpResponse(503, jsonHeader, '{"reason":"other"}'),
      transport,
    ],
    [
      "503 with an unrelated media type is a communication failure",
      httpResponse(503, { "Content-Type": "text/html" }, "<html></html>"),
      transport,
    ],
    [
      "503 with the declared body under another media type is a communication failure",
      httpResponse(503, { "Content-Type": "text/plain" }, '{"reason":"blocked"}'),
      transport,
    ],
    ["503 without a body is a communication failure", httpResponse(503, {}, ""), transport],
    [
      "502 carrying the declared body is not the declared 503",
      httpResponse(502, jsonHeader, '{"reason":"blocked"}'),
      transport,
    ],
    ["504 is a communication failure", httpResponse(504, {}, ""), transport],
    [
      "a truncated 503 body is a communication failure",
      httpResponse(503, jsonHeader, '{"rea', 100),
      transport,
    ],
  ];
}

/** Every hand-written response of the choose operation
 * @returns Responses in report order
 */
export function chooseResponses(): readonly Response[] {
  return [...selectorResponses(), ...gatewayResponses()];
}

/** Bodyless result selection: only a response with neither body nor content type is the void result
 * @returns Responses for the ping operation
 */
export function pingResponses(): readonly Response[] {
  return [
    [
      "a response without a body and without a media type is the void result",
      httpResponse(200, {}, ""),
      { exit: "succeeded", case: "Pong" },
    ],
    [
      "a response with a media type but no body is not the void result",
      httpResponse(200, jsonHeader, ""),
      defect,
    ],
    [
      "a response with a body but no media type is not the void result",
      httpResponse(200, {}, "x"),
      defect,
    ],
    [
      "a response with a media type and a JSON body is not the void result",
      httpResponse(200, jsonHeader, "{}"),
      defect,
    ],
    ["a relayed 503 is a communication failure", httpResponse(503, {}, ""), transport],
  ];
}
