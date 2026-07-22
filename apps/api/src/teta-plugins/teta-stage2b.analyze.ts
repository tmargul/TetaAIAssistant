import type { Stage2aFormBinding } from './teta-stage2a-bindings.types';
import type {
  BosTypeAnalysis,
  GatewayDescriptor,
  LookupBindingSplit,
  RelationEdge2b,
  Stage2bAuditSummary,
  Stage2bBatchRequest,
  Stage2bBatchResult,
  Stage2bLinkedChain,
} from './teta-stage2b.types';
import { readStage2bBatch } from './teta-stage2b.reader';

export type Stage2bSeed = {
  assemblies: Array<{
    assemblyName: string;
    types: string[];
    referencedByForms: string[];
  }>;
  boRequested: number;
  dfRequested: number;
};

/** Collect bos DLL + BO/DF types from Stage 2A forms (targeted, not full DLL scan). */
export function seedStage2bFromStage2a(forms: Stage2aFormBinding[]): Stage2bSeed {
  const byAsm = new Map<
    string,
    { types: Set<string>; forms: Set<string> }
  >();

  let boRequested = 0;
  let dfRequested = 0;

  for (const form of forms) {
    const formType = form.formType ?? '';
    for (const asm of form.assemblies ?? []) {
      if (asm.role !== 'bos' || !asm.name) continue;
      const key = normalizeAsm(asm.name);
      const entry = byAsm.get(key) ?? { types: new Set(), forms: new Set() };
      if (formType) entry.forms.add(formType);
      byAsm.set(key, entry);
    }
    for (const bo of form.businessObjects ?? []) {
      if (!bo.fullType) continue;
      boRequested += 1;
      const asm = normalizeAsm(bo.assembly || guessAsmFromType(bo.fullType));
      const entry = byAsm.get(asm) ?? { types: new Set(), forms: new Set() };
      entry.types.add(bo.fullType);
      if (formType) entry.forms.add(formType);
      byAsm.set(asm, entry);
    }
    for (const df of form.dataFactories ?? []) {
      if (!df.fullType) continue;
      dfRequested += 1;
      const asm = normalizeAsm(df.assembly || guessAsmFromType(df.fullType));
      const entry = byAsm.get(asm) ?? { types: new Set(), forms: new Set() };
      entry.types.add(df.fullType);
      if (formType) entry.forms.add(formType);
      byAsm.set(asm, entry);
    }
  }

  return {
    assemblies: [...byAsm.entries()].map(([assemblyName, v]) => ({
      assemblyName,
      types: [...v.types],
      referencedByForms: [...v.forms],
    })),
    boRequested,
    dfRequested,
  };
}

function normalizeAsm(name: string): string {
  const n = name.trim();
  return n.toLowerCase().endsWith('.dll') ? n : `${n}.dll`;
}

function guessAsmFromType(fullType: string): string {
  // Teta.Sumo.Sales.bosSalesDictionaries.DF.X → bosSalesDictionaries.dll
  const m = fullType.match(/\.bos([A-Za-z0-9_]+)\./);
  if (m) return `bos${m[1]}.dll`;
  const m2 = fullType.match(/\.(bos[A-Za-z0-9_]+)\./i);
  if (m2) return `${m2[1]}.dll`;
  return 'unknown.dll';
}

export function analyzeStage2b(options: {
  forms: Stage2aFormBinding[];
  searchRoots: string[];
}): { seed: Stage2bSeed; batch: Stage2bBatchResult } {
  const seed = seedStage2bFromStage2a(options.forms);
  const request: Stage2bBatchRequest = {
    searchRoots: options.searchRoots,
    assemblies: seed.assemblies,
  };
  const batch = readStage2bBatch(request);
  return { seed, batch };
}

/** Split lookup vs target binding (Stage 2A conflicts that are semantically valid). */
export function splitLookupBindings(forms: Stage2aFormBinding[]): {
  resolved: LookupBindingSplit[];
  unresolved: Array<{ formType?: string | null; control?: string | null; message: string }>;
} {
  const resolved: LookupBindingSplit[] = [];
  const unresolved: Array<{ formType?: string | null; control?: string | null; message: string }> =
    [];

  for (const form of forms) {
    const lookups = new Map(
      (form.lookups ?? [])
        .filter((l) => l.control)
        .map((l) => [l.control!.toLowerCase(), l] as const),
    );

    for (const b of form.bindings ?? []) {
      const control = b.control ?? '';
      if (!control) continue;
      const bag = b.binding ?? {};
      const dataMember = (b.dataMember ?? bag.dataMember) as string | undefined;
      const datasetTable = (b.datasetTable ?? bag.datasetTable) as string | undefined;
      const valueMember = (b.valueMember ?? bag.valueMember) as string | undefined;
      const displayMember = (b.displayMember ?? bag.displayMember) as string | undefined;
      const lookup = lookups.get(control.toLowerCase());

      const hasTarget = Boolean(datasetTable && dataMember);
      const alternatives = Array.isArray(b.alternatives)
        ? b.alternatives.map(String)
        : [];
      const hasLookupMembers = Boolean(
        valueMember || displayMember || lookup || alternatives.length >= 2,
      );

      if (!hasLookupMembers && !hasTarget) continue;

      const conflict = (form.conflicts ?? []).find(
        (c) => (c.subject ?? '').toLowerCase().includes(control.toLowerCase()),
      );

      // Semantic split from DesignMode Column/Table + DictionaryColumn* alternatives
      if (hasTarget && alternatives.length >= 2) {
        const tables = alternatives.filter(
          (a) =>
            /[a-z]/.test(a) && // PascalCase-ish logical table
            a !== dataMember &&
            !/^[A-Z0-9_]+$/.test(a),
        );
        const lookupTable =
          tables.find((t) => t !== datasetTable) ??
          alternatives.find((a) => a !== datasetTable && /[a-z]/.test(a)) ??
          null;
        const cols = alternatives.filter((a) => /^[A-Z][A-Z0-9_]*$/.test(a));
        const display =
          displayMember ??
          cols.find((c) => c === 'NAZWA' || c.endsWith('_NAZWA')) ??
          cols.find((c) => c !== dataMember && c !== 'ID' && !c.endsWith('_ID')) ??
          null;
        const value =
          valueMember ??
          cols.find((c) => c === 'ID') ??
          cols.find((c) => c.endsWith('_ID') && c !== dataMember) ??
          cols.find((c) => c !== dataMember && c !== display) ??
          null;

        if (lookupTable || value || display || lookup) {
          resolved.push({
            control,
            formType: form.formType,
            targetBinding: {
              datasetTable: datasetTable ?? null,
              dataMember: dataMember ?? null,
            },
            lookupBinding: {
              datasetTable: lookupTable,
              valueMember: value,
              displayMember: display,
              lookupClass: lookup?.lookupClass ?? null,
              pluginAssembly: lookup?.pluginAssembly ?? null,
            },
            confidence: 'confirmed_from_il',
            evidence: [
              ...(b.evidence ?? []).map((e) => e.assignment ?? '').filter(Boolean),
              `alternatives=${alternatives.join(',')}`,
            ],
          });
          continue;
        }
      }

      if (hasTarget && (valueMember || displayMember || lookup)) {
        // Infer lookup dataset from alternatives / conflict message / second table name
        let lookupTable: string | null = null;
        if (conflict?.message) {
          const vs = conflict.message.match(
            /\bvs\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
          );
          if (vs?.[1] && vs[1] !== datasetTable) lookupTable = vs[1];
          if (!lookupTable) {
            const pair = conflict.message.match(
              /:\s*([A-Za-z_][A-Za-z0-9_]*)\s+vs\s+([A-Za-z_][A-Za-z0-9_]*)/i,
            );
            if (pair) {
              lookupTable = [pair[1], pair[2]].find((t) => t !== datasetTable) ?? null;
            }
          }
        }

        resolved.push({
          control,
          formType: form.formType,
          targetBinding: {
            datasetTable: datasetTable ?? null,
            dataMember: dataMember ?? null,
          },
          lookupBinding: {
            datasetTable: lookupTable,
            valueMember: valueMember ?? null,
            displayMember: displayMember ?? null,
            lookupClass: lookup?.lookupClass ?? null,
            pluginAssembly: lookup?.pluginAssembly ?? null,
          },
          confidence: 'confirmed_from_il',
          evidence: [
            ...(b.evidence ?? []).map((e) => e.assignment ?? '').filter(Boolean),
            lookup
              ? `lookup ${lookup.pluginAssembly}/${lookup.lookupClass}`
              : '',
          ].filter(Boolean),
        });
      } else if (conflict) {
        unresolved.push({
          formType: form.formType,
          control,
          message: conflict.message ?? 'unresolved lookup conflict',
        });
      }
    }

    // Explicit lov*/lcbo* with TableName + ValueMember pattern from propertyAssignments
    for (const a of form.propertyAssignments ?? []) {
      const control = a.control ?? '';
      if (!/^lov|^lcbo|LookUp|Lookup/i.test(control) && !lookups.has(control.toLowerCase())) {
        continue;
      }
      if (resolved.some((r) => r.control === control)) continue;
    }
  }

  return { resolved, unresolved };
}

/** Link Stage 2A form bindings to Stage 2B gateways with evidence. */
export function linkStage2aToStage2b(
  forms: Stage2aFormBinding[],
  batch: Stage2bBatchResult,
): { chains: Stage2bLinkedChain[]; relations: RelationEdge2b[] } {
  const chains: Stage2bLinkedChain[] = [];
  const relations: RelationEdge2b[] = [...(batch.relations ?? [])];

  const gatewaysByDataset = new Map<string, GatewayDescriptor[]>();
  for (const gw of batch.gateways ?? []) {
    const key = (gw.datasetTable ?? '').toLowerCase();
    if (!key) continue;
    const list = gatewaysByDataset.get(key) ?? [];
    list.push(gw);
    gatewaysByDataset.set(key, list);
  }

  const typesByFull = new Map(
    (batch.types ?? [])
      .filter((t) => t.fullName)
      .map((t) => [t.fullName!.toLowerCase(), t] as const),
  );

  for (const form of forms) {
    const formType = form.formType ?? '';
    const formBoDf = [
      ...(form.businessObjects ?? []).map((b) => b.fullType),
      ...(form.dataFactories ?? []).map((d) => d.fullType),
    ].filter(Boolean) as string[];

    for (const b of form.bindings ?? []) {
      const datasetTable = String(
        b.datasetTable ?? b.binding?.datasetTable ?? '',
      ).trim();
      const dataMember = String(b.dataMember ?? b.binding?.dataMember ?? '').trim();
      if (!datasetTable || !dataMember) continue;
      if (Array.isArray(b.dataMember) || Array.isArray(b.binding?.dataMember)) continue;

      const gws = gatewaysByDataset.get(datasetTable.toLowerCase()) ?? [];
      // Prefer gateway reachable from this form's BO/DF
      const preferred =
        gws.find((g) =>
          formBoDf.some((t) => {
            const analysis = typesByFull.get(t.toLowerCase());
            return analysis?.gateways?.some(
              (x) =>
                x.gatewayType === g.gatewayType ||
                x.datasetTable?.toLowerCase() === datasetTable.toLowerCase(),
            );
          }),
        ) ?? gws[0];

      if (!preferred) continue;

      const boOrDf =
        formBoDf.find((t) => {
          const analysis = typesByFull.get(t.toLowerCase());
          return analysis?.datasetTables?.some(
            (d) => d.name?.toLowerCase() === datasetTable.toLowerCase(),
          );
        }) ?? formBoDf[0] ?? null;

      const columnOnGateway = (preferred as GatewayDescriptor & { _cols?: string[] });
      const mtgType = (batch.types ?? []).find(
        (t) =>
          t.gateways?.some((g) => g.gatewayType === preferred.gatewayType) &&
          t.datasetTables?.some((d) =>
            d.columns?.some((c) => c.name?.toUpperCase() === dataMember.toUpperCase()),
          ),
      );
      const hasColumn = Boolean(
        mtgType?.datasetTables?.some(
          (d) =>
            d.name?.toLowerCase() === datasetTable.toLowerCase() &&
            d.columns?.some((c) => c.name?.toUpperCase() === dataMember.toUpperCase()),
        ),
      );

      const oracleColStatus =
        preferred.oracleViewStatus === 'confirmed_in_oracle' && hasColumn
          ? 'confirmed_in_oracle'
          : preferred.oracleViewStatus === 'confirmed_in_oracle'
            ? 'oracle_not_checked'
            : preferred.oracleViewStatus ?? 'oracle_not_checked';

      const chainConfidence =
        boOrDf && preferred.viewName && hasColumn
          ? 'confirmed_from_il'
          : boOrDf && preferred.viewName
            ? 'confirmed_from_il'
            : 'probable_from_naming';

      chains.push({
        formType,
        control: b.control,
        dataMember,
        formDatasetTable: datasetTable,
        boOrDf,
        gatewayType: preferred.gatewayType,
        viewName: preferred.viewName,
        baseTableName: preferred.baseTableName,
        packageName: preferred.packageName,
        oracleColumnStatus: oracleColStatus,
        confidence: chainConfidence,
        evidence: [
          `form ${b.control}.${dataMember} @ ${datasetTable}`,
          preferred.gatewayType ? `gateway ${preferred.gatewayType}` : '',
          preferred.viewName ? `view ${preferred.viewName}` : '',
          hasColumn ? `column ${dataMember} on gateway dataset` : '',
        ].filter(Boolean),
      });

      relations.push({
        relationType: 'formDatasource_gatewayDataset',
        from: datasetTable,
        to: preferred.datasetTable ?? datasetTable,
        confidence: 'confirmed_from_il',
        evidence: [`form=${formType}`, `gateway=${preferred.gatewayType}`],
      });

      if (hasColumn && preferred.viewName) {
        relations.push({
          relationType: 'formColumn_oracleColumn',
          from: `${datasetTable}.${dataMember}`,
          to: `${preferred.viewName}.${dataMember}`,
          confidence:
            oracleColStatus === 'confirmed_in_oracle'
              ? 'confirmed_in_oracle'
              : 'confirmed_from_il',
          evidence: chains[chains.length - 1].evidence ?? [],
        });
      }

      void columnOnGateway;
    }
  }

  return { chains, relations };
}

export function summarizeStage2b(options: {
  seed: Stage2bSeed;
  batch: Stage2bBatchResult;
  chains: Stage2bLinkedChain[];
  lookupResolved: number;
  lookupUnresolved: number;
  oracleConfirmed: number;
  oracleMissing: number;
}): Stage2bAuditSummary {
  const assemblies = options.batch.assemblies ?? [];
  const types = options.batch.types ?? [];
  const gateways = options.batch.gateways ?? [];

  return {
    bosDllReferenced: options.seed.assemblies.length,
    bosDllResolved: assemblies.filter((a) =>
      ['resolved', 'duplicate_same_hash'].includes(a.resolutionStatus ?? ''),
    ).length,
    bosDllMissing: assemblies.filter((a) => a.resolutionStatus === 'physical_file_missing')
      .length,
    bosDllDuplicateDifferentHash: assemblies.filter(
      (a) => a.resolutionStatus === 'duplicate_different_hash',
    ).length,
    bosDllUnreadable: assemblies.filter((a) => a.resolutionStatus === 'unreadable').length,
    boTypesRequested: options.seed.boRequested,
    boTypesFound: types.filter(
      (t) => t.technicalRole === 'BO' && t.typeResolutionStatus === 'found',
    ).length,
    dfTypesRequested: options.seed.dfRequested,
    dfTypesFound: types.filter(
      (t) => t.technicalRole === 'DF' && t.typeResolutionStatus === 'found',
    ).length,
    gatewayTypes: gateways.length,
    datasetTables: new Set(
      types.flatMap((t) => (t.datasetTables ?? []).map((d) => d.name).filter(Boolean)),
    ).size,
    views: new Set(gateways.map((g) => g.viewName).filter(Boolean)).size,
    baseTables: new Set(gateways.map((g) => g.baseTableName).filter(Boolean)).size,
    packages: new Set(gateways.map((g) => g.packageName).filter(Boolean)).size,
    packageOperations: gateways.reduce(
      (n, g) => n + Object.keys(g.operations ?? {}).length,
      0,
    ),
    confirmedOracleObjects: options.oracleConfirmed,
    objectsMissingInOracle: options.oracleMissing,
    formDatasourceGatewayDatasetConfirmed: options.chains.filter((c) =>
      c.evidence?.some((e) => e.startsWith('gateway ')),
    ).length,
    formColumnOracleColumnConfirmed: options.chains.filter(
      (c) =>
        c.oracleColumnStatus === 'confirmed_in_oracle' ||
        (c.viewName && c.evidence?.some((e) => e.startsWith('column '))),
    ).length,
    lookupConflictsResolvedSemantically: options.lookupResolved,
    unresolvedLookupConflicts: options.lookupUnresolved,
    candidateStringsNotPromoted: types.filter((t) => t.roleConfidence === 'candidate_string')
      .length,
    inheritanceChainsResolved: types.filter((t) => (t.inheritanceChain?.length ?? 0) > 0)
      .length,
  };
}

export function collectOracleCandidateNames(batch: Stage2bBatchResult): string[] {
  const names = new Set<string>();
  for (const gw of batch.gateways ?? []) {
    for (const n of [gw.viewName, gw.baseTableName, gw.packageName, gw.rawPackageName]) {
      if (n?.trim()) names.add(n.trim().toUpperCase());
    }
  }
  return [...names].sort();
}

export function applyOracleStatuses(
  batch: Stage2bBatchResult,
  kinds: Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>,
  available: boolean,
): { confirmed: number; missing: number } {
  let confirmed = 0;
  let missing = 0;
  if (!available) {
    for (const gw of batch.gateways ?? []) {
      if (gw.viewName) gw.oracleViewStatus = 'oracle_unavailable';
      if (gw.baseTableName) gw.oracleTableStatus = 'oracle_unavailable';
      if (gw.packageName) gw.oraclePackageStatus = 'oracle_unavailable';
    }
    return { confirmed: 0, missing: 0 };
  }

  for (const gw of batch.gateways ?? []) {
    if (gw.viewName) {
      const k = kinds.get(gw.viewName.toUpperCase());
      if (k === 'VIEW') {
        gw.oracleViewStatus = 'confirmed_in_oracle';
        confirmed += 1;
      } else if (k) {
        gw.oracleViewStatus = 'invalid_object_type';
        missing += 1;
      } else {
        gw.oracleViewStatus = 'confirmed_in_dll_not_found_in_oracle';
        missing += 1;
      }
    }
    if (gw.baseTableName) {
      const k = kinds.get(gw.baseTableName.toUpperCase());
      if (k === 'TABLE' || k === 'VIEW') {
        gw.oracleTableStatus = 'confirmed_in_oracle';
        confirmed += 1;
      } else if (k) {
        gw.oracleTableStatus = 'invalid_object_type';
        missing += 1;
      } else {
        gw.oracleTableStatus = 'confirmed_in_dll_not_found_in_oracle';
        missing += 1;
      }
    }
    if (gw.packageName) {
      const k = kinds.get(gw.packageName.toUpperCase());
      if (k === 'PACKAGE') {
        gw.oraclePackageStatus = 'confirmed_in_oracle';
        confirmed += 1;
      } else if (k) {
        gw.oraclePackageStatus = 'invalid_object_type';
        missing += 1;
      } else {
        gw.oraclePackageStatus = 'confirmed_in_dll_not_found_in_oracle';
        missing += 1;
      }
    }
  }
  return { confirmed, missing };
}

export function findType(
  batch: Stage2bBatchResult,
  fullNameSuffix: string,
): BosTypeAnalysis | undefined {
  return (batch.types ?? []).find(
    (t) =>
      t.fullName === fullNameSuffix ||
      (t.fullName?.endsWith(fullNameSuffix) ?? false) ||
      t.name === fullNameSuffix,
  );
}
