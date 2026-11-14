import type { ArrayType } from "../../model/contract-model.js";
import { useCheck, type UseCheck } from "./checks.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines } from "./naming.js";
import { readIntoUse, writeIntoUse } from "./use-codec.js";

/** Backing-storage identity that provider default application keys settled results on
 * @param t - Array representation
 * @returns Internal comparer exposing neither the storage nor element equality
 */
function storageIdentity(t: string): string {
  const comparer = `global::System.Collections.Generic.IEqualityComparer<${t}>`;
  return lines(
    doc("Identity of the privately owned storage", [], undefined, {
      value: "Comparer that equates two arrays only when they share one backing storage",
    }),
    `internal static ${comparer} StorageIdentity { get; } = new StorageIdentityComparer();`,
    doc("Backing-storage identity comparison without element equality or element hashing"),
    `private sealed class StorageIdentityComparer : ${comparer} {`,
    doc(
      "Shared-storage test of two arrays",
      [
        ["left", "First array"],
        ["right", "Second array"],
      ],
      "Whether both arrays view the same backing storage",
    ),
    `public bool Equals(${t} left, ${t} right) => left._items == right._items;`,
    doc(
      "Identity hash of the backing storage",
      [["value", "Array whose storage identity is hashed"]],
      "Hash code consistent with storage identity",
    ),
    `public int GetHashCode(${t} value) => value._items.GetHashCode();`,
    "}",
  );
}

/** Nominal immutable array representation shared by every array declaration
 * @param c - Target context
 * @param node - Resolved array
 * @param keyed - Whether provider default application keys settled results on this array's storage
 * @returns Array declaration
 */
function declaration(c: CSharpContext, node: ArrayType, keyed: boolean): string {
  const t = "Value";
  const element = c.use(node.element);
  return lines(
    doc(node.description || `Validated immutable collection ${node.name}`),
    `public readonly struct ${t} : IEnumerable<${element}> {`,
    doc("Privately owned validated elements"),
    `private readonly ImmutableArray<${element}> _items;`,
    doc("Validated storage completion", [["items", "Privately owned validated elements"]]),
    `private ${t}(ImmutableArray<${element}> items) { _items = items; }`,
    doc("Uninitialized representation detection", [], undefined, {
      value: "Whether construction never completed",
    }),
    "public bool IsDefault => _items.IsDefault;",
    doc("Validated element count", [], undefined, { value: "Number of elements" }),
    "public int Length => _items.Length;",
    doc("Immutable element access", [["index", "Zero-based element position"]], undefined, {
      value: "Validated element",
    }),
    `public ${element} this[int index] => _items[index];`,
    doc("Allocation-free element traversal", [], "Immutable element enumerator"),
    `public ImmutableArray<${element}>.Enumerator GetEnumerator() => _items.GetEnumerator();`,
    doc("Generic element traversal", [], "Immutable element enumerator"),
    `global::System.Collections.Generic.IEnumerator<${element}> IEnumerable<${element}>.GetEnumerator() => ((IEnumerable<${element}>)_items).GetEnumerator();`,
    doc("Untyped element traversal", [], "Immutable element enumerator"),
    "System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => ((System.Collections.IEnumerable)_items).GetEnumerator();",
    doc(
      "Internal accepted storage completion",
      [["items", "Privately owned validated elements"]],
      "Completed immutable collection",
    ),
    `internal static ${t} Complete(ImmutableArray<${element}> items) => new(items);`,
    keyed && storageIdentity(t),
    "}",
  );
}

/** Single-pass caller collection ownership
 * @param c - Target context
 * @param node - Resolved array
 * @param item - Element validation plan
 * @returns Construction invariant members
 */
function ownershipMembers(c: CSharpContext, node: ArrayType, item: UseCheck): string {
  const t = c.type(node.id);
  const element = c.use(node.element);
  const { minItems, maxItems } = node.constraints;
  return lines(
    doc("Declared array cardinality validation", [["count", "Number of elements"], "c", "path"]),
    "private static void CheckLength(int count, ReadContext c, Wire.Path path) {",
    minItems !== undefined && `if (count < ${minItems}) c.Add(path, "minItems");`,
    maxItems !== undefined && `if (count > ${maxItems}) c.Add(path, "maxItems");`,
    "}",
    doc("Completed immutable array guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, Wire.Path path) { if (value.IsDefault) c.Add(path, "required"); }`,
    doc(
      "Owned mutable collection acceptance",
      [["items", "Caller-owned elements"], "c", "path"],
      "Completed candidate",
    ),
    `internal static ${t} Own(IEnumerable<${element}> items, ReadContext c, Wire.Path path) {`,
    "int before = c.ViolationCount; var values = items.ToImmutableArray();",
    "CheckLength(values.Length, c, path);",
    `for (int i = 0; i < values.Length; i++) { ${item.call("values[i]", "Wire.At(path, i.ToString(CultureInfo.InvariantCulture))", false)} }`,
    `return c.ViolationCount == before ? ${t}.Complete(values) : default;`,
    "}",
  );
}

/** Typed array acceptance continuation
 * @param c - Target context
 * @param node - Resolved array
 * @param item - Element validation plan
 * @returns Reader scheduling member
 */
function readMember(c: CSharpContext, node: ArrayType, item: UseCheck): string {
  const t = c.type(node.id);
  const element = c.use(node.element);
  const verify = item.call("decoded", "childPath", true);
  return lines(
    doc("Private typed array continuation scheduling", [
      "element",
      "c",
      "path",
      "binding",
      "encoding",
      ["pending", "Traversal work stack"],
      ["complete", "Completed candidate receiver"],
    ]),
    `internal static void ReadInto(JsonElement element, ReadContext c, Wire.Path path, string binding, string? encoding, global::System.Collections.Generic.Stack<Action> pending, Action<${t}> complete) => pending.Push(() => {`,
    'if (element.ValueKind != JsonValueKind.Array) { c.Add(path, element.ValueKind == JsonValueKind.Null ? "null" : "type"); complete(default); return; }',
    `var values = ImmutableArray.CreateBuilder<${element}>(element.GetArrayLength()); int i = 0; int beforeArray = c.ViolationCount;`,
    "var elements = element.EnumerateArray();",
    "void Next() {",
    "if (!elements.MoveNext()) {",
    "CheckLength(values.Count, c, path);",
    `complete(c.ViolationCount == beforeArray ? ${t}.Complete(values.MoveToImmutable()) : default); return;`,
    "}",
    "var item = elements.Current; var childPath = Wire.At(path, (i++).ToString(CultureInfo.InvariantCulture)); int beforeItem = c.ViolationCount;",
    `Action<${element}> acceptChild = decoded => {`,
    verify && `if (c.ViolationCount == beforeItem) { ${verify} }`,
    "values.Add(decoded); pending.Push(Next);",
    "};",
    readIntoUse(c, node.element, "item", "childPath", "acceptChild"),
    "}",
    "pending.Push(Next);",
    "});",
  );
}

/** Typed array output continuation
 * @param c - Target context
 * @param node - Resolved array
 * @returns Writer scheduling member
 */
function writeMember(c: CSharpContext, node: ArrayType): string {
  const t = c.type(node.id);
  return lines(
    doc("Private typed array output scheduling", [
      "writer",
      "value",
      "binding",
      "encoding",
      ["pending", "Traversal work stack"],
    ]),
    `internal static void WriteInto(Utf8JsonWriter writer, ${t} value, string binding, string? encoding, global::System.Collections.Generic.Stack<Action> pending) => pending.Push(() => {`,
    "writer.WriteStartArray(); int index = 0;",
    "void Next() {",
    "if (index == value.Length) { writer.WriteEndArray(); return; }",
    "var item = value[index++]; pending.Push(Next);",
    writeIntoUse(c, node.element, "item"),
    "}",
    "pending.Push(Next);",
    "});",
  );
}

/** Array declaration with validated ownership and typed wire traversal
 * @param c - Target context
 * @param node - Resolved array
 * @param keyed - Whether provider default application keys settled results on this array's storage
 * @returns Declaration and codec
 */
export function renderArray(c: CSharpContext, node: ArrayType, keyed: boolean): string {
  const t = c.type(node.id);
  const element = c.use(node.element);
  const item = useCheck(c, "CheckElement", node.element, "an array element");
  const members = lines(
    declaration(c, node, keyed),
    item.declaration,
    ownershipMembers(c, node, item),
    readMember(c, node, item),
    writeMember(c, node),
  );
  const create = lines(
    doc(
      "Owned array construction",
      [["items", "Elements to copy"]],
      "Completed collection or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(IEnumerable<${element}> items) {`,
    `var c = new ReadContext(); if (items is null) { c.Add("", "null"); return c.Finish(default(${t})); }`,
    'return c.Finish(Own(items, c, ""));',
    "}",
  );
  return codecShell(c, node, members, create);
}
