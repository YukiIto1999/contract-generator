import assert from "node:assert/strict";
import { AsyncResult, Ok } from "ts-results-es";
import * as C from "./contract.js";
import type { Check } from "./check.js";
import { createFetchTransport, createHttpClient, type HttpTransport } from "./client.js";
import { accepted, type Values } from "./consumer-fixture.js";
import type { Environment, HttpHost } from "./host.js";

/** Independently specified fault response served instead of the provider */
export interface Fault {
  response: Response | undefined;
}

/**
 * Case observed from a call result
 * @param result - Awaited client result
 * @returns Success or rejection case name, empty for a failure
 */
function caseOf(result: {
  isOk(): boolean;
  isErr(): boolean;
  value?: unknown;
  error?: unknown;
}): string {
  const held = (result.isOk() ? result.value : result.error) as { case?: string } | undefined;
  return held?.case ?? "";
}

/**
 * Real HTTP guarantees through generated client and provider
 * @param fixture - Accepted values and their wire form
 * @param host - Running socket host
 * @param env - Adapter observations
 * @param fault - Served fault response
 * @returns Named checks over real sockets
 */
export function httpChecks(
  fixture: Values,
  host: HttpHost,
  env: Environment,
  fault: Fault,
): readonly Check[] {
  const signal = new AbortController().signal;
  const { value, wire, input, explicitInput } = fixture;
  const real = createFetchTransport(fetch);
  let calls = 0;
  const transport: HttpTransport = {
    request(request, context) {
      calls++;
      return real.request(request, context);
    },
    readBody: real.readBody,
  };
  const client = createHttpClient({ baseUrl: host.baseUrl, transport });
  const labelled = (label: string): C.SubmitInput =>
    accepted(C.SubmitInput.create({ input: accepted(C.Envelope.create({ ...value, label })) }));
  const run = async (submit: C.SubmitInput) =>
    await client.submit(submit)(undefined, signal, Infinity);
  const served = async (response: Response) => {
    fault.response = response;
    try {
      return await run(input);
    } finally {
      fault.response = undefined;
    }
  };
  return [
    [
      "http-call-is-deferred-and-created-case-gets-the-provider-default",
      async () => {
        const effect = client.submit(input);
        assert.equal(calls, 0);
        const created = await effect(undefined, signal, Infinity);
        assert.equal(caseOf(created), "Created");
        assert.equal(
          created.isOk() && created.value.case !== "Completed" && created.value.value.value,
          "3",
        );
      },
    ],
    [
      "http-explicit-limit-reaches-the-handler",
      async () => {
        const result = await run(explicitInput);
        assert.equal(
          result.isOk() && result.value.case !== "Completed" && result.value.value.value,
          "2",
        );
      },
    ],
    [
      "http-invalid-limit-is-answered-by-the-host-without-the-handler",
      async () => {
        for (const limit of [null, 4]) {
          const before = env.limits.length;
          const response = await fetch(new URL("/submit", host.baseUrl), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input: wire, limit }),
          });
          assert.equal(response.status, 400);
          assert.equal(env.limits.length, before);
        }
      },
    ],
    [
      "http-forged-input-is-a-defect-before-anything-is-sent",
      async () => {
        const before = calls;
        const forged = {
          ...input,
          input: { ...value, requestId: "not-a-uuid" },
        } as unknown as C.SubmitInput;
        await assert.rejects(async () => await run(forged), C.ContractDefect);
        assert.equal(calls, before);
      },
    ],
    [
      "http-201-and-202-with-the-same-body-select-different-cases",
      async () => {
        assert.equal(caseOf(await run(input)), "Created");
        assert.equal(caseOf(await run(labelled("q"))), "Queued");
      },
    ],
    [
      "http-204-selects-the-void-case",
      async () => {
        const completed = await run(labelled("v"));
        assert.deepEqual(completed.isOk() && completed.value, { case: "Completed" });
      },
    ],
    [
      "http-declared-rejection-is-a-rejection-result",
      async () => {
        assert.equal(caseOf(await run(labelled("r"))), "Rejected");
      },
    ],
    [
      "http-empty-binary-result-is-empty-bytes",
      async () => {
        const download = await client.download(accepted(C.DownloadInput.create({})))(
          undefined,
          signal,
          Infinity,
        );
        assert.equal(download.isOk() && download.value.value.length, 0);
      },
    ],
    [
      "http-undeclared-or-mismatched-responses-are-defects",
      async () => {
        const json = { "content-type": "application/json" };
        for (const response of [
          new Response('{"value":"3"}', { status: 200, headers: json }),
          new Response('{"value":"3"}', { status: 201, headers: { "content-type": "text/plain" } }),
          new Response("null", { status: 201, headers: json }),
        ])
          await assert.rejects(async () => await served(response), C.ContractDefect);
      },
    ],
    [
      "http-intermediary-statuses-without-a-declared-rejection-are-communication-failures",
      async () => {
        for (const status of [502, 503, 504]) {
          const result = await served(
            new Response("intermediary", { status, headers: { "content-type": "text/html" } }),
          );
          assert.equal(
            result.isErr() && "kind" in result.error && result.error.kind,
            "communication",
          );
        }
      },
    ],
    [
      "http-declared-rejection-body-is-a-rejection-result",
      async () => {
        const body = '{"code":"invalid","message":"declared"}';
        const result = await served(
          new Response(body, { status: 400, headers: { "content-type": "application/json" } }),
        );
        assert.equal(caseOf(result), "Rejected");
      },
    ],
    [
      "http-cancellation-before-start-rejects-with-the-reason-without-sending",
      async () => {
        const controller = new AbortController();
        controller.abort(new DOMException("cancelled", "AbortError"));
        const before = calls;
        await assert.rejects(
          async () => await client.submit(input)(undefined, controller.signal, Infinity),
          (error) => error === controller.signal.reason,
        );
        assert.equal(calls, before);
      },
    ],
    [
      "http-completed-result-survives-a-later-cancellation-and-forwards-the-deadline",
      async () => {
        const precedence = new AbortController();
        const completed: HttpTransport = {
          request: (_request, context) => {
            assert.equal(context.deadlineAt, 45678);
            const response = new Response('{"value":"3"}', {
              status: 201,
              headers: { "content-type": "application/json" },
            });
            return new AsyncResult(Promise.resolve(Ok(response)));
          },
          readBody: (response, context) =>
            real.readBody(response, context).map((bytes) => {
              precedence.abort(new DOMException("late", "AbortError"));
              return bytes;
            }),
        };
        const preserved = await createHttpClient({
          baseUrl: host.baseUrl,
          transport: completed,
        }).submit(input)(undefined, precedence.signal, 45678);
        assert.equal(preserved.isOk(), true);
      },
    ],
    [
      "http-host-defect-is-propagated-unchanged",
      async () => {
        const defect = new Error("host defect");
        const broken: HttpTransport = {
          request: () => {
            throw defect;
          },
          readBody: real.readBody,
        };
        await assert.rejects(
          async () =>
            await createHttpClient({ baseUrl: host.baseUrl, transport: broken }).submit(input)(
              undefined,
              signal,
              Infinity,
            ),
          (error) => error === defect,
        );
      },
    ],
  ];
}
