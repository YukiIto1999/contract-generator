/** One named guarantee of a consumer program */
export type Check = readonly [name: string, run: () => void | Promise<void>];

/**
 * Execution of named checks reporting one JSON line each
 * @param checks - Named guarantees in execution order
 * @param write - Sink of the result lines
 * @returns Completion after every check reported
 */
export async function runChecks(
  checks: readonly Check[],
  write: (line: string) => void,
): Promise<void> {
  for (const [name, run] of checks) {
    try {
      await run();
      write(JSON.stringify({ check: name, passed: true }));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      write(JSON.stringify({ check: name, passed: false, detail }));
    }
  }
}
