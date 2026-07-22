namespace TetaDllMetadataReader;

internal sealed class Stage2bRequest
{
    public string? DllPath { get; set; }
    public List<string>? Match { get; set; }
    public List<string>? SearchRoots { get; set; }
    public string? AssemblyName { get; set; }
    public bool AnalyzeRelatedGateways { get; set; } = true;
}

internal sealed class Stage2bBatchRequest
{
    public List<string>? SearchRoots { get; set; }
    public List<Stage2bAssemblyRequest>? Assemblies { get; set; }
}

internal sealed class Stage2bAssemblyRequest
{
    public string? AssemblyName { get; set; }
    public List<string>? Types { get; set; }
    public List<string>? ReferencedByForms { get; set; }
}

internal sealed class Stage2bResult
{
    public string? DllPath { get; set; }
    public string? AssemblyName { get; set; }
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? ErrorDetail { get; set; }
    public BosAssemblyResolution? Resolution { get; set; }
    public List<BosTypeAnalysis>? Types { get; set; }
}

internal sealed class Stage2bBatchResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public List<BosAssemblyResolution> Assemblies { get; set; } = [];
    public List<BosTypeAnalysis> Types { get; set; } = [];
    public List<GatewayDescriptor> Gateways { get; set; } = [];
    public List<RelationEdge2b> Relations { get; set; } = [];
}

internal sealed class BosAssemblyResolution
{
    public string? AssemblyName { get; set; }
    public string? ResolvedPath { get; set; }
    public string? ResolutionStatus { get; set; }
    public List<string>? CandidatePaths { get; set; }
    public List<string>? ReferencedByForms { get; set; }
    public List<string>? ReferencedTypes { get; set; }
    public string? FileHashSha256 { get; set; }
    public string? FileVersion { get; set; }
    public long? FileSize { get; set; }
}

internal sealed class BosTypeAnalysis
{
    public string? FullName { get; set; }
    public string? Namespace { get; set; }
    public string? Name { get; set; }
    public string? AssemblyName { get; set; }
    public string? ResolvedDllPath { get; set; }
    public string? BaseType { get; set; }
    public List<string>? InheritanceChain { get; set; }
    public List<string>? Interfaces { get; set; }
    public string? TechnicalRole { get; set; }
    public string? RoleConfidence { get; set; }
    public List<string>? RoleEvidence { get; set; }
    public string? TypeResolutionStatus { get; set; }
    public List<BosMemberInfo>? Fields { get; set; }
    public List<BosMemberInfo>? Properties { get; set; }
    public List<BosMemberInfo>? Methods { get; set; }
    public List<GetterFact>? Getters { get; set; }
    public List<CtorArgumentFact>? ConstructorFacts { get; set; }
    public List<GatewayDescriptor>? Gateways { get; set; }
    public List<DatasetTableFact>? DatasetTables { get; set; }
    public List<string>? RelatedGatewayTypes { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
    public List<string>? ReferencedByForms { get; set; }
}

internal sealed class BosMemberInfo
{
    public string? Name { get; set; }
    public string? TypeName { get; set; }
    public string? DeclaringType { get; set; }
    public string? InheritedFromType { get; set; }
    public string? InheritedFromAssembly { get; set; }
    public bool IsInteresting { get; set; }
    public object? LiteralValue { get; set; }
}

internal sealed class GetterFact
{
    public string? PropertyName { get; set; }
    public object? Value { get; set; }
    public List<object?>? Alternatives { get; set; }
    public string? DeclaringType { get; set; }
    public string? Method { get; set; }
    public string? Offset { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class CtorArgumentFact
{
    public string? DeclaringType { get; set; }
    public string? Method { get; set; }
    public string? Offset { get; set; }
    public string? CalledMember { get; set; }
    public string? CalledType { get; set; }
    public List<object?>? Arguments { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class GatewayDescriptor
{
    public string? GatewayType { get; set; }
    public string? GatewayKind { get; set; }
    public string? DeclaringType { get; set; }
    public string? AssemblyName { get; set; }
    public string? DatasetTable { get; set; }
    public string? Alias { get; set; }
    public string? ViewName { get; set; }
    public string? BaseTableName { get; set; }
    public string? PackageName { get; set; }
    public string? RawPackageName { get; set; }
    public string? NormalizedPackageName { get; set; }
    public string? PackageKind { get; set; }
    public Dictionary<string, OperationDescriptor>? Operations { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
    public string? OracleViewStatus { get; set; }
    public string? OracleTableStatus { get; set; }
    public string? OraclePackageStatus { get; set; }
}

internal sealed class OperationDescriptor
{
    public string? Kind { get; set; }
    public string? MethodName { get; set; }
    public string? PackageProcedure { get; set; }
    public string? Sql { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class DatasetTableFact
{
    public string? Name { get; set; }
    public string? Source { get; set; }
    public string? DeclaringType { get; set; }
    public string? Confidence { get; set; }
    public List<DatasetColumnFact>? Columns { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class DatasetColumnFact
{
    public string? Name { get; set; }
    public string? DataType { get; set; }
    public bool? IsPrimaryKey { get; set; }
    public bool? ReadOnly { get; set; }
    public string? Confidence { get; set; }
}

internal sealed class RelationEdge2b
{
    public string? RelationType { get; set; }
    public string? From { get; set; }
    public string? To { get; set; }
    public string? Confidence { get; set; }
    public List<string>? Evidence { get; set; }
}
