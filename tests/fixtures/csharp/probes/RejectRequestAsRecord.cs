using Sample;

/// <summary>Compile rejection of a request identifier in a record role</summary>
internal static class RejectRequestAsRecord
{
    /// <summary>Intentionally invalid nominal role exchange</summary>
    /// <param name="value">Request identifier</param>
    /// <returns>Invalid record identifier assignment</returns>
    internal static RecordId Exchange(RequestId value) => value;
}
