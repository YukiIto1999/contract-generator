import { Result } from "ts-results-es";
import type {
  Constraints,
  ContractModel,
  ContractType,
  EmissionOptions,
  GenerationIssue,
  Origin,
} from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { inputOf } from "./operation-plan.js";

/** Declaration position carrying value restrictions */
interface RestrictionSite {
  /** Contract member the restrictions belong to */
  readonly subject: string;
  /** Original declaration location */
  readonly origin: Origin;
  /** Restrictions at the position */
  readonly constraints: Constraints;
}

/**
 * Restrictions a declaration or its member references declare
 * @param type - Declaration
 * @returns Restriction sites in declaration order
 */
function typeSites(type: ContractType): readonly RestrictionSite[] {
  switch (type.kind) {
    case "scalar":
      return [{ subject: type.id, origin: type.origin, constraints: type.constraints }];
    case "object":
      return type.fields.map((field) => ({
        subject: `${type.id}.${field.name}`,
        origin: field.origin,
        constraints: field.type.constraints,
      }));
    case "array":
      return [
        { subject: type.id, origin: type.origin, constraints: type.constraints },
        {
          subject: `${type.id}[]`,
          origin: type.element.origin,
          constraints: type.element.constraints,
        },
      ];
    case "union":
      return type.variants.map((variant) => ({
        subject: `${type.id}.${variant.name}`,
        origin: variant.origin,
        constraints: variant.type.constraints,
      }));
    case "enum":
    case "literal":
      return [];
  }
}

/**
 * Every position whose pattern the generated code compiles
 * @param model - Contract model
 * @param types - Declarations in stable order
 * @returns Restriction sites of declarations and operation outcomes
 */
function restrictionSites(
  model: ContractModel,
  types: readonly ContractType[],
): readonly RestrictionSite[] {
  const outcomes = model.operations.flatMap((operation) =>
    operation.outcomes.flatMap((outcome) =>
      outcome.type === undefined
        ? []
        : [
            {
              subject: `${operation.id}.${outcome.name}`,
              origin: outcome.origin,
              constraints: outcome.type.constraints,
            },
          ],
    ),
  );
  return [...types.flatMap(typeSites), ...outcomes];
}

/**
 * Compilation outcome of a declared pattern
 * @param pattern - ECMAScript pattern source
 * @returns Whether the pattern is a valid Unicode regular expression
 * @throws {@link Error} Failure that is not a pattern syntax error
 */
function isUnicodePattern(pattern: string): boolean {
  return Result.wrap<RegExp, unknown>(() => new RegExp(pattern, "u"))
    .mapErr((cause) => {
      if (cause instanceof SyntaxError) return cause;
      throw cause;
    })
    .isOk();
}

/**
 * Declared patterns that are not ECMAScript Unicode regular expressions
 * @param sites - Restriction sites
 * @returns One source-addressed issue per invalid pattern
 */
function patternIssues(sites: readonly RestrictionSite[]): GenerationIssue[] {
  return sites.flatMap((site): GenerationIssue[] => {
    const { pattern } = site.constraints;
    if (pattern === undefined || isUnicodePattern(pattern)) return [];
    return [
      {
        code: "typescript-pattern",
        target: "typescript",
        origin: site.origin,
        subject: site.subject,
        reason: "The declared pattern is not a valid ECMAScript Unicode regular expression",
      },
    ];
  });
}

/**
 * Declarations that would share one TypeScript name
 * @param types - Declarations in stable order
 * @returns One issue per repeated declaration name
 */
function nameIssues(types: readonly ContractType[]): GenerationIssue[] {
  const seen = new Set<string>();
  return types.flatMap((type): GenerationIssue[] => {
    if (!seen.has(type.name)) {
      seen.add(type.name);
      return [];
    }
    return [
      {
        code: "typescript-name",
        target: "typescript",
        origin: type.origin,
        subject: type.id,
        reason: `Duplicate TypeScript declaration ${type.name}`,
      },
    ];
  });
}

/**
 * Operations that the generated code cannot bind
 * @param model - Contract model
 * @param options - Caller-owned language integration
 * @returns Issues for a missing Effect module and for operations without an object parameter declaration
 */
function operationIssues(model: ContractModel, options: EmissionOptions): GenerationIssue[] {
  const byId = new Map(model.types.map((type) => [type.id, type]));
  const operations = [...model.operations].sort((a, b) => compareText(a.id, b.id));
  const issues = operations.flatMap((operation): GenerationIssue[] =>
    inputOf(byId, operation) === undefined
      ? [
          {
            code: "typescript-operation-input",
            target: "typescript",
            origin: operation.origin,
            subject: operation.id,
            reason: "The operation parameters must resolve to a generated object declaration",
          },
        ]
      : [],
  );
  const first = operations[0];
  if (options.typescriptEffectModule !== undefined || first === undefined) return issues;
  return [
    {
      code: "typescript-effect-module",
      target: "typescript",
      origin: first.origin,
      subject: first.id,
      reason:
        "A caller-owned module exporting callable Effect<Env, E, A> and deferEffect((env, signal, deadlineAt) => AsyncResult<A, E>) is required",
    },
    ...issues,
  ];
}

/**
 * Source-addressed failures that prevent generating the TypeScript target
 * @param model - Contract model
 * @param options - Caller-owned language integration
 * @returns Every issue in stable declaration order, empty when generation can proceed
 */
export function validateModel(model: ContractModel, options: EmissionOptions): GenerationIssue[] {
  const types = [...model.types].sort((a, b) => compareText(a.id, b.id));
  return [
    ...nameIssues(types),
    ...patternIssues(restrictionSites(model, types)),
    ...operationIssues(model, options),
  ];
}
