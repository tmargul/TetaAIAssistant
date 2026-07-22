using System.Collections.Immutable;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.RegularExpressions;

namespace TetaDllMetadataReader;

/// <summary>
/// Stage 2A: static IL decode + limited symbolic stack reconstruction.
/// Does not execute assemblies. Does not change Etap 1 TypeDef matching.
/// </summary>
internal static class IlBindingAnalyzer
{
    private static readonly HashSet<string> TargetMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "InitializeComponent", ".ctor", "OnLoad", "Load", "Initialize", "Init",
    };

    private static readonly Regex TargetMethodPrefix = new(
        "^(Create|Configure|Bind|Add|Dodaj|Ustaw|Initialize|Init$|Build|Fill|Load)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex TargetMethodContains = new(
        "(Column|DataSet|DataSource|Filter|Lookup|Browser|Parametr|Binding)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly HashSet<string> InterestingProperties = new(StringComparer.OrdinalIgnoreCase)
    {
        "Name", "Text", "DataMember", "DataSource", "DataField", "ValueMember", "DisplayMember",
        "TableName", "DataSetName", "ViewName", "Alias", "ColumnName", "FieldName",
        "Filter", "Where", "Condition", "BusinessObject", "BusinessObjectType",
        "DataFactory", "DataFactoryType", "AssemblyName", "TypeName", "PluginAssembly",
        "PluginClass", "Browser", "GridLayout", "HeaderText", "Caption", "KeyField",
        "ParentField", "IdField", "ParentIdField", "LookupAssembly", "LookupClass",
        "Gateway", "Perspektywa", "NazwaTabeliDataSet", "PakietDAC", "TabelaBO",
    };

    public static FormTechnicalBinding AnalyzeType(
        PEReader pe,
        MetadataReader mr,
        TypeDefinitionHandle typeHandle,
        string formTypeFullName,
        string? pluginsRoot,
        int inheritanceDepthLimit = 10)
    {
        var binding = new FormTechnicalBinding
        {
            FormType = formTypeFullName,
            DeclaredOnType = formTypeFullName,
        };

        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        AnalyzeTypeChain(pe, mr, typeHandle, formTypeFullName, pluginsRoot, inheritanceDepthLimit, 0, visited, binding, isRoot: true);
        PostProcess(binding);
        return binding;
    }

    private static void AnalyzeTypeChain(
        PEReader pe,
        MetadataReader mr,
        TypeDefinitionHandle typeHandle,
        string typeFullName,
        string? pluginsRoot,
        int depthLimit,
        int depth,
        HashSet<string> visited,
        FormTechnicalBinding binding,
        bool isRoot)
    {
        if (depth > depthLimit) return;
        if (!visited.Add(typeFullName)) return;

        var td = mr.GetTypeDefinition(typeHandle);
        var fields = IndexFields(mr, td, typeFullName);
        foreach (var field in fields.Values)
        {
            UpsertControl(binding, field, isRoot ? null : typeFullName);
        }

        var methodsToAnalyze = SelectMethods(mr, td);
        if (methodsToAnalyze.Any(mh =>
        {
            var md = mr.GetMethodDefinition(mh);
            return string.Equals(mr.GetString(md.Name), "InitializeComponent", StringComparison.Ordinal);
        }))
        {
            binding.HasInitializeComponent = true;
        }
        var callGraphExtra = new HashSet<string>(StringComparer.Ordinal);
        foreach (var methodHandle in methodsToAnalyze)
        {
            AnalyzeMethod(pe, mr, methodHandle, typeFullName, fields, binding, isRoot ? null : typeFullName, callGraphExtra);
        }

        // Direct callees in same type referenced from InitializeComponent
        foreach (var mh in td.GetMethods())
        {
            var md = mr.GetMethodDefinition(mh);
            var name = mr.GetString(md.Name);
            if (!callGraphExtra.Contains(name)) continue;
            if (methodsToAnalyze.Contains(mh)) continue;
            AnalyzeMethod(pe, mr, mh, typeFullName, fields, binding, isRoot ? null : typeFullName, null);
        }

        // Walk base type in same assembly when possible
        if (td.BaseType.IsNil) return;
        if (td.BaseType.Kind == HandleKind.TypeDefinition)
        {
            var baseTd = mr.GetTypeDefinition((TypeDefinitionHandle)td.BaseType);
            var baseName = BuildTypeName(mr, baseTd);
            if (IsFrameworkBase(baseName)) return;
            AnalyzeTypeChain(pe, mr, (TypeDefinitionHandle)td.BaseType, baseName, pluginsRoot, depthLimit, depth + 1, visited, binding, isRoot: false);
            return;
        }

        if (td.BaseType.Kind == HandleKind.TypeReference && !string.IsNullOrWhiteSpace(pluginsRoot))
        {
            var baseName = ResolveTypeRefName(mr, (TypeReferenceHandle)td.BaseType);
            if (baseName == null || IsFrameworkBase(baseName)) return;
            // Cross-assembly base resolution left as unresolved evidence for Stage 2A.
            binding.UnresolvedEvidence.Add(new UnresolvedEvidence
            {
                Kind = "base_type_external",
                Message = $"Base type {baseName} not in same assembly; inheritance not expanded.",
                DeclaringType = typeFullName,
            });
        }
    }

    private static bool IsFrameworkBase(string name) =>
        name.StartsWith("System.", StringComparison.Ordinal)
        || name.StartsWith("System.", StringComparison.OrdinalIgnoreCase)
        || name is "Object" or "MarshalByRefObject";

    private static List<MethodDefinitionHandle> SelectMethods(MetadataReader mr, TypeDefinition td)
    {
        var list = new List<MethodDefinitionHandle>();
        foreach (var mh in td.GetMethods())
        {
            var md = mr.GetMethodDefinition(mh);
            var name = mr.GetString(md.Name);
            if (TargetMethods.Contains(name) || TargetMethodPrefix.IsMatch(name) || TargetMethodContains.IsMatch(name))
            {
                list.Add(mh);
            }
        }
        return list;
    }

    private static Dictionary<string, FieldInfoLite> IndexFields(MetadataReader mr, TypeDefinition td, string declaringType)
    {
        var map = new Dictionary<string, FieldInfoLite>(StringComparer.Ordinal);
        foreach (var fh in td.GetFields())
        {
            var field = mr.GetFieldDefinition(fh);
            var name = mr.GetString(field.Name);
            string? typeName = null;
            try
            {
                var sig = field.DecodeSignature(new SimpleTypeProvider(mr), null!);
                typeName = sig;
            }
            catch { /* ignore */ }

            map[name] = new FieldInfoLite
            {
                Name = name,
                TypeName = typeName,
                DeclaringType = declaringType,
                Handle = fh,
            };
        }
        return map;
    }

    private static void AnalyzeMethod(
        PEReader pe,
        MetadataReader mr,
        MethodDefinitionHandle methodHandle,
        string declaringType,
        Dictionary<string, FieldInfoLite> fields,
        FormTechnicalBinding binding,
        string? inheritedFromType,
        HashSet<string>? collectCallees)
    {
        var method = mr.GetMethodDefinition(methodHandle);
        var methodName = mr.GetString(method.Name);
        if (method.RelativeVirtualAddress == 0) return;

        byte[] il;
        try
        {
            var body = pe.GetMethodBody(method.RelativeVirtualAddress);
            il = body.GetILContent().ToArray();
        }
        catch
        {
            return;
        }

        var instructions = IlDecoder.Decode(il, mr);
        if (collectCallees != null)
        {
            foreach (var ins in instructions)
            {
                if (ins.Opcode is IlOpcode.Call or IlOpcode.Callvirt
                    && ins.ResolvedName != null
                    && fields.ContainsKey("_sentinel_") == false)
                {
                    // Same-type instance calls often appear as MethodDefinition names without type prefix.
                    if (ins.ResolvedKind == "methodDef")
                    {
                        collectCallees.Add(ins.ResolvedName);
                    }
                }
            }
        }

        var stack = new List<StackValue>();
        var locals = new Dictionary<int, StackValue>();

        foreach (var ins in instructions)
        {
            try
            {
                Step(ins, stack, locals, fields, mr, declaringType, methodName, binding, inheritedFromType);
            }
            catch
            {
                // Keep going — limited symbolic execution must be resilient.
                stack.Clear();
            }
        }
    }

    private static void Step(
        IlInstruction ins,
        List<StackValue> stack,
        Dictionary<int, StackValue> locals,
        Dictionary<string, FieldInfoLite> fields,
        MetadataReader mr,
        string declaringType,
        string methodName,
        FormTechnicalBinding binding,
        string? inheritedFromType)
    {
        switch (ins.Opcode)
        {
            case IlOpcode.Nop:
            case IlOpcode.Break:
                return;
            case IlOpcode.Ldnull:
                stack.Add(StackValue.Null());
                return;
            case IlOpcode.Ldstr:
                stack.Add(StackValue.String(ins.ResolvedString ?? ""));
                return;
            case IlOpcode.LdcI4:
                stack.Add(StackValue.Number(ins.IntOperand ?? 0));
                return;
            case IlOpcode.LdcI8:
                stack.Add(StackValue.Number(ins.LongOperand ?? 0));
                return;
            case IlOpcode.LdcR4:
            case IlOpcode.LdcR8:
                stack.Add(StackValue.Number(ins.DoubleOperand ?? 0));
                return;
            case IlOpcode.Ldarg0:
                stack.Add(StackValue.This(declaringType));
                return;
            case IlOpcode.Ldarg:
                stack.Add(StackValue.Arg(ins.IntOperand ?? 0));
                return;
            case IlOpcode.Ldloc:
            {
                var idx = ins.IntOperand ?? 0;
                stack.Add(locals.TryGetValue(idx, out var v) ? v.Clone() : StackValue.Unknown($"loc{idx}"));
                return;
            }
            case IlOpcode.Stloc:
            {
                var idx = ins.IntOperand ?? 0;
                locals[idx] = Pop(stack);
                return;
            }
            case IlOpcode.Dup:
                if (stack.Count > 0) stack.Add(stack[^1].Clone());
                return;
            case IlOpcode.Pop:
                Pop(stack);
                return;
            case IlOpcode.Ldfld:
            case IlOpcode.Ldsfld:
            {
                var fieldName = ins.ResolvedName ?? "?";
                fields.TryGetValue(fieldName, out var fieldInfo);
                var owner = Pop(stack);
                stack.Add(StackValue.Field(fieldName, fieldInfo?.TypeName, owner));
                return;
            }
            case IlOpcode.Stfld:
            {
                var value = Pop(stack);
                var target = Pop(stack);
                var fieldName = ins.ResolvedName ?? "?";
                RecordFieldStore(binding, fieldName, value, target, methodName, ins, declaringType, inheritedFromType, fields);
                return;
            }
            case IlOpcode.Newobj:
            {
                var argc = Math.Max(0, ins.ParamCount ?? 0);
                var args = PopArgs(stack, argc);
                // newobj does not consume 'this' — ctor args only
                var ctorType = ins.ResolvedType ?? ins.ResolvedName ?? "unknown";
                stack.Add(StackValue.Constructed(ctorType, args, methodName, ins.Offset));
                RecordConstructor(binding, ctorType, args, methodName, ins, declaringType, inheritedFromType);
                return;
            }
            case IlOpcode.Call:
            case IlOpcode.Callvirt:
            {
                var isInstance = ins.HasThis == true;
                var argc = Math.Max(0, ins.ParamCount ?? 0);
                var args = PopArgs(stack, argc);
                StackValue? instance = isInstance ? Pop(stack) : null;
                var memberName = ins.ResolvedName ?? "";
                if (memberName.StartsWith("set_", StringComparison.Ordinal))
                {
                    var prop = memberName[4..];
                    var value = args.Count > 0 ? args[0] : StackValue.Unknown("?");
                    RecordPropertyAssignment(
                        binding, instance, prop, value, methodName, ins, declaringType, inheritedFromType, fields,
                        confidence: "confirmed_from_il");
                }
                else if (memberName.StartsWith("get_", StringComparison.Ordinal))
                {
                    stack.Add(StackValue.PropertyGet(instance, memberName[4..]));
                }
                else
                {
                    // Non-setter call: if args look like bos/DF descriptors, record as call site
                    if (LooksLikeDescriptorCall(args))
                    {
                        RecordDescriptorCall(binding, memberName, ins.ResolvedType, instance, args, methodName, ins, declaringType, inheritedFromType);
                    }
                    if (ins.ReturnsValue == true)
                    {
                        stack.Add(StackValue.Unknown($"ret:{memberName}"));
                    }
                }
                return;
            }
            case IlOpcode.Br:
            case IlOpcode.Brtrue:
            case IlOpcode.Brfalse:
            case IlOpcode.Leave:
            case IlOpcode.Ret:
                if (ins.Opcode is IlOpcode.Brtrue or IlOpcode.Brfalse) Pop(stack);
                if (ins.Opcode == IlOpcode.Ret && stack.Count > 0) stack.Clear();
                return;
            default:
                // Conservative: unknown opcode clears stack to avoid false bindings
                if (ins.Pops > 0)
                {
                    for (var i = 0; i < ins.Pops && stack.Count > 0; i++) Pop(stack);
                }
                for (var i = 0; i < ins.Pushes; i++) stack.Add(StackValue.Unknown($"op:{ins.Opcode}"));
                return;
        }
    }

    private static void RecordPropertyAssignment(
        FormTechnicalBinding binding,
        StackValue? instance,
        string property,
        StackValue value,
        string methodName,
        IlInstruction ins,
        string declaringType,
        string? inheritedFromType,
        Dictionary<string, FieldInfoLite> fields,
        string confidence)
    {
        var control = ResolveControlName(instance);
        var valueLiteral = value.AsLiteral();
        var assignment = new PropertyAssignment
        {
            Control = control,
            ControlType = ResolveControlType(control, instance, fields),
            Property = property,
            Value = valueLiteral,
            ValueKind = value.Kind,
            Method = methodName,
            Offset = $"0x{ins.Offset:X4}",
            Assignment = control != null
                ? $"{control}.{property} = {FormatLiteral(value)}"
                : $"{property} = {FormatLiteral(value)}",
            DeclaredOnType = declaringType,
            InheritedFromType = inheritedFromType,
            Confidence = confidence,
            Evidence = new List<EvidenceItem>
            {
                new()
                {
                    Method = methodName,
                    Offset = $"0x{ins.Offset:X4}",
                    Assignment = control != null
                        ? $"{control}.{property} = {FormatLiteral(value)}"
                        : $"{property} = {FormatLiteral(value)}",
                    Opcode = ins.Opcode.ToString(),
                    ResolvedMember = ins.ResolvedName,
                },
            },
        };
        binding.PropertyAssignments.Add(assignment);

        if (control != null)
        {
            UpsertControlProperty(binding, control, assignment.ControlType, property, valueLiteral, methodName, inheritedFromType);
        }

        ClassifyBindingFromAssignment(binding, assignment, value);
        if (value.Kind == StackKind.Constructed)
        {
            ClassifyConstructedAssignment(binding, assignment, value);
        }
    }

    private static void ClassifyConstructedAssignment(
        FormTechnicalBinding binding,
        PropertyAssignment assignment,
        StackValue value)
    {
        var ctor = value.TypeName ?? "";
        var args = (value.ConstructorArgs ?? []).Select(a => a.AsLiteral()?.ToString()).ToList();
        if (ctor.Contains("DesignModeColumn", StringComparison.OrdinalIgnoreCase) && args.Count >= 3)
        {
            var table = args[1];
            var column = args[2];
            if (!string.IsNullOrWhiteSpace(table))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = table!,
                    Kind = "dataset_table",
                    RelatedControl = assignment.Control,
                    Confidence = "confirmed_from_il",
                    DeclaredOnType = assignment.DeclaredOnType,
                    InheritedFromType = assignment.InheritedFromType,
                });
            }
            if (assignment.Control != null && !string.IsNullOrWhiteSpace(column))
            {
                AddTypedBinding(binding, assignment, dataMember: column, datasetTable: table, format: null);
                binding.Relations.Add(new RelationEdge
                {
                    RelationType = "control_column",
                    From = assignment.Control,
                    To = column!,
                    Confidence = "confirmed_from_il",
                    SourceMethod = assignment.Method,
                    SourceOffsets = [assignment.Offset ?? ""],
                    Evidence =
                    [
                        $"{assignment.Control}.{assignment.Property} = new DesignModeColumn(..., \"{table}\", \"{column}\")",
                    ],
                });
            }
        }
        else if (ctor.Contains("DesignModeTable", StringComparison.OrdinalIgnoreCase) && args.Count >= 2)
        {
            var table = args[1];
            if (!string.IsNullOrWhiteSpace(table))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = table!,
                    Kind = "dataset_table",
                    RelatedControl = assignment.Control,
                    Confidence = "confirmed_from_il",
                    DeclaredOnType = assignment.DeclaredOnType,
                    InheritedFromType = assignment.InheritedFromType,
                });
                if (assignment.Control != null)
                {
                    AddTypedBinding(binding, assignment, dataMember: null, datasetTable: table, format: null);
                }
            }
        }
        else if (ctor.Contains("DataSet", StringComparison.OrdinalIgnoreCase) && args.Count >= 1)
        {
            var name = args[0];
            if (!string.IsNullOrWhiteSpace(name) && !double.TryParse(name, out _))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = name!,
                    Kind = "dataset",
                    Confidence = "confirmed_from_il",
                    DeclaredOnType = assignment.DeclaredOnType,
                    InheritedFromType = assignment.InheritedFromType,
                });
            }
        }
    }

    private static void RecordFieldStore(
        FormTechnicalBinding binding,
        string fieldName,
        StackValue value,
        StackValue target,
        string methodName,
        IlInstruction ins,
        string declaringType,
        string? inheritedFromType,
        Dictionary<string, FieldInfoLite> fields)
    {
        fields.TryGetValue(fieldName, out var field);
        if (value.Kind == StackKind.Constructed)
        {
            RecordConstructor(binding, value.TypeName ?? "?", value.ConstructorArgs ?? [], methodName, ins, declaringType, inheritedFromType);
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "formType_stores_constructed",
                From = declaringType,
                To = value.TypeName ?? "?",
                Confidence = "confirmed_from_il",
                SourceMethod = methodName,
                SourceOffsets = [$"0x{ins.Offset:X4}"],
                Evidence = [$"stfld {fieldName} = new {value.TypeName}(...)"],
            });
        }

        if (field != null)
        {
            UpsertControl(binding, field, inheritedFromType);
            if (value.Kind == StackKind.Constructed && value.TypeName != null)
            {
                var ctrl = binding.Controls.FirstOrDefault(c => c.FieldName == fieldName);
                if (ctrl != null)
                {
                    ctrl.ConstructorType = value.TypeName;
                    ctrl.CreatedInMethod = methodName;
                }
            }
        }
    }

    private static void RecordConstructor(
        FormTechnicalBinding binding,
        string ctorType,
        List<StackValue> args,
        string methodName,
        IlInstruction ins,
        string declaringType,
        string? inheritedFromType)
    {
        var literals = args.Select(a => a.AsLiteral()).Where(x => x != null).Cast<object?>().ToList();
        var record = new ConstructorCall
        {
            ConstructorType = ctorType,
            Arguments = literals,
            Method = methodName,
            Offset = $"0x{ins.Offset:X4}",
            DeclaredOnType = declaringType,
            InheritedFromType = inheritedFromType,
            Confidence = args.All(a => a.IsConcrete()) ? "confirmed_from_il" : "probable_from_local_sequence",
        };
        binding.ConstructorCalls.Add(record);

            // Heuristic: (bosXxx.dll or path\…\bosXxx.dll, Full.Type.DF/BO, TableName|int)
        if (literals.Count >= 2)
        {
            var a0raw = literals[0]?.ToString() ?? "";
            var a0 = NormalizeAssemblyName(a0raw);
            var a1 = literals[1]?.ToString() ?? "";
            var a2 = literals.Count >= 3 ? literals[2]?.ToString() : null;
            // Skip numeric placeholder as logical table name
            if (a2 != null && double.TryParse(a2, out _)) a2 = null;

            if (a0.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                || a0raw.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            {
                if (!a0.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) && a0raw.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                {
                    a0 = Path.GetFileName(a0raw);
                }

                binding.Assemblies.Add(new AssemblyRef
                {
                    Name = a0,
                    Role = a0.StartsWith("bos", StringComparison.OrdinalIgnoreCase) ? "bos" :
                           a0.StartsWith("plg", StringComparison.OrdinalIgnoreCase) ? "plugin" : "other",
                    Confidence = record.Confidence,
                    Evidence = [$"{methodName} @ {record.Offset}: new {ctorType}(...)" ],
                });
                if (a1.Contains(".DF.", StringComparison.OrdinalIgnoreCase) || a1.EndsWith("DF", StringComparison.Ordinal))
                {
                    binding.DataFactories.Add(new TypedEntity
                    {
                        FullType = a1,
                        Assembly = a0,
                        LogicalName = a2,
                        Confidence = record.Confidence,
                        DeclaredOnType = declaringType,
                        InheritedFromType = inheritedFromType,
                        Evidence =
                        [
                            new EvidenceItem
                            {
                                Method = methodName,
                                Offset = record.Offset,
                                Assignment = $"new {ctorType}(\"{a0}\", \"{a1}\"" + (a2 != null ? $", \"{a2}\"" : "") + ")",
                            },
                        ],
                    });
                    if (!string.IsNullOrWhiteSpace(a2))
                    {
                        binding.DataSources.Add(new DataSourceEntity
                        {
                            Name = a2!,
                            Kind = "dataset_table",
                            RelatedDf = a1,
                            RelatedAssembly = a0,
                            Confidence = record.Confidence,
                            DeclaredOnType = declaringType,
                            InheritedFromType = inheritedFromType,
                        });
                    }
                }
                if (a1.Contains(".BO.", StringComparison.OrdinalIgnoreCase) || a1.EndsWith("BO", StringComparison.Ordinal))
                {
                    binding.BusinessObjects.Add(new TypedEntity
                    {
                        FullType = a1,
                        Assembly = a0,
                        LogicalName = a2,
                        Confidence = record.Confidence,
                        DeclaredOnType = declaringType,
                        InheritedFromType = inheritedFromType,
                        Evidence =
                        [
                            new EvidenceItem
                            {
                                Method = methodName,
                                Offset = record.Offset,
                                Assignment = $"new {ctorType}(\"{a0}\", \"{a1}\"" + (a2 != null ? $", \"{a2}\"" : "") + ")",
                            },
                        ],
                    });
                }
                if (a1.Contains(".Lvd", StringComparison.OrdinalIgnoreCase) || a1.Contains("Lov", StringComparison.OrdinalIgnoreCase) || a1.Contains(".Lvd", StringComparison.Ordinal))
                {
                    binding.Lookups.Add(new LookupEntity
                    {
                        PluginAssembly = a0,
                        LookupClass = a1,
                        Confidence = record.Confidence,
                        DeclaredOnType = declaringType,
                        Evidence =
                        [
                            new EvidenceItem
                            {
                                Method = methodName,
                                Offset = record.Offset,
                                Assignment = $"new {ctorType}(\"{a0}\", \"{a1}\")",
                            },
                        ],
                    });
                }

                binding.Relations.Add(new RelationEdge
                {
                    RelationType = "formType_descriptor",
                    From = declaringType,
                    To = a1,
                    Confidence = record.Confidence,
                    SourceMethod = methodName,
                    SourceOffsets = [record.Offset!],
                    Evidence = [$"ctor {ctorType} args"],
                });
            }
        }

        // DataGridColumnName("KOD", "RodzajeKoncesji", …)
        if (ctorType.Contains("DataGridColumnName", StringComparison.OrdinalIgnoreCase) && literals.Count >= 2)
        {
            var col = literals[0]?.ToString();
            var table = literals[1]?.ToString();
            if (!string.IsNullOrWhiteSpace(table))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = table!,
                    Kind = "dataset_table",
                    Confidence = record.Confidence,
                    DeclaredOnType = declaringType,
                    InheritedFromType = inheritedFromType,
                });
            }
            if (!string.IsNullOrWhiteSpace(col))
            {
                binding.Relations.Add(new RelationEdge
                {
                    RelationType = "column_dataset_table",
                    From = col!,
                    To = table ?? "",
                    Confidence = record.Confidence,
                    SourceMethod = methodName,
                    SourceOffsets = [record.Offset ?? ""],
                    Evidence = [$"new {ctorType}(\"{col}\", \"{table}\")"],
                });
            }
        }

        if (ctorType.Contains("DataSet", StringComparison.OrdinalIgnoreCase) && literals.Count >= 1)
        {
            var name = literals[0]?.ToString();
            if (!string.IsNullOrWhiteSpace(name) && !double.TryParse(name, out _))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = name!,
                    Kind = "dataset",
                    Confidence = record.Confidence,
                    DeclaredOnType = declaringType,
                    InheritedFromType = inheritedFromType,
                });
            }
        }

        if (ctorType.Contains("DesignModeColumn", StringComparison.OrdinalIgnoreCase) && literals.Count >= 3)
        {
            var table = literals[1]?.ToString();
            var column = literals[2]?.ToString();
            if (!string.IsNullOrWhiteSpace(table))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = table!,
                    Kind = "dataset_table",
                    Confidence = record.Confidence,
                    DeclaredOnType = declaringType,
                    InheritedFromType = inheritedFromType,
                });
            }
            if (!string.IsNullOrWhiteSpace(column))
            {
                binding.Relations.Add(new RelationEdge
                {
                    RelationType = "column_dataset_table",
                    From = column!,
                    To = table ?? "",
                    Confidence = "probable_from_local_sequence",
                    SourceMethod = methodName,
                    SourceOffsets = [record.Offset ?? ""],
                    Evidence = [$"new DesignModeColumn(..., \"{table}\", \"{column}\")"],
                });
            }
        }
        if (ctorType.Contains("DesignModeTable", StringComparison.OrdinalIgnoreCase) && literals.Count >= 2)
        {
            var table = literals[1]?.ToString();
            if (!string.IsNullOrWhiteSpace(table))
            {
                binding.DataSources.Add(new DataSourceEntity
                {
                    Name = table!,
                    Kind = "dataset_table",
                    Confidence = record.Confidence,
                    DeclaredOnType = declaringType,
                    InheritedFromType = inheritedFromType,
                });
            }
        }
    }

    private static string NormalizeAssemblyName(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        try
        {
            if (value.Contains('\\') || value.Contains('/'))
            {
                return Path.GetFileName(value);
            }
        }
        catch { /* ignore */ }
        return value;
    }

    private static void RecordDescriptorCall(
        FormTechnicalBinding binding,
        string memberName,
        string? declaringTypeOfMember,
        StackValue? instance,
        List<StackValue> args,
        string methodName,
        IlInstruction ins,
        string formType,
        string? inheritedFromType)
    {
        RecordConstructor(
            binding,
            declaringTypeOfMember ?? memberName,
            args,
            methodName,
            ins,
            formType,
            inheritedFromType);
    }

    private static bool LooksLikeDescriptorCall(List<StackValue> args)
    {
        if (args.Count < 2) return false;
        var a0 = args[0].AsLiteral()?.ToString() ?? "";
        return a0.EndsWith(".dll", StringComparison.OrdinalIgnoreCase);
    }

    private static void ClassifyBindingFromAssignment(
        FormTechnicalBinding binding,
        PropertyAssignment assignment,
        StackValue value)
    {
        if (assignment.Value == null) return;
        var prop = assignment.Property ?? "";
        var val = assignment.Value.ToString() ?? "";
        var control = assignment.Control;

        // Indexer / set_Item — never synthesize a UI control named Item.
        if (prop.Equals("Item", StringComparison.OrdinalIgnoreCase)
            || string.Equals(control, "Item", StringComparison.OrdinalIgnoreCase))
        {
            binding.DataOperations.Add(new DataOperation
            {
                OperationKind = "indexer_assignment",
                Target = control is null or "Item" ? "unresolved" : control,
                TargetType = assignment.ControlType,
                Key = val,
                Value = null,
                Method = assignment.Method,
                Offset = assignment.Offset,
                Confidence = "probable_from_local_sequence",
                Evidence = assignment.Evidence,
            });
            return;
        }

        if (control == null) return;

        if (prop.Equals("Format", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("FormatString", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("DisplayFormat", StringComparison.OrdinalIgnoreCase))
        {
            AddTypedBinding(binding, assignment, dataMember: null, datasetTable: null, format: val);
            return;
        }

        if (prop.Equals("ParameterName", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.ParameterName = val;
            cb.PropertyBindings ??= new Dictionary<string, object?>();
            cb.PropertyBindings["parameterName"] = val;
            SyncBindingBag(cb);
            binding.Relations.Add(new RelationEdge
            {
                RelationType = val.StartsWith("KP_UPR", StringComparison.OrdinalIgnoreCase)
                    ? "control_permission_parameter"
                    : "control_parameter",
                From = control,
                To = val,
                Confidence = "confirmed_from_il",
                SourceMethod = assignment.Method,
                SourceOffsets = [assignment.Offset ?? ""],
                Evidence = assignment.Evidence.Select(e => e.Assignment ?? "").ToList(),
            });
            return;
        }

        if (prop.Equals("DataMember", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("DataField", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("ColumnName", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("FieldName", StringComparison.OrdinalIgnoreCase))
        {
            AddTypedBinding(binding, assignment, dataMember: val, datasetTable: null, format: null);
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "control_column",
                From = control,
                To = val,
                Confidence = assignment.Confidence,
                SourceMethod = assignment.Method,
                SourceOffsets = [assignment.Offset ?? ""],
                Evidence = assignment.Evidence.Select(e => e.Assignment ?? "").ToList(),
            });
            return;
        }

        if (prop.Equals("IDColumn", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("KeyField", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.IdColumn = val;
            SyncBindingBag(cb);
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "tree_key_column",
                From = control,
                To = val,
                Confidence = assignment.Confidence,
                SourceMethod = assignment.Method,
                SourceOffsets = [assignment.Offset ?? ""],
            });
            return;
        }

        if (prop.Equals("ParentIDColumn", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("ParentField", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.ParentIdColumn = val;
            SyncBindingBag(cb);
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "tree_parent_column",
                From = control,
                To = val,
                Confidence = assignment.Confidence,
                SourceMethod = assignment.Method,
                SourceOffsets = [assignment.Offset ?? ""],
            });
            return;
        }

        if (prop.Equals("NameColumn", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.NameColumn = val;
            SyncBindingBag(cb);
            return;
        }

        if (prop.Equals("ValueColumn", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.ValueColumn = val;
            SyncBindingBag(cb);
            return;
        }

        if (prop.Equals("ValueMember", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.ValueMember = val;
            SyncBindingBag(cb);
            return;
        }

        if (prop.Equals("DisplayMember", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.DisplayMember = val;
            SyncBindingBag(cb);
            return;
        }

        if (prop.Equals("Filter", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("Where", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("Condition", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("Preselection", StringComparison.OrdinalIgnoreCase))
        {
            var cb = EnsureBinding(binding, assignment);
            cb.FilterExpression = val;
            SyncBindingBag(cb);
            binding.Filters.Add(new FilterEntity
            {
                Expression = val,
                Control = control,
                Confidence = assignment.Confidence,
                DeclaredOnType = assignment.DeclaredOnType,
                InheritedFromType = assignment.InheritedFromType,
                Evidence = assignment.Evidence,
            });
            return;
        }

        if (prop.Equals("TableName", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("DataSetName", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("ViewName", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("Alias", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("NazwaTabeliDataSet", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("DataSourceTableName", StringComparison.OrdinalIgnoreCase))
        {
            binding.DataSources.Add(new DataSourceEntity
            {
                Name = val,
                Kind = prop.Equals("ViewName", StringComparison.OrdinalIgnoreCase) ? "logical_view" : "dataset_table",
                RelatedControl = control,
                Confidence = assignment.Confidence,
                DeclaredOnType = assignment.DeclaredOnType,
                InheritedFromType = assignment.InheritedFromType,
            });
            AddTypedBinding(binding, assignment, dataMember: null, datasetTable: val, format: null);
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "control_dataset_table",
                From = control,
                To = val,
                Confidence = assignment.Confidence,
                SourceMethod = assignment.Method,
                SourceOffsets = [assignment.Offset ?? ""],
            });
            return;
        }

        if (prop.Equals("ShortAssemblyName", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("AssemblyName", StringComparison.OrdinalIgnoreCase)
            || prop.Equals("PluginAssembly", StringComparison.OrdinalIgnoreCase))
        {
            var asm = NormalizeAssemblyName(val);
            binding.Assemblies.Add(new AssemblyRef
            {
                Name = asm,
                Role = asm.StartsWith("bos", StringComparison.OrdinalIgnoreCase) ? "bos" :
                       asm.StartsWith("plg", StringComparison.OrdinalIgnoreCase) ? "plugin" : "other",
                Confidence = assignment.Confidence,
                Evidence = [$"{assignment.Method} @ {assignment.Offset}: {prop} = \"{asm}\""],
            });
            if (asm.StartsWith("bos", StringComparison.OrdinalIgnoreCase))
            {
                binding.Relations.Add(new RelationEdge
                {
                    RelationType = "formType_bos_DLL",
                    From = assignment.DeclaredOnType ?? "",
                    To = asm,
                    Confidence = assignment.Confidence,
                    SourceMethod = assignment.Method,
                    SourceOffsets = [assignment.Offset ?? ""],
                    Evidence = assignment.Evidence.Select(e => e.Assignment ?? "").ToList(),
                });
            }
            return;
        }

        // Remaining string assignments in Add*/Create* methods → dataOperations candidates, not dataMember.
        if (value.Kind == StackKind.String
            && assignment.Method != null
            && TargetMethodPrefix.IsMatch(assignment.Method)
            && !string.Equals(assignment.Method, "InitializeComponent", StringComparison.OrdinalIgnoreCase)
            && Regex.IsMatch(val, @"^[A-Za-z_][A-Za-z0-9_]*$"))
        {
            binding.DataOperations.Add(new DataOperation
            {
                OperationKind = "string_assignment",
                Target = control,
                TargetType = assignment.ControlType,
                Key = prop,
                Value = val,
                Method = assignment.Method,
                Offset = assignment.Offset,
                Confidence = "probable_from_local_sequence",
                Evidence = assignment.Evidence,
            });
        }
    }

    private static ControlBinding EnsureBinding(FormTechnicalBinding binding, PropertyAssignment assignment)
    {
        var existing = binding.Bindings.FirstOrDefault(b =>
            string.Equals(b.Control, assignment.Control, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            existing.Evidence.AddRange(assignment.Evidence);
            if (assignment.Confidence == "confirmed_from_il") existing.Confidence = "confirmed_from_il";
            return existing;
        }

        var cb = new ControlBinding
        {
            Control = assignment.Control,
            ControlType = assignment.ControlType,
            Confidence = assignment.Confidence,
            DeclaredOnType = assignment.DeclaredOnType,
            InheritedFromType = assignment.InheritedFromType,
            Evidence = [..assignment.Evidence],
        };
        binding.Bindings.Add(cb);
        return cb;
    }

    private static void AddTypedBinding(
        FormTechnicalBinding binding,
        PropertyAssignment assignment,
        string? dataMember,
        string? datasetTable,
        string? format)
    {
        var cb = EnsureBinding(binding, assignment);
        if (dataMember != null) SetOrAlternative(cb, "dataMember", dataMember, () => cb.DataMember, v => cb.DataMember = v, binding);
        if (datasetTable != null) SetOrAlternative(cb, "datasetTable", datasetTable, () => cb.DatasetTable, v => cb.DatasetTable = v, binding);
        if (format != null) SetOrAlternative(cb, "format", format, () => cb.Format, v => cb.Format = v, binding);
        SyncBindingBag(cb);
    }

    private static void SetOrAlternative(
        ControlBinding cb,
        string field,
        string value,
        Func<object?> getter,
        Action<object?> setter,
        FormTechnicalBinding form)
    {
        var current = getter();
        if (current == null)
        {
            setter(value);
            return;
        }
        if (Equals(current, value)) return;

        // Same field, different values in different code paths → alternatives, not array merge of Format+Column.
        cb.Alternatives ??= [];
        if (!cb.Alternatives.Contains(current)) cb.Alternatives.Add(current);
        if (!cb.Alternatives.Contains(value)) cb.Alternatives.Add(value);
        form.Conflicts.Add(new ConflictItem
        {
            Subject = $"{cb.Control}.{field}",
            Message = $"Multiple {field} values: {current} vs {value}",
            Confidence = "conflicting",
        });
    }

    private static void SyncBindingBag(ControlBinding cb)
    {
        cb.Binding = new Dictionary<string, object?>
        {
            ["dataMember"] = cb.DataMember,
            ["datasetTable"] = cb.DatasetTable,
            ["format"] = cb.Format,
            ["valueMember"] = cb.ValueMember,
            ["displayMember"] = cb.DisplayMember,
            ["parameterName"] = cb.ParameterName,
            ["filterExpression"] = cb.FilterExpression,
            ["idColumn"] = cb.IdColumn,
            ["parentIdColumn"] = cb.ParentIdColumn,
            ["nameColumn"] = cb.NameColumn,
            ["valueColumn"] = cb.ValueColumn,
        };
        // Drop nulls for compactness
        foreach (var key in cb.Binding.Keys.ToList())
        {
            if (cb.Binding[key] == null) cb.Binding.Remove(key);
        }
        if (cb.PropertyBindings != null)
        {
            foreach (var kv in cb.PropertyBindings)
                cb.Binding[kv.Key] = kv.Value;
        }
    }

    private static void UpsertControl(FormTechnicalBinding binding, FieldInfoLite field, string? inheritedFromType)
    {
        var existing = binding.Controls.FirstOrDefault(c => c.FieldName == field.Name);
        if (existing == null)
        {
            binding.Controls.Add(new ControlEntity
            {
                FieldName = field.Name,
                FieldType = field.TypeName,
                DeclaringType = field.DeclaringType,
                InheritedFromType = inheritedFromType,
                ControlKind = ClassifyControl(field.TypeName),
                Confidence = "confirmed_from_metadata",
                AssignedProperties = [],
                Evidence = [$"FieldDef {field.Name} : {field.TypeName}"],
            });
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "formType_control",
                From = field.DeclaringType,
                To = field.Name,
                Confidence = "confirmed_from_metadata",
                SourceMethod = null,
                SourceOffsets = [],
                Evidence = ["FieldDef"],
            });
        }
        else if (inheritedFromType != null && existing.InheritedFromType == null)
        {
            existing.InheritedFromType = inheritedFromType;
        }
    }

    private static void UpsertControlProperty(
        FormTechnicalBinding binding,
        string control,
        string? controlType,
        string property,
        object? value,
        string methodName,
        string? inheritedFromType)
    {
        var ctrl = binding.Controls.FirstOrDefault(c => c.FieldName == control);
        if (ctrl == null)
        {
            ctrl = new ControlEntity
            {
                FieldName = control,
                FieldType = controlType,
                ControlKind = ClassifyControl(controlType),
                Confidence = "confirmed_from_il",
                AssignedProperties = [],
                DeclaringType = null,
                InheritedFromType = inheritedFromType,
            };
            binding.Controls.Add(ctrl);
        }
        ctrl.AssignedProperties ??= [];
        ctrl.AssignedProperties.Add(new AssignedProperty
        {
            Property = property,
            Value = value,
            Method = methodName,
            Confidence = "confirmed_from_il",
        });
        if (controlType != null && ctrl.FieldType == null) ctrl.FieldType = controlType;
    }

    private static string ClassifyControl(string? typeName)
    {
        if (string.IsNullOrWhiteSpace(typeName)) return "other";
        var t = typeName;
        if (Regex.IsMatch(t, "ColumnStyle|GridColumn|DataGridColumn", RegexOptions.IgnoreCase)) return "grid_column";
        if (Regex.IsMatch(t, "DataGrid|GridControl|SumoDataGrid|grd", RegexOptions.IgnoreCase)) return "grid";
        if (Regex.IsMatch(t, "Tree|TreeView|SumoTree", RegexOptions.IgnoreCase)) return "tree";
        if (Regex.IsMatch(t, "TabControl|TabPage|SumoTab", RegexOptions.IgnoreCase)) return "tab";
        if (Regex.IsMatch(t, "GroupBox|Panel|Group", RegexOptions.IgnoreCase)) return "group";
        if (Regex.IsMatch(t, "CheckBox|CheckEdit", RegexOptions.IgnoreCase)) return "checkbox";
        if (Regex.IsMatch(t, "Combo|LookUpEdit|Lookup|Lov|Lvd", RegexOptions.IgnoreCase)) return "lookup";
        if (Regex.IsMatch(t, "Date|DateTime|ldtp", RegexOptions.IgnoreCase)) return "date";
        if (Regex.IsMatch(t, "Button|ToolStrip|Command|MenuItem", RegexOptions.IgnoreCase)) return "button";
        if (Regex.IsMatch(t, "Filter|gtf", RegexOptions.IgnoreCase)) return "filter";
        if (Regex.IsMatch(t, "TextBox|TextEdit|Label|ltxt|Spin", RegexOptions.IgnoreCase)) return "text";
        return "other";
    }

    private static void PostProcess(FormTechnicalBinding binding)
    {
        // Deduplicate entities by key
        binding.Assemblies = binding.Assemblies
            .GroupBy(a => a.Name ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        binding.DataFactories = binding.DataFactories
            .GroupBy(a => a.FullType ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        binding.BusinessObjects = binding.BusinessObjects
            .GroupBy(a => a.FullType ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        binding.DataSources = binding.DataSources
            .GroupBy(a => a.Name ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        binding.Lookups = binding.Lookups
            .GroupBy(a => (a.PluginAssembly ?? "") + "|" + (a.LookupClass ?? ""), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // Bindings already merged via EnsureBinding — just sync bag + drop Item leftovers
        binding.Bindings = binding.Bindings
            .Where(b => !string.Equals(b.Control, "Item", StringComparison.OrdinalIgnoreCase))
            .ToList();
        foreach (var cb in binding.Bindings) SyncBindingBag(cb);

        // Do NOT auto-link DF → datasourceTable (would invent datasource_DF).
        // Keep DF.LogicalName only when ctor provided an explicit table string.
        foreach (var ds in binding.DataSources)
        {
            ds.RelatedDf = null; // clear heuristic contamination; relations carry DF links
        }

        // Promote form-level relations for BO/DF/bos
        foreach (var bo in binding.BusinessObjects)
        {
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "formType_BO",
                From = binding.FormType ?? "",
                To = bo.FullType ?? "",
                Confidence = bo.Confidence,
                SourceMethod = bo.Evidence.FirstOrDefault()?.Method,
                SourceOffsets = bo.Evidence.Select(e => e.Offset ?? "").Where(x => x.Length > 0).ToList(),
            });
        }
        foreach (var df in binding.DataFactories)
        {
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "form_DF",
                From = binding.FormType ?? "",
                To = df.FullType ?? "",
                Confidence = df.Confidence,
                SourceMethod = df.Evidence.FirstOrDefault()?.Method,
                SourceOffsets = df.Evidence.Select(e => e.Offset ?? "").Where(x => x.Length > 0).ToList(),
            });
            // If DF ctor had explicit logical table name → confirmed datasource_DF
            if (!string.IsNullOrWhiteSpace(df.LogicalName) && df.LogicalName != "0")
            {
                binding.Relations.Add(new RelationEdge
                {
                    RelationType = "datasource_DF",
                    From = df.LogicalName!,
                    To = df.FullType ?? "",
                    Confidence = "confirmed_from_il",
                    SourceMethod = df.Evidence.FirstOrDefault()?.Method,
                    SourceOffsets = df.Evidence.Select(e => e.Offset ?? "").Where(x => x.Length > 0).ToList(),
                    Evidence = ["DF ctor logicalName"],
                });
                var ds = binding.DataSources.FirstOrDefault(d =>
                    string.Equals(d.Name, df.LogicalName, StringComparison.OrdinalIgnoreCase));
                if (ds != null)
                {
                    ds.RelatedDf = df.FullType;
                    ds.RelatedAssembly = df.Assembly;
                }
            }
        }
        foreach (var asm in binding.Assemblies.Where(a => a.Role == "bos"))
        {
            binding.Relations.Add(new RelationEdge
            {
                RelationType = "formType_bos_DLL",
                From = binding.FormType ?? "",
                To = asm.Name ?? "",
                Confidence = asm.Confidence,
            });
        }

        CategorizeFields(binding);
    }

    private static readonly Regex UiTypeHint = new(
        @"Control|Grid|TextBox|TextEdit|Date|CheckBox|Combo|LookUp|Lookup|ListOfValues|Tree|Tab|Group|Button|ToolBar|ToolStrip|ColumnStyle|Filter|Label|Spin|Panel|gtf|Sumo|DevExpress|Windows\.Forms",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex NonUiType = new(
        @"^(System\.)?(String|Boolean|Int\d+|UInt\d+|Byte|Decimal|Double|Single|Object|DataSet|DataTable|DataRow|DataColumn|IBusinessObject|OperationResult|IContainer|Guid|DateTime|Type)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static void CategorizeFields(FormTechnicalBinding binding)
    {
        var usedAsControl = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in binding.PropertyAssignments)
        {
            if (!string.IsNullOrEmpty(a.Control) && !string.Equals(a.Control, "Item", StringComparison.OrdinalIgnoreCase))
                usedAsControl.Add(a.Control!);
        }
        foreach (var b in binding.Bindings)
        {
            if (!string.IsNullOrEmpty(b.Control)) usedAsControl.Add(b.Control!);
        }

        binding.UiControls = [];
        binding.DataObjects = [];
        binding.BusinessObjectFields = [];
        binding.Constants = [];
        binding.TechnicalFields = [];
        binding.SyntheticTargets = [];

        foreach (var c in binding.Controls)
        {
            var name = c.FieldName ?? "";
            var type = c.FieldType ?? "";
            var simple = type.Split('.', '<')[^1];

            if (string.IsNullOrEmpty(name) || name.Equals("Item", StringComparison.OrdinalIgnoreCase))
            {
                binding.SyntheticTargets.Add(c);
                continue;
            }

            if (NonUiType.IsMatch(simple) || NonUiType.IsMatch(type))
            {
                if (Regex.IsMatch(type, @"DataSet|DataTable|DataRow", RegexOptions.IgnoreCase))
                    binding.DataObjects.Add(c);
                else if (Regex.IsMatch(type, @"IBusinessObject|\.BO\.|BusinessObject", RegexOptions.IgnoreCase)
                         || name.Equals("m_BO", StringComparison.OrdinalIgnoreCase))
                    binding.BusinessObjectFields.Add(c);
                else if (Regex.IsMatch(name, @"^[A-Z][A-Z0-9_]*$"))
                    binding.Constants.Add(c);
                else
                    binding.TechnicalFields.Add(c);
                continue;
            }

            if (Regex.IsMatch(type, @"DataSet|DataTable", RegexOptions.IgnoreCase))
            {
                binding.DataObjects.Add(c);
                continue;
            }

            if (Regex.IsMatch(type, @"IBusinessObject|\.BO\.", RegexOptions.IgnoreCase)
                || name.Equals("m_BO", StringComparison.OrdinalIgnoreCase))
            {
                binding.BusinessObjectFields.Add(c);
                continue;
            }

            var looksUi = UiTypeHint.IsMatch(type)
                || string.Equals(c.CreatedInMethod, "InitializeComponent", StringComparison.OrdinalIgnoreCase)
                || usedAsControl.Contains(name);

            if (looksUi)
            {
                // m_* without UI type hint → technical
                if (name.StartsWith("m_", StringComparison.Ordinal) && !UiTypeHint.IsMatch(type))
                    binding.TechnicalFields.Add(c);
                else
                    binding.UiControls.Add(c);
                continue;
            }

            if (Regex.IsMatch(name, @"^[A-Z][A-Z0-9_]*$"))
                binding.Constants.Add(c);
            else
                binding.TechnicalFields.Add(c);
        }

        // controls = ui only (deprecated alias)
        binding.Controls = binding.UiControls;
    }

    private static string? ResolveControlName(StackValue? instance)
    {
        if (instance == null) return null;
        if (instance.Kind == StackKind.Field) return instance.FieldName;
        if (instance.Kind == StackKind.PropertyGet && instance.Owner?.Kind == StackKind.Field)
            return instance.Owner.FieldName;
        return instance.FieldName;
    }

    private static string? ResolveControlType(
        string? control,
        StackValue? instance,
        Dictionary<string, FieldInfoLite> fields)
    {
        if (control != null && fields.TryGetValue(control, out var f)) return f.TypeName;
        return instance?.TypeName;
    }

    private static string FormatLiteral(StackValue v) =>
        v.Kind switch
        {
            StackKind.String => $"\"{v.StringValue}\"",
            StackKind.Number => v.NumberValue?.ToString() ?? "0",
            StackKind.Null => "null",
            StackKind.Constructed => $"new {v.TypeName}(...)",
            _ => v.Label ?? "?",
        };

    private static string ToCamel(string name) =>
        string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name[1..];

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

    private static string BuildTypeName(MetadataReader mr, TypeDefinition td)
    {
        var ns = mr.GetString(td.Namespace);
        var name = mr.GetString(td.Name);
        return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
    }

    private static string? ResolveTypeRefName(MetadataReader mr, TypeReferenceHandle handle)
    {
        var tr = mr.GetTypeReference(handle);
        var ns = mr.GetString(tr.Namespace);
        var name = mr.GetString(tr.Name);
        return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
    }

    private sealed class FieldInfoLite
    {
        public string Name { get; set; } = "";
        public string? TypeName { get; set; }
        public string DeclaringType { get; set; } = "";
        public FieldDefinitionHandle Handle { get; set; }
    }
}

internal sealed class SimpleTypeProvider : ISignatureTypeProvider<string, object?>
{
    private readonly MetadataReader _mr;
    public SimpleTypeProvider(MetadataReader mr) => _mr = mr;

    public string GetArrayType(string elementType, ArrayShape shape) => elementType + "[]";
    public string GetByReferenceType(string elementType) => elementType + "&";
    public string GetFunctionPointerType(MethodSignature<string> signature) => "fnptr";
    public string GetGenericInstantiation(string genericType, ImmutableArray<string> typeArguments) =>
        genericType + "<" + string.Join(",", typeArguments) + ">";
    public string GetGenericMethodParameter(object? genericContext, int index) => "!!" + index;
    public string GetGenericTypeParameter(object? genericContext, int index) => "!" + index;
    public string GetModifiedType(string modifier, string unmodifiedType, bool isRequired) => unmodifiedType;
    public string GetPinnedType(string elementType) => elementType;
    public string GetPointerType(string elementType) => elementType + "*";
    public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode.ToString();
    public string GetSZArrayType(string elementType) => elementType + "[]";
    public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind)
    {
        var td = reader.GetTypeDefinition(handle);
        var ns = reader.GetString(td.Namespace);
        var name = reader.GetString(td.Name);
        return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
    }
    public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind)
    {
        var tr = reader.GetTypeReference(handle);
        var ns = reader.GetString(tr.Namespace);
        var name = reader.GetString(tr.Name);
        return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
    }
    public string GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind)
        => "TypeSpec";
}
