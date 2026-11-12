/** Source input required by a native fixture */
export interface Dependency {
  /** Input name matching the sibling directory */
  readonly input: string;
  /** Environment variable containing the immutable source path */
  readonly sourceVariable: string;
  /** Project path relative to the source root */
  readonly project: string;
}

/** Immutable GitHub source identity from the Nix lock */
export interface LockedSource {
  /** Nix source transport */
  readonly type: string;
  /** GitHub repository owner */
  readonly owner: string;
  /** GitHub repository name */
  readonly repo: string;
  /** Exact source commit */
  readonly rev: string;
  /** Expected NAR content hash */
  readonly narHash: string;
}

/** Input graph produced by devenv update */
export interface DevenvLock {
  /** Root input node */
  readonly root: string;
  /** Named source nodes */
  readonly nodes: Readonly<
    Record<
      string,
      {
        /** Root input references */
        readonly inputs?: Readonly<Record<string, string>>;
        /** Resolved immutable source */
        readonly locked?: LockedSource;
      }
    >
  >;
}

/** Content-checked source available for copying */
export interface PreparedSource {
  /** Native dependency declaration */
  readonly dependency: Dependency;
  /** Canonical immutable source location */
  readonly path: string;
  /** Immutable repository URL */
  readonly repository: string;
  /** Exact source commit */
  readonly revision: string;
  /** Verified NAR content hash */
  readonly narHash: string;
}

/** Native fixture source ownership identity */
export const sourceOwner = "@yukiito1999/contract-generator/native-dependencies/v1";
/** Ownership marker excluded from upstream source content */
export const ownershipFile = ".contract-generator-source.json";
/** Ownership input name of the complete native dependency root */
export const rootInput = "native-dependencies";
/** Immutable source inputs in sibling publication order */
export const dependencies: readonly Dependency[] = [
  {
    input: "typemodeling-dotnet",
    sourceVariable: "CONTRACT_GENERATOR_TYPEMODELING_SOURCE",
    project: "src/TypeModeling/TypeModeling.csproj",
  },
  {
    input: "effectsystem-dotnet",
    sourceVariable: "CONTRACT_GENERATOR_EFFECTSYSTEM_SOURCE",
    project: "src/EffectSystem/EffectSystem.csproj",
  },
];
