/** Private work stacks and deferred diagnostic pointer storage */
export const runtimeFrames = String.raw`
/// <summary>Private typed codec work drivers</summary>
internal static partial class Wire
{
/// <summary>Deferred RFC 6901 pointer materialization</summary>
internal readonly struct Path
{
    /// <summary>Shared ancestor segment</summary>
    private sealed class Segment(Segment? parent, string text)
    {
        /// <summary>Ancestor segment</summary>
        internal readonly Segment? Parent = parent;
        /// <summary>Unescaped member segment</summary>
        internal readonly string Text = text;
    }
    /// <summary>Ancestor chain</summary>
    private readonly Segment? _tail;
    /// <summary>Already positioned root</summary>
    private readonly string? _root;
    /// <summary>Pointer storage completion</summary>
    /// <param name="tail">Ancestor chain</param>
    /// <param name="root">Already positioned root</param>
    private Path(Segment? tail, string? root) { _tail = tail; _root = root; }
    /// <summary>Constant-time child pointer extension</summary>
    /// <param name="key">Unescaped member segment</param>
    /// <returns>Child pointer</returns>
    internal Path Append(string key) => new(new Segment(_tail, key), _root);
    /// <summary>Root pointer conversion</summary>
    /// <param name="path">Already positioned pointer</param>
    public static implicit operator Path(string path) => new(null, path);
    /// <summary>Diagnostic pointer conversion</summary>
    /// <param name="path">Deferred pointer</param>
    public static implicit operator string(Path path) => path.ToString();
    /// <summary>Diagnostic-only pointer materialization</summary>
    /// <returns>RFC 6901 pointer</returns>
    public override string ToString()
    {
        var parts = new global::System.Collections.Generic.Stack<string>();
        for (var part = _tail; part is not null; part = part.Parent) parts.Push(part.Text);
        var text = new global::System.Text.StringBuilder(_root);
        while (parts.TryPop(out var part)) text.Append('/').Append(part.Replace("~", "~0", StringComparison.Ordinal).Replace("/", "~1", StringComparison.Ordinal));
        return text.ToString();
    }
}
    /// <summary>Atomic typed traversal over private continuations</summary>
    /// <typeparam name="T">Completed contract representation</typeparam>
    /// <param name="start">Root scheduling operation</param>
    /// <returns>Completed root candidate</returns>
    internal static T ReadFrames<T>(Action<global::System.Collections.Generic.Stack<Action>, Action<T>> start)
    {
        var pending = new global::System.Collections.Generic.Stack<Action>();
        T result = default!;
        start(pending, value => result = value);
        while (pending.TryPop(out var step)) step();
        return result;
    }
    /// <summary>Typed writer traversal over private continuations</summary>
    /// <param name="start">Root scheduling operation</param>
    internal static void WriteFrames(Action<global::System.Collections.Generic.Stack<Action>> start)
    {
        var pending = new global::System.Collections.Generic.Stack<Action>();
        start(pending);
        while (pending.TryPop(out var step)) step();
    }
}
`;
