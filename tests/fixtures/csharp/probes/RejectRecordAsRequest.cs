using Sample;

/// <summary>Compile rejection of a record identifier in a request role</summary>
internal static class RejectRecordAsRequest
{
    /// <summary>Intentionally invalid nominal role exchange</summary>
    /// <param name="value">Record identifier</param>
    /// <returns>Invalid request identifier assignment</returns>
    internal static RequestId Exchange(RecordId value) => value;
}
