import { expect } from "vite-plus/test";
import { observeCodecCases } from "./csharp-codec-observation.js";
import { featuresSource } from "./csharp-contract.js";
import { featuresCodecCases } from "./csharp-features-cases.js";
import {
  expectBytesRoundTrip,
  expectParameterMapping,
  expectSameStatusSelection,
} from "./csharp-features-loopback.js";
import {
  expectOrdinaryValuesOnTheConfiguredOrigin,
  expectRedirectsNeverReachAnotherOrigin,
  expectSameOriginRedirectNotFollowed,
  expectUnsafeValuesNeverSent,
} from "./csharp-features-wire.js";
import { chooseResponses, pingResponses, type Response } from "./csharp-features-client-cases.js";
import { providerScenarios } from "./csharp-features-provider-cases.js";
import { PeerPool } from "./csharp-peers.js";
import { runDriver } from "./csharp-process.js";
import { nativeTest, useContract } from "./csharp-suite.js";
import { buildCSharpProject, generatedDiagnostics } from "./csharp-toolchain.js";

/** Raw peers that serve the hand-written responses */
const peers = new PeerPool();
/** Features contract with its driver */
const features = useContract(featuresSource, "Features", ["FeaturesDriver.csproj"], () =>
  peers.close(),
);

/** Client observations of hand-written responses
 * @param operation - Client operation name
 * @param responses - Scenarios with their expectations
 */
async function expectResponses(operation: string, responses: readonly Response[]): Promise<void> {
  const requests = [];
  for (const [, response] of responses)
    requests.push({ operation, url: await peers.origin(response) });
  const observations = await runDriver(features.driver("FeaturesDriver"), requests);
  responses.forEach(([name, , expected], index) =>
    expect(observations[index], name).toMatchObject(expected),
  );
}

nativeTest(
  "compiles the types, provider and client units without a compiler diagnostic of their own",
  () => {
    expect(
      generatedDiagnostics(features.build("FeaturesDriver.csproj")).map(
        (diagnostic) => diagnostic.text,
      ),
    ).toEqual([]);
  },
);

nativeTest(
  "keeps an inherited role and rejects its use as an unrelated role with CS0029 only (G1)",
  () => {
    const accepted = buildCSharpProject(features.fixture(), "RoleProbe.csproj", {
      Probe: "FeatureInheritedRoleAccepted",
    });
    expect([accepted.status, accepted.diagnostics], accepted.output).toEqual([0, []]);
    const rejected = buildCSharpProject(features.fixture(), "RoleProbe.csproj", {
      Probe: "FeatureRejectInheritedAsOther",
    });
    expect(rejected.status, rejected.output).not.toBe(0);
    expect(
      rejected.diagnostics.map((d) => `${d.severity} ${d.code}`),
      rejected.output,
    ).toEqual(["error CS0029"]);
    expect(rejected.diagnostics[0]!.text).toContain(
      "'Features.CustomerRole' to 'Features.OtherCustomer'",
    );
  },
);

nativeTest(
  "preserves exact numbers, applies temporal, mixed-kind and merge rules and keeps per-binding encodings (G3 G5 G6)",
  async () => {
    expect(
      (await observeCodecCases(features.driver("FeaturesDriver"), featuresCodecCases())).length,
    ).toBeGreaterThan(0);
  },
);

nativeTest(
  "selects same-status results by the declared header and a declared 503 rejection by its body",
  () => expectSameStatusSelection(features.driver("FeaturesDriver")),
);
nativeTest(
  "maps path, query, header and body parameters and leaves the default to the provider (G7)",
  () => expectParameterMapping(features.driver("FeaturesDriver")),
);
nativeTest(
  "carries bytes unchanged in both directions and keeps an empty body distinct from an absent one (G8)",
  () => expectBytesRoundTrip(features.driver("FeaturesDriver")),
);

nativeTest(
  "sends ordinary path and header values to the configured origin exactly and keeps a horizontal tab (G20)",
  () => expectOrdinaryValuesOnTheConfiguredOrigin(features.driver("FeaturesDriver"), peers),
);
nativeTest(
  "returns an empty or dot path value and a framing header value as a communication failure before any send (G20)",
  () => expectUnsafeValuesNeverSent(features.driver("FeaturesDriver"), peers),
);
nativeTest(
  "never carries a request to another origin through a redirect and reports the redirect as a defect (G20)",
  () => expectRedirectsNeverReachAnotherOrigin(features.driver("FeaturesDriver"), peers),
);
nativeTest("does not follow a redirect to the same origin and reports it as a defect (G20)", () =>
  expectSameOriginRedirectNotFollowed(features.driver("FeaturesDriver"), peers),
);

nativeTest(
  "completes provider requests, defaults at every depth and merged bodies through every provider entry (G7 G8)",
  async () => {
    const scenarios = providerScenarios();
    const observations = await runDriver(
      features.driver("FeaturesDriver"),
      scenarios.map(([, request]) => request),
    );
    scenarios.forEach(([name, , expected], index) =>
      expect(observations[index], name).toMatchObject(expected),
    );
  },
);

nativeTest(
  "separates declared results, declared rejections, defects and communication failures by selector (G8 G9)",
  () => expectResponses("choose", chooseResponses()),
);

nativeTest("matches a bodyless result only to a response with no body and no media type (G8)", () =>
  expectResponses("ping", pingResponses()),
);

nativeTest("answers a bodyless result without a media type and without a body", async () => {
  const [observation] = await runDriver(features.driver("FeaturesDriver"), [
    { operation: "provider", method: "GET", target: "/ping" },
  ]);
  expect(observation).toMatchObject({
    exit: "responded",
    status: 200,
    contentType: null,
    bodyBase64: "",
  });
});
