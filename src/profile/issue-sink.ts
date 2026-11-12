import type { DiagnosticTarget } from "@typespec/compiler";

/** Source-addressed profile failure accumulation */
export type IssueSink = (
  code: string,
  target: DiagnosticTarget,
  reason: string,
  subject?: string,
) => void;
