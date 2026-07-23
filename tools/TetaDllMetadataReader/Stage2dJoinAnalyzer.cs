using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.RegularExpressions;

namespace TetaDllMetadataReader;

/// <summary>
/// Stage 2D — reconstruct SqlJoin / projected-column graph from IL only.
/// Does not build or execute SQL. Does not touch Stage 2A/2B/2C logic.
/// </summary>
internal static class Stage2dJoinAnalyzer
{
    private static readonly Regex JoinMember = new(
        @"^(AddJoin|AddOuterJoin|AddInnerJoin|AddLeftJoin|AddRightJoin|Join|LeftJoin|RightJoin|OuterJoin|InnerJoin)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ColumnMember = new(
        @"^(AddColumn|AddKeyColumn|AddCalculatedColumn|AddExpression|AddAlias|AddComputedColumn)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex JoinTypeToken = new(
        @"^(LEFT|RIGHT|INNER|OUTER|FULL|CROSS|left|right|inner|outer|full|cross)$",
        RegexOptions.Compiled);

    private static readonly Regex ConditionRe = new(
        @"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex QualifiedCol = new(
        @"^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static Stage2dDatasetModel AnalyzeType(
        PEReader pe,
        MetadataReader mr,
        TypeDefinitionHandle handle,
        string fullName,
        string assemblyName,
        string dllPath)
    {
        // Reuse Stage 2B role/gateway main-source discovery without mutating 2B outputs.
        var bos = BosGatewayAnalyzer.AnalyzeType(pe, mr, handle, fullName, assemblyName, dllPath);
        var model = new Stage2dDatasetModel
        {
            DeclaringType = fullName,
            AssemblyName = assemblyName,
            ResolvedDllPath = dllPath,
            TechnicalRole = bos.TechnicalRole,
            Joins = [],
            ProjectedColumns = [],
            DatasetColumns = [],
            Evidence = [],
            Confidence = "confirmed_from_il",
        };

        var gw = bos.Gateways?.FirstOrDefault();
        model.DatasetTable = gw?.DatasetTable
            ?? bos.DatasetTables?.FirstOrDefault()?.Name;

        if (gw?.ViewName != null || gw?.BaseTableName != null || gw?.Alias != null)
        {
            model.MainSource = new Stage2dMainSource
            {
                ObjectName = gw.ViewName ?? gw.BaseTableName,
                Alias = gw.Alias,
                ObjectKind = gw.ViewName != null ? "view" : gw.BaseTableName != null ? "table" : "unknown",
                Confidence = gw.Confidence ?? "confirmed_from_il",
                Evidence = gw.Evidence,
            };
        }

        // Dedicated full-method IL scan for joins/columns
        var td = mr.GetTypeDefinition(handle);
        foreach (var mh in td.GetMethods())
        {
            var md = mr.GetMethodDefinition(mh);
            var mname = mr.GetString(md.Name);
            ScanMethod(pe, mr, mh, mname, fullName, model);
        }

        // Also consume Stage 2B constructor facts (already IL-derived) as secondary source
        foreach (var fact in bos.ConstructorFacts ?? [])
        {
            IngestCallFact(
                model,
                fact.Method ?? ".ctor",
                fact.Offset ?? "",
                fact.CalledMember ?? "",
                fact.CalledType ?? "",
                (fact.Arguments ?? []).Select(a => a?.ToString()).ToList()!,
                fact.Evidence?.FirstOrDefault());
        }

        Deduplicate(model);
        model.Confidence = model.Joins!.Count + model.ProjectedColumns!.Count > 0
            ? "confirmed_from_il"
            : model.MainSource != null ? "confirmed_from_il" : "manual_required";
        return model;
    }

    private static void ScanMethod(
        PEReader pe,
        MetadataReader mr,
        MethodDefinitionHandle mh,
        string methodName,
        string declaringType,
        Stage2dDatasetModel model)
    {
        var md = mr.GetMethodDefinition(mh);
        if (md.RelativeVirtualAddress == 0) return;
        byte[] il;
        try
        {
            il = pe.GetMethodBody(md.RelativeVirtualAddress).GetILContent().ToArray();
        }
        catch
        {
            return;
        }

        var instructions = IlDecoder.Decode(il, mr);
        var stack = new List<StackValue>();

        foreach (var ins in instructions)
        {
            switch (ins.Opcode)
            {
                case IlOpcode.Ldstr:
                    stack.Add(StackValue.String(ins.ResolvedString ?? ""));
                    break;
                case IlOpcode.LdcI4:
                    stack.Add(StackValue.Number(ins.IntOperand ?? 0));
                    break;
                case IlOpcode.Ldnull:
                    stack.Add(StackValue.Null());
                    break;
                case IlOpcode.Ldarg0:
                    stack.Add(StackValue.This(declaringType));
                    break;
                case IlOpcode.Newobj:
                case IlOpcode.Call:
                case IlOpcode.Callvirt:
                {
                    var argc = ins.ParamCount ?? 0;
                    var hasThis = ins.HasThis == true && ins.Opcode != IlOpcode.Newobj;
                    var args = PopArgs(stack, argc);
                    if (hasThis && stack.Count > 0) Pop(stack);

                    var calledType = ins.ResolvedType ?? "";
                    var calledName = ins.ResolvedName ?? "";
                    var simpleName = calledName.Contains('.') ? calledName.Split('.').Last() : calledName;
                    if (simpleName.Equals(".ctor", StringComparison.Ordinal) && calledType.Contains("JoinDefinition", StringComparison.OrdinalIgnoreCase))
                        simpleName = ".ctor";

                    var interesting =
                        JoinMember.IsMatch(simpleName)
                        || ColumnMember.IsMatch(simpleName)
                        || (simpleName is ".ctor" && calledType.Contains("JoinDefinition", StringComparison.OrdinalIgnoreCase))
                        || simpleName is "set_TableName" or "set_ViewName" or "set_TableAlias" or "set_Alias"
                            or "set_Perspektywa" or "set_BaseTableName";

                    if (interesting)
                    {
                        var literals = args.Select(a => a.AsLiteral()?.ToString()).ToList();
                        IngestCallFact(
                            model,
                            methodName,
                            $"0x{ins.Offset:X4}",
                            simpleName,
                            calledType,
                            literals!,
                            new EvidenceItem
                            {
                                Method = methodName,
                                Offset = $"0x{ins.Offset:X4}",
                                Assignment =
                                    $"{calledType}::{simpleName}({string.Join(", ", literals.Select(FormatArg))})",
                                Opcode = ins.Opcode.ToString(),
                                ResolvedMember = simpleName,
                            });
                    }

                    if (ins.ReturnsValue == true || ins.Opcode == IlOpcode.Newobj)
                        stack.Add(ins.Opcode == IlOpcode.Newobj
                            ? StackValue.Constructed(calledType, args, methodName, ins.Offset)
                            : StackValue.Unknown("ret:" + calledName));
                    break;
                }
                case IlOpcode.Pop:
                    Pop(stack);
                    break;
                case IlOpcode.Dup:
                    if (stack.Count > 0) stack.Add(stack[^1].Clone());
                    break;
                case IlOpcode.Ret:
                    break;
                default:
                    for (var i = 0; i < ins.Pops && stack.Count > 0; i++) Pop(stack);
                    for (var i = 0; i < ins.Pushes; i++) stack.Add(StackValue.Unknown(ins.RawOpcode));
                    break;
            }
        }
    }

    private static void IngestCallFact(
        Stage2dDatasetModel model,
        string methodName,
        string offset,
        string member,
        string calledType,
        List<string?> args,
        EvidenceItem? evidence)
    {
        evidence ??= new EvidenceItem
        {
            Method = methodName,
            Offset = offset,
            Assignment = $"{calledType}::{member}({string.Join(", ", args.Select(FormatArg))})",
            ResolvedMember = member,
        };

        if (member is "set_TableName" or "set_ViewName" or "set_Perspektywa")
        {
            var obj = FirstString(args);
            if (obj == null) return;
            model.MainSource ??= new Stage2dMainSource { Evidence = [] };
            model.MainSource.ObjectName ??= obj;
            model.MainSource.ObjectKind ??= LooksLikeView(obj) ? "view" : LooksLikeTable(obj) ? "table" : "unknown";
            model.MainSource.Confidence = "confirmed_from_il";
            model.MainSource.Evidence ??= [];
            model.MainSource.Evidence.Add(evidence);
            model.Evidence!.Add(evidence);
            return;
        }

        if (member is "set_TableAlias" or "set_Alias")
        {
            var alias = FirstString(args);
            if (alias == null) return;
            model.MainSource ??= new Stage2dMainSource { Evidence = [] };
            model.MainSource.Alias ??= alias;
            model.MainSource.Confidence ??= "confirmed_from_il";
            model.MainSource.Evidence ??= [];
            model.MainSource.Evidence.Add(evidence);
            model.Evidence!.Add(evidence);
            return;
        }

        if (member is "set_BaseTableName")
        {
            var obj = FirstString(args);
            if (obj == null) return;
            model.MainSource ??= new Stage2dMainSource { Evidence = [] };
            model.MainSource.ObjectName ??= obj;
            model.MainSource.ObjectKind = "table";
            model.MainSource.Confidence = "confirmed_from_il";
            model.MainSource.Evidence ??= [];
            model.MainSource.Evidence.Add(evidence);
            return;
        }

        var isJoinDefCtor = member is ".ctor" && calledType.Contains("JoinDefinition", StringComparison.OrdinalIgnoreCase);
        if (JoinMember.IsMatch(member) || isJoinDefCtor)
        {
            TryAddJoin(model, member, isJoinDefCtor ? "JoinDefinition" : member, args, evidence);
            return;
        }

        if (ColumnMember.IsMatch(member))
        {
            TryAddColumn(model, member, args, evidence);
        }
    }

    private static void TryAddJoin(
        Stage2dDatasetModel model,
        string member,
        string sourceApi,
        List<string?> args,
        EvidenceItem evidence)
    {
        // (joinedObject, alias, condition?, joinType?)
        var joined = args.ElementAtOrDefault(0);
        var alias = args.ElementAtOrDefault(1);
        if (string.IsNullOrWhiteSpace(joined) || string.IsNullOrWhiteSpace(alias)) return;
        if (!LooksLikeObjectName(joined) || !LooksLikeAlias(alias)) return;

        string? rawCond = null;
        string? joinType = null;
        if (args.Count >= 4)
        {
            rawCond = args[2];
            joinType = args[3];
        }
        else if (args.Count == 3)
        {
            if (args[2] != null && JoinTypeToken.IsMatch(args[2]!)) joinType = args[2];
            else rawCond = args[2];
        }

        joinType = NormalizeJoinType(joinType, member, sourceApi);
        var condition = ParseCondition(rawCond);

        model.Joins!.Add(new Stage2dJoin
        {
            JoinedObject = joined,
            Alias = alias,
            JoinType = joinType,
            RawCondition = rawCond,
            Condition = condition,
            SourceApi = sourceApi,
            Confidence = condition != null || rawCond == null ? "confirmed_from_il" : "probable",
            Evidence = [evidence],
        });
        model.Evidence!.Add(evidence);
    }

    private static void TryAddColumn(
        Stage2dDatasetModel model,
        string member,
        List<string?> args,
        EvidenceItem evidence)
    {
        // Variants:
        // 1) (datasetColumn)
        // 2) (sourceExpr, datasetColumn)
        // 3) (sourceExpr, datasetColumn, null)
        // 4) (sourceExpr, datasetColumn, joinedObject, alias, condition, joinType)
        if (args.Count == 0) return;

        // Detect join-carrying AddColumn overload
        if (args.Count >= 6
            && !string.IsNullOrWhiteSpace(args[2])
            && LooksLikeObjectName(args[2]!)
            && !string.IsNullOrWhiteSpace(args[3])
            && LooksLikeAlias(args[3]!))
        {
            TryAddJoin(model, member, "AddColumn", [args[2], args[3], args[4], args[5]], evidence);
            // continue to record column from args[0]/args[1]
        }
        else if (args.Count >= 4
                 && !string.IsNullOrWhiteSpace(args[2])
                 && LooksLikeObjectName(args[2]!)
                 && !string.IsNullOrWhiteSpace(args[3])
                 && LooksLikeAlias(args[3]!))
        {
            // (expr, datasetCol, joinedObject, alias) without join type
            TryAddJoin(model, member, "AddColumn", [args[2], args[3], null, null], evidence);
        }

        string? expr = null;
        string? datasetCol = null;

        if (args.Count == 1)
        {
            datasetCol = args[0];
            expr = args[0];
        }
        else
        {
            expr = args[0];
            datasetCol = args[1] ?? InferDatasetColumn(expr);
        }

        if (string.IsNullOrWhiteSpace(datasetCol) && string.IsNullOrWhiteSpace(expr)) return;

        // Reject polluted join-type tokens as dataset columns
        if (datasetCol != null && JoinTypeToken.IsMatch(datasetCol)) return;

        var (alias, col) = SplitQualified(expr);
        var calculated = IsCalculated(expr, member);
        var fromJoin = alias != null
            && model.Joins!.Any(j => string.Equals(j.Alias, alias, StringComparison.OrdinalIgnoreCase));

        var projected = new Stage2dProjectedColumn
        {
            SourceAlias = alias,
            SourceColumn = col,
            Expression = expr,
            DatasetColumn = datasetCol ?? InferDatasetColumn(expr),
            Calculated = calculated,
            Confidence = member.Equals("AddKeyColumn", StringComparison.OrdinalIgnoreCase)
                ? "confirmed_from_il"
                : expr != null ? "confirmed_from_il" : "probable",
            Evidence = [evidence],
        };
        model.ProjectedColumns!.Add(projected);

        model.DatasetColumns!.Add(new Stage2dDatasetColumn
        {
            Name = projected.DatasetColumn,
            SourceAlias = alias,
            SourceColumn = col,
            Expression = expr,
            Calculated = calculated,
            FromJoin = fromJoin || (alias != null && !string.Equals(alias, model.MainSource?.Alias, StringComparison.OrdinalIgnoreCase)),
            Confidence = projected.Confidence,
            Evidence = [evidence],
        });
        model.Evidence!.Add(evidence);
    }

    private static Stage2dJoinCondition? ParseCondition(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var m = ConditionRe.Match(raw.Trim());
        if (!m.Success)
        {
            return new Stage2dJoinCondition
            {
                Confidence = "manual_required",
            };
        }

        return new Stage2dJoinCondition
        {
            LeftAlias = m.Groups[1].Value,
            LeftColumn = m.Groups[2].Value,
            Operator = m.Groups[3].Value,
            RightAlias = m.Groups[4].Value,
            RightColumn = m.Groups[5].Value,
            Confidence = "confirmed_from_literal",
        };
    }

    private static (string? alias, string? column) SplitQualified(string? expr)
    {
        if (string.IsNullOrWhiteSpace(expr)) return (null, null);
        var m = QualifiedCol.Match(expr.Trim());
        if (!m.Success) return (null, expr);
        return (m.Groups[1].Value, m.Groups[2].Value);
    }

    private static string? InferDatasetColumn(string? expr)
    {
        if (string.IsNullOrWhiteSpace(expr)) return null;
        var (alias, col) = SplitQualified(expr);
        if (alias != null && col != null) return $"{alias}_{col}".ToUpperInvariant();
        return expr;
    }

    private static bool IsCalculated(string? expr, string member)
    {
        if (member.Contains("Calculated", StringComparison.OrdinalIgnoreCase)
            || member.Contains("Expression", StringComparison.OrdinalIgnoreCase)
            || member.Contains("Computed", StringComparison.OrdinalIgnoreCase))
            return true;
        if (string.IsNullOrWhiteSpace(expr)) return false;
        if (QualifiedCol.IsMatch(expr.Trim())) return false;
        if (Regex.IsMatch(expr, @"^[A-Za-z_][A-Za-z0-9_]*$")) return false;
        return Regex.IsMatch(expr, @"\(|\)|\+|DECODE|CASE|NVL|TO_|SUBSTR|TRIM", RegexOptions.IgnoreCase);
    }

    private static string NormalizeJoinType(string? raw, string member, string sourceApi)
    {
        if (!string.IsNullOrWhiteSpace(raw))
        {
            var t = raw.Trim().ToUpperInvariant();
            if (t is "LEFT" or "OUTER" or "LEFT OUTER") return "LEFT";
            if (t is "RIGHT" or "RIGHT OUTER") return "RIGHT";
            if (t is "INNER") return "INNER";
            if (t is "FULL" or "FULL OUTER") return "FULL";
            if (t is "CROSS") return "CROSS";
        }

        if (member.Contains("Outer", StringComparison.OrdinalIgnoreCase)
            || member.Contains("Left", StringComparison.OrdinalIgnoreCase)
            || sourceApi.Contains("Outer", StringComparison.OrdinalIgnoreCase))
            return "LEFT";
        if (member.Contains("Inner", StringComparison.OrdinalIgnoreCase)) return "INNER";
        if (member.Contains("Right", StringComparison.OrdinalIgnoreCase)) return "RIGHT";
        return "UNKNOWN";
    }

    private static bool LooksLikeObjectName(string s) =>
        s.Length is >= 2 and <= 120
        && !JoinTypeToken.IsMatch(s)
        && (s.Contains('_') || Regex.IsMatch(s, @"^[A-Za-z][A-Za-z0-9_]*$"));

    private static bool LooksLikeAlias(string s) =>
        Regex.IsMatch(s, @"^[A-Za-z_][A-Za-z0-9_]{0,30}$") && !JoinTypeToken.IsMatch(s);

    private static bool LooksLikeView(string s) =>
        s.StartsWith("NT_", StringComparison.OrdinalIgnoreCase) || s.StartsWith("V_", StringComparison.OrdinalIgnoreCase);

    private static bool LooksLikeTable(string s) =>
        s.StartsWith("T_", StringComparison.OrdinalIgnoreCase) || s.StartsWith("TETA_", StringComparison.OrdinalIgnoreCase);

    private static string? FirstString(List<string?> args) =>
        args.FirstOrDefault(a => !string.IsNullOrWhiteSpace(a));

    private static string FormatArg(string? v) => v == null ? "null" : $"\"{v}\"";

    private static List<StackValue> PopArgs(List<StackValue> stack, int count)
    {
        var args = new List<StackValue>();
        for (var i = 0; i < count; i++)
        {
            if (stack.Count == 0) args.Insert(0, StackValue.Unknown("missing"));
            else args.Insert(0, Pop(stack));
        }
        return args;
    }

    private static StackValue Pop(List<StackValue> stack)
    {
        var v = stack[^1];
        stack.RemoveAt(stack.Count - 1);
        return v;
    }

    private static void Deduplicate(Stage2dDatasetModel model)
    {
        model.Joins = model.Joins!
            .GroupBy(j => $"{j.JoinedObject}|{j.Alias}|{j.RawCondition}|{j.JoinType}", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        model.ProjectedColumns = model.ProjectedColumns!
            .GroupBy(c => $"{c.DatasetColumn}|{c.Expression}", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        model.DatasetColumns = model.DatasetColumns!
            .GroupBy(c => c.Name ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // Mark FromJoin after dedupe
        var aliases = new HashSet<string>(
            model.Joins.Select(j => j.Alias ?? "").Where(a => a.Length > 0),
            StringComparer.OrdinalIgnoreCase);
        foreach (var col in model.DatasetColumns)
        {
            if (col.SourceAlias != null && aliases.Contains(col.SourceAlias))
                col.FromJoin = true;
        }
    }
}
