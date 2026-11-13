import { expect, test } from "vite-plus/test";
import type { Constraints } from "../../../model/contract-model.js";
import type { IssueSink } from "../../issue-sink.js";
import {
  checkIntegerDomain,
  compareNumbers,
  inclusive,
  isIntegral,
  plainNumber,
} from "../../numeric-bounds.js";
import { compileSource } from "./profile-source.fixture.js";

/** Declaration that owns the domain under test, as a real compiler target */
const owner = (await compileSource("namespace Public;")).program.getGlobalNamespaceType();

/**
 * Rule codes reported by an integer-domain check
 * @param constraints - Effective restrictions of an integer use
 * @returns Codes of the reported issues
 */
function domainCodes(constraints: Constraints): string[] {
  const codes: string[] = [];
  const sink: IssueSink = (code) => {
    codes.push(code);
  };
  checkIntegerDomain(constraints, owner, sink);
  return codes;
}

test.each(["1", "-0", "1000", "1e3", "2.50e1", "100.000"])("%s is a whole number", (text) => {
  expect(isIntegral(text)).toBe(true);
});

test.each(["1.5", "0.001", "2.5e-1", "-7.25"])("%s is not a whole number", (text) => {
  expect(isIntegral(text)).toBe(false);
});

test("plain spelling drops exponents and redundant digits", () => {
  expect(plainNumber("1e3")).toBe("1000");
  expect(plainNumber("5.0")).toBe("5");
  expect(plainNumber("0.10")).toBe("0.1");
});

test("exact comparison separates values that binary64 cannot", () => {
  expect(compareNumbers("9007199254740992", "9007199254740993")).toBe(-1);
  expect(compareNumbers("1.0", "1")).toBe(0);
  expect(compareNumbers("-1e300", "-1e299")).toBe(-1);
});

test("an integer domain needs a whole number between its boundaries", () => {
  const between = (minimum: string, maximum: string, lowerOpen: boolean, upperOpen: boolean) => ({
    minimum: { value: minimum, exclusive: lowerOpen },
    maximum: { value: maximum, exclusive: upperOpen },
  });
  expect(domainCodes(between("1", "2", true, true))).toEqual(["empty-domain"]);
  expect(domainCodes(between("1", "2", true, false))).toEqual([]);
  expect(domainCodes(between("1.2", "1.8", false, false))).toEqual(["empty-domain"]);
  expect(domainCodes(between("-1.5", "-1.2", false, false))).toEqual(["empty-domain"]);
  expect(domainCodes({ minimum: inclusive("3"), maximum: inclusive("3") })).toEqual([]);
});
