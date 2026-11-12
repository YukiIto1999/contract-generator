using Features;

/// <summary>Compile rejection of an inherited role in a separately declared role</summary>
internal static class FeatureRejectInheritedAsOther
{
    /// <summary>Intentionally invalid nominal role exchange</summary>
    /// <param name="value">Inherited customer role</param>
    /// <returns>Invalid assignment to an unrelated role</returns>
    internal static OtherCustomer Exchange(CustomerRole value) => value;
}
