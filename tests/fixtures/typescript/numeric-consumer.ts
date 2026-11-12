import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { AsyncResult, Ok, Err, type Result } from "ts-results-es";
import * as C from "./contract.js";
import {
  createProvider,
  type Handlers,
  type HttpFailure,
  type InvalidInput,
  type NotFound,
  type RequestBodyReader,
} from "./provider.js";
import {
  createHttpClient,
  createFetchTransport,
  createIpcClient,
  type HttpTransport,
} from "./client.js";
import { deferEffect, type Effect } from "./effect.js";
import { runChecks, type Check } from "./check.js";

/** Generated provider entrypoints that the numeric consumer serves and calls */
interface NumericProvider {
  handleHttp(request: Request): Effect<unknown, HttpFailure, C.Accepted<Response>>;
  handleIpc(
    command: string,
    parametersJson: string,
  ): Effect<unknown, InvalidInput | NotFound, C.Accepted<string>>;
}

/** Exact numeric source oracle independent of generated writers */
const raw =
  '{"wide":9007199254740993,"unsigned":18446744073709551615,"integer":900719925474099312345678901234567890,"amount":"12345678901234567890.123456789012345678900","instant":"0000-02-29T12:34:56.1234567890123456789+05:45","epoch":-62167219199.1234567890123456789,"lexicalEpoch":1.0e3}';

/**
 * Compile-time role proof: a separately declared role stays incompatible with an inherited role
 * @param role - Value of the inherited role
 * @returns Value typed as the inherited role
 */
export function roleProof(role: C.NonemptyCustomer): C.CustomerRole {
  // @ts-expect-error Separately declared role remains incompatible with an inherited role
  const otherRole: C.OtherCustomer = role;
  void otherRole;
  return role;
}

/**
 * Accepted numbers with both binding encodings
 * @returns Decoded value and its two encodings
 */
function numbers() {
  const value = C.Numbers.decode(raw);
  if (value.isErr()) throw new Error(JSON.stringify(value.error));
  const http = C.Numbers.encode(value.value.value, "http");
  const ipc = C.Numbers.encode(value.value.value, "ipc");
  if (http.isErr() || ipc.isErr()) throw new Error("Expected exact numeric encoding");
  return { value: value.value.value, http: http.value, ipc: ipc.value };
}

/**
 * Exact numeric and temporal guarantees without I/O
 * @returns Named checks
 */
function numericChecks(): readonly Check[] {
  const { value, http, ipc } = numbers();
  return [
    [
      "unsafe-integers-keep-their-exact-http-tokens",
      () => {
        assert.equal(value.wide, 9007199254740993n);
        assert.equal(value.unsigned, 18446744073709551615n);
        assert.ok(http.includes('"wide":9007199254740993'));
        assert.ok(http.includes('"integer":900719925474099312345678901234567890'));
      },
    ],
    [
      "decimal-and-lexical-values-follow-each-binding-encoding",
      () => {
        assert.ok(http.includes('"amount":"12345678901234567890.123456789012345678900"'));
        assert.ok(ipc.includes('"amount":12345678901234567890.123456789012345678900'));
        assert.ok(http.includes('"lexicalEpoch":1.0e3'));
        assert.ok(ipc.includes('"lexicalEpoch":"1970-01-01T00:16:40Z"'));
      },
    ],
    [
      "unix-timestamps-convert-exactly-to-calendar-spelling",
      () => {
        assert.equal(value.epoch, "0000-01-01T00:00:00.8765432109876543211Z");
        assert.ok(http.includes('"epoch":-62167219199.1234567890123456789'));
      },
    ],
    [
      "unix-timestamp-beyond-the-calendar-range-is-rejected",
      () => {
        assert.equal(C.Numbers.decode(raw.replace("1.0e3", "253402300800")).isErr(), true);
      },
    ],
    [
      "offset-timestamps-accept-only-real-leap-seconds",
      () => {
        assert.equal(C.ExactOffset.decode('"1990-12-31T23:59:60Z"').isOk(), true);
        assert.equal(
          C.ExactOffset.decode('"1991-01-01T05:44:60.1234567890123456789+05:45"').isOk(),
          true,
        );
        assert.equal(C.ExactOffset.decode('"1990-12-31T23:58:60Z"').isErr(), true);
        assert.equal(
          C.ExactOffset.decode('"0000-02-29T23:59:60.1234567890123456789+05:45"').isErr(),
          true,
        );
      },
    ],
    [
      "inherited-role-keeps-the-ancestor-role-and-rejects-empty-text",
      () => {
        assert.equal(C.NonemptyCustomer.create("customer").isOk(), true);
        assert.equal(C.NonemptyCustomer.create("").isErr(), true);
      },
    ],
    [
      "declarations-named-like-infrastructure-are-escaped-and-reachable",
      () => {
        assert.equal(C.$Codec.create({ value: "escaped contract name" }).isOk(), true);
        assert.equal(C.$ChooseSuccess.create({ value: "escaped operation suffix" }).isOk(), true);
      },
    ],
    [
      "ipc-encoding-round-trips-and-uint64-overflow-is-rejected",
      () => {
        assert.equal(C.Numbers.decode(ipc, "ipc").isOk(), true);
        assert.equal(
          C.Numbers.decode(raw.replace("18446744073709551615", "18446744073709551616")).isErr(),
          true,
        );
      },
    ],
  ];
}

/** Outcome that the fixture handler returns next */
type Selected = "First" | "Second" | "Nil" | "Done" | "Refused";

/**
 * Handlers whose result is chosen by the checks
 * @param select - Currently selected choose outcome
 * @returns Handwritten adapter of the numeric contract
 */
function handlersOf(select: () => Selected): Handlers<unknown> {
  const payload = (text: string): C.Payload => {
    const created = C.Payload.create({ value: text });
    if (created.isErr()) throw new Error("Fixture payload");
    return created.value.value;
  };
  const effect = <A, E>(make: () => Result<A, E>) =>
    deferEffect((_env: unknown, signal: AbortSignal) => {
      signal.throwIfAborted();
      return new AsyncResult(Promise.resolve(make()));
    });
  return {
    choose: () =>
      effect((): Result<C.ChooseSuccess, C.ChooseRejection> => {
        const selected = select();
        if (selected === "Nil") return Ok({ case: "Nil" as const, value: null });
        if (selected === "Done") return Ok({ case: "Done" as const });
        if (selected === "Refused") {
          const rejected = C.Refused.create({ reason: "blocked" });
          if (rejected.isErr()) throw new Error("Fixture rejection");
          return Err({ case: "Refused" as const, value: rejected.value.value });
        }
        return Ok({
          case: selected === "Second" ? ("Second" as const) : ("First" as const),
          value: payload("same"),
        });
      }),
    route: (input) => {
      const body =
        input.input === undefined ? "absent" : input.input === null ? "null" : input.input.value;
      return effect(() =>
        Ok({
          case: "Matched" as const,
          value: payload(`${input.pathId}|${input.token}|${input.search}|${body}`),
        }),
      );
    },
    relay: (input) =>
      effect(() =>
        Ok({
          case: "Relayed" as const,
          value: payload(`${input.pathId}|${input.token}|${input.note}`),
        }),
      ),
    archive: (input) =>
      effect(() =>
        Ok({
          case: "Archived" as const,
          value: payload(`${input.tenant}|${input.item}|${input.token}`),
        }),
      ),
    upload: (input) =>
      effect(() =>
        Ok({
          case: "Stored" as const,
          value: payload(`${input.binary.length}:${input.binary.at(0) ?? "empty"}`),
        }),
      ),
    image: () => effect(() => Ok({ case: "Loaded" as const, value: bytesOf([137, 80, 78, 71]) })),
    inline: () => effect(() => Ok({ case: "Loaded" as const, value: bytesOf([1, 2, 3]) })),
  };
}

/**
 * Accepted bytes of a fixture payload
 * @param content - Byte values
 * @returns Owned byte sequence
 */
function bytesOf(content: readonly number[]): C.IntrinsicBytes {
  const created = C.IntrinsicBytes.create(new Uint8Array(content));
  if (created.isErr()) throw new Error("Fixture bytes");
  return created.value.value;
}

/** Fault switches of the served responses */
interface Faults {
  selector: boolean;
  gateway: boolean;
}

/**
 * Real socket host serving the generated provider
 * @param provider - Generated provider
 * @param faults - Fault switches
 * @returns Listening server
 */
async function serve(provider: NumericProvider, faults: Faults) {
  const server = createServer(async (incoming, outgoing) => {
    const parts: Uint8Array[] = [];
    for await (const part of incoming) parts.push(Uint8Array.from(part as Uint8Array));
    const body = new Uint8Array(Buffer.concat(parts));
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers))
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const request = new Request(`http://127.0.0.1${incoming.url}`, {
      method: incoming.method!,
      headers,
      ...(body.length > 0 ? { body } : {}),
    });
    const result = await provider.handleHttp(request)(
      undefined,
      new AbortController().signal,
      Infinity,
    );
    if (result.isErr()) {
      outgoing.writeHead(400);
      outgoing.end();
      return;
    }
    const served = result.value.value;
    const responseHeaders = Object.fromEntries(served.headers);
    if (faults.selector) responseHeaders["x-case"] = "wrong";
    outgoing.writeHead(served.status, responseHeaders);
    outgoing.end(
      faults.gateway ? '{"not":"declared"}' : new Uint8Array(await served.arrayBuffer()),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

/**
 * Real HTTP and IPC guarantees of placements, selectors and bytes
 * @param base - Service origin
 * @param provider - Generated provider
 * @param selection - Choose outcome switch
 * @param faults - Fault switches
 * @returns Named checks
 */
function operationChecks(
  base: string,
  provider: NumericProvider,
  selection: { current: Selected },
  faults: Faults,
): readonly Check[] {
  const client = createHttpClient({ baseUrl: base, transport: createFetchTransport(fetch) });
  const signal = new AbortController().signal;
  const choose = async () => {
    const input = C.ChooseInput.create({});
    if (input.isErr()) throw new Error("Empty operation input");
    return await client.choose(input.value.value)(undefined, signal, Infinity);
  };
  return [
    [
      "same-status-results-are-selected-by-explicit-headers",
      async () => {
        for (const outcome of ["First", "Second", "Nil", "Done", "Refused"] as const) {
          selection.current = outcome;
          const result = await choose();
          assert.equal(result.isErr(), outcome === "Refused");
          const held = (result.isOk() ? result.value : result.error) as { case: string };
          assert.equal(held.case, outcome);
        }
      },
    ],
    [
      "path-header-query-and-body-placements-round-trip-with-absent-null-and-present-bodies",
      async () => {
        const payload = C.Payload.create({ value: "body" });
        if (payload.isErr()) throw new Error("Fixture body");
        for (const [body, expected] of [
          [undefined, "absent"],
          [null, "null"],
          [payload.value.value, "body"],
        ] as const) {
          const routed = C.RouteInput.create({
            pathId: "A/B",
            token: "Secret",
            ...(body === undefined ? {} : { input: body }),
          });
          if (routed.isErr()) throw new Error("Fixture route input");
          const result = await client.route(routed.value.value)(undefined, signal, Infinity);
          assert.equal(result.isOk() && result.value.value.value, `A/B|Secret|default|${expected}`);
        }
      },
    ],
    [
      "query-values-are-percent-encoded",
      async () => {
        const routed = C.RouteInput.create({ pathId: "C", token: "Secret", search: "x&y z" });
        if (routed.isErr()) throw new Error("Fixture query");
        const result = await client.route(routed.value.value)(undefined, signal, Infinity);
        assert.equal(result.isOk() && result.value.value.value, "C|Secret|x&y z|absent");
      },
    ],
    [
      "body-member-duplicating-a-placed-parameter-is-reported-and-never-fills-it",
      async () => {
        const request = new Request("http://127.0.0.1/relay/from-path", {
          method: "POST",
          headers: { "content-type": "application/json", "x-token": "from-header" },
          body: '{"pathId":"from-body","token":"from-body","note":"n"}',
        });
        const result = await provider.handleHttp(request)(undefined, signal, Infinity);
        assert.equal(result.isOk(), true);
        if (result.isErr()) return;
        assert.equal(await result.value.value.text(), '{"value":"from-path|from-header|n"}');
        assert.deepEqual(result.value.diagnostics, [
          { path: "", key: "pathId" },
          { path: "", key: "token" },
        ]);
      },
    ],
    [
      "raw-binary-request-bodies-keep-every-byte",
      async () => {
        for (const content of [new Uint8Array(), new Uint8Array([0, 255])]) {
          const upload = C.UploadInput.create({ binary: content });
          if (upload.isErr()) throw new Error("Fixture upload");
          const result = await client.upload(upload.value.value)(undefined, signal, Infinity);
          assert.equal(
            result.isOk() && result.value.value.value,
            content.length === 0 ? "0:empty" : "2:0",
          );
        }
      },
    ],
    [
      "non-json-media-bytes-result-is-the-raw-bytes",
      async () => {
        const image = await client.image(accepted(C.ImageInput.create({})))(
          undefined,
          signal,
          Infinity,
        );
        assert.deepEqual(
          image.isOk() && Array.from(image.value.value.toUint8Array()),
          [137, 80, 78, 71],
        );
      },
    ],
    [
      "json-media-bytes-result-is-a-json-string-in-the-binding-encoding",
      async () => {
        const response = await fetch(new URL("/inline", base));
        assert.equal(await response.text(), '"AQID"');
        const inline = await client.inline(accepted(C.InlineInput.create({})))(
          undefined,
          signal,
          Infinity,
        );
        assert.deepEqual(inline.isOk() && Array.from(inline.value.value.toUint8Array()), [1, 2, 3]);
      },
    ],
    [
      "wrong-selector-header-is-a-contract-defect",
      async () => {
        selection.current = "First";
        faults.selector = true;
        try {
          await assert.rejects(choose, C.ContractDefect);
        } finally {
          faults.selector = false;
        }
      },
    ],
    [
      "undeclared-body-behind-a-gateway-status-is-a-communication-failure",
      async () => {
        selection.current = "Refused";
        faults.gateway = true;
        try {
          const gateway = await choose();
          assert.equal(
            gateway.isErr() && "kind" in gateway.error && gateway.error.kind,
            "communication",
          );
        } finally {
          faults.gateway = false;
        }
      },
    ],
    [
      "ipc-keeps-null-and-void-results-distinct",
      async () => {
        const transport = {
          request: (command: string, parametersJson: string, context: C.CallContext) =>
            provider
              .handleIpc(command, parametersJson)(undefined, context.signal, context.deadlineAt)
              .map((served) => served.value)
              .mapErr(() => ({ kind: "communication" as const, message: "inbound rejection" })),
        };
        const ipcClient = createIpcClient({ transport });
        for (const outcome of ["Nil", "Done"] as const) {
          selection.current = outcome;
          const input = C.ChooseInput.create({});
          if (input.isErr()) throw new Error("Empty operation input");
          const result = await ipcClient.choose(input.value.value)(undefined, signal, Infinity);
          assert.deepEqual(
            result.isOk() && result.value,
            outcome === "Nil" ? { case: "Nil", value: null } : { case: "Done" },
          );
        }
      },
    ],
  ];
}

/**
 * Accepted value extraction restricted to fixture assertions
 * @typeParam T - Public generated type
 * @param result - Generated public acceptance
 * @returns Accepted value
 */
function accepted<T>(result: Result<C.Accepted<T>, readonly C.Violation[]>): T {
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value.value;
}

/**
 * Real HTTP guarantees of path and header values at the wire boundary
 * @param base - Service origin of the served provider
 * @returns Named checks
 */
function archiveChecks(base: string): readonly Check[] {
  const real = createFetchTransport(fetch);
  const sent: string[] = [];
  const transport: HttpTransport = {
    request: (request, context) => {
      sent.push(request.url);
      return new URL(request.url).origin === new URL(base).origin
        ? real.request(request, context)
        : new AsyncResult<Response, C.CommunicationFailure>(
            Promise.resolve(
              Err<C.CommunicationFailure>({
                kind: "communication",
                message: "off the service origin",
              }),
            ),
          );
    },
    readBody: real.readBody,
  };
  const client = createHttpClient({ baseUrl: base, transport });
  const signal = new AbortController().signal;
  const archive = async (
    tenant: string,
    item: string,
    token = "t",
  ): Promise<Result<C.ArchiveSuccess, C.ArchiveRejection | C.CommunicationFailure>> => {
    sent.length = 0;
    const input = accepted(C.ArchiveInput.create({ tenant, item, token }));
    return await client.archive(input)(undefined, signal, Infinity);
  };
  return [
    [
      "path-and-header-values-reach-the-service-origin-exactly",
      async () => {
        const result = await archive("acme", "a/b c.d", "x\ty");
        assert.deepEqual(sent, [`${base}/acme/a%2Fb%20c.d/archive`]);
        assert.equal(result.isOk() && result.value.value.value, "acme|a/b c.d|x\ty");
      },
    ],
    [
      "empty-and-dot-path-values-are-communication-failures-before-the-transport",
      async () => {
        const unsafe = [
          ["", "attacker.invalid"],
          ["", ""],
          [".", "x"],
          ["x", ".."],
          ["..", ".."],
          ["acme", ""],
        ] as const;
        for (const [tenant, item] of unsafe) {
          const failed = await archive(tenant, item);
          assert.equal(
            failed.isErr() && "kind" in failed.error && failed.error.kind,
            "communication",
            `${tenant}|${item}`,
          );
          assert.deepEqual(sent, [], `${tenant}|${item}`);
        }
      },
    ],
    [
      "header-values-with-control-framing-are-communication-failures-before-the-transport",
      async () => {
        for (const token of ["a\r\nInjected: 1", "a\nb", "a\rb", "a\u0000b"]) {
          const failed = await archive("acme", "x", token);
          assert.equal(
            failed.isErr() && "kind" in failed.error && failed.error.kind,
            "communication",
            JSON.stringify(token),
          );
          assert.deepEqual(sent, [], JSON.stringify(token));
        }
      },
    ],
  ];
}

/**
 * Every named numeric, selector and placement guarantee
 * @param write - Sink of one JSON result line per check
 * @returns Completion after every check reported and the host closed
 */
export async function runNumericChecks(write: (line: string) => void): Promise<void> {
  const selection = { current: "First" as Selected };
  const faults: Faults = { selector: false, gateway: false };
  const readBody: RequestBodyReader = (request) =>
    new AsyncResult(request.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer))));
  const provider = createProvider(
    handlersOf(() => selection.current),
    readBody,
  );
  const server = await serve(provider, faults);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const base = `http://127.0.0.1:${address.port}`;
    await runChecks(
      [
        ...numericChecks(),
        ...operationChecks(base, provider, selection, faults),
        ...archiveChecks(base),
      ],
      write,
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

await runNumericChecks((line) => process.stdout.write(line + "\n"));
