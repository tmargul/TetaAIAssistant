namespace TetaDllMetadataReader;

internal enum StackKind
{
    Unknown,
    This,
    Arg,
    String,
    Number,
    Null,
    Field,
    Constructed,
    PropertyGet,
}

internal sealed class StackValue
{
    public StackKind Kind { get; set; }
    public string? StringValue { get; set; }
    public double? NumberValue { get; set; }
    public string? FieldName { get; set; }
    public string? TypeName { get; set; }
    public string? Label { get; set; }
    public StackValue? Owner { get; set; }
    public List<StackValue>? ConstructorArgs { get; set; }

    public static StackValue Unknown(string label) => new() { Kind = StackKind.Unknown, Label = label };
    public static StackValue This(string type) => new() { Kind = StackKind.This, TypeName = type };
    public static StackValue Arg(int i) => new() { Kind = StackKind.Arg, Label = "arg" + i };
    public static StackValue String(string s) => new() { Kind = StackKind.String, StringValue = s };
    public static StackValue Number(double n) => new() { Kind = StackKind.Number, NumberValue = n };
    public static StackValue Null() => new() { Kind = StackKind.Null };
    public static StackValue Field(string name, string? type, StackValue? owner) =>
        new() { Kind = StackKind.Field, FieldName = name, TypeName = type, Owner = owner };
    public static StackValue Constructed(string type, List<StackValue> args, string method, int offset) =>
        new() { Kind = StackKind.Constructed, TypeName = type, ConstructorArgs = args, Label = $"{method}@{offset}" };
    public static StackValue PropertyGet(StackValue? owner, string prop) =>
        new() { Kind = StackKind.PropertyGet, FieldName = prop, Owner = owner };

    public StackValue Clone() => new()
    {
        Kind = Kind,
        StringValue = StringValue,
        NumberValue = NumberValue,
        FieldName = FieldName,
        TypeName = TypeName,
        Label = Label,
        Owner = Owner,
        ConstructorArgs = ConstructorArgs?.Select(a => a.Clone()).ToList(),
    };

    public bool IsConcrete() =>
        Kind is StackKind.String or StackKind.Number or StackKind.Null
        || (Kind == StackKind.Constructed && (ConstructorArgs?.All(a => a.IsConcrete()) ?? false));

    public object? AsLiteral() =>
        Kind switch
        {
            StackKind.String => StringValue,
            StackKind.Number => NumberValue,
            StackKind.Null => null,
            _ => null,
        };
}

internal sealed class FormTechnicalBinding
{
    public string? FormIdentity { get; set; }
    public string? RegistryId { get; set; }
    public string? Guid { get; set; }
    public string? FormType { get; set; }
    public string? PluginType { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? Assembly { get; set; }
    public string? ResolvedDllPath { get; set; }
    public bool HasInitializeComponent { get; set; }
    /// <summary>Deprecated: same as UiControls after Stage 2A.1 categorization.</summary>
    public List<ControlEntity> Controls { get; set; } = [];
    public List<ControlEntity> UiControls { get; set; } = [];
    public List<ControlEntity> DataObjects { get; set; } = [];
    public List<ControlEntity> BusinessObjectFields { get; set; } = [];
    public List<ControlEntity> Constants { get; set; } = [];
    public List<ControlEntity> TechnicalFields { get; set; } = [];
    public List<ControlEntity> SyntheticTargets { get; set; } = [];
    public List<DataSourceEntity> DataSources { get; set; } = [];
    public List<TypedEntity> BusinessObjects { get; set; } = [];
    public List<TypedEntity> DataFactories { get; set; } = [];
    public List<AssemblyRef> Assemblies { get; set; } = [];
    public List<ControlBinding> Bindings { get; set; } = [];
    public List<DataOperation> DataOperations { get; set; } = [];
    public List<FilterEntity> Filters { get; set; } = [];
    public List<LookupEntity> Lookups { get; set; } = [];
    public List<RelationEdge> Relations { get; set; } = [];
    public List<PropertyAssignment> PropertyAssignments { get; set; } = [];
    public List<ConstructorCall> ConstructorCalls { get; set; } = [];
    public List<UnresolvedEvidence> UnresolvedEvidence { get; set; } = [];
    public List<ConflictItem> Conflicts { get; set; } = [];
}

internal sealed class ControlEntity
{
    public string? FieldName { get; set; }
    public string? FieldType { get; set; }
    public string? DeclaringType { get; set; }
    public string? InheritedFromType { get; set; }
    public string? CreatedInMethod { get; set; }
    public string? ConstructorType { get; set; }
    public string? ControlKind { get; set; }
    public string? Confidence { get; set; }
    public List<AssignedProperty>? AssignedProperties { get; set; }
    public List<string>? Evidence { get; set; }
}

internal sealed class AssignedProperty
{
    public string? Property { get; set; }
    public object? Value { get; set; }
    public string? Method { get; set; }
    public string? Confidence { get; set; }
}

internal sealed class DataSourceEntity
{
    public string? Name { get; set; }
    public string? Kind { get; set; }
    public string? RelatedDf { get; set; }
    public string? RelatedAssembly { get; set; }
    public string? RelatedControl { get; set; }
    public string? Confidence { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? InheritedFromType { get; set; }
}

internal sealed class TypedEntity
{
    public string? FullType { get; set; }
    public string? Assembly { get; set; }
    public string? LogicalName { get; set; }
    public string? Confidence { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? InheritedFromType { get; set; }
    public List<EvidenceItem> Evidence { get; set; } = [];
}

internal sealed class AssemblyRef
{
    public string? Name { get; set; }
    public string? Role { get; set; }
    public string? Confidence { get; set; }
    public List<string>? Evidence { get; set; }
}

internal sealed class ControlBinding
{
    public string? Control { get; set; }
    public string? ControlType { get; set; }
    /// <summary>Legacy bag — prefer typed fields below.</summary>
    public Dictionary<string, object?>? Binding { get; set; }
    public object? DataMember { get; set; }
    public object? DatasetTable { get; set; }
    public object? Format { get; set; }
    public object? ValueMember { get; set; }
    public object? DisplayMember { get; set; }
    public object? ParameterName { get; set; }
    public object? FilterExpression { get; set; }
    public object? IdColumn { get; set; }
    public object? ParentIdColumn { get; set; }
    public object? NameColumn { get; set; }
    public object? ValueColumn { get; set; }
    public List<object?>? Alternatives { get; set; }
    public Dictionary<string, object?>? PropertyBindings { get; set; }
    public string? Confidence { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? InheritedFromType { get; set; }
    public List<EvidenceItem> Evidence { get; set; } = [];
}

internal sealed class DataOperation
{
    public string? OperationKind { get; set; }
    public string? Target { get; set; }
    public string? TargetType { get; set; }
    public string? Key { get; set; }
    public object? Value { get; set; }
    public string? Method { get; set; }
    public string? Offset { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class FilterEntity
{
    public string? Expression { get; set; }
    public string? Control { get; set; }
    public string? DataSource { get; set; }
    public string? Confidence { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? InheritedFromType { get; set; }
    public List<EvidenceItem> Evidence { get; set; } = [];
}

internal sealed class LookupEntity
{
    public string? PluginAssembly { get; set; }
    public string? LookupClass { get; set; }
    public string? Control { get; set; }
    public string? Confidence { get; set; }
    public string? DeclaredOnType { get; set; }
    public List<EvidenceItem> Evidence { get; set; } = [];
}

internal sealed class RelationEdge
{
    public string? RelationType { get; set; }
    public string? From { get; set; }
    public string? To { get; set; }
    public string? Confidence { get; set; }
    public string? SourceMethod { get; set; }
    public List<string>? SourceOffsets { get; set; }
    public List<string>? Evidence { get; set; }
}

internal sealed class PropertyAssignment
{
    public string? Control { get; set; }
    public string? ControlType { get; set; }
    public string? Property { get; set; }
    public object? Value { get; set; }
    public StackKind ValueKind { get; set; }
    public string? Method { get; set; }
    public string? Offset { get; set; }
    public string? Assignment { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? InheritedFromType { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem> Evidence { get; set; } = [];
}

internal sealed class ConstructorCall
{
    public string? ConstructorType { get; set; }
    public List<object?> Arguments { get; set; } = [];
    public string? Method { get; set; }
    public string? Offset { get; set; }
    public string? DeclaredOnType { get; set; }
    public string? InheritedFromType { get; set; }
    public string? Confidence { get; set; }
}

internal sealed class EvidenceItem
{
    public string? Method { get; set; }
    public string? Offset { get; set; }
    public string? Assignment { get; set; }
    public string? Opcode { get; set; }
    public string? ResolvedMember { get; set; }
}

internal sealed class UnresolvedEvidence
{
    public string? Kind { get; set; }
    public string? Message { get; set; }
    public string? DeclaringType { get; set; }
}

internal sealed class ConflictItem
{
    public string? Subject { get; set; }
    public string? Message { get; set; }
    public string? Confidence { get; set; }
}
