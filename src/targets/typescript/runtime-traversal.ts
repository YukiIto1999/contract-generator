/** Private drivers of specialized declaration frames */
export const runtimeTraversalSource = String.raw`/**
 * Iterative completion of specialized readers
 * @typeParam T - Completed declaration
 * @param root - Suspended root reader
 * @returns Entire completion or invalid sentinel
 */
function finishRead<T>(root: ReadFrame<T>): T | undefined {
  const frames: ReadFrame<unknown>[] = [root];
  let completed: unknown;
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const next = frame.next(completed);
    if (next.done) {
      frames.pop();
      completed = next.value;
    } else {
      frames.push(next.value);
      completed = undefined;
    }
  }
  return completed as T | undefined;
}

/**
 * Specialized null binding traversal
 * @returns Null emission frame
 */
function* writeNull(): WriteFrame {
  yield { kind: "scalar", value: null };
}

/**
 * Iterative specialized binding traversal
 * @param root - Suspended root writer
 * @param emit - Destination observation
 */
function finishWrite(root: WriteFrame, emit: (event: WireEvent) => void): void {
  const frames: WriteFrame[] = [root];
  while (frames.length > 0) {
    const next = frames[frames.length - 1]!.next();
    if (next.done) frames.pop();
    else if ("kind" in next.value) emit(next.value);
    else frames.push(next.value);
  }
}

/** Mutable destination of one independent binding container */
interface WireDestination {
  /** Owned container */
  readonly value: Record<string, unknown> | unknown[];
  /** Next declared object member */
  key: string | undefined;
}

/**
 * Independently owned binding representation
 * @param root - Specialized root writer
 * @returns Complete binding graph
 * @throws {@link ContractDefect} Invalid specialized writer sequence
 */
function wireGraph(root: WriteFrame): unknown {
  const containers: WireDestination[] = [];
  let output: unknown;
  let assigned = false;
  const append = (value: unknown): void => {
    const destination = containers[containers.length - 1];
    if (destination === undefined) {
      if (assigned) throw new ContractDefect("Multiple binding roots");
      output = value;
      assigned = true;
    } else if (Array.isArray(destination.value)) destination.value.push(value);
    else {
      if (destination.key === undefined) throw new ContractDefect("Missing binding member");
      destination.value[destination.key] = value;
      destination.key = undefined;
    }
  };
  finishWrite(root, (event) => {
    switch (event.kind) {
      case "key": {
        const destination = containers[containers.length - 1];
        if (destination === undefined || Array.isArray(destination.value) || destination.key !== undefined) {
          throw new ContractDefect("Invalid binding member");
        }
        destination.key = event.key;
        break;
      }
      case "object":
      case "array": {
        const value: Record<string, unknown> | unknown[] = event.kind === "array" ? [] : Object.create(null);
        append(value);
        containers.push({ value, key: undefined });
        break;
      }
      case "end": {
        const destination = containers.pop();
        if (destination === undefined || destination.key !== undefined) throw new ContractDefect("Invalid binding container end");
        break;
      }
      case "scalar":
        append(event.value);
        break;
    }
  });
  if (!assigned || containers.length !== 0) throw new ContractDefect("Incomplete binding representation");
  return output;
}

/** Punctuation state of a directly encoded container */
interface JsonDestination {
  /** Array element punctuation instead of named members */
  readonly array: boolean;
  /** Absence of an emitted child */
  first: boolean;
  /** Pending named member value */
  pending: boolean;
}

/**
 * Direct binding JSON encoding without a temporary binding graph
 * @param root - Specialized root writer
 * @returns Entire JSON document
 * @throws {@link ContractDefect} Invalid specialized writer sequence
 */
function wireText(root: WriteFrame): string {
  const chunks: string[] = [];
  const containers: JsonDestination[] = [];
  let assigned = false;
  const beforeValue = (): void => {
    const container = containers[containers.length - 1];
    if (container === undefined) {
      if (assigned) throw new ContractDefect("Multiple binding roots");
      assigned = true;
    } else if (container.array) {
      if (!container.first) chunks.push(",");
      container.first = false;
    } else {
      if (!container.pending) throw new ContractDefect("Missing binding member");
      container.pending = false;
    }
  };
  finishWrite(root, (event) => {
    switch (event.kind) {
      case "key": {
        const container = containers[containers.length - 1];
        if (container === undefined || container.array || container.pending) throw new ContractDefect("Invalid binding member");
        if (!container.first) chunks.push(",");
        container.first = false;
        container.pending = true;
        chunks.push(jsonScalarText(event.key), ":");
        break;
      }
      case "object":
      case "array":
        beforeValue();
        chunks.push(event.kind === "array" ? "[" : "{");
        containers.push({ array: event.kind === "array", first: true, pending: false });
        break;
      case "end": {
        const container = containers.pop();
        if (container === undefined || container.pending) throw new ContractDefect("Invalid binding container end");
        chunks.push(container.array ? "]" : "}");
        break;
      }
      case "scalar":
        beforeValue();
        chunks.push(jsonScalarText(event.value));
        break;
    }
  });
  if (!assigned || containers.length !== 0) throw new ContractDefect("Incomplete binding representation");
  return chunks.join("");
}
`;
