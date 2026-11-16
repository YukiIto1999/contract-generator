/** `Directory.Build.props` that a consumer places above generated output sitting beside its own tree
 *
 * The generated projects import nothing themselves, so this file is the one place that gives them the analyzers and the error policy.
 * The dependency paths reach them from the environment, as the README tells a consumer whose output is outside its tree.
 */
export const outputTreeProps = `<Project>
  <Import Project="$(MSBuildThisFileDirectory)generated/csharp/Contract.Analysis.props" />
  <Import Project="$(MSBuildThisFileDirectory)generated/csharp/Contract.EffectAnalysis.props" />
</Project>
`;
