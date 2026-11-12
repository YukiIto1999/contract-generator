import { expect } from "vite-plus/test";
import { sampleSource } from "./csharp-contract.js";
import { matrixScenarios, submit, envelope, type Binding } from "./csharp-operation-scenarios.js";
import {
  expectDefaultAndStatusSelection,
  expectIpcInputFailures,
  expectLimitRejection,
  expectMalformedRequests,
  expectResolvedEnvelopes,
  expectRouting,
  expectUnknownMembersDropped,
} from "./csharp-provider-expectations.js";
import { runDriver } from "./csharp-process.js";
import { nativeTest, useContract, useServer } from "./csharp-suite.js";

/** Sample contract with the operation driver and a real provider server */
const sample = useContract(sampleSource, "Sample", ["OperationDriver.csproj"]);
const server = useServer(sample);

for (const binding of ["direct", "http", "ipc"] as const satisfies readonly Binding[]) {
  nativeTest(`${binding}: observes the same contract outcomes (G7 G14)`, async () => {
    const scenarios = matrixScenarios();
    const observations = await runDriver(
      sample.driver("OperationDriver"),
      scenarios.map(([, request]) => request(binding, server().origin)),
    );
    scenarios.forEach(([name, , expected], index) =>
      expect(observations[index], `${binding}: ${name}`).toEqual(expected),
    );
  });
}

nativeTest("runs the real handlers in distinct processes for HTTP and IPC (G14)", async () => {
  const [direct, http, ipc] = await runDriver(
    sample.driver("OperationDriver"),
    (["direct", "http", "ipc"] as const).map((binding) =>
      submit(binding, server().origin, envelope(1, "pid")),
    ),
  );
  const pids = [direct, http, ipc].map((observation) =>
    Number(String(observation!.value).replace("pid:", "")),
  );
  expect(pids[1]).toBe(server().child.pid);
  expect(new Set([...pids, process.pid]).size).toBe(4);
});

nativeTest(
  "applies the default only to an unspecified limit and selects each result by status (G7 G8)",
  () => expectDefaultAndStatusSelection(server().origin),
);
nativeTest(
  "rejects null and out-of-range limits before the handler instead of repairing them (G7)",
  () => expectLimitRejection(server().origin),
);
nativeTest(
  "rejects wrong media types, malformed JSON, non-object bodies and missing members as normal violations (G7)",
  () => expectMalformedRequests(server().origin),
);
nativeTest("accepts unknown members and does not echo their values (G5)", () =>
  expectUnknownMembersDropped(server().origin),
);
nativeTest("answers undeclared routes and methods outside the declared results (G8)", () =>
  expectRouting(server().origin),
);
nativeTest(
  "returns resolved envelopes with their own tags, a body-free void and a declared rejection (G7 G9)",
  () => {
    expectResolvedEnvelopes(sample.driver("OperationDriver"));
  },
);
nativeTest(
  "rejects null and out-of-range limits and bad input over IPC without a resolved envelope (G7 G9)",
  () => {
    expectIpcInputFailures(sample.driver("OperationDriver"));
  },
);
