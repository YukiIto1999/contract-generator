import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom } from "./profile-source.fixture.js";

test("nullable declared rejection payloads retain their independent outcome classification", async () => {
  const model = await modelFrom(`namespace Public;
    @error model Rejection { message: string; }
    @outcomes union Result { rejected: Rejection | null }
    op run(): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "rejected", 400, "application/json");`);
  expect(model.operations[0]?.outcomes[0]).toMatchObject({
    rejection: true,
    type: { nullable: true },
  });
});

test("one outcome cannot mix successful and declared rejection payload variants", async () => {
  const codes = await codesFrom(`namespace Public;
    model Success { kind: "success"; }
    @error model Failure { kind: "failure"; }
    @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union Mixed { success: Success, failure: Failure }
    @outcomes union Result { mixed: Mixed }
    op run(): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "mixed", 400, "application/json");`);
  expect(codes).toContain("ambiguous-outcome-role");
});

test("an operation must return a named union marked as outcomes", async () => {
  const codes = await codesFrom(`namespace Public;
    op run(): string;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");`);
  expect(codes).toContain("invalid-outcomes");
});

test("an outcomes union cannot be used as a payload value", async () => {
  const codes = await codesFrom(`namespace Public;
    @outcomes union Result { ok: void }
    model Holder { result: Result; }`);
  expect(codes).toContain("outcomes-as-payload");
});

test("outcomes and bindings are listed in canonical name order whatever the declaration order", async () => {
  const model = await modelFrom(`namespace Public;
    @outcomes union Result { zebra: void, apple: void }
    op run(): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "zebra", 204);
    @@httpResult(run, "apple", 200);`);
  const operation = model.operations[0];
  expect(operation?.outcomes.map((outcome) => outcome.name)).toEqual(["Apple", "Zebra"]);
  expect(operation?.http?.results.map((result) => result.outcome)).toEqual(["Apple", "Zebra"]);
});
