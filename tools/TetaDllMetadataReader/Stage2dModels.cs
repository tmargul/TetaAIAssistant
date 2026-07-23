namespace TetaDllMetadataReader;

internal sealed class Stage2dRequest
{
    public string? DllPath { get; set; }
    public List<string>? Match { get; set; }
    public List<string>? SearchRoots { get; set; }
    public string? AssemblyName { get; set; }
    public bool AnalyzeRelatedGateways { get; set; } = true;
}

internal sealed class Stage2dBatchRequest
{
    public List<string>? SearchRoots { get; set; }
    public List<Stage2bAssemblyRequest>? Assemblies { get; set; }
}

internal sealed class Stage2dResult
{
    public string? DllPath { get; set; }
    public string? AssemblyName { get; set; }
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? ErrorDetail { get; set; }
    public BosAssemblyResolution? Resolution { get; set; }
    public List<Stage2dDatasetModel>? Datasets { get; set; }
}

internal sealed class Stage2dBatchResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public List<BosAssemblyResolution> Assemblies { get; set; } = [];
    public List<Stage2dDatasetModel> Datasets { get; set; } = [];
}

internal sealed class Stage2dDatasetModel
{
    public string? DeclaringType { get; set; }
    public string? AssemblyName { get; set; }
    public string? ResolvedDllPath { get; set; }
    public string? TechnicalRole { get; set; }
    public string? DatasetTable { get; set; }
    public Stage2dMainSource? MainSource { get; set; }
    public List<Stage2dJoin>? Joins { get; set; }
    public List<Stage2dProjectedColumn>? ProjectedColumns { get; set; }
    public List<Stage2dDatasetColumn>? DatasetColumns { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class Stage2dMainSource
{
    public string? ObjectName { get; set; }
    public string? Alias { get; set; }
    public string? ObjectKind { get; set; } // view | table | unknown
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class Stage2dJoin
{
    public string? JoinedObject { get; set; }
    public string? Alias { get; set; }
    public string? JoinType { get; set; } // LEFT | INNER | RIGHT | UNKNOWN
    public Stage2dJoinCondition? Condition { get; set; }
    public string? RawCondition { get; set; }
    public string? SourceApi { get; set; } // AddJoin | JoinDefinition | AddColumn
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class Stage2dJoinCondition
{
    public string? LeftAlias { get; set; }
    public string? LeftColumn { get; set; }
    public string? Operator { get; set; }
    public string? RightAlias { get; set; }
    public string? RightColumn { get; set; }
    public string? Confidence { get; set; }
}

internal sealed class Stage2dProjectedColumn
{
    public string? SourceAlias { get; set; }
    public string? SourceColumn { get; set; }
    public string? Expression { get; set; }
    public string? DatasetColumn { get; set; }
    public bool Calculated { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}

internal sealed class Stage2dDatasetColumn
{
    public string? Name { get; set; }
    public string? SourceAlias { get; set; }
    public string? SourceColumn { get; set; }
    public string? Expression { get; set; }
    public bool Calculated { get; set; }
    public bool FromJoin { get; set; }
    public string? Confidence { get; set; }
    public List<EvidenceItem>? Evidence { get; set; }
}
