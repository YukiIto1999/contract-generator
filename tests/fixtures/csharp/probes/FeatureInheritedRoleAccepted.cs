using Features;
using TypeModeling.Domain;

/// <summary>A narrowed scalar keeps the ancestor's nominal role</summary>
internal static class FeatureInheritedRoleAccepted
{
    /// <summary>Narrowed construction yielding the ancestor role itself</summary>
    /// <param name="value">Candidate customer text</param>
    /// <returns>The same CustomerRole type that the ancestor declares</returns>
    internal static Result<Accepted<CustomerRole>, ContractFailure> Create(string value) => NonemptyCustomerCodec.Create(value);
}
