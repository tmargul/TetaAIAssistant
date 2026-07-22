using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;

namespace TetaDllMetadataReader;

internal enum IlOpcode
{
    Nop, Break, Ldarg0, Ldarg, Ldloc, Stloc, Ldnull, Ldstr,
    LdcI4, LdcI8, LdcR4, LdcR8,
    Dup, Pop,
    Call, Callvirt, Newobj,
    Ldfld, Ldsfld, Stfld,
    Br, Brtrue, Brfalse, Leave, Ret,
    Other,
}

internal sealed class IlInstruction
{
    public int Offset { get; set; }
    public IlOpcode Opcode { get; set; }
    public string RawOpcode { get; set; } = "";
    public int? IntOperand { get; set; }
    public long? LongOperand { get; set; }
    public double? DoubleOperand { get; set; }
    public string? ResolvedString { get; set; }
    public string? ResolvedName { get; set; }
    public string? ResolvedType { get; set; }
    public string? ResolvedKind { get; set; }
    public int? ParamCount { get; set; }
    public bool? HasThis { get; set; }
    public bool? ReturnsValue { get; set; }
    public int Pops { get; set; }
    public int Pushes { get; set; }
}

internal static class IlDecoder
{
    public static List<IlInstruction> Decode(byte[] il, MetadataReader mr)
    {
        var list = new List<IlInstruction>();
        var i = 0;
        while (i < il.Length)
        {
            var offset = i;
            var b = il[i++];
            var ins = new IlInstruction { Offset = offset, RawOpcode = b.ToString("X2") };

            if (b == 0xFE)
            {
                if (i >= il.Length) break;
                var b2 = il[i++];
                ins.RawOpcode = $"FE_{b2:X2}";
                DecodeFe(il, ref i, b2, ins, mr);
                list.Add(ins);
                continue;
            }

            switch (b)
            {
                case 0x00: ins.Opcode = IlOpcode.Nop; break;
                case 0x01: ins.Opcode = IlOpcode.Break; break;
                case 0x02: // ldarg.0
                    ins.Opcode = IlOpcode.Ldarg0; ins.IntOperand = 0; ins.Pushes = 1; break;
                case 0x03: case 0x04: case 0x05: // ldarg.1..3
                    ins.Opcode = IlOpcode.Ldarg; ins.IntOperand = b - 0x02; ins.Pushes = 1; break;
                case 0x06: case 0x07: case 0x08: case 0x09: // ldloc.0..3
                    ins.Opcode = IlOpcode.Ldloc; ins.IntOperand = b - 0x06; ins.Pushes = 1; break;
                case 0x0A: case 0x0B: case 0x0C: case 0x0D: // stloc.0..3
                    ins.Opcode = IlOpcode.Stloc; ins.IntOperand = b - 0x0A; ins.Pops = 1; break;
                case 0x0E: // ldarg.s
                    ins.Opcode = IlOpcode.Ldarg; ins.IntOperand = il[i++]; ins.Pushes = 1; break;
                case 0x11: // ldloc.s
                    ins.Opcode = IlOpcode.Ldloc; ins.IntOperand = il[i++]; ins.Pushes = 1; break;
                case 0x13: // stloc.s
                    ins.Opcode = IlOpcode.Stloc; ins.IntOperand = il[i++]; ins.Pops = 1; break;
                case 0x14: // ldnull
                    ins.Opcode = IlOpcode.Ldnull; ins.Pushes = 1; break;
                case 0x15: case 0x16: case 0x17: case 0x18: case 0x19:
                case 0x1A: case 0x1B: case 0x1C: case 0x1D: // ldc.i4.m1 .. ldc.i4.8
                    ins.Opcode = IlOpcode.LdcI4; ins.IntOperand = b == 0x15 ? -1 : b - 0x16; ins.Pushes = 1; break;
                case 0x1F: // ldc.i4.s
                    ins.Opcode = IlOpcode.LdcI4; ins.IntOperand = (sbyte)il[i++]; ins.Pushes = 1; break;
                case 0x20: // ldc.i4
                    ins.Opcode = IlOpcode.LdcI4; ins.IntOperand = ReadI4(il, ref i); ins.Pushes = 1; break;
                case 0x21: // ldc.i8
                    ins.Opcode = IlOpcode.LdcI8; ins.LongOperand = BitConverter.ToInt64(il, i); i += 8; ins.Pushes = 1; break;
                case 0x22: // ldc.r4
                    ins.Opcode = IlOpcode.LdcR4; ins.DoubleOperand = BitConverter.ToSingle(il, i); i += 4; ins.Pushes = 1; break;
                case 0x23: // ldc.r8
                    ins.Opcode = IlOpcode.LdcR8; ins.DoubleOperand = BitConverter.ToDouble(il, i); i += 8; ins.Pushes = 1; break;
                case 0x25: // dup
                    ins.Opcode = IlOpcode.Dup; ins.Pops = 1; ins.Pushes = 2; break;
                case 0x26: // pop
                    ins.Opcode = IlOpcode.Pop; ins.Pops = 1; break;
                case 0x28: // call
                    DecodeCall(il, ref i, ins, mr, IlOpcode.Call); break;
                case 0x6F: // callvirt
                    DecodeCall(il, ref i, ins, mr, IlOpcode.Callvirt); break;
                case 0x73: // newobj
                    DecodeCall(il, ref i, ins, mr, IlOpcode.Newobj); break;
                case 0x72: // ldstr
                    {
                        var tok = ReadI4(il, ref i);
                        ins.Opcode = IlOpcode.Ldstr; ins.Pushes = 1;
                        try
                        {
                            var h = MetadataTokens.Handle(tok);
                            if (h.Kind == HandleKind.UserString)
                                ins.ResolvedString = mr.GetUserString(MetadataTokens.UserStringHandle(tok));
                        }
                        catch { /* ignore */ }
                        break;
                    }
                case 0x7B: // ldfld
                    DecodeField(il, ref i, ins, mr, IlOpcode.Ldfld); ins.Pops = 1; ins.Pushes = 1; break;
                case 0x7E: // ldsfld
                    DecodeField(il, ref i, ins, mr, IlOpcode.Ldsfld); ins.Pushes = 1; break;
                case 0x7D: // stfld
                    DecodeField(il, ref i, ins, mr, IlOpcode.Stfld); ins.Pops = 2; break;
                case 0x2A: // ret
                    ins.Opcode = IlOpcode.Ret; break;
                case 0x2B: // br.s
                    ins.Opcode = IlOpcode.Br; ins.IntOperand = (sbyte)il[i++]; break;
                case 0x2C: // brfalse.s
                    ins.Opcode = IlOpcode.Brfalse; ins.IntOperand = (sbyte)il[i++]; ins.Pops = 1; break;
                case 0x2D: // brtrue.s
                    ins.Opcode = IlOpcode.Brtrue; ins.IntOperand = (sbyte)il[i++]; ins.Pops = 1; break;
                case 0x38: // br
                    ins.Opcode = IlOpcode.Br; ins.IntOperand = ReadI4(il, ref i); break;
                case 0x39: // brfalse
                    ins.Opcode = IlOpcode.Brfalse; ins.IntOperand = ReadI4(il, ref i); ins.Pops = 1; break;
                case 0x3A: // brtrue
                    ins.Opcode = IlOpcode.Brtrue; ins.IntOperand = ReadI4(il, ref i); ins.Pops = 1; break;
                case 0xDE: // leave.s
                    ins.Opcode = IlOpcode.Leave; ins.IntOperand = (sbyte)il[i++]; break;
                case 0xDD: // leave
                    ins.Opcode = IlOpcode.Leave; ins.IntOperand = ReadI4(il, ref i); break;
                // Short branches / compares with 1-byte offset
                case 0x2E: case 0x2F: case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37:
                    ins.Opcode = IlOpcode.Other; ins.Pops = 2; i += 1; break;
                case 0x3B: case 0x3C: case 0x3D: case 0x3E: case 0x3F: case 0x40: case 0x41: case 0x42: case 0x43: case 0x44:
                    ins.Opcode = IlOpcode.Other; ins.Pops = 2; i += 4; break;
                case 0x45: // switch
                {
                    var n = ReadI4(il, ref i);
                    i += n * 4;
                    ins.Opcode = IlOpcode.Other; ins.Pops = 1;
                    break;
                }
                // Token-bearing ops we don't specially handle but must skip 4 bytes
                case 0x27: // calli
                case 0x29: // jmp
                case 0x70: // ldtoken? no ldftn
                case 0x71: // ldnull-ish / castclass etc.
                case 0x74: // castclass
                case 0x75: // isinst
                case 0x79: // unbox
                case 0x7C: // ldflda
                case 0x7F: // ldsflda
                case 0x80: // stsfld
                case 0x81: // stobj
                case 0x8C: // box
                case 0x8D: // newarr
                case 0xA3: // ldelem
                case 0xA4: // stelem
                case 0xA5: // unbox.any
                case 0xD0: // ldtoken
                    ReadI4(il, ref i);
                    ins.Opcode = IlOpcode.Other;
                    ins.Pops = 1; ins.Pushes = 1;
                    break;
                case 0x0F: // ldarga.s
                case 0x10: // starg.s
                case 0x12: // ldloca.s
                    i += 1; ins.Opcode = IlOpcode.Other; ins.Pushes = 1; break;
                default:
                    // Unknown single-byte: best-effort continue
                    ins.Opcode = IlOpcode.Other;
                    break;
            }

            list.Add(ins);
        }
        return list;
    }

    private static void DecodeFe(byte[] il, ref int i, byte b2, IlInstruction ins, MetadataReader mr)
    {
        switch (b2)
        {
            case 0x09: // ldarg
                ins.Opcode = IlOpcode.Ldarg; ins.IntOperand = ReadU2(il, ref i); ins.Pushes = 1; break;
            case 0x0C: // ldloc
                ins.Opcode = IlOpcode.Ldloc; ins.IntOperand = ReadU2(il, ref i); ins.Pushes = 1; break;
            case 0x0E: // stloc
                ins.Opcode = IlOpcode.Stloc; ins.IntOperand = ReadU2(il, ref i); ins.Pops = 1; break;
            case 0x01: // ceq
            case 0x02: // cgt
            case 0x03: // cgt.un
            case 0x04: // clt
            case 0x05: // clt.un
                ins.Opcode = IlOpcode.Other; ins.Pops = 2; ins.Pushes = 1; break;
            case 0x06: // ldftn
            case 0x07: // ldvirtftn
                ReadI4(il, ref i); ins.Opcode = IlOpcode.Other; ins.Pushes = 1; break;
            case 0x15: // initobj
            case 0x16: // constrained
            case 0x1C: // sizeof
            case 0x1D: // refanytype
                ReadI4(il, ref i); ins.Opcode = IlOpcode.Other; break;
            default:
                ins.Opcode = IlOpcode.Other;
                break;
        }
    }

    private static void DecodeCall(byte[] il, ref int i, IlInstruction ins, MetadataReader mr, IlOpcode opcode)
    {
        var tok = ReadI4(il, ref i);
        ins.Opcode = opcode;
        try
        {
            var handle = MetadataTokens.EntityHandle(tok);
            if (handle.Kind == HandleKind.MemberReference)
            {
                var mref = mr.GetMemberReference((MemberReferenceHandle)handle);
                ins.ResolvedName = mr.GetString(mref.Name);
                ins.ResolvedKind = "memberRef";
                ins.ResolvedType = ResolveMemberParent(mr, mref.Parent);
                var sig = mref.DecodeMethodSignature(new ParamCountingProvider(), genericContext: (object?)null);
                ins.ParamCount = sig.ParameterTypes.Length;
                ins.HasThis = (sig.Header.CallingConvention & SignatureCallingConvention.ThisCall) != 0
                              || sig.Header.IsInstance;
                // SignatureHeader.IsInstance is the right check
                ins.HasThis = sig.Header.IsInstance;
                ins.ReturnsValue = sig.ReturnType;
                if (opcode == IlOpcode.Newobj)
                {
                    ins.HasThis = false;
                    ins.ReturnsValue = true;
                    ins.Pushes = 1;
                    ins.Pops = ins.ParamCount ?? 0;
                }
                else
                {
                    ins.Pops = (ins.ParamCount ?? 0) + (ins.HasThis == true ? 1 : 0);
                    ins.Pushes = ins.ReturnsValue == true ? 1 : 0;
                }
            }
            else if (handle.Kind == HandleKind.MethodDefinition)
            {
                var mdef = mr.GetMethodDefinition((MethodDefinitionHandle)handle);
                ins.ResolvedName = mr.GetString(mdef.Name);
                ins.ResolvedKind = "methodDef";
                var sig = mdef.DecodeSignature(new ParamCountingProvider(), genericContext: (object?)null);
                ins.ParamCount = sig.ParameterTypes.Length;
                ins.HasThis = (mdef.Attributes & MethodAttributes.Static) == 0;
                ins.ReturnsValue = sig.ReturnType;
                if (opcode == IlOpcode.Newobj)
                {
                    ins.HasThis = false;
                    ins.Pushes = 1;
                    ins.Pops = ins.ParamCount ?? 0;
                }
                else
                {
                    ins.Pops = (ins.ParamCount ?? 0) + (ins.HasThis == true ? 1 : 0);
                    ins.Pushes = ins.ReturnsValue == true ? 1 : 0;
                }
            }
            else if (handle.Kind == HandleKind.MethodSpecification)
            {
                ins.ResolvedKind = "methodSpec";
                ins.ResolvedName = "MethodSpec";
                ins.ParamCount = 0;
                ins.HasThis = true;
                ins.Pops = 1;
            }
        }
        catch
        {
            ins.ParamCount = 0;
            ins.HasThis = opcode != IlOpcode.Newobj;
        }
    }

    private static void DecodeField(byte[] il, ref int i, IlInstruction ins, MetadataReader mr, IlOpcode opcode)
    {
        var tok = ReadI4(il, ref i);
        ins.Opcode = opcode;
        try
        {
            var handle = MetadataTokens.EntityHandle(tok);
            if (handle.Kind == HandleKind.FieldDefinition)
            {
                var f = mr.GetFieldDefinition((FieldDefinitionHandle)handle);
                ins.ResolvedName = mr.GetString(f.Name);
                ins.ResolvedKind = "fieldDef";
            }
            else if (handle.Kind == HandleKind.MemberReference)
            {
                var mref = mr.GetMemberReference((MemberReferenceHandle)handle);
                ins.ResolvedName = mr.GetString(mref.Name);
                ins.ResolvedType = ResolveMemberParent(mr, mref.Parent);
                ins.ResolvedKind = "fieldRef";
            }
        }
        catch { /* ignore */ }
    }

    private static string? ResolveMemberParent(MetadataReader mr, EntityHandle parent)
    {
        try
        {
            if (parent.Kind == HandleKind.TypeReference)
            {
                var tr = mr.GetTypeReference((TypeReferenceHandle)parent);
                var ns = mr.GetString(tr.Namespace);
                var name = mr.GetString(tr.Name);
                return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
            }
            if (parent.Kind == HandleKind.TypeDefinition)
            {
                var td = mr.GetTypeDefinition((TypeDefinitionHandle)parent);
                var ns = mr.GetString(td.Namespace);
                var name = mr.GetString(td.Name);
                return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
            }
        }
        catch { /* ignore */ }
        return null;
    }

    private static int ReadI4(byte[] il, ref int i)
    {
        var v = BitConverter.ToInt32(il, i);
        i += 4;
        return v;
    }

    private static int ReadU2(byte[] il, ref int i)
    {
        var v = BitConverter.ToUInt16(il, i);
        i += 2;
        return v;
    }
}

/// <summary>Signature provider that only cares about parameter counts / void returns.</summary>
internal sealed class ParamCountingProvider : ISignatureTypeProvider<bool, object?>
{
    public bool GetArrayType(bool elementType, ArrayShape shape) => true;
    public bool GetByReferenceType(bool elementType) => true;
    public bool GetFunctionPointerType(MethodSignature<bool> signature) => true;
    public bool GetGenericInstantiation(bool genericType, System.Collections.Immutable.ImmutableArray<bool> typeArguments) => true;
    public bool GetGenericMethodParameter(object? genericContext, int index) => true;
    public bool GetGenericTypeParameter(object? genericContext, int index) => true;
    public bool GetModifiedType(bool modifier, bool unmodifiedType, bool isRequired) => unmodifiedType;
    public bool GetPinnedType(bool elementType) => true;
    public bool GetPointerType(bool elementType) => true;
    public bool GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode != PrimitiveTypeCode.Void;
    public bool GetSZArrayType(bool elementType) => true;
    public bool GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) => true;
    public bool GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) => true;
    public bool GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind) => true;
}
