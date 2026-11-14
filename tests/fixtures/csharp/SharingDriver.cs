using System.Text;
using System.Text.Json;
using DefaultSharing;
using TypeModeling.Domain;

/// <summary>JSON-lines observations of the identity that provider acceptance gives the children of an immutable graph</summary>
internal static class SharingDriver
{
    /// <summary>Spelling of every generated provider default</summary>
    private const string Fallback = "fallback";

    /// <summary>Wall-clock allowance of one deep shared-graph acceptance</summary>
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(5);

    /// <summary>Standard-input protocol of one request per line with a graph, untouched or dag mode</summary>
    /// <returns>Process success code</returns>
    public static int Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            var input = request.RootElement;
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                switch (input.GetProperty("mode").GetString())
                {
                    case "graph":
                        Graph(writer);
                        break;
                    case "untouched":
                        Untouched(writer);
                        break;
                    case "dag":
                        Dag(
                            input.GetProperty("kind").GetString()!,
                            input.GetProperty("depth").GetInt32(),
                            writer
                        );
                        break;
                    default:
                        throw new InvalidOperationException("Unknown sharing fixture mode");
                }
                writer.WriteEndObject();
            }
            Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
        }
        return 0;
    }

    /// <summary>Accepted value of a generated construction</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated construction or acceptance result</param>
    /// <returns>The accepted value</returns>
    private static T Required<T>(Result<Accepted<T>, ContractFailure> result)
    {
        if (result.IsFailed(out Failed<ContractFailure> failed, out var accepted))
            throw new InvalidOperationException(JsonSerializer.Serialize(failed.Failure));
        return accepted.Value;
    }

    /// <summary>Leaf whose note is absent or explicit</summary>
    /// <param name="note">Explicit note, or null to leave the provider default to acceptance</param>
    /// <returns>Constructed leaf</returns>
    private static Leaf Make(string? note = null) =>
        Required(Leaf.Create(note: note is null ? default : Presence<string>.Present(note)));

    /// <summary>Whether a note holds the provider default</summary>
    /// <param name="note">Observed member</param>
    /// <returns>Presence of the default spelling</returns>
    private static bool Filled(Presence<string> note) => note.IsPresent && note.Value == Fallback;

    /// <summary>Payload of a marked variant</summary>
    /// <param name="tag">Union value known to hold the marked variant</param>
    /// <returns>Variant payload</returns>
    private static MarkedTag PayloadOf(Tagged tag) => ((Tagged.Marked)tag).Value;

    /// <summary>Acceptance of one graph that shares, repeats and separates children of every representation</summary>
    /// <param name="writer">Observation output</param>
    private static void Graph(Utf8JsonWriter writer)
    {
        var shared = Make();
        var twin = Make();
        var kept = Make("kept");
        var sharedList = Required(LeavesCodec.Create(new[] { shared, shared, kept }));
        var twinList = Required(LeavesCodec.Create(new[] { shared, shared, kept }));
        var keptList = Required(LeavesCodec.Create(new[] { kept }));
        var payload = Required(MarkedTag.Create(kind: "marked", note: default));
        var sharedTag = Required(Tagged.Marked.Create(payload));
        var twinTag = Required(Tagged.Marked.Create(payload));
        var keptTag = Required(
            Tagged.Plain.Create(Required(PlainTag.Create(kind: "plain", label: "kept")))
        );
        var sharing = Required(
            Sharing.Create(
                first: shared,
                second: shared,
                distinct: twin,
                settled: kept,
                maybe: Presence<Leaf?>.Present(shared),
                nothing: Presence<Leaf?>.Present(null),
                firstLeaves: sharedList,
                secondLeaves: sharedList,
                distinctLeaves: twinList,
                settledLeaves: keptList,
                firstTag: sharedTag,
                secondTag: sharedTag,
                distinctTag: twinTag,
                settledTag: keptTag
            )
        );
        var input = Required(
            SettleInput.Create(
                sharing: Presence<Sharing>.Present(sharing),
                rung: default,
                ladder: default,
                tier: default
            )
        );
        var s = Required(SettleAcceptance.Accept(input)).Sharing.Value;
        var acceptedPayload = PayloadOf(s.FirstTag);
        writer.WriteBoolean("objectShared", ReferenceEquals(s.First, s.Second));
        writer.WriteBoolean("objectFilled", Filled(s.First.Note) && Filled(s.Distinct.Note));
        writer.WriteBoolean("objectReplaced", !ReferenceEquals(s.First, shared));
        writer.WriteBoolean("objectDistinct", !ReferenceEquals(s.Distinct, s.First));
        writer.WriteBoolean("objectUnchanged", ReferenceEquals(s.Settled, kept));
        writer.WriteBoolean(
            "nullableShared",
            s.Maybe.IsPresent && ReferenceEquals(s.Maybe.Value, s.First)
        );
        writer.WriteBoolean("nullPreserved", s.Nothing.IsPresent && s.Nothing.Value is null);
        writer.WriteBoolean("listShared", s.FirstLeaves.Equals(s.SecondLeaves));
        writer.WriteBoolean("listDistinct", !s.FirstLeaves.Equals(s.DistinctLeaves));
        writer.WriteBoolean("listReplaced", !s.FirstLeaves.Equals(sharedList));
        writer.WriteBoolean("listUnchanged", s.SettledLeaves.Equals(keptList));
        writer.WriteBoolean(
            "listElements",
            s.FirstLeaves.Length == 3
                && ReferenceEquals(s.FirstLeaves[0], s.FirstLeaves[1])
                && ReferenceEquals(s.FirstLeaves[0], s.First)
                && ReferenceEquals(s.FirstLeaves[2], kept)
                && Filled(s.FirstLeaves[0].Note)
        );
        writer.WriteBoolean("tagShared", ReferenceEquals(s.FirstTag, s.SecondTag));
        writer.WriteBoolean("tagFilled", Filled(acceptedPayload.Note));
        writer.WriteBoolean(
            "tagReplaced",
            !ReferenceEquals(s.FirstTag, sharedTag) && !ReferenceEquals(acceptedPayload, payload)
        );
        writer.WriteBoolean("tagDistinct", !ReferenceEquals(s.DistinctTag, s.FirstTag));
        writer.WriteBoolean(
            "tagPayloadShared",
            ReferenceEquals(PayloadOf(s.DistinctTag), acceptedPayload)
        );
        writer.WriteBoolean("tagUnchanged", ReferenceEquals(s.SettledTag, keptTag));
        writer.WriteBoolean(
            "inputUnchanged",
            ReferenceEquals(input.Sharing.Value, sharing)
                && ReferenceEquals(sharing.First, shared)
                && ReferenceEquals(sharing.Second, shared)
                && ReferenceEquals(sharing.Distinct, twin)
                && !shared.Note.IsPresent
                && !twin.Note.IsPresent
                && !payload.Note.IsPresent
                && ReferenceEquals(sharing.Maybe.Value, shared)
                && sharing.FirstLeaves.Equals(sharedList)
                && ReferenceEquals(sharedList[0], shared)
                && ReferenceEquals(sharedList[1], shared)
                && ReferenceEquals(sharing.FirstTag, sharedTag)
                && ReferenceEquals(sharing.DistinctTag, twinTag)
                && ReferenceEquals(PayloadOf(sharing.FirstTag), payload)
        );
    }

    /// <summary>Acceptance of a graph in which no default fills anywhere</summary>
    /// <param name="writer">Observation output</param>
    private static void Untouched(Utf8JsonWriter writer)
    {
        var kept = Make("kept");
        var keptList = Required(LeavesCodec.Create(new[] { kept, kept }));
        var keptTag = Required(
            Tagged.Marked.Create(
                Required(MarkedTag.Create(kind: "marked", note: Presence<string>.Present("kept")))
            )
        );
        var sharing = Required(
            Sharing.Create(
                first: kept,
                second: kept,
                distinct: Make("kept"),
                settled: kept,
                maybe: default,
                nothing: default,
                firstLeaves: keptList,
                secondLeaves: keptList,
                distinctLeaves: keptList,
                settledLeaves: keptList,
                firstTag: keptTag,
                secondTag: keptTag,
                distinctTag: keptTag,
                settledTag: keptTag
            )
        );
        var input = Required(
            SettleInput.Create(
                sharing: Presence<Sharing>.Present(sharing),
                rung: default,
                ladder: default,
                tier: default
            )
        );
        var accepted = Required(SettleAcceptance.Accept(input));
        writer.WriteBoolean("inputIdentity", ReferenceEquals(accepted, input));
        writer.WriteBoolean("sharingIdentity", ReferenceEquals(accepted.Sharing.Value, sharing));
    }

    /// <summary>Result of walking one accepted chain whose every level refers to the next level twice</summary>
    /// <param name="Levels">Number of levels above the terminal one</param>
    /// <param name="Shared">Whether the two references of every level are the same accepted instance</param>
    /// <param name="Filled">Whether every level holds the provider default</param>
    /// <param name="SourceUnchanged">Whether the input chain still has no default and its own sharing</param>
    private readonly record struct Chain(
        int Levels,
        bool Shared,
        bool Filled,
        bool SourceUnchanged
    );

    /// <summary>Acceptance of a shared chain under a wall-clock allowance</summary>
    /// <param name="kind">Representation of the shared child: object, array or union</param>
    /// <param name="depth">Number of levels above the terminal one</param>
    /// <param name="writer">Observation output</param>
    private static void Dag(string kind, int depth, Utf8JsonWriter writer)
    {
        Func<int, Chain> build = kind switch
        {
            "object" => ObjectChain,
            "array" => ArrayChain,
            "union" => UnionChain,
            _ => throw new InvalidOperationException("Unknown shared chain kind"),
        };
        var task = Task.Run(() => build(depth));
        if (!task.Wait(Budget))
        {
            writer.WriteBoolean("completed", false);
            return;
        }
        var chain = task.Result;
        writer.WriteBoolean("completed", true);
        writer.WriteNumber("levels", chain.Levels);
        writer.WriteBoolean("shared", chain.Shared);
        writer.WriteBoolean("filled", chain.Filled);
        writer.WriteBoolean("sourceUnchanged", chain.SourceUnchanged);
    }

    /// <summary>Object chain in which both optional members of a level are the level below</summary>
    /// <param name="depth">Number of levels above the leaf</param>
    /// <returns>Observation of the accepted chain</returns>
    private static Chain ObjectChain(int depth)
    {
        var top = Required(Rung.Create(note: default, below: default, also: default));
        for (int i = 0; i < depth; i++)
            top = Required(
                Rung.Create(
                    note: default,
                    below: Presence<Rung>.Present(top),
                    also: Presence<Rung>.Present(top)
                )
            );
        var input = Required(
            SettleInput.Create(
                sharing: default,
                rung: Presence<Rung>.Present(top),
                ladder: default,
                tier: default
            )
        );
        var node = Required(SettleAcceptance.Accept(input)).Rung.Value;
        int levels = 0;
        bool shared = true,
            filled = true;
        while (node.Below.IsPresent)
        {
            shared &= node.Also.IsPresent && ReferenceEquals(node.Below.Value, node.Also.Value);
            filled &= Filled(node.Note);
            node = node.Below.Value;
            levels++;
        }
        filled &= Filled(node.Note);
        var original = top;
        bool unchanged = true;
        while (original.Below.IsPresent)
        {
            unchanged &=
                !original.Note.IsPresent
                && original.Also.IsPresent
                && ReferenceEquals(original.Below.Value, original.Also.Value);
            original = original.Below.Value;
        }
        return new Chain(levels, shared, filled, unchanged && !original.Note.IsPresent);
    }

    /// <summary>Array chain in which both elements of a level are the level below</summary>
    /// <param name="depth">Number of levels above the leaf</param>
    /// <returns>Observation of the accepted chain</returns>
    private static Chain ArrayChain(int depth)
    {
        var top = Required(
            Step.Create(note: default, below: Required(StepsCodec.Create(Array.Empty<Step>())))
        );
        for (int i = 0; i < depth; i++)
            top = Required(
                Step.Create(note: default, below: Required(StepsCodec.Create(new[] { top, top })))
            );
        var input = Required(
            SettleInput.Create(
                sharing: default,
                rung: default,
                ladder: Presence<Step>.Present(top),
                tier: default
            )
        );
        var node = Required(SettleAcceptance.Accept(input)).Ladder.Value;
        int levels = 0;
        bool shared = true,
            filled = true;
        while (node.Below.Length != 0)
        {
            shared &= node.Below.Length == 2 && ReferenceEquals(node.Below[0], node.Below[1]);
            filled &= Filled(node.Note);
            node = node.Below[0];
            levels++;
        }
        filled &= Filled(node.Note);
        var original = top;
        bool unchanged = true;
        while (original.Below.Length != 0)
        {
            unchanged &=
                !original.Note.IsPresent
                && original.Below.Length == 2
                && ReferenceEquals(original.Below[0], original.Below[1]);
            original = original.Below[0];
        }
        return new Chain(levels, shared, filled, unchanged && !original.Note.IsPresent);
    }

    /// <summary>Union chain in which both members of a fork are the union below</summary>
    /// <param name="depth">Number of forks above the end</param>
    /// <returns>Observation of the accepted chain</returns>
    private static Chain UnionChain(int depth)
    {
        Tier top = Required(Tier.End.Create(Required(EndTag.Create(kind: "end", label: "end"))));
        for (int i = 0; i < depth; i++)
            top = Required(
                Tier.Fork.Create(
                    Required(ForkTag.Create(kind: "fork", note: default, left: top, right: top))
                )
            );
        var input = Required(
            SettleInput.Create(
                sharing: default,
                rung: default,
                ladder: default,
                tier: Presence<Tier>.Present(top)
            )
        );
        var node = Required(SettleAcceptance.Accept(input)).Tier.Value;
        int levels = 0;
        bool shared = true,
            filled = true;
        while (node is Tier.Fork fork)
        {
            shared &= ReferenceEquals(fork.Value.Left, fork.Value.Right);
            filled &= Filled(fork.Value.Note);
            node = fork.Value.Left;
            levels++;
        }
        var original = top;
        bool unchanged = true;
        while (original is Tier.Fork source)
        {
            unchanged &=
                !source.Value.Note.IsPresent
                && ReferenceEquals(source.Value.Left, source.Value.Right);
            original = source.Value.Left;
        }
        return new Chain(levels, shared, filled, unchanged);
    }
}
