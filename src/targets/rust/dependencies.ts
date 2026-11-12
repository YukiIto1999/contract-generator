import type { GeneratedFile } from "../../model/contract-model.js";

/** Exact direct dependencies of generated Rust crates */
export const rustDependencies = {
  serde: "1.0.229",
  serde_json: "1.0.151",
  num_bigint: "0.4.8",
  base64: "0.22.1",
  bytes: "1.12.1",
  thiserror: "2.0.21",
  regex: "1.13.1",
  reqwest: "0.13.5",
  axum: "0.8.9",
  tokio: "1.53.1",
  tokio_util: "0.7.19",
  http_body_util: "0.1.5",
  url: "2.5.8",
  percent_encoding: "2.3.2",
} as const;

/** Workspace lint policy of the languages/rust standard that every generated crate inherits */
const workspaceLints = `[workspace.lints.rust]
warnings = "deny"
unsafe_code = "deny"
missing_docs = "deny"

[workspace.lints.clippy]
unwrap_used = "deny"
expect_used = "deny"
missing_errors_doc = "deny"
missing_panics_doc = "deny"
missing_safety_doc = "deny"
missing_docs_in_private_items = "deny"
`;

/** Self-contained Cargo package manifest inheriting the workspace lints
 * @param prefix - Cargo package prefix
 * @param unit - Dependency-unit suffix
 * @param dependencies - Exact package dependency declarations
 * @returns Standalone crate manifest; its doctests are off, because a fenced block in a contract description would otherwise compile and run under `cargo test`
 */
function manifest(prefix: string, unit: string, dependencies: string): string {
  return `[package]\nname = "${prefix}-${unit}"\nversion = "0.1.0"\nedition = "2024"\nrust-version = "1.85"\npublish = false\n\n[lints]\nworkspace = true\n\n[lib]\ndoctest = false\n\n[dependencies]\n${dependencies}\n`;
}

/** Cargo workspace and package manifests of the four dependency units
 * @param prefix - Cargo package prefix
 * @returns Generated manifest files
 */
export function rustManifests(prefix: string): readonly GeneratedFile[] {
  const d = rustDependencies;
  const json = `serde_json = { version = "=${d.serde_json}", features = ["arbitrary_precision"] }`;
  const own = `${prefix}-types = { path = "../types" }\n${prefix}-transport = { path = "../transport" }`;
  return [
    {
      path: "rust/Cargo.toml",
      content: `[workspace]\nresolver = "3"\nmembers = ["types", "transport", "provider", "client"]\n\n${workspaceLints}`,
    },
    {
      path: "rust/types/Cargo.toml",
      content: manifest(
        prefix,
        "types",
        `serde = { version = "=${d.serde}", features = ["derive"] }\nserde_json = { version = "=${d.serde_json}", features = ["arbitrary_precision", "raw_value"] }\nnum-bigint = "=${d.num_bigint}"\nbase64 = "=${d.base64}"\nbytes = "=${d.bytes}"\nthiserror = "=${d.thiserror}"\nregex = "=${d.regex}"`,
      ),
    },
    {
      path: "rust/transport/Cargo.toml",
      content: manifest(
        prefix,
        "transport",
        `${prefix}-types = { path = "../types" }\n${json}\nthiserror = "=${d.thiserror}"\ntokio = { version = "=${d.tokio}", features = ["time"] }\ntokio-util = { version = "=${d.tokio_util}", features = ["rt"] }`,
      ),
    },
    {
      path: "rust/provider/Cargo.toml",
      content: manifest(
        prefix,
        "provider",
        `${own}\n${json}\naxum = "=${d.axum}"\nhttp-body-util = "=${d.http_body_util}"\nurl = "=${d.url}"\npercent-encoding = "=${d.percent_encoding}"`,
      ),
    },
    {
      path: "rust/client/Cargo.toml",
      content: manifest(
        prefix,
        "client",
        `${own}\n${json}\nreqwest = { version = "=${d.reqwest}", default-features = false, features = ["rustls"] }\ntokio = { version = "=${d.tokio}", features = ["macros"] }\nbytes = "=${d.bytes}"\nurl = "=${d.url}"`,
      ),
    },
  ];
}
