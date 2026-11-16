/** Dependency unit of the generated C# output */
export type Unit = "Types" | "Provider" | "Client";

/** Project reference lines of one unit
 * @param unit - Dependency role
 * @returns Reference items
 */
function references(unit: Unit): string {
  return unit === "Types"
    ? '<ProjectReference Include="$(TypeModelingProjectPath)" />'
    : '<ProjectReference Include="../types/Contract.Types.csproj" />\n    <ProjectReference Include="$(EffectSystemProjectPath)" />';
}

/** Contract-specific build policy for the consumer's `Directory.Build.props`, on top of the TypeModeling props
 *
 * The analyzer attachment belongs to `TypeModeling.Analysis.props` of the checkout that `TypeModelingProjectPath` names.
 * An earlier import of that file is left alone, so the analyzer is attached once.
 * @returns Importable error policy, analyzer configuration and import of the owner's props
 */
export function analysisProps(): string {
  return `<Project>
  <PropertyGroup>
    <WarningsAsErrors>$(WarningsAsErrors);CS8509;CS8524;CS8655;CS8846;CS8847;TYPMOD021</WarningsAsErrors>
    <_ContractTypeModelingRoot Condition="'$(TypeModelingProjectPath)' != ''">$([MSBuild]::NormalizeDirectory('$(MSBuildProjectDirectory)', '$(TypeModelingProjectPath)', '..', '..', '..'))</_ContractTypeModelingRoot>
  </PropertyGroup>
  <ItemGroup>
    <GlobalAnalyzerConfigFiles Include="$(MSBuildThisFileDirectory)Contract.Analysis.globalconfig" />
  </ItemGroup>
  <Import Project="$(_ContractTypeModelingRoot)TypeModeling.Analysis.props" Condition="'$(TypeModelingAnalyzerProject)' == '' And '$(_ContractTypeModelingRoot)' != '' And Exists('$(_ContractTypeModelingRoot)TypeModeling.Analysis.props')" />
  <Target Name="RequireContractAnalysis" BeforeTargets="PrepareForBuild">
    <Error Condition="'$(TypeModelingAnalyzerProject)' == ''" Text="TypeModeling.Analysis.props was not imported; set TypeModelingProjectPath to src/TypeModeling/TypeModeling.csproj of a TypeModeling v0.4.0 or later checkout" />
  </Target>
</Project>
`;
}

/** Explicit case coverage for generated types and importing consumers
 * @returns Global analyzer configuration enabling the opt-in closed-case rule
 */
export function analysisConfig(): string {
  return `is_global = true
dotnet_diagnostic.TYPMOD021.severity = error
`;
}

/** Contract-specific build policy for projects that use Effect, on top of the EffectSystem props
 *
 * The analyzer attachment belongs to `EffectSystem.Analysis.props` of the checkout that `EffectSystemProjectPath` names.
 * An earlier import of that file is left alone, so the analyzer is attached once.
 * @returns Importable error policy and import of the owner's props
 */
export function effectAnalysisProps(): string {
  return `<Project>
  <PropertyGroup>
    <WarningsAsErrors>$(WarningsAsErrors);EFFSYS001;EFFSYS002;EFFSYS003;EFFSYS004;EFFSYS005;EFFSYS006;EFFSYS007;EFFSYS008;EFFSYS009;EFFSYS010;EFFSYS011;EFFSYS012;EFFSYS013;EFFSYS014;EFFSYS015</WarningsAsErrors>
    <_ContractEffectSystemRoot Condition="'$(EffectSystemProjectPath)' != ''">$([MSBuild]::NormalizeDirectory('$(MSBuildProjectDirectory)', '$(EffectSystemProjectPath)', '..', '..', '..'))</_ContractEffectSystemRoot>
  </PropertyGroup>
  <Import Project="$(_ContractEffectSystemRoot)EffectSystem.Analysis.props" Condition="'$(EffectSystemAnalyzerProject)' == '' And '$(_ContractEffectSystemRoot)' != '' And Exists('$(_ContractEffectSystemRoot)EffectSystem.Analysis.props')" />
  <Target Name="RequireContractEffectAnalysis" BeforeTargets="PrepareForBuild">
    <Error Condition="'$(EffectSystemAnalyzerProject)' == ''" Text="EffectSystem.Analysis.props was not imported; set EffectSystemProjectPath to src/EffectSystem/EffectSystem.csproj of an EffectSystem v0.4.0 or later checkout" />
  </Target>
</Project>
`;
}

/** Generated dependency-unit project
 *
 * A unit is an ordinary project of the consumer: it declares no analyzer reference and imports no props.
 * The analyzers, the error policy and the dependency paths reach it from the `Directory.Build.props` above it.
 * @param unit - Dependency role
 * @returns Deterministic caller-configured project file
 */
export function project(unit: Unit): string {
  const dependency = unit === "Types" ? "TypeModelingProjectPath" : "EffectSystemProjectPath";
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>14</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <JsonSerializerIsReflectionEnabledByDefault>false</JsonSerializerIsReflectionEnabledByDefault>
    <AssemblyName>Contract.${unit}</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    ${references(unit)}
  </ItemGroup>
  <Target Name="RequireContractDependency" BeforeTargets="PrepareForBuild">
    <Error Condition="'$(${dependency})' == ''" Text="Supply ${dependency} for the ${dependency.replace("ProjectPath", "")} source project" />
  </Target>
</Project>
`;
}
