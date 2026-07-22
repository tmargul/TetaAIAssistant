using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.RegularExpressions;

namespace TetaDllMetadataReader;

internal static class BosGatewayAnalyzer
{
    private static readonly HashSet<string> GetterProps = new(StringComparer.OrdinalIgnoreCase)
    {
        "ViewName", "Perspektywa", "BaseTableName", "TabelaBD", "DataBaseTable",
        "PackageName", "PakietDAC", "Alias", "TableAlias",
        "NazwaTabeliDataSet", "DataSetTableName", "TableName", "TabelaBO",
        "Gateway", "GatewayName",
    };

    private static readonly Regex InterestingName = new(
        @"ViewName|BaseTableName|PackageName|Alias|TableName|NazwaTabeli|DataSet|Perspektywa|Tabela|Pakiet|Gateway|MTG|TG|Select|Insert|Update|Delete|SqlJoin|PrimaryKey|KeyColumn|Where|OrderBy",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex OracleLike = new(
        @"^(NT_|T_|PA_|PK_|SL_|KP_|LG_|AKT_)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static BosTypeAnalysis AnalyzeType(
        PEReader pe,
        MetadataReader mr,
        TypeDefinitionHandle handle,
        string fullName,
        string assemblyName,
        string dllPath,
        Dictionary<string, TypeDefinitionHandle>? typeIndex = null,
        int inheritanceDepthLimit = 20)
    {
        var td = mr.GetTypeDefinition(handle);
        var ns = mr.GetString(td.Namespace);
        var name = mr.GetString(td.Name);
        var analysis = new BosTypeAnalysis
        {
            FullName = fullName,
            Namespace = ns,
            Name = name,
            AssemblyName = assemblyName,
            ResolvedDllPath = dllPath,
            TypeResolutionStatus = "found",
            Interfaces = [],
            InheritanceChain = [],
            Fields = [],
            Properties = [],
            Methods = [],
            Getters = [],
            ConstructorFacts = [],
            Gateways = [],
            DatasetTables = [],
            RelatedGatewayTypes = [],
            Evidence = [],
            RoleEvidence = [],
        };

        analysis.BaseType = ResolveBaseTypeName(mr, td);
        BuildInheritanceChain(mr, td, analysis, inheritanceDepthLimit);
        foreach (var ih in td.GetInterfaceImplementations())
        {
            var impl = mr.GetInterfaceImplementation(ih);
            var iname = ResolveTypeHandleName(mr, impl.Interface);
            if (iname != null) analysis.Interfaces.Add(iname);
        }

        ClassifyRole(analysis);

        foreach (var fh in td.GetFields())
        {
            var field = mr.GetFieldDefinition(fh);
            var fname = mr.GetString(field.Name);
            string? ftype = null;
            try
            {
                ftype = field.DecodeSignature(new SimpleSigProvider(mr), null).Name;
            }
            catch { /* ignore */ }

            object? literal = null;
            if ((field.Attributes & FieldAttributes.HasDefault) != 0)
            {
                try
                {
                    var c = mr.GetConstant(field.GetDefaultValue());
                    literal = DecodeConstant(mr, c);
                }
                catch { /* ignore */ }
            }

            analysis.Fields.Add(new BosMemberInfo
            {
                Name = fname,
                TypeName = ftype,
                DeclaringType = fullName,
                IsInteresting = InterestingName.IsMatch(fname) || InterestingName.IsMatch(ftype ?? ""),
                LiteralValue = literal,
            });

            if (ftype != null && IsGatewayTypeName(ftype))
                analysis.RelatedGatewayTypes!.Add(ftype);
        }

        foreach (var ph in td.GetProperties())
        {
            var prop = mr.GetPropertyDefinition(ph);
            var pname = mr.GetString(prop.Name);
            analysis.Properties.Add(new BosMemberInfo
            {
                Name = pname,
                DeclaringType = fullName,
                IsInteresting = InterestingName.IsMatch(pname) || GetterProps.Contains(pname),
            });

            var accessors = prop.GetAccessors();
            if (!accessors.Getter.IsNil)
            {
                AnalyzeGetter(pe, mr, accessors.Getter, pname, fullName, analysis);
            }
        }

        foreach (var mh in td.GetMethods())
        {
            var md = mr.GetMethodDefinition(mh);
            var mname = mr.GetString(md.Name);
            analysis.Methods.Add(new BosMemberInfo
            {
                Name = mname,
                DeclaringType = fullName,
                IsInteresting = InterestingName.IsMatch(mname),
            });

            if (mname is ".ctor" or ".cctor" || mname.StartsWith("Create", StringComparison.OrdinalIgnoreCase)
                || mname.StartsWith("Init", StringComparison.OrdinalIgnoreCase)
                || mname.StartsWith("Build", StringComparison.OrdinalIgnoreCase)
                || mname.StartsWith("Add", StringComparison.OrdinalIgnoreCase)
                || mname.StartsWith("Configure", StringComparison.OrdinalIgnoreCase))
            {
                AnalyzeMethodBody(pe, mr, mh, mname, fullName, analysis);
            }
        }

        // Naming-convention related gateways in same assembly
        if (typeIndex != null)
        {
            foreach (var related in DiscoverRelatedByName(name, typeIndex, mr))
            {
                if (!analysis.RelatedGatewayTypes!.Contains(related, StringComparer.OrdinalIgnoreCase))
                    analysis.RelatedGatewayTypes.Add(related);
            }
        }

        // If this type itself is a gateway — promote ctor strings to descriptor
        if (analysis.TechnicalRole is "TG" or "MTG" or "Gateway")
        {
            var gw = BuildGatewayFromCtorFacts(analysis);
            if (gw != null)
            {
                analysis.Gateways!.Add(gw);
                if (!string.IsNullOrWhiteSpace(gw.DatasetTable))
                {
                    analysis.DatasetTables!.Add(new DatasetTableFact
                    {
                        Name = gw.DatasetTable,
                        Source = "gateway_ctor",
                        DeclaringType = fullName,
                        Confidence = gw.Confidence,
                        Evidence = gw.Evidence,
                    });
                }
            }
        }
        else
        {
            // DF/BO: dataset from ctor string args + late-bound gateways
            PromoteLateBoundGateways(analysis);
            foreach (var ctor in analysis.ConstructorFacts ?? [])
            {
                foreach (var arg in ctor.Arguments ?? [])
                {
                    if (arg is string s && LooksLikeDatasetTable(s))
                    {
                        analysis.DatasetTables!.Add(new DatasetTableFact
                        {
                            Name = s,
                            Source = "ctor_argument",
                            DeclaringType = fullName,
                            Confidence = "confirmed_from_il",
                            Evidence = ctor.Evidence,
                        });
                    }
                }
            }
        }

        Deduplicate(analysis);
        return analysis;
    }

    private static void PromoteLateBoundGateways(BosTypeAnalysis analysis)
    {
        foreach (var fact in analysis.ConstructorFacts ?? [])
        {
            var member = fact.CalledMember ?? "";
            if (!member.Contains("CreateTableGatewayByLateBinding", StringComparison.OrdinalIgnoreCase)
                && !member.Contains("CreateGateway", StringComparison.OrdinalIgnoreCase))
                continue;
            var args = (fact.Arguments ?? []).Select(a => a?.ToString()).Where(s => !string.IsNullOrWhiteSpace(s)).Cast<string>().ToList();
            if (args.Count < 2) continue;
            var gwType = args[^1];
            if (!analysis.RelatedGatewayTypes!.Contains(gwType, StringComparer.OrdinalIgnoreCase))
                analysis.RelatedGatewayTypes.Add(gwType);
            var simple = gwType.Split('.').Last();
            var stem = simple;
            foreach (var suffix in new[] { "TG", "MTG", "DF", "BO" })
            {
                if (stem.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                {
                    stem = stem[..^suffix.Length];
                    break;
                }
            }
            if (string.IsNullOrWhiteSpace(stem)) continue;
            analysis.DatasetTables!.Add(new DatasetTableFact
            {
                Name = stem,
                Source = "late_bound_gateway",
                DeclaringType = analysis.FullName,
                Confidence = "confirmed_from_il",
                Evidence = fact.Evidence,
            });
        }
    }

    public static GatewayDescriptor? BuildGatewayFromCtorFacts(BosTypeAnalysis analysis)
    {
        var facts = analysis.ConstructorFacts ?? [];
        if (facts.Count == 0) return null;

        string? dataset = null, view = null, alias = null, package = null, baseTable = null;
        var columns = new List<string>();
        var evidence = new List<EvidenceItem>();

        foreach (var fact in facts)
        {
            var member = fact.CalledMember ?? "";
            var args = (fact.Arguments ?? []).Select(a => a?.ToString()).Where(s => !string.IsNullOrWhiteSpace(s)).Cast<string>().ToList();
            if (fact.Evidence != null) evidence.AddRange(fact.Evidence);

            if (member.Equals("set_TableName", StringComparison.OrdinalIgnoreCase)
                || member.Equals("set_ViewName", StringComparison.OrdinalIgnoreCase)
                || member.Equals("set_Perspektywa", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Count > 0)
                {
                    if (LooksLikeView(args[0]) || member.Contains("View", StringComparison.OrdinalIgnoreCase)
                        || member.Contains("Perspektywa", StringComparison.OrdinalIgnoreCase))
                        view ??= args[0];
                    else if (LooksLikeBaseTable(args[0]))
                        baseTable ??= args[0];
                    else
                        view ??= args[0]; // TableGatewayBase.TableName is typically the Oracle view
                }
                continue;
            }

            if (member.Equals("set_TableAlias", StringComparison.OrdinalIgnoreCase)
                || member.Equals("set_Alias", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Count > 0) alias ??= args[0];
                continue;
            }

            if (member.Equals("set_BaseTableName", StringComparison.OrdinalIgnoreCase)
                || member.Equals("set_TabelaBD", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Count > 0) baseTable ??= args[0];
                continue;
            }

            if (member.Equals("set_PackageName", StringComparison.OrdinalIgnoreCase)
                || member.Equals("set_PakietDAC", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Count > 0) package ??= args[0];
                continue;
            }

            if (member.Equals("AddColumn", StringComparison.OrdinalIgnoreCase)
                || member.Equals("AddKeyColumn", StringComparison.OrdinalIgnoreCase))
            {
                columns.AddRange(args);
                continue;
            }

            // Late-bound gateway: CreateTableGatewayByLateBinding("bosX.dll", "FQN.TG")
            if (member.Contains("CreateTableGatewayByLateBinding", StringComparison.OrdinalIgnoreCase)
                || member.Contains("CreateGateway", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Count >= 2)
                {
                    var gwType = args[^1];
                    if (!analysis.RelatedGatewayTypes!.Contains(gwType, StringComparer.OrdinalIgnoreCase))
                        analysis.RelatedGatewayTypes.Add(gwType);
                    var simple = gwType.Split('.').Last();
                    var stem = simple;
                    foreach (var suffix in new[] { "TG", "MTG", "DF", "BO" })
                    {
                        if (stem.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                        {
                            stem = stem[..^suffix.Length];
                            break;
                        }
                    }
                    if (!string.IsNullOrWhiteSpace(stem))
                    {
                        analysis.DatasetTables!.Add(new DatasetTableFact
                        {
                            Name = stem,
                            Source = "late_bound_gateway",
                            DeclaringType = analysis.FullName,
                            Confidence = "confirmed_from_il",
                            Evidence = fact.Evidence,
                        });
                    }
                }
                continue;
            }

            // base TableGateway / MainTableGateway ctor: (IContainer?, datasetTableName)
            if (member.Contains(".ctor")
                && (fact.CalledType?.Contains("TableGateway", StringComparison.OrdinalIgnoreCase) ?? false)
                && !(fact.CalledType?.Contains("SumoCommandBuilder", StringComparison.OrdinalIgnoreCase) ?? false))
            {
                foreach (var s in args)
                {
                    if (LooksLikeDatasetTable(s) || (!LooksLikePackage(s) && !LooksLikeView(s)))
                        dataset ??= s;
                }
                continue;
            }

            // SumoCommandBuilder(..., package, ...)
            if (fact.CalledType?.Contains("SumoCommandBuilder", StringComparison.OrdinalIgnoreCase) ?? false)
            {
                foreach (var s in (fact.Arguments ?? []).Select(a => a?.ToString()))
                {
                    if (s != null && LooksLikePackage(s)) package ??= s;
                }
            }

            // Generic string harvest from remaining calls
            foreach (var s in args)
            {
                if (LooksLikePackage(s)) package ??= s;
                else if (LooksLikeView(s)) view ??= s;
                else if (LooksLikeBaseTable(s)) baseTable ??= s;
            }
        }

        if (dataset == null && view == null && package == null && alias == null)
            return null;

        var kind = analysis.TechnicalRole is "MTG" or "TG" or "Gateway"
            ? analysis.TechnicalRole
            : ClassifyGatewayKind(analysis.Name ?? "", analysis.BaseType);

        var gw = new GatewayDescriptor
        {
            GatewayType = analysis.FullName,
            GatewayKind = kind,
            DeclaringType = analysis.FullName,
            AssemblyName = analysis.AssemblyName,
            DatasetTable = dataset,
            Alias = alias,
            ViewName = view,
            BaseTableName = baseTable,
            PackageName = package,
            RawPackageName = package,
            NormalizedPackageName = package?.ToUpperInvariant(),
            PackageKind = ClassifyPackageKind(package),
            Operations = InferOperationsFromPackage(package, facts.FirstOrDefault() ?? new CtorArgumentFact()),
            Confidence = "confirmed_from_il",
            Evidence = evidence,
        };

        // Attach discovered columns onto dataset table fact later via analysis
        if (columns.Count > 0 && !string.IsNullOrWhiteSpace(dataset))
        {
            analysis.DatasetTables ??= [];
            var existing = analysis.DatasetTables.FirstOrDefault(d =>
                string.Equals(d.Name, dataset, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
            {
                existing = new DatasetTableFact
                {
                    Name = dataset,
                    Source = "gateway_ctor",
                    DeclaringType = analysis.FullName,
                    Confidence = "confirmed_from_il",
                    Columns = [],
                    Evidence = evidence,
                };
                analysis.DatasetTables.Add(existing);
            }
            existing.Columns ??= [];
            foreach (var col in columns.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (existing.Columns.Any(c => string.Equals(c.Name, col, StringComparison.OrdinalIgnoreCase)))
                    continue;
                existing.Columns.Add(new DatasetColumnFact
                {
                    Name = col,
                    IsPrimaryKey = facts.Any(f =>
                        f.CalledMember?.Equals("AddKeyColumn", StringComparison.OrdinalIgnoreCase) == true
                        && (f.Arguments?.Any(a => string.Equals(a?.ToString(), col, StringComparison.OrdinalIgnoreCase)) ?? false)),
                    Confidence = "confirmed_from_il",
                });
            }
        }

        return gw;
    }

    private static Dictionary<string, OperationDescriptor>? InferOperationsFromPackage(
        string? packageName,
        CtorArgumentFact fact)
    {
        if (string.IsNullOrWhiteSpace(packageName)) return null;
        // Package presence alone does not confirm CRUD — mark as probable naming only.
        var kind = ClassifyPackageKind(packageName);
        if (kind is null) return null;
        return new Dictionary<string, OperationDescriptor>
        {
            ["select"] = new OperationDescriptor
            {
                Kind = "package_inferred",
                PackageProcedure = null,
                Confidence = "probable_from_naming",
                Evidence =
                [
                    new EvidenceItem
                    {
                        Method = fact.Method,
                        Offset = fact.Offset,
                        Assignment = $"package {packageName} present; CRUD not confirmed from IL",
                    },
                ],
            },
        };
    }

    private static void AnalyzeGetter(
        PEReader pe,
        MetadataReader mr,
        MethodDefinitionHandle mh,
        string propertyName,
        string declaringType,
        BosTypeAnalysis analysis)
    {
        var md = mr.GetMethodDefinition(mh);
        if (md.RelativeVirtualAddress == 0) return;
        byte[] il;
        try
        {
            var body = pe.GetMethodBody(md.RelativeVirtualAddress);
            il = body.GetILContent().ToArray();
        }
        catch
        {
            return;
        }

        var instructions = IlDecoder.Decode(il, mr);
        var strings = new List<(string value, int offset)>();
        string? staticField = null;
        foreach (var ins in instructions)
        {
            if (ins.Opcode == IlOpcode.Ldstr && ins.ResolvedString != null)
                strings.Add((ins.ResolvedString, ins.Offset));
            if (ins.Opcode == IlOpcode.Ldsfld && ins.ResolvedName != null)
                staticField = ins.ResolvedName;
        }

        if (strings.Count == 1 && instructions.Any(i => i.Opcode == IlOpcode.Ret))
        {
            analysis.Getters!.Add(new GetterFact
            {
                PropertyName = propertyName,
                Value = strings[0].value,
                DeclaringType = declaringType,
                Method = "get_" + propertyName,
                Offset = $"0x{strings[0].offset:X4}",
                Confidence = "confirmed_from_getter_il",
                Evidence =
                [
                    new EvidenceItem
                    {
                        Method = "get_" + propertyName,
                        Offset = $"0x{strings[0].offset:X4}",
                        Assignment = $"get_{propertyName} => \"{strings[0].value}\"",
                        Opcode = "Ldstr",
                    },
                ],
            });
            ApplyGetterToGatewayHints(analysis, propertyName, strings[0].value);
            return;
        }

        if (strings.Count > 1)
        {
            analysis.Getters!.Add(new GetterFact
            {
                PropertyName = propertyName,
                Value = strings[0].value,
                Alternatives = strings.Select(s => (object?)s.value).ToList(),
                DeclaringType = declaringType,
                Method = "get_" + propertyName,
                Offset = $"0x{strings[0].offset:X4}",
                Confidence = "confirmed_from_getter_il",
                Evidence =
                [
                    new EvidenceItem
                    {
                        Method = "get_" + propertyName,
                        Offset = $"0x{strings[0].offset:X4}",
                        Assignment = $"get_{propertyName} alternatives: {string.Join(", ", strings.Select(s => s.value))}",
                    },
                ],
            });
            return;
        }

        if (staticField != null)
        {
            analysis.Getters!.Add(new GetterFact
            {
                PropertyName = propertyName,
                Value = staticField,
                DeclaringType = declaringType,
                Method = "get_" + propertyName,
                Confidence = "confirmed_from_constant",
                Evidence =
                [
                    new EvidenceItem
                    {
                        Method = "get_" + propertyName,
                        Assignment = $"get_{propertyName} => static field {staticField}",
                        Opcode = "Ldsfld",
                    },
                ],
            });
        }
    }

    private static void ApplyGetterToGatewayHints(BosTypeAnalysis analysis, string prop, string value)
    {
        if (!IsGatewayRole(analysis.TechnicalRole) && analysis.TechnicalRole is not ("BO" or "DF" or "unknown"))
            return;

        var gw = analysis.Gateways!.FirstOrDefault() ?? new GatewayDescriptor
        {
            GatewayType = analysis.FullName,
            GatewayKind = analysis.TechnicalRole,
            DeclaringType = analysis.FullName,
            AssemblyName = analysis.AssemblyName,
            Confidence = "confirmed_from_getter_il",
            Evidence = [],
        };
        var created = analysis.Gateways!.Count == 0;

        if (prop is "ViewName" or "Perspektywa") gw.ViewName ??= value;
        else if (prop is "BaseTableName" or "TabelaBD" or "DataBaseTable") gw.BaseTableName ??= value;
        else if (prop is "PackageName" or "PakietDAC")
        {
            gw.PackageName ??= value;
            gw.RawPackageName ??= value;
            gw.NormalizedPackageName = value.ToUpperInvariant();
            gw.PackageKind = ClassifyPackageKind(value);
        }
        else if (prop is "Alias" or "TableAlias") gw.Alias ??= value;
        else if (prop is "NazwaTabeliDataSet" or "DataSetTableName" or "TableName" or "TabelaBO")
        {
            gw.DatasetTable ??= value;
            analysis.DatasetTables!.Add(new DatasetTableFact
            {
                Name = value,
                Source = "getter",
                DeclaringType = analysis.FullName,
                Confidence = "confirmed_from_getter_il",
            });
        }

        if (created && (gw.ViewName != null || gw.PackageName != null || gw.DatasetTable != null || gw.BaseTableName != null))
            analysis.Gateways.Add(gw);
        else if (!created)
        {
            // already in list
        }
    }

    private static void AnalyzeMethodBody(
        PEReader pe,
        MetadataReader mr,
        MethodDefinitionHandle mh,
        string methodName,
        string declaringType,
        BosTypeAnalysis analysis)
    {
        var md = mr.GetMethodDefinition(mh);
        if (md.RelativeVirtualAddress == 0) return;
        byte[] il;
        try
        {
            var body = pe.GetMethodBody(md.RelativeVirtualAddress);
            il = body.GetILContent().ToArray();
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
                    var totalPop = argc + (hasThis || ins.Opcode == IlOpcode.Newobj ? 1 : 0);
                    // For newobj, ParamCount is ctor params; instance is pushed by newobj semantics — decoder sets ParamCount as params only
                    if (ins.Opcode == IlOpcode.Newobj)
                        totalPop = argc; // args only; result pushed
                    var args = PopArgs(stack, argc);
                    if (hasThis && stack.Count > 0) Pop(stack);

                    var calledType = ins.ResolvedType ?? "";
                    var calledName = ins.ResolvedName ?? "";
                    if (args.Count > 0 && (calledName.Contains(".ctor") || IsGatewayTypeName(calledType)
                        || calledType.Contains("TableGateway", StringComparison.OrdinalIgnoreCase)
                        || calledType.Contains("MultiTableGateway", StringComparison.OrdinalIgnoreCase)
                        || calledType.Contains("DictionaryFacade", StringComparison.OrdinalIgnoreCase)
                        || calledType.Contains("BusinessObject", StringComparison.OrdinalIgnoreCase)))
                    {
                        var literals = args.Select(a => a.AsLiteral()).ToList();
                        if (literals.Any(l => l != null))
                        {
                            analysis.ConstructorFacts!.Add(new CtorArgumentFact
                            {
                                DeclaringType = declaringType,
                                Method = methodName,
                                Offset = $"0x{ins.Offset:X4}",
                                CalledMember = calledName,
                                CalledType = calledType,
                                Arguments = literals,
                                Confidence = "confirmed_from_il",
                                Evidence =
                                [
                                    new EvidenceItem
                                    {
                                        Method = methodName,
                                        Offset = $"0x{ins.Offset:X4}",
                                        Assignment = $"{calledType}::{calledName}({string.Join(", ", literals.Select(FormatArg))})",
                                        Opcode = ins.Opcode.ToString(),
                                        ResolvedMember = calledName,
                                    },
                                ],
                            });
                        }
                    }

                    if (IsGatewayTypeName(calledType))
                        analysis.RelatedGatewayTypes!.Add(calledType);

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
                    // approximate stack for other ops
                    for (var i = 0; i < ins.Pops && stack.Count > 0; i++) Pop(stack);
                    for (var i = 0; i < ins.Pushes; i++) stack.Add(StackValue.Unknown(ins.RawOpcode));
                    break;
            }
        }
    }

    private static void ClassifyRole(BosTypeAnalysis a)
    {
        var name = a.Name ?? "";
        var ns = a.Namespace ?? "";
        var baseType = a.BaseType ?? "";
        var evidence = a.RoleEvidence!;

        // Prefer explicit type-name suffixes over base-type heuristics.
        if (name.EndsWith("MTG", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "MTG";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("name suffix MTG");
            return;
        }
        if (name.EndsWith("TG", StringComparison.OrdinalIgnoreCase) && !name.EndsWith("MTG", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "TG";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("name suffix TG");
            return;
        }
        if (name.EndsWith("DF", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "DF";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("name suffix DF");
            return;
        }
        if (name.EndsWith("BO", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "BO";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("name suffix BO");
            return;
        }

        if (baseType.Contains("MultiTableGateway", StringComparison.OrdinalIgnoreCase)
            || baseType.Contains("MainTableGateway", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "MTG";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("base MTG");
            return;
        }
        if (baseType.Contains("TableGateway", StringComparison.OrdinalIgnoreCase)
            || ns.Contains(".Gateways", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "TG";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("base TG");
            return;
        }
        if (baseType.Contains("DataFactory", StringComparison.OrdinalIgnoreCase)
            || baseType.Contains("DictionaryFacade", StringComparison.OrdinalIgnoreCase)
            || ns.Contains(".DF", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "DF";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("base/ns DF");
            return;
        }
        if (baseType.Contains("BusinessObject", StringComparison.OrdinalIgnoreCase)
            || ns.Contains(".BO", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "BO";
            a.RoleConfidence = "confirmed_from_metadata";
            evidence.Add("base/ns BO");
            return;
        }
        if (baseType.Contains("DataSet", StringComparison.OrdinalIgnoreCase) || name.Contains("DataSet", StringComparison.OrdinalIgnoreCase))
        {
            a.TechnicalRole = "DataSet builder";
            a.RoleConfidence = "probable_from_naming";
            evidence.Add("DataSet naming");
            return;
        }
        a.TechnicalRole = "unknown";
        a.RoleConfidence = "candidate_string";
        evidence.Add("unclassified");
    }

    private static string? ClassifyGatewayKind(string name, string? baseType)
    {
        if (name.EndsWith("MTG", StringComparison.OrdinalIgnoreCase)
            || (baseType?.Contains("MultiTableGateway", StringComparison.OrdinalIgnoreCase) ?? false))
            return "MTG";
        if (name.EndsWith("TG", StringComparison.OrdinalIgnoreCase)
            || (baseType?.Contains("TableGateway", StringComparison.OrdinalIgnoreCase) ?? false))
            return "TG";
        return "Gateway";
    }

    private static string? ClassifyPackageKind(string? package)
    {
        if (string.IsNullOrWhiteSpace(package)) return null;
        if (package.EndsWith("_DAC", StringComparison.OrdinalIgnoreCase)) return "DAC";
        if (package.EndsWith("_AGL", StringComparison.OrdinalIgnoreCase)) return "AGL";
        if (package.EndsWith("_LEP", StringComparison.OrdinalIgnoreCase)) return "LEP";
        return "custom";
    }

    private static bool IsGatewayTypeName(string type) =>
        type.EndsWith("TG", StringComparison.OrdinalIgnoreCase)
        || type.EndsWith("MTG", StringComparison.OrdinalIgnoreCase)
        || type.Contains("TableGateway", StringComparison.OrdinalIgnoreCase)
        || type.Contains("MultiTableGateway", StringComparison.OrdinalIgnoreCase);

    private static bool IsGatewayRole(string? role) =>
        role is "TG" or "MTG" or "Gateway";

    private static bool LooksLikeView(string s) =>
        s.StartsWith("NT_", StringComparison.OrdinalIgnoreCase)
        || s.StartsWith("V_", StringComparison.OrdinalIgnoreCase);

    private static bool LooksLikeBaseTable(string s) =>
        s.StartsWith("T_", StringComparison.OrdinalIgnoreCase)
        || (s.StartsWith("KP_", StringComparison.OrdinalIgnoreCase) && !s.Contains("_DAC", StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikePackage(string s) =>
        s.EndsWith("_DAC", StringComparison.OrdinalIgnoreCase)
        || s.EndsWith("_AGL", StringComparison.OrdinalIgnoreCase)
        || s.EndsWith("_LEP", StringComparison.OrdinalIgnoreCase)
        || s.StartsWith("PA_", StringComparison.OrdinalIgnoreCase);

    private static bool LooksLikeAlias(string s) =>
        s.Length is >= 2 and <= 12 && Regex.IsMatch(s, @"^[A-Za-z][A-Za-z0-9_]*$") && !OracleLike.IsMatch(s);

    private static bool LooksLikeDatasetTable(string s) =>
        !OracleLike.IsMatch(s)
        && !LooksLikePackage(s)
        && Regex.IsMatch(s, @"^[A-Za-z_][A-Za-z0-9_]*$")
        && s.Length is >= 2 and <= 80
        && !s.Equals("KOD", StringComparison.OrdinalIgnoreCase);

    private static IEnumerable<string> DiscoverRelatedByName(
        string typeName,
        Dictionary<string, TypeDefinitionHandle> typeIndex,
        MetadataReader mr)
    {
        var stem = typeName;
        foreach (var suffix in new[] { "DF", "BO", "TG", "MTG", "Facade" })
        {
            if (stem.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                stem = stem[..^suffix.Length];
                break;
            }
        }

        foreach (var candidateSuffix in new[] { "TG", "MTG", "DF", "BO" })
        {
            var simple = stem + candidateSuffix;
            foreach (var kv in typeIndex)
            {
                if (kv.Key.EndsWith("." + simple, StringComparison.OrdinalIgnoreCase)
                    || kv.Key.Equals(simple, StringComparison.OrdinalIgnoreCase))
                {
                    yield return kv.Key;
                }
            }
        }
    }

    private static void BuildInheritanceChain(
        MetadataReader mr,
        TypeDefinition td,
        BosTypeAnalysis analysis,
        int depthLimit)
    {
        var depth = 0;
        EntityHandle current = td.BaseType;
        while (!current.IsNil && depth < depthLimit)
        {
            var name = ResolveTypeHandleName(mr, current);
            if (name == null || name.StartsWith("System.", StringComparison.Ordinal)) break;
            analysis.InheritanceChain!.Add(name);
            if (current.Kind != HandleKind.TypeDefinition) break;
            var baseTd = mr.GetTypeDefinition((TypeDefinitionHandle)current);
            current = baseTd.BaseType;
            depth++;
        }
    }

    private static string? ResolveBaseTypeName(MetadataReader mr, TypeDefinition td) =>
        ResolveTypeHandleName(mr, td.BaseType);

    private static string? ResolveTypeHandleName(MetadataReader mr, EntityHandle handle)
    {
        if (handle.IsNil) return null;
        if (handle.Kind == HandleKind.TypeDefinition)
        {
            var td = mr.GetTypeDefinition((TypeDefinitionHandle)handle);
            var ns = mr.GetString(td.Namespace);
            var name = mr.GetString(td.Name);
            return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
        }
        if (handle.Kind == HandleKind.TypeReference)
        {
            var tr = mr.GetTypeReference((TypeReferenceHandle)handle);
            var ns = mr.GetString(tr.Namespace);
            var name = mr.GetString(tr.Name);
            return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
        }
        return null;
    }

    private static object? DecodeConstant(MetadataReader mr, Constant constant)
    {
        var blob = mr.GetBlobReader(constant.Value);
        return constant.TypeCode switch
        {
            ConstantTypeCode.String => blob.ReadUTF16(blob.RemainingBytes),
            ConstantTypeCode.Boolean => blob.ReadBoolean(),
            ConstantTypeCode.Int32 => blob.ReadInt32(),
            ConstantTypeCode.Int64 => blob.ReadInt64(),
            _ => null,
        };
    }

    private static void Deduplicate(BosTypeAnalysis a)
    {
        a.RelatedGatewayTypes = a.RelatedGatewayTypes?
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        a.DatasetTables = a.DatasetTables?
            .GroupBy(d => d.Name ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First()).ToList();
        a.ConstructorFacts = a.ConstructorFacts?
            .GroupBy(c => $"{c.Offset}|{c.CalledMember}|{string.Join(",", c.Arguments ?? [])}")
            .Select(g => g.First()).ToList();
    }

    private static StackValue Pop(List<StackValue> stack)
    {
        if (stack.Count == 0) return StackValue.Unknown("underflow");
        var v = stack[^1];
        stack.RemoveAt(stack.Count - 1);
        return v;
    }

    private static List<StackValue> PopArgs(List<StackValue> stack, int count)
    {
        var args = new List<StackValue>();
        for (var i = 0; i < count; i++) args.Insert(0, Pop(stack));
        return args;
    }

    private static string FormatArg(object? v) =>
        v switch
        {
            null => "null",
            string s => $"\"{s}\"",
            _ => v.ToString() ?? "?",
        };

    private sealed class SimpleSigProvider : ISignatureTypeProvider<TypeName, object?>
    {
        private readonly MetadataReader _mr;
        public SimpleSigProvider(MetadataReader mr) => _mr = mr;
        public TypeName GetPrimitiveType(PrimitiveTypeCode typeCode) => new(typeCode.ToString());
        public TypeName GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind)
            => new(ResolveTypeHandleName(reader, handle) ?? "?");
        public TypeName GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind)
            => new(ResolveTypeHandleName(reader, handle) ?? "?");
        public TypeName GetSZArrayType(TypeName elementType) => new(elementType.Name + "[]");
        public TypeName GetArrayType(TypeName elementType, ArrayShape shape) => new(elementType.Name + "[...]");
        public TypeName GetByReferenceType(TypeName elementType) => new(elementType.Name + "&");
        public TypeName GetPointerType(TypeName elementType) => new(elementType.Name + "*");
        public TypeName GetGenericInstantiation(TypeName genericType, System.Collections.Immutable.ImmutableArray<TypeName> typeArguments)
            => new($"{genericType.Name}<{string.Join(",", typeArguments.Select(t => t.Name))}>");
        public TypeName GetGenericTypeParameter(object? genericContext, int index) => new("!T" + index);
        public TypeName GetGenericMethodParameter(object? genericContext, int index) => new("!!T" + index);
        public TypeName GetFunctionPointerType(MethodSignature<TypeName> signature) => new("fnptr");
        public TypeName GetModifiedType(TypeName modifier, TypeName unmodifiedType, bool isRequired) => unmodifiedType;
        public TypeName GetPinnedType(TypeName elementType) => elementType;
        public TypeName GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind)
            => new("TypeSpec");
    }

    private readonly record struct TypeName(string Name);
}
