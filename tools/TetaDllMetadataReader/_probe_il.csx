using System;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Reflection.Metadata.Ecma335;

var dll = @"A:\TETA Aplikacja klienta - 33.5\Plugins\Sales\plgSalesDictionaries.dll";
var wanted = "Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji";
using var fs = File.OpenRead(dll);
using var pe = new PEReader(fs);
var mr = pe.GetMetadataReader();
foreach (var th in mr.TypeDefinitions) {
  var td = mr.GetTypeDefinition(th);
  var ns = mr.GetString(td.Namespace);
  var name = mr.GetString(td.Name);
  var full = string.IsNullOrEmpty(ns) ? name : ns + "." + name;
  if (full != wanted) continue;
  foreach (var mh in td.GetMethods()) {
    var md = mr.GetMethodDefinition(mh);
    var mname = mr.GetString(md.Name);
    if (mname != "InitializeComponent") continue;
    var body = pe.GetMethodBody(md.RelativeVirtualAddress);
    var il = body.GetILContent().ToArray();
    int i = 0; int shown = 0;
    while (i < il.Length && shown < 120) {
      int offset = i;
      byte op = il[i++];
      string text = $"0x{offset:X4}: ";
      if (op == 0xFE) {
        byte op2 = il[i++];
        text += $"FE {op2:X2}";
        // rough skip for common FE ops
        if (op2 is 0x01 or 0x02 or 0x03 or 0x04 or 0x05 or 0x06 or 0x07 or 0x09 or 0x0A or 0x0B or 0x0C or 0x0D or 0x0E or 0x0F or 0x11 or 0x12 or 0x14 or 0x15 or 0x16 or 0x18 or 0x1A or 0x1C or 0x1D) { /* no operand */ }
        else if (op2 is 0x09 or 0x0A) { /* ldarga/ldloca short - 1 byte? */ }
        else if (op2 is 0x0B or 0x0C or 0x0D or 0x0E) { i += 2; }
        else if (op2 is 0x12 or 0x13 or 0x15) { i += 4; }
        else if (op2 == 0x16) { i += 4; } // constrained
        else { /* unknown */ }
      } else {
        text += $"{op:X2}";
        switch (op) {
          case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x0E:
          case 0x0F: case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
          case 0x16: case 0x17: case 0x18: case 0x19: case 0x1A: case 0x1B: case 0x1C:
          case 0x1D: case 0x25: case 0x26: case 0x2A: case 0x7E: // nop-ish / ldarg / stloc / ret / ldsfld short forms handled below
            break;
        }
        // operand sizes
        if (op is >= 0x0E and <= 0x13) { /* ldarg.s etc 1 byte */ if (op is 0x0E or 0x0F or 0x10 or 0x11 or 0x12 or 0x13) i += 1; }
        else if (op is 0x1F) i += 1; // ldc.i4.s
        else if (op is 0x20 or 0x21) i += 4; // ldc.i4 / ldc.i8 partial
        else if (op is 0x21) i += 8;
        else if (op is 0x22) i += 4; // ldc.r4
        else if (op is 0x23) i += 8; // ldc.r8
        else if (op is 0x28 or 0x29 or 0x27 or 0x6F or 0x73 or 0x74 or 0x75 or 0x7B or 0x7C or 0x7D or 0x7E or 0x80 or 0x72 or 0x70 or 0x71 or 0x8C or 0x8D or 0xA3 or 0xA4 or 0xA5 or 0xD0) {
          var tok = BitConverter.ToInt32(il, i); i += 4;
          text += $" tok={tok:X8}";
          try {
            var h = MetadataTokens.EntityHandle(tok);
            if (h.Kind == HandleKind.UserString) text += $" str=\"{mr.GetUserString(MetadataTokens.UserStringHandle(tok))}\"";
            else if (h.Kind == HandleKind.MemberReference) {
              var mref = mr.GetMemberReference((MemberReferenceHandle)h);
              text += $" mref={mr.GetString(mref.Name)}";
            }
            else if (h.Kind == HandleKind.MethodDefinition) {
              var mdef = mr.GetMethodDefinition((MethodDefinitionHandle)h);
              text += $" mdef={mr.GetString(mdef.Name)}";
            }
            else if (h.Kind == HandleKind.FieldDefinition) {
              var fdef = mr.GetFieldDefinition((FieldDefinitionHandle)h);
              text += $" fld={mr.GetString(fdef.Name)}";
            }
            else if (h.Kind == HandleKind.TypeReference) {
              var tr = mr.GetTypeReference((TypeReferenceHandle)h);
              text += $" typeref={mr.GetString(tr.Namespace)}.{mr.GetString(tr.Name)}";
            }
            else if (h.Kind == HandleKind.TypeDefinition) {
              var tdef = mr.GetTypeDefinition((TypeDefinitionHandle)h);
              text += $" typedef={mr.GetString(tdef.Name)}";
            }
            else text += $" kind={h.Kind}";
          } catch { text += " (bad tok)"; }
        }
        else if (op is >= 0x2B and <= 0x37) i += 1; // br.s family
        else if (op is >= 0x38 and <= 0x44) i += 4; // br family
        else if (op is 0x45) { var n = BitConverter.ToInt32(il, i); i += 4 + n*4; } // switch
        else if (op is 0xFE) { /* handled */ }
      }
      Console.WriteLine(text);
      shown++;
    }
  }
}
