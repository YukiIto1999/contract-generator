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

/** Shared build-time enforcement for generated projects and their consumers
 * @returns Importable analyzer attachment and exhaustiveness error policy
 */
export function analysisProps(): string {
  return `<Project>
  <PropertyGroup>
    <WarningsAsErrors>$(WarningsAsErrors);CS8509;CS8524;CS8655;CS8846;CS8847;TYPMOD001</WarningsAsErrors>
    <_TypeModelingProjectDirectory Condition="'$(TypeModelingProjectPath)' != ''">$([System.IO.Path]::GetDirectoryName($([MSBuild]::NormalizePath('$(MSBuildProjectDirectory)', '$(TypeModelingProjectPath)'))))</_TypeModelingProjectDirectory>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="$(_TypeModelingProjectDirectory)/../TypeModeling.Analyzers/TypeModeling.Analyzers.csproj" Condition="'$(TypeModelingProjectPath)' != ''" OutputItemType="Analyzer" ReferenceOutputAssembly="false" PrivateAssets="all" />
  </ItemGroup>
  <Target Name="RequireContractAnalysis" BeforeTargets="PrepareForBuild">
    <Error Condition="'$(TypeModelingProjectPath)' == ''" Text="Supply TypeModelingProjectPath for TypeModeling v0.2.0 source and its analyzer" />
    <Error Condition="'$(TypeModelingProjectPath)' != '' And !Exists('$(_TypeModelingProjectDirectory)/../TypeModeling.Analyzers/TypeModeling.Analyzers.csproj')" Text="TypeModeling.Analyzers must be present beside the TypeModeling source project" />
  </Target>
</Project>
`;
}

/** Additional build-time enforcement for projects that use Effect
 * @returns Importable effect analyzer attachment and error policy
 */
export function effectAnalysisProps(): string {
  return `<Project>
  <PropertyGroup>
    <WarningsAsErrors>$(WarningsAsErrors);EFFSYS001;EFFSYS002;EFFSYS003;EFFSYS004;EFFSYS005;EFFSYS006;EFFSYS007;EFFSYS008;EFFSYS009;EFFSYS010;EFFSYS011;EFFSYS012;EFFSYS013</WarningsAsErrors>
    <_EffectSystemProjectDirectory Condition="'$(EffectSystemProjectPath)' != ''">$([System.IO.Path]::GetDirectoryName($([MSBuild]::NormalizePath('$(MSBuildProjectDirectory)', '$(EffectSystemProjectPath)'))))</_EffectSystemProjectDirectory>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="$(_EffectSystemProjectDirectory)/../EffectSystem.Analyzers/EffectSystem.Analyzers.csproj" Condition="'$(EffectSystemProjectPath)' != ''" OutputItemType="Analyzer" ReferenceOutputAssembly="false" PrivateAssets="all" />
  </ItemGroup>
  <Target Name="RequireContractEffectAnalysis" BeforeTargets="PrepareForBuild">
    <Error Condition="'$(EffectSystemProjectPath)' == ''" Text="Supply EffectSystemProjectPath for EffectSystem v0.2.0 source and its analyzer" />
    <Error Condition="'$(EffectSystemProjectPath)' != '' And !Exists('$(_EffectSystemProjectDirectory)/../EffectSystem.Analyzers/EffectSystem.Analyzers.csproj')" Text="EffectSystem.Analyzers must be present beside the EffectSystem source project" />
  </Target>
</Project>
`;
}

/** Generated dependency-unit project
 * @param unit - Dependency role
 * @returns Deterministic caller-configured project file
 */
export function project(unit: Unit): string {
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
  <Import Project="../Contract.Analysis.props" />${unit === "Types" ? "" : '\n  <Import Project="../Contract.EffectAnalysis.props" />'}
  <ItemGroup>
    ${references(unit)}
  </ItemGroup>
</Project>
`;
}
