/** Dependency unit of the generated C# output */
export type Unit = "Types" | "Provider" | "Client";

/** Project reference lines of one unit
 * @param unit - Dependency role
 * @returns Reference items
 */
function references(unit: Unit): string {
  if (unit === "Types") return '<ProjectReference Include="$(TypeModelingProjectPath)" />';
  return `<ProjectReference Include="../types/Contract.Types.csproj" />\n    <ProjectReference Include="$(EffectSystemProjectPath)" />`;
}

/** Guard that names the dependency source a unit needs
 * @param unit - Dependency role
 * @returns Error element
 */
function requirement(unit: Unit): string {
  return unit === "Types"
    ? "<Error Condition=\"'$(TypeModelingProjectPath)' == ''\" Text=\"Supply TypeModelingProjectPath for TypeModeling v0.2.0 source\" />"
    : "<Error Condition=\"'$(EffectSystemProjectPath)' == ''\" Text=\"Supply EffectSystemProjectPath for EffectSystem v0.2.0 source\" />";
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
  <ItemGroup>
    ${references(unit)}
  </ItemGroup>
  <Target Name="RequireContractDependencies" BeforeTargets="PrepareForBuild">
    ${requirement(unit)}
  </Target>
</Project>
`;
}
