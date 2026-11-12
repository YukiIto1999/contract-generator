import { ShortLabel } from "./contract.js";

/** Pure generated codec usage without provider or client or Effect imports
 * @returns Exact JSON text after public construction and decoding
 */
export function pureCodecConsumer(): string {
  const created = ShortLabel.create("😀");
  if (created.isErr()) throw new Error("Construction rejected valid code point fixture");
  const encoded = ShortLabel.encode(created.value.value);
  if (encoded.isErr()) throw new Error("Encoding rejected an accepted value");
  const decoded = ShortLabel.decode(encoded.value);
  if (decoded.isErr() || decoded.value.value !== "😀")
    throw new Error("Pure codec changed the contract value");
  return encoded.value;
}
