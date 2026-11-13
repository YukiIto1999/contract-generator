import { expect } from "vite-plus/test";
import { cancellationScenarios } from "./csharp-cancellation-cases.js";
import { httpScenarios, ipcScenarios } from "./csharp-classification-cases.js";
import { sampleSource } from "./csharp-contract.js";
import { envelope, submit } from "./csharp-operation-scenarios.js";
import { freePort, essence, runDriver } from "./csharp-process.js";
import { httpResponse, parseRawRequest, PeerPool } from "./csharp-peers.js";
import { nativeTest, useContract, useServer } from "./csharp-suite.js";

/** Raw peers that serve the hand-written responses */
const peers = new PeerPool();
/** Sample contract with the operation driver and a real provider server */
const sample = useContract(sampleSource, "Sample", ["OperationDriver.csproj"], () => peers.close());
const server = useServer(sample);

nativeTest(
  "sends the declared route and parameters body and never applies the provider default (G7 G8)",
  async () => {
    const origins = [
      await peers.origin(
        httpResponse(201, { "Content-Type": "application/json" }, '{"value":"wire"}'),
      ),
      await peers.origin(
        httpResponse(201, { "Content-Type": "application/json" }, '{"value":"wire"}'),
      ),
      await peers.origin(httpResponse(200, { "Content-Type": "application/octet-stream" }, "")),
    ];
    const observations = await runDriver(sample.driver("OperationDriver"), [
      submit("http", origins[0]!, envelope(1)),
      submit("http", origins[1]!, envelope(1), 2, { deadlineAfterMs: 600_000 }),
      { operation: "download", binding: "http", url: origins[2], payload: "{}" },
    ]);
    expect(observations.map((observation) => observation.exit)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    const sent = peers.peers.slice(-3).map((peer) => parseRawRequest(peer.requests[0]!));
    expect(sent[0]!.line).toBe("POST /submit HTTP/1.1");
    expect(essence(sent[0]!.headers.get("content-type"))).toBe("application/json");
    expect(JSON.parse(sent[0]!.body.toString("utf8"))).toEqual({ input: envelope(1) });
    expect(JSON.parse(sent[1]!.body.toString("utf8"))).toEqual({ input: envelope(1), limit: 2 });
    expect([...sent[1]!.headers.keys()].filter((key) => /deadline|timeout/i.test(key))).toEqual([]);
    expect([sent[2]!.line, sent[2]!.body.length]).toEqual(["GET /download HTTP/1.1", 0]);
  },
);

nativeTest(
  "separates success cases, declared rejections, defects and communication failures by identifying information (G8 G9)",
  async () => {
    const unreachable = `http://127.0.0.1:${await freePort()}/`;
    const scenarios = httpScenarios();
    const requests = [];
    for (const [, operation, response] of scenarios) {
      const url = response === undefined ? unreachable : await peers.origin(response);
      requests.push(
        operation === "submit"
          ? submit("http", url, envelope(1))
          : { operation, binding: "http", url, payload: "{}" },
      );
    }
    const observations = await runDriver(sample.driver("OperationDriver"), requests);
    scenarios.forEach(([name, , , expected], index) =>
      expect(observations[index], name).toMatchObject(expected),
    );
  },
  300_000,
);

nativeTest(
  "separates IPC success cases, declared rejections, defects and communication failures by resolved tag (G8 G9)",
  async () => {
    const scenarios = ipcScenarios();
    const requests = scenarios.map(([, operation, ipcPeer]) =>
      operation === "submit"
        ? submit("ipc", server().origin, envelope(1), undefined, { ipcPeer })
        : { operation, binding: "ipc", ipcPeer, payload: "{}" },
    );
    const observations = await runDriver(sample.driver("OperationDriver"), requests);
    scenarios.forEach(([name, , , expected], index) =>
      expect(observations[index], name).toMatchObject(expected),
    );
  },
  300_000,
);

for (const binding of ["direct", "http", "ipc"] as const)
  nativeTest(`${binding}: keeps the host-owned reason and the completed result (G10)`, async () => {
    const scenarios = cancellationScenarios(binding, server().origin);
    const observations = await runDriver(
      sample.driver("OperationDriver"),
      scenarios.map(([, request]) => request),
    );
    scenarios.forEach(([name, , expected], index) =>
      expect(observations[index], `${binding}: ${name}`).toMatchObject(expected),
    );
  });

nativeTest(
  "forwards the host deadline to handlers over direct and IPC calls and to the HTTP request options (G10)",
  async () => {
    const deadline = new Date(Date.now() + 10 * 60_000);
    deadline.setMilliseconds(123);
    const at = deadline.toISOString();
    const [direct, ipc, http] = await runDriver(
      sample.driver("OperationDriver"),
      (["direct", "ipc", "http"] as const).map((binding) =>
        submit(binding, server().origin, envelope(1, "dl"), undefined, {
          deadline: at,
          observeDeadline: true,
        }),
      ),
    );
    const instant = (value: unknown): number =>
      new Date(String(value).replace(/^deadline:/, "")).getTime();
    expect([instant(direct!.value), instant(ipc!.value), instant(http!.httpDeadline)]).toEqual([
      deadline.getTime(),
      deadline.getTime(),
      deadline.getTime(),
    ]);
    expect([direct, ipc, http].map((result) => instant(result!.runtimeDeadline))).toEqual([
      deadline.getTime(),
      deadline.getTime(),
      deadline.getTime(),
    ]);
    expect([direct, ipc, http].map((result) => result!.deadlineOverruns)).toEqual([0, 0, 0]);
    expect([direct, ipc, http].map((result) => result!.exit)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
  },
);

nativeTest(
  "records an expired execution deadline and preserves the boundary's typed failure",
  async () => {
    const deadline = new Date(Date.now() - 60_000).toISOString();
    const [result] = await runDriver(sample.driver("OperationDriver"), [
      submit("direct", server().origin, envelope(1), undefined, {
        deadline,
        observeDeadline: true,
      }),
    ]);
    expect(result).toMatchObject({ exit: "transport", reason: "deadline", deadlineOverruns: 1 });
    expect(new Date(String(result!.runtimeDeadline)).getTime()).toBe(new Date(deadline).getTime());
  },
);
