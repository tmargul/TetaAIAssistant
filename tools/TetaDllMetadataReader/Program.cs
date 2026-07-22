using System.Collections.Immutable;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace TetaDllMetadataReader;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static int Main(string[] args)
    {
        try
        {
            if (args.Contains("--batch-stdin", StringComparer.OrdinalIgnoreCase))
            {
                var input = Console.In.ReadToEnd();
                var requests = JsonSerializer.Deserialize<List<DllRequest>>(input, JsonOpts) ?? [];
                var results = requests.Select(ReadDll).ToList();
                Console.Out.Write(JsonSerializer.Serialize(results, JsonOpts));
                return 0;
            }

            string? dll = null;
            var matches = new List<string>();
            var noTypeIndex = false;
            for (var i = 0; i < args.Length; i++)
            {
                if (args[i] is "--dll" && i + 1 < args.Length) dll = args[++i];
                else if (args[i] is "--match" && i + 1 < args.Length)
                {
                    matches.AddRange(args[++i].Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                }
                else if (args[i] is "--no-type-index") noTypeIndex = true;
            }

            if (string.IsNullOrWhiteSpace(dll))
            {
                Console.Error.WriteLine("Usage: TetaDllMetadataReader --dll <path> [--match FQN1;FQN2] [--no-type-index]");
                Console.Error.WriteLine("   or: TetaDllMetadataReader --batch-stdin < requests.json");
                return 2;
            }

            var result = ReadDll(new DllRequest { DllPath = dll, Match = matches, NoTypeIndex = noTypeIndex });
            Console.Out.Write(JsonSerializer.Serialize(result, JsonOpts));
            return result.Ok ? 0 : 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            return 1;
        }
    }

    private static DllResult ReadDll(DllRequest request)
    {
        var path = request.DllPath?.Trim() ?? "";
        var result = new DllResult { DllPath = path };
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            result.Ok = false;
            result.Error = "dll_missing";
            return result;
        }

        try
        {
            using var stream = File.OpenRead(path);
            using var pe = new PEReader(stream, PEStreamOptions.PrefetchEntireImage);
            if (!pe.HasMetadata)
            {
                result.Ok = false;
                result.Error = "no_cli_metadata";
                return result;
            }

            var mr = pe.GetMetadataReader();
            var provider = new AttrProvider(mr);
            var sigProvider = new SigProvider(mr);
            var typeIndex = BuildTypeIndex(mr, provider);
            result.TypeCount = typeIndex.Count;
            if (request.NoTypeIndex != true)
            {
                result.Types = typeIndex.Select(t => t.ToCompact()).ToList();
            }
            result.Resources = ReadResources(mr);
            result.XmlDocPath = FindXmlDocumentation(path);
            Dictionary<string, string>? xmlMembers = null;
            if (result.XmlDocPath != null)
            {
                xmlMembers = LoadXmlDocMembers(result.XmlDocPath);
                result.XmlDocMemberCount = xmlMembers.Count;
            }

            var matchSet = (request.Match ?? [])
                .Where(m => !string.IsNullOrWhiteSpace(m))
                .Select(m => m.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToList();

            result.MatchedTypes = [];
            foreach (var wanted in matchSet)
            {
                var match = MatchType(typeIndex, wanted);
                if (match.Status is "not_found" or "ambiguous_simple_name")
                {
                    result.MatchedTypes.Add(new MatchedTypeResult
                    {
                        RequestedClassName = wanted,
                        ClassVerificationStatus = match.Status,
                        AmbiguousCandidates = match.Ambiguous,
                    });
                    continue;
                }

                var detailed = EnrichType(pe, mr, provider, sigProvider, match.Type!, xmlMembers);
                detailed.RequestedClassName = wanted;
                detailed.ClassVerificationStatus = match.Status;
                result.MatchedTypes.Add(detailed);
            }

            // Global plugin attribute stats from compact scan
            result.PluginAttributeTypeCount = typeIndex.Count(t =>
                t.AttributeTypeNames.Any(a => a.Contains("PluginAttribute", StringComparison.OrdinalIgnoreCase)
                    || a.Equals("Plugin", StringComparison.OrdinalIgnoreCase)));
            result.PluginGroupAttributeTypeCount = typeIndex.Count(t =>
                t.AttributeTypeNames.Any(a => a.Contains("PluginGroup", StringComparison.OrdinalIgnoreCase)));

            result.Ok = true;
            return result;
        }
        catch (Exception ex)
        {
            result.Ok = false;
            result.Error = "assembly_unreadable";
            result.ErrorDetail = ex.Message;
            return result;
        }
    }

    private static List<TypeInfo> BuildTypeIndex(MetadataReader mr, AttrProvider provider)
    {
        var list = new List<TypeInfo>();
        foreach (var handle in mr.TypeDefinitions)
        {
            var td = mr.GetTypeDefinition(handle);
            var name = mr.GetString(td.Name);
            if (name is "<Module>") continue;

            var ns = mr.GetString(td.Namespace);
            var declaring = ResolveDeclaringTypeName(mr, td);
            var fullName = BuildFullName(ns, name, declaring);
            var normalized = NormalizeTypeName(fullName);

            var attrNames = new List<string>();
            foreach (var cah in td.GetCustomAttributes())
            {
                attrNames.Add(GetAttributeTypeName(mr, cah));
            }

            string? baseType = null;
            var baseRes = "none";
            if (!td.BaseType.IsNil)
            {
                baseType = ResolveEntityName(mr, td.BaseType);
                baseRes = td.BaseType.Kind == HandleKind.TypeDefinition ? "resolved" : "unresolved_ref";
            }

            var interfaces = new List<string>();
            foreach (var iface in td.GetInterfaceImplementations())
            {
                var impl = mr.GetInterfaceImplementation(iface);
                var iname = ResolveEntityName(mr, impl.Interface);
                if (!string.IsNullOrEmpty(iname)) interfaces.Add(iname);
            }

            var visibility = GetVisibility(td.Attributes);
            var isNested = (td.Attributes & TypeAttributes.VisibilityMask) >= TypeAttributes.NestedPublic
                || (td.Attributes & TypeAttributes.VisibilityMask) == TypeAttributes.NestedPrivate
                || declaring != null;
            list.Add(new TypeInfo
            {
                Handle = handle,
                Namespace = ns,
                Name = name,
                FullName = fullName,
                NormalizedFullName = normalized,
                DeclaringType = declaring,
                BaseType = baseType,
                BaseTypeResolution = baseRes,
                Interfaces = interfaces,
                Visibility = visibility,
                IsAbstract = (td.Attributes & TypeAttributes.Abstract) != 0,
                IsSealed = (td.Attributes & TypeAttributes.Sealed) != 0,
                IsNested = isNested,
                AttributeTypeNames = attrNames,
            });
        }
        return list;
    }

    private static MatchOutcome MatchType(List<TypeInfo> types, string wanted)
    {
        var exact = types.Where(t => t.FullName == wanted).ToList();
        if (exact.Count == 1)
            return new MatchOutcome { Status = "verified_exact", Type = exact[0] };

        var normWanted = NormalizeTypeName(wanted);
        var byNorm = types.Where(t => t.NormalizedFullName == normWanted).ToList();
        if (byNorm.Count == 1)
            return new MatchOutcome { Status = "verified_normalized", Type = byNorm[0] };

        var byCi = types.Where(t => string.Equals(t.NormalizedFullName, normWanted, StringComparison.OrdinalIgnoreCase)).ToList();
        if (byCi.Count == 1)
            return new MatchOutcome { Status = "verified_case_insensitive", Type = byCi[0] };

        var simple = wanted.Contains('.') || wanted.Contains('+')
            ? wanted.Split('.', '+').Last()
            : wanted;
        var bySimple = types.Where(t => t.Name == simple).ToList();
        if (bySimple.Count == 1)
            return new MatchOutcome { Status = "matched_unique_simple_name", Type = bySimple[0] };
        if (bySimple.Count > 1)
            return new MatchOutcome
            {
                Status = "ambiguous_simple_name",
                Ambiguous = bySimple.Select(t => t.FullName).Take(20).ToList(),
            };

        return new MatchOutcome { Status = "not_found" };
    }

    private static MatchedTypeResult EnrichType(
        PEReader pe,
        MetadataReader mr,
        AttrProvider attrProvider,
        SigProvider sigProvider,
        TypeInfo type,
        Dictionary<string, string>? xmlMembers)
    {
        var td = mr.GetTypeDefinition(type.Handle);
        var attributes = new List<AttributeInfo>();
        foreach (var cah in td.GetCustomAttributes())
        {
            attributes.Add(DecodeAttribute(mr, attrProvider, cah));
        }

        var members = new List<MemberInfo>();
        foreach (var fh in td.GetFields())
        {
            var field = mr.GetFieldDefinition(fh);
            var fname = mr.GetString(field.Name);
            object? literal = null;
            if ((field.Attributes & FieldAttributes.HasDefault) != 0)
            {
                try
                {
                    var constant = mr.GetConstant(field.GetDefaultValue());
                    literal = ReadConstant(mr, constant);
                }
                catch { /* ignore */ }
            }

            string? fieldType = null;
            try
            {
                var sig = field.DecodeSignature(sigProvider, null);
                fieldType = sig.Name;
            }
            catch { /* ignore */ }

            members.Add(new MemberInfo
            {
                MemberKind = "field",
                Name = fname,
                DeclaringType = type.FullName,
                TypeName = fieldType,
                LiteralValue = literal?.ToString(),
                IsInterestingName = IsInterestingMemberName(fname),
            });
        }

        foreach (var ph in td.GetProperties())
        {
            var prop = mr.GetPropertyDefinition(ph);
            var pname = mr.GetString(prop.Name);
            var accessorsList = new List<string>();
            var accessorsHandle = prop.GetAccessors();
            if (!accessorsHandle.Getter.IsNil) accessorsList.Add("get_" + pname);
            if (!accessorsHandle.Setter.IsNil) accessorsList.Add("set_" + pname);
            var accessors = accessorsList.Count > 0 ? string.Join(",", accessorsList) : null;

            members.Add(new MemberInfo
            {
                MemberKind = "property",
                Name = pname,
                DeclaringType = type.FullName,
                Accessors = accessors,
                IsInterestingName = IsInterestingMemberName(pname),
            });
        }

        var ilCandidates = ExtractLdstrForType(pe, mr, td, type.FullName);

        string? xmlDoc = null;
        if (xmlMembers != null)
        {
            var key = "T:" + type.FullName.Replace('+', '.');
            xmlMembers.TryGetValue(key, out xmlDoc);
        }

        return new MatchedTypeResult
        {
            Namespace = type.Namespace,
            Name = type.Name,
            FullName = type.FullName,
            NormalizedFullName = type.NormalizedFullName,
            DeclaringType = type.DeclaringType,
            BaseType = type.BaseType,
            BaseTypeResolution = type.BaseTypeResolution,
            Interfaces = type.Interfaces,
            Visibility = type.Visibility,
            IsAbstract = type.IsAbstract,
            IsSealed = type.IsSealed,
            IsNested = type.IsNested,
            Attributes = attributes,
            Members = members,
            IlStringCandidates = ilCandidates,
            XmlDocumentation = xmlDoc,
            HasXmlDocumentation = xmlDoc != null,
        };
    }

    private static List<IlStringCandidate> ExtractLdstrForType(
        PEReader pe,
        MetadataReader mr,
        TypeDefinition td,
        string declaringType)
    {
        var list = new List<IlStringCandidate>();
        foreach (var mh in td.GetMethods())
        {
            var method = mr.GetMethodDefinition(mh);
            var methodName = mr.GetString(method.Name);
            if (method.RelativeVirtualAddress == 0) continue;
            try
            {
                var body = pe.GetMethodBody(method.RelativeVirtualAddress);
                var il = body.GetILContent().ToArray();
                for (var i = 0; i < il.Length; i++)
                {
                    // ldstr = 0x72, followed by 4-byte metadata token
                    if (il[i] != 0x72 || i + 4 >= il.Length) continue;
                    var token = BitConverter.ToInt32(il, i + 1);
                    i += 4;
                    try
                    {
                        var handle = MetadataTokens.Handle(token);
                        if (handle.Kind != HandleKind.UserString) continue;
                        var value = mr.GetUserString((UserStringHandle)handle);
                        list.Add(new IlStringCandidate
                        {
                            MethodName = methodName,
                            DeclaringType = declaringType,
                            StringValue = value,
                            IsInteresting = IsInterestingIlString(value),
                        });
                        // Cap per-type IL dump for batch size
                        if (list.Count >= 200) return list;
                    }
                    catch
                    {
                        // ignore bad tokens
                    }
                }
            }
            catch
            {
                // ignore methods without readable body
            }
        }
        return list;
    }

    private static AttributeInfo DecodeAttribute(MetadataReader mr, AttrProvider provider, CustomAttributeHandle cah)
    {
        var ca = mr.GetCustomAttribute(cah);
        var typeName = GetAttributeTypeName(mr, cah);
        var shortName = typeName.Contains('.') ? typeName.Split('.').Last() : typeName;
        if (shortName.EndsWith("Attribute", StringComparison.Ordinal))
            shortName = shortName[..^"Attribute".Length];

        var ctorArgs = new List<object?>();
        var named = new Dictionary<string, object?>();
        try
        {
            var value = ca.DecodeValue(provider);
            foreach (var arg in value.FixedArguments)
                ctorArgs.Add(NormalizeAttrValue(arg.Value));
            foreach (var arg in value.NamedArguments)
                named[arg.Name ?? ""] = NormalizeAttrValue(arg.Value);
        }
        catch
        {
            // keep type name only
        }

        return new AttributeInfo
        {
            AttributeType = typeName,
            AttributeShortName = shortName,
            ConstructorArguments = ctorArgs,
            NamedArguments = named,
        };
    }

    private static object? NormalizeAttrValue(object? value)
    {
        if (value is null) return null;
        if (value is string or bool or int or long or float or double or byte or short or uint or ulong)
            return value;
        if (value is ImmutableArray<CustomAttributeTypedArgument<string>> arr)
            return arr.Select(a => NormalizeAttrValue(a.Value)).ToList();
        return value.ToString();
    }

    private static List<ResourceInfo> ReadResources(MetadataReader mr)
    {
        var list = new List<ResourceInfo>();
        foreach (var rh in mr.ManifestResources)
        {
            var res = mr.GetManifestResource(rh);
            var name = mr.GetString(res.Name);
            list.Add(new ResourceInfo
            {
                Name = name,
                IsPublic = (res.Attributes & ManifestResourceAttributes.Public) != 0,
                LooksLikeFormResource = name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase)
                    || name.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("Widok", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("Form", StringComparison.OrdinalIgnoreCase),
            });
        }
        return list;
    }

    private static string? FindXmlDocumentation(string dllPath)
    {
        var xml = Path.ChangeExtension(dllPath, ".xml");
        if (File.Exists(xml)) return xml;
        var dir = Path.GetDirectoryName(dllPath);
        if (dir == null) return null;
        var name = Path.GetFileNameWithoutExtension(dllPath) + ".xml";
        var alt = Path.Combine(dir, name);
        return File.Exists(alt) ? alt : null;
    }

    private static Dictionary<string, string> LoadXmlDocMembers(string xmlPath)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            var doc = XDocument.Load(xmlPath);
            foreach (var member in doc.Descendants("member"))
            {
                var name = (string?)member.Attribute("name");
                if (string.IsNullOrEmpty(name)) continue;
                var summary = (string?)member.Element("summary");
                var remarks = (string?)member.Element("remarks");
                var text = string.Join("\n", new[] { summary, remarks }.Where(s => !string.IsNullOrWhiteSpace(s)));
                if (!string.IsNullOrWhiteSpace(text))
                    map[name] = Regex.Replace(text.Trim(), @"\s+", " ");
            }
        }
        catch
        {
            // ignore malformed xml
        }
        return map;
    }

    private static string GetAttributeTypeName(MetadataReader mr, CustomAttributeHandle cah)
    {
        var ca = mr.GetCustomAttribute(cah);
        var ctor = ca.Constructor;
        if (ctor.Kind == HandleKind.MemberReference)
        {
            var mem = mr.GetMemberReference((MemberReferenceHandle)ctor);
            return ResolveEntityName(mr, mem.Parent) ?? "UnknownAttribute";
        }
        if (ctor.Kind == HandleKind.MethodDefinition)
        {
            var md = mr.GetMethodDefinition((MethodDefinitionHandle)ctor);
            var td = mr.GetTypeDefinition(md.GetDeclaringType());
            return BuildFullName(mr.GetString(td.Namespace), mr.GetString(td.Name), null);
        }
        return "UnknownAttribute";
    }

    private static string? ResolveDeclaringTypeName(MetadataReader mr, TypeDefinition td)
    {
        var vis = td.Attributes & TypeAttributes.VisibilityMask;
        var nested = vis is TypeAttributes.NestedPublic or TypeAttributes.NestedPrivate
            or TypeAttributes.NestedFamily or TypeAttributes.NestedAssembly
            or TypeAttributes.NestedFamANDAssem or TypeAttributes.NestedFamORAssem;
        if (!nested) return null;
        try
        {
            var declaring = td.GetDeclaringType();
            if (declaring.IsNil) return null;
            var outer = mr.GetTypeDefinition(declaring);
            var ns = mr.GetString(outer.Namespace);
            var name = mr.GetString(outer.Name);
            var outerDeclaring = ResolveDeclaringTypeName(mr, outer);
            return BuildFullName(ns, name, outerDeclaring);
        }
        catch
        {
            return null;
        }
    }

    private static string BuildFullName(string ns, string name, string? declaring)
    {
        if (declaring != null)
            return declaring + "+" + name;
        return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
    }

    private static string NormalizeTypeName(string name) =>
        name.Trim().Replace('+', '.');

    private static string? ResolveEntityName(MetadataReader mr, EntityHandle handle)
    {
        switch (handle.Kind)
        {
            case HandleKind.TypeDefinition:
            {
                var td = mr.GetTypeDefinition((TypeDefinitionHandle)handle);
                var declaring = ResolveDeclaringTypeName(mr, td);
                return BuildFullName(mr.GetString(td.Namespace), mr.GetString(td.Name), declaring);
            }
            case HandleKind.TypeReference:
            {
                var tr = mr.GetTypeReference((TypeReferenceHandle)handle);
                var ns = mr.GetString(tr.Namespace);
                var name = mr.GetString(tr.Name);
                return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
            }
            case HandleKind.TypeSpecification:
                return "TypeSpec";
            default:
                return null;
        }
    }

    private static string GetVisibility(TypeAttributes attrs)
    {
        var vis = attrs & TypeAttributes.VisibilityMask;
        return vis switch
        {
            TypeAttributes.Public => "public",
            TypeAttributes.NotPublic => "not_public",
            TypeAttributes.NestedPublic => "nested_public",
            TypeAttributes.NestedPrivate => "nested_private",
            TypeAttributes.NestedFamily => "nested_family",
            TypeAttributes.NestedAssembly => "nested_assembly",
            TypeAttributes.NestedFamANDAssem => "nested_fam_and_assem",
            TypeAttributes.NestedFamORAssem => "nested_fam_or_assem",
            _ => "unknown",
        };
    }

    private static object? ReadConstant(MetadataReader mr, Constant constant)
    {
        var blob = mr.GetBlobReader(constant.Value);
        return constant.TypeCode switch
        {
            ConstantTypeCode.Boolean => blob.ReadBoolean(),
            ConstantTypeCode.Char => blob.ReadChar(),
            ConstantTypeCode.SByte => blob.ReadSByte(),
            ConstantTypeCode.Byte => blob.ReadByte(),
            ConstantTypeCode.Int16 => blob.ReadInt16(),
            ConstantTypeCode.UInt16 => blob.ReadUInt16(),
            ConstantTypeCode.Int32 => blob.ReadInt32(),
            ConstantTypeCode.UInt32 => blob.ReadUInt32(),
            ConstantTypeCode.Int64 => blob.ReadInt64(),
            ConstantTypeCode.UInt64 => blob.ReadUInt64(),
            ConstantTypeCode.Single => blob.ReadSingle(),
            ConstantTypeCode.Double => blob.ReadDouble(),
            ConstantTypeCode.String => blob.ReadUTF16(blob.RemainingBytes / 2),
            ConstantTypeCode.NullReference => null,
            _ => null,
        };
    }

    private static string TypeNameFromDecoded(TypeNameOrSig sig) => sig.Name;

    private static bool IsInterestingMemberName(string name)
    {
        string[] keys =
        [
            "NazwaTabeliDataSet", "Perspektywa", "PakietDAC", "TabelaBO", "Alias",
            "DataSource", "Gateway", "View", "Table", "Package",
        ];
        return keys.Any(k => name.Contains(k, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsInterestingIlString(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 200) return false;
        if (Regex.IsMatch(value, @"^(SL_|L_|T_|NT_|PA_|PK_|AKT_DATE_)")) return true;
        if (value.EndsWith("_DAC", StringComparison.OrdinalIgnoreCase)) return true;
        if (Regex.IsMatch(value, @"DataSet|Perspektywa|Tabela|Pakiet|Alias|Gateway", RegexOptions.IgnoreCase))
            return true;
        if (Regex.IsMatch(value, @"^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$")) return true;
        return false;
    }

    // ---- models ----

    private sealed class DllRequest
    {
        public string? DllPath { get; set; }
        public List<string>? Match { get; set; }
        public bool? NoTypeIndex { get; set; }
    }

    private sealed class DllResult
    {
        public string DllPath { get; set; } = "";
        public bool Ok { get; set; }
        public string? Error { get; set; }
        public string? ErrorDetail { get; set; }
        public int TypeCount { get; set; }
        public List<CompactType>? Types { get; set; }
        public List<MatchedTypeResult>? MatchedTypes { get; set; }
        public List<ResourceInfo>? Resources { get; set; }
        public string? XmlDocPath { get; set; }
        public int XmlDocMemberCount { get; set; }
        public int PluginAttributeTypeCount { get; set; }
        public int PluginGroupAttributeTypeCount { get; set; }
    }

    private sealed class CompactType
    {
        public string? Namespace { get; set; }
        public string Name { get; set; } = "";
        public string FullName { get; set; } = "";
        public string NormalizedFullName { get; set; } = "";
        public string? DeclaringType { get; set; }
        public string? BaseType { get; set; }
        public List<string>? AttributeTypeNames { get; set; }
    }

    private sealed class MatchedTypeResult
    {
        public string? RequestedClassName { get; set; }
        public string? ClassVerificationStatus { get; set; }
        public List<string>? AmbiguousCandidates { get; set; }
        public string? Namespace { get; set; }
        public string? Name { get; set; }
        public string? FullName { get; set; }
        public string? NormalizedFullName { get; set; }
        public string? DeclaringType { get; set; }
        public string? BaseType { get; set; }
        public string? BaseTypeResolution { get; set; }
        public List<string>? Interfaces { get; set; }
        public string? Visibility { get; set; }
        public bool IsAbstract { get; set; }
        public bool IsSealed { get; set; }
        public bool IsNested { get; set; }
        public List<AttributeInfo>? Attributes { get; set; }
        public List<MemberInfo>? Members { get; set; }
        public List<IlStringCandidate>? IlStringCandidates { get; set; }
        public string? XmlDocumentation { get; set; }
        public bool HasXmlDocumentation { get; set; }
    }

    private sealed class AttributeInfo
    {
        public string AttributeType { get; set; } = "";
        public string AttributeShortName { get; set; } = "";
        public List<object?> ConstructorArguments { get; set; } = [];
        public Dictionary<string, object?> NamedArguments { get; set; } = new();
    }

    private sealed class MemberInfo
    {
        public string MemberKind { get; set; } = "";
        public string Name { get; set; } = "";
        public string? DeclaringType { get; set; }
        public string? TypeName { get; set; }
        public string? LiteralValue { get; set; }
        public string? Accessors { get; set; }
        public bool IsInterestingName { get; set; }
    }

    private sealed class IlStringCandidate
    {
        public string MethodName { get; set; } = "";
        public string DeclaringType { get; set; } = "";
        public string StringValue { get; set; } = "";
        public bool IsInteresting { get; set; }
    }

    private sealed class ResourceInfo
    {
        public string Name { get; set; } = "";
        public bool IsPublic { get; set; }
        public bool LooksLikeFormResource { get; set; }
    }

    private sealed class TypeInfo
    {
        public TypeDefinitionHandle Handle { get; set; }
        public string Namespace { get; set; } = "";
        public string Name { get; set; } = "";
        public string FullName { get; set; } = "";
        public string NormalizedFullName { get; set; } = "";
        public string? DeclaringType { get; set; }
        public string? BaseType { get; set; }
        public string BaseTypeResolution { get; set; } = "none";
        public List<string> Interfaces { get; set; } = [];
        public string Visibility { get; set; } = "";
        public bool IsAbstract { get; set; }
        public bool IsSealed { get; set; }
        public bool IsNested { get; set; }
        public List<string> AttributeTypeNames { get; set; } = [];

        public CompactType ToCompact() => new()
        {
            Namespace = Namespace,
            Name = Name,
            FullName = FullName,
            NormalizedFullName = NormalizedFullName,
            DeclaringType = DeclaringType,
            BaseType = BaseType,
            AttributeTypeNames = AttributeTypeNames,
        };
    }

    private sealed class MatchOutcome
    {
        public string Status { get; set; } = "not_found";
        public TypeInfo? Type { get; set; }
        public List<string>? Ambiguous { get; set; }
    }

    private readonly record struct TypeNameOrSig(string Name);

    private sealed class AttrProvider : ICustomAttributeTypeProvider<string>
    {
        private readonly MetadataReader _mr;
        public AttrProvider(MetadataReader mr) => _mr = mr;

        public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode.ToString();
        public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) =>
            ResolveEntityName(reader, handle) ?? "?";
        public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) =>
            ResolveEntityName(reader, handle) ?? "?";
        public string GetSZArrayType(string elementType) => elementType + "[]";
        public string GetSystemType() => "System.Type";
        public bool IsSystemType(string type) => type is "System.Type" or "Type";
        public string GetTypeFromSerializedName(string name) => name;
        public PrimitiveTypeCode GetUnderlyingEnumType(string type) => PrimitiveTypeCode.Int32;
    }

    private sealed class SigProvider : ISignatureTypeProvider<TypeNameOrSig, object?>
    {
        private readonly MetadataReader _mr;
        public SigProvider(MetadataReader mr) => _mr = mr;

        public TypeNameOrSig GetPrimitiveType(PrimitiveTypeCode typeCode) => new(typeCode.ToString());
        public TypeNameOrSig GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind)
            => new(ResolveEntityName(reader, handle) ?? "?");
        public TypeNameOrSig GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind)
            => new(ResolveEntityName(reader, handle) ?? "?");
        public TypeNameOrSig GetSZArrayType(TypeNameOrSig elementType) => new(elementType.Name + "[]");
        public TypeNameOrSig GetArrayType(TypeNameOrSig elementType, ArrayShape shape) => new(elementType.Name + "[...]");
        public TypeNameOrSig GetByReferenceType(TypeNameOrSig elementType) => new(elementType.Name + "&");
        public TypeNameOrSig GetPointerType(TypeNameOrSig elementType) => new(elementType.Name + "*");
        public TypeNameOrSig GetGenericInstantiation(TypeNameOrSig genericType, ImmutableArray<TypeNameOrSig> typeArguments)
            => new($"{genericType.Name}<{string.Join(",", typeArguments.Select(t => t.Name))}>");
        public TypeNameOrSig GetGenericTypeParameter(object? genericContext, int index) => new("!T" + index);
        public TypeNameOrSig GetGenericMethodParameter(object? genericContext, int index) => new("!!T" + index);
        public TypeNameOrSig GetFunctionPointerType(MethodSignature<TypeNameOrSig> signature) => new("fnptr");
        public TypeNameOrSig GetModifiedType(TypeNameOrSig modifier, TypeNameOrSig unmodifiedType, bool isRequired) => unmodifiedType;
        public TypeNameOrSig GetPinnedType(TypeNameOrSig elementType) => elementType;
        public TypeNameOrSig GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind)
            => new("TypeSpec");
    }
}
