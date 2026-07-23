/**
 * Stage 2D.1 — dataset / join semantic normalization (post-IL).
 * Does not modify Stage 1 / 2A / 2B / 2C or the Stage 2D IL decoder.
 */
import type {
  Stage2dAuditSummary,
  Stage2dCalculatedDeps,
  Stage2dConditionStatus,
  Stage2dDatasetModel,
  Stage2dEvidenceItem,
  Stage2dJoin,
  Stage2dJoinCondition,
  Stage2dProjectedColumn,
  Stage2dStage2bGatewayHint,
  Stage2dStage2bTypeHint,
} from './teta-stage2d.types';

export type Stage2d1NormalizeOptions = {
  stage2bTypes?: Stage2dStage2bTypeHint[];
  stage2bGateways?: Stage2dStage2bGatewayHint[];
};

export type Stage2d1NormalizeResult = {
  datasets: Stage2dDatasetModel[];
  audit: Stage2d1AuditExtras;
};

export type Stage2d1AuditExtras = {
  datasetTableColumnMisclassificationsFixed: number;
  datasetsWithConfirmedDatasetTable: number;
  datasetsWithUnresolvedDatasetTable: number;
  datasetsWithConfirmedMainSource: number;
  datasetsWithUnresolvedMainSource: number;
  joinsExplicitCondition: number;
  joinsInheritedCondition: number;
  joinsConditionAddedLater: number;
  joinsFrameworkDefault: number;
  joinsDynamicUnresolved: number;
  joinsNotProvidedInIl: number;
  joinsSuppliedByAddColumn: number;
  duplicateJoinEvidenceMerged: number;
  conflictingJoinDefinitions: number;
  inheritedJoins: number;
  projectedColumnsWithoutExplicitDatasetAlias: number;
  calculatedExpressionDependenciesParsed: number;
  examples: Stage2d1Examples;
};

export type Stage2d1Examples = {
  datasetTableColumnMisclassificationsFixed: string[];
  datasetsWithConfirmedDatasetTable: string[];
  datasetsWithUnresolvedDatasetTable: string[];
  datasetsWithConfirmedMainSource: string[];
  datasetsWithUnresolvedMainSource: string[];
  joinsExplicitCondition: string[];
  joinsInheritedCondition: string[];
  joinsConditionAddedLater: string[];
  joinsFrameworkDefault: string[];
  joinsDynamicUnresolved: string[];
  joinsNotProvidedInIl: string[];
  joinsSuppliedByAddColumn: string[];
  duplicateJoinEvidenceMerged: string[];
  conflictingJoinDefinitions: string[];
  inheritedJoins: string[];
  projectedColumnsWithoutExplicitDatasetAlias: string[];
  calculatedExpressionDependenciesParsed: string[];
};

const emptyExamples = (): Stage2d1Examples => ({
  datasetTableColumnMisclassificationsFixed: [],
  datasetsWithConfirmedDatasetTable: [],
  datasetsWithUnresolvedDatasetTable: [],
  datasetsWithConfirmedMainSource: [],
  datasetsWithUnresolvedMainSource: [],
  joinsExplicitCondition: [],
  joinsInheritedCondition: [],
  joinsConditionAddedLater: [],
  joinsFrameworkDefault: [],
  joinsDynamicUnresolved: [],
  joinsNotProvidedInIl: [],
  joinsSuppliedByAddColumn: [],
  duplicateJoinEvidenceMerged: [],
  conflictingJoinDefinitions: [],
  inheritedJoins: [],
  projectedColumnsWithoutExplicitDatasetAlias: [],
  calculatedExpressionDependenciesParsed: [],
});

function pushEx(list: string[], item: string, max = 20) {
  if (list.length < max) list.push(item);
}

function simpleName(full?: string | null): string {
  if (!full) return '';
  const i = full.lastIndexOf('.');
  return i >= 0 ? full.slice(i + 1) : full;
}

function normAlias(a?: string | null): string {
  return (a ?? '').trim().toUpperCase();
}

function normObj(a?: string | null): string {
  return (a ?? '').trim().toUpperCase();
}

/** Oracle-style column / bad datasetTable (e.g. SKLP_ID), not PascalCase DataSet name. */
export function looksLikeColumnNotDatasetTable(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  if (n.includes('.')) return true;
  if (/_ID$/i.test(n)) return true;
  // ALL_CAPS_WITH_UNDERSCORES without lowercase → column-like
  if (/^[A-Z][A-Z0-9_]*$/.test(n) && n.includes('_')) return true;
  // single token ALL CAPS short identifier often a column
  if (/^[A-Z]{2,12}$/.test(n) && !/[a-z]/.test(n)) return true;
  return false;
}

export function looksLikeValidDatasetTable(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n || looksLikeColumnNotDatasetTable(n)) return false;
  // PascalCase / mixed case DataSet table names
  if (/[a-z]/.test(n) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return true;
  return false;
}

export function parseCalculatedDependencies(expression?: string | null): Stage2dCalculatedDeps {
  const expr = (expression ?? '').trim();
  const deps: Stage2dCalculatedDeps = {
    referencedAliases: [],
    referencedColumns: [],
    referencedPackages: [],
    referencedFunctions: [],
    referencedSubqueryObjects: [],
  };
  if (!expr) return deps;

  const packages = new Set<string>();
  const functions = new Set<string>();
  const columns = new Set<string>();
  const aliases = new Set<string>();
  const subqueries = new Set<string>();

  // PKG.Func(...) or SCHEMA.PKG.Func
  for (const m of expr.matchAll(/\b([A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    packages.add(m[1]!);
    functions.add(m[2]!);
  }

  // alias.column (not package.func — already consumed above for funcs)
  for (const m of expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const left = m[1]!;
    const right = m[2]!;
    if (packages.has(left) || packages.has(`${left}.${right}`)) continue;
    // skip if this was package.func call site
    const after = expr.slice((m.index ?? 0) + m[0].length);
    if (/^\s*\(/.test(after) && /^[A-Z][A-Z0-9_]*$/.test(left)) {
      packages.add(left);
      functions.add(right);
      continue;
    }
    columns.add(`${left}.${right}`);
    aliases.add(left);
  }

  // FROM / JOIN object hints inside subselect snippets
  for (const m of expr.matchAll(/\b(?:FROM|JOIN)\s+([A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)?)/gi)) {
    subqueries.add(m[1]!);
  }

  deps.referencedPackages = [...packages];
  deps.referencedFunctions = [...functions];
  deps.referencedColumns = [...columns];
  deps.referencedAliases = [...aliases];
  deps.referencedSubqueryObjects = [...subqueries];
  return deps;
}

function parseConditionParts(raw?: string | null): Stage2dJoinCondition | null {
  if (!raw) return null;
  const m = raw
    .trim()
    .match(
      /^([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/,
    );
  if (!m) return null;
  return {
    leftAlias: m[1],
    leftColumn: m[2],
    operator: m[3],
    rightAlias: m[4],
    rightColumn: m[5],
    confidence: 'confirmed_from_literal',
  };
}

function conditionEqual(a?: Stage2dJoinCondition | null, b?: Stage2dJoinCondition | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    normAlias(a.leftAlias) === normAlias(b.leftAlias) &&
    normObj(a.leftColumn) === normObj(b.leftColumn) &&
    (a.operator ?? '=') === (b.operator ?? '=') &&
    normAlias(a.rightAlias) === normAlias(b.rightAlias) &&
    normObj(a.rightColumn) === normObj(b.rightColumn)
  );
}

function joinKey(declaringType: string, datasetKey: string, j: Stage2dJoin): string {
  return [
    declaringType,
    datasetKey,
    normAlias(j.normalizedAlias ?? j.alias),
    normObj(j.joinedObject),
  ].join('|');
}

function mergeEvidence(a?: Stage2dEvidenceItem[] | null, b?: Stage2dEvidenceItem[] | null) {
  const out: Stage2dEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const e of [...(a ?? []), ...(b ?? [])]) {
    const k = `${e.method}|${e.offset}|${e.assignment}|${e.resolvedMember}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function classifyConditionStatus(
  j: Stage2dJoin,
  siblings: Stage2dJoin[],
): Stage2dConditionStatus {
  const hasParsed =
    !!(j.condition?.leftColumn && j.condition?.rightColumn) || !!parseConditionParts(j.rawCondition);
  const raw = (j.rawCondition ?? '').trim();
  const api = (j.sourceApi ?? '').toLowerCase();
  const apis = (j.sourceApis ?? [j.sourceApi]).map((x) => (x ?? '').toLowerCase());

  if (hasParsed || (raw && raw.toLowerCase() !== 'null')) {
    if (apis.some((a) => a.includes('addcolumn'))) return 'supplied_by_addcolumn_overload';
    if (api.includes('joindefinition') || /JoinDefinition/i.test(j.evidence?.[0]?.assignment ?? '')) {
      return 'explicit_literal';
    }
    if (raw && !j.condition) return 'explicit_reconstructed';
    return 'explicit_literal';
  }

  // null / missing — look for sibling evidence for same alias
  const sameAlias = siblings.filter(
    (s) =>
      s !== j &&
      normAlias(s.alias) === normAlias(j.alias) &&
      normObj(s.joinedObject) === normObj(j.joinedObject),
  );
  for (const s of sameAlias) {
    if (s.condition?.leftColumn || parseConditionParts(s.rawCondition)) {
      if ((s.sourceApi ?? '').toLowerCase().includes('addcolumn')) return 'supplied_by_addcolumn_overload';
      return 'added_later';
    }
  }

  if (j.inheritanceKind === 'inherited') return 'inherited_from_base';

  // Dynamic only when assignment itself shows non-literal condition loading (not opcode Callvirt noise)
  const assignText = (j.evidence ?? []).map((e) => e.assignment ?? '').join(' ');
  if (
    !raw &&
    !/\bnull\b/i.test(assignText) &&
    /AddJoin[^"]*\b(ldloc|ldarg)|condition[^\n]*(ldloc|ldarg|variable)/i.test(assignText)
  ) {
    return 'unresolved_dynamic';
  }

  // AddJoin(..., null, ...) with no other evidence
  if (api.includes('addjoin') || /AddJoin/i.test(j.evidence?.[0]?.assignment ?? '')) {
    return 'not_provided_in_il';
  }

  return 'not_provided_in_il';
}

function pickGatewayForType(
  typeFull: string,
  typeHints: Map<string, Stage2dStage2bTypeHint>,
  gatewayByType: Map<string, Stage2dStage2bGatewayHint>,
): Stage2dStage2bGatewayHint | null {
  const hint = typeHints.get(typeFull);
  const sn = simpleName(typeFull);

  // Prefer gateway whose simple name shares stem with declaring type (strip BO/TG/DF/MTG)
  const stem = sn.replace(/(BO|TG|DF|MTG|STG)$/i, '');
  const candidates = [
    ...(hint?.gateways ?? []),
    ...[...gatewayByType.values()].filter((g) => {
      const gsn = simpleName(g.gatewayType);
      return gsn.replace(/(BO|TG|DF|MTG|STG)$/i, '') === stem;
    }),
  ];

  // Prefer self gateway (TG matching type)
  const self =
    candidates.find((g) => (g.gatewayType ?? '') === typeFull) ??
    candidates.find((g) => simpleName(g.gatewayType).replace(/(TG|MTG|STG)$/i, '') === stem);
  if (self?.datasetTable || self?.viewName) return self;

  // Prefer gateway with datasetTable matching stem
  const byDs = candidates.find(
    (g) => (g.datasetTable ?? '').toLowerCase() === stem.toLowerCase() && g.viewName,
  );
  if (byDs) return byDs;

  return candidates.find((g) => g.datasetTable || g.viewName) ?? null;
}

function normalizeProjectedColumns(
  cols: Stage2dProjectedColumn[] | undefined,
  audit: Stage2d1AuditExtras,
  declaringType: string,
): Stage2dProjectedColumn[] {
  return (cols ?? []).map((c) => {
    const expression = c.expression ?? null;
    const sourceAlias = c.sourceAlias ?? null;
    const sourceColumn = c.sourceColumn ?? null;
    const calculated = !!c.calculated;

    // Detect when datasetColumn was wrongly set to full ALIAS.COLUMN
    const rawDs = c.datasetColumn ?? null;
    const looksLikeExprAsName =
      !!rawDs &&
      (rawDs.includes('.') ||
        (sourceAlias &&
          sourceColumn &&
          rawDs.toUpperCase() === `${sourceAlias}.${sourceColumn}`.toUpperCase()) ||
        (expression && rawDs.toUpperCase() === expression.toUpperCase() && expression.includes('.')));

    // Explicit name: second AddColumn arg distinct from expression
    const evidenceAssign = (c.evidence ?? []).map((e) => e.assignment ?? '').join(' ');
    const hasExplicitSecondArg =
      /AddColumn\s*\(\s*"[^"]+"\s*,\s*"[^"]+"\s*\)/i.test(evidenceAssign) ||
      (!!rawDs &&
        !looksLikeExprAsName &&
        !!expression &&
        rawDs.toUpperCase() !== expression.toUpperCase());

    let datasetColumnExplicit: string | null = null;
    let effectiveDatasetColumn: string | null = null;
    let effectiveDatasetColumnStatus: string = 'unresolved';

    if (hasExplicitSecondArg && rawDs && !looksLikeExprAsName) {
      datasetColumnExplicit = rawDs;
      effectiveDatasetColumn = rawDs;
      effectiveDatasetColumnStatus = 'explicit';
    } else if (looksLikeExprAsName || (!rawDs && expression?.includes('.'))) {
      datasetColumnExplicit = null;
      // Framework often derives last segment or ALIAS_COLUMN
      if (sourceAlias && sourceColumn) {
        effectiveDatasetColumn = sourceColumn;
        effectiveDatasetColumnStatus = 'framework_derived';
      } else if (expression?.includes('.')) {
        effectiveDatasetColumn = expression.split('.').pop() ?? null;
        effectiveDatasetColumnStatus = 'framework_derived';
      } else {
        effectiveDatasetColumn = null;
        effectiveDatasetColumnStatus = 'unresolved';
      }
      pushEx(
        audit.examples.projectedColumnsWithoutExplicitDatasetAlias,
        `${declaringType}: ${expression ?? rawDs} → effective=${effectiveDatasetColumn}`,
      );
      audit.projectedColumnsWithoutExplicitDatasetAlias += 1;
    } else if (rawDs) {
      datasetColumnExplicit = rawDs;
      effectiveDatasetColumn = rawDs;
      effectiveDatasetColumnStatus = 'explicit';
    } else if (sourceColumn) {
      datasetColumnExplicit = null;
      effectiveDatasetColumn = sourceColumn;
      effectiveDatasetColumnStatus = 'framework_derived';
      audit.projectedColumnsWithoutExplicitDatasetAlias += 1;
      pushEx(
        audit.examples.projectedColumnsWithoutExplicitDatasetAlias,
        `${declaringType}: ${expression} → effective=${effectiveDatasetColumn}`,
      );
    }

    let calculatedDependencies: Stage2dCalculatedDeps | null = null;
    if (calculated && expression) {
      calculatedDependencies = parseCalculatedDependencies(expression);
      if (
        (calculatedDependencies.referencedPackages?.length ?? 0) > 0 ||
        (calculatedDependencies.referencedColumns?.length ?? 0) > 0
      ) {
        audit.calculatedExpressionDependenciesParsed += 1;
        pushEx(
          audit.examples.calculatedExpressionDependenciesParsed,
          `${declaringType}: ${expression.slice(0, 80)} → pkgs=${(calculatedDependencies.referencedPackages ?? []).join(',')}`,
        );
      }
    }

    return {
      ...c,
      expression,
      sourceAlias,
      sourceColumn,
      datasetColumn: datasetColumnExplicit ?? effectiveDatasetColumn,
      datasetColumnExplicit,
      effectiveDatasetColumn,
      effectiveDatasetColumnStatus,
      calculated,
      calculatedDependencies,
    };
  });
}

function mergeJoinsForDataset(
  d: Stage2dDatasetModel,
  audit: Stage2d1AuditExtras,
): Stage2dJoin[] {
  const declaringType = d.declaringType ?? '';
  const datasetKey = d.datasetTable ?? simpleName(declaringType);
  const raw = [...(d.joins ?? [])];
  const buckets = new Map<string, Stage2dJoin[]>();

  for (const j of raw) {
    const rawAlias = j.alias ?? j.rawAlias ?? null;
    const normalized = normAlias(rawAlias) || null;
    const enriched: Stage2dJoin = {
      ...j,
      rawAlias,
      normalizedAlias: normalized,
      alias: rawAlias,
    };
    const key = joinKey(declaringType, datasetKey, enriched);
    const list = buckets.get(key) ?? [];
    list.push(enriched);
    buckets.set(key, list);
  }

  const merged: Stage2dJoin[] = [];
  for (const group of buckets.values()) {
    if (group.length === 1) {
      const only = group[0]!;
      only.conditionStatus = classifyConditionStatus(only, raw);
      only.sourceApis = only.sourceApi ? [only.sourceApi] : [];
      merged.push(only);
      continue;
    }

    audit.duplicateJoinEvidenceMerged += group.length - 1;
    pushEx(
      audit.examples.duplicateJoinEvidenceMerged,
      `${declaringType}: ${group[0]!.alias} / ${group[0]!.joinedObject} ×${group.length} [${group.map((g) => g.sourceApi).join('+')}]`,
    );

    // Prefer condition-bearing + JoinDefinition / AddJoin over bare
    const withCond = group.filter(
      (g) => g.condition?.leftColumn || parseConditionParts(g.rawCondition),
    );
    const preferred =
      withCond.find((g) => /joindefinition/i.test(g.sourceApi ?? '')) ??
      withCond[0] ??
      group.find((g) => /addjoin/i.test(g.sourceApi ?? '')) ??
      group[0]!;

    const joinTypes = [
      ...new Set(group.map((g) => (g.joinType ?? 'UNKNOWN').toUpperCase()).filter(Boolean)),
    ];
    const conditions = group
      .map((g) => g.condition ?? parseConditionParts(g.rawCondition))
      .filter(Boolean) as Stage2dJoinCondition[];
    let conflicting = false;
    const alternatives: Array<Record<string, unknown>> = [];

    if (joinTypes.length > 1) {
      conflicting = true;
      alternatives.push({ field: 'joinType', values: joinTypes });
    }
    for (let i = 1; i < conditions.length; i++) {
      if (!conditionEqual(conditions[0], conditions[i])) {
        conflicting = true;
        alternatives.push({ field: 'condition', values: conditions });
        break;
      }
    }

    if (conflicting) {
      audit.conflictingJoinDefinitions += 1;
      pushEx(
        audit.examples.conflictingJoinDefinitions,
        `${declaringType}: ${preferred.alias} / ${preferred.joinedObject}`,
      );
    }

    const allEvidence = group.reduce(
      (acc, g) => mergeEvidence(acc, g.evidence),
      [] as Stage2dEvidenceItem[],
    );
    const sourceApis = [...new Set(group.map((g) => g.sourceApi).filter(Boolean) as string[])];

    const out: Stage2dJoin = {
      ...preferred,
      joinType: conflicting && joinTypes.length > 1 ? preferred.joinType : preferred.joinType,
      condition: preferred.condition ?? parseConditionParts(preferred.rawCondition),
      rawCondition: preferred.rawCondition ?? withCond[0]?.rawCondition ?? null,
      sourceApi: preferred.sourceApi,
      sourceApis,
      evidence: allEvidence,
      alternatives: conflicting ? alternatives : null,
      confidence: conflicting ? 'conflicting' : preferred.confidence ?? 'confirmed_from_il',
    };
    out.conditionStatus = classifyConditionStatus(out, group);
    // If sibling had condition via AddColumn, adopt it
    if (
      (!out.condition || !out.condition.leftColumn) &&
      withCond.length > 0 &&
      withCond[0] !== preferred
    ) {
      out.condition = withCond[0]!.condition ?? parseConditionParts(withCond[0]!.rawCondition);
      out.rawCondition = withCond[0]!.rawCondition ?? out.rawCondition;
      out.conditionStatus = 'supplied_by_addcolumn_overload';
    }
    merged.push(out);
  }

  return merged;
}

function applyInheritance(
  datasets: Stage2dDatasetModel[],
  typeHints: Map<string, Stage2dStage2bTypeHint>,
  audit: Stage2d1AuditExtras,
): void {
  const byType = new Map(datasets.map((d) => [d.declaringType ?? '', d]));
  /** Snapshot of locally declared joins before inheritance merge. */
  const declaredSnapshot = new Map(
    datasets.map((d) => [d.declaringType ?? '', [...(d.joins ?? [])]]),
  );

  for (const d of datasets) {
    const full = d.declaringType ?? '';
    const hint = typeHints.get(full);
    const chain = hint?.inheritanceChain ?? d.inheritanceChain ?? [];
    const baseType = hint?.baseType ?? d.baseType ?? chain[0] ?? null;
    d.baseType = baseType;
    d.inheritanceChain = chain.length ? chain : d.inheritanceChain;

    const localKeys = new Set(
      (d.joins ?? []).map((j) =>
        joinKey(full, d.datasetTable ?? simpleName(full), j),
      ),
    );

    const inherited: Stage2dJoin[] = [];
    for (const ancestor of chain) {
      if (!ancestor || ancestor === full) continue;
      const baseDs = byType.get(ancestor);
      const baseJoins = declaredSnapshot.get(ancestor) ?? [];
      if (!baseJoins.length) continue;
      for (const j of baseJoins) {
        const key = joinKey(full, d.datasetTable ?? simpleName(full), {
          ...j,
          normalizedAlias: normAlias(j.alias),
        });
        // Same logical join already declared locally → skip duplicate
        const localSame = (d.joins ?? []).some(
          (lj) =>
            normAlias(lj.alias) === normAlias(j.alias) &&
            normObj(lj.joinedObject) === normObj(j.joinedObject),
        );
        if (localSame) continue;
        if (localKeys.has(key)) continue;

        const copy: Stage2dJoin = {
          ...j,
          inheritanceKind: 'inherited',
          declaredOnType: ancestor,
          inheritedByType: full,
          sourceAssembly: baseDs?.assemblyName ?? j.sourceAssembly ?? null,
          conditionStatus:
            j.conditionStatus === 'explicit_literal' || j.condition?.leftColumn
              ? 'inherited_from_base'
              : j.conditionStatus ?? 'inherited_from_base',
          confidence: j.confidence ?? 'inherited_from_base_type',
          evidence: mergeEvidence(j.evidence, [
            {
              method: 'inheritance',
              assignment: `inherited from ${ancestor}`,
              resolvedMember: ancestor,
            },
          ]),
        };
        inherited.push(copy);
        audit.inheritedJoins += 1;
        pushEx(
          audit.examples.inheritedJoins,
          `${full} ← ${ancestor}: ${j.alias} → ${j.joinedObject}`,
        );
      }
    }

    const declared = (d.joins ?? []).map((j) => ({
      ...j,
      inheritanceKind: j.inheritanceKind ?? ('declared' as const),
      declaredOnType: j.declaredOnType ?? full,
      inheritedByType: null,
      sourceAssembly: j.sourceAssembly ?? d.assemblyName ?? null,
    }));

    d.declaredJoins = declared;
    d.inheritedJoins = inherited;
    d.effectiveJoins = [...declared, ...inherited];
    d.joins = d.effectiveJoins;
  }
}

function bumpConditionAudit(j: Stage2dJoin, audit: Stage2d1AuditExtras, declaringType: string) {
  const status = j.conditionStatus ?? 'not_provided_in_il';
  const line = `${declaringType}: ${j.alias} → ${j.joinedObject} [${status}] ${j.rawCondition ?? '(null)'}`;
  switch (status) {
    case 'explicit_literal':
    case 'explicit_reconstructed':
      audit.joinsExplicitCondition += 1;
      pushEx(audit.examples.joinsExplicitCondition, line);
      break;
    case 'inherited_from_base':
      audit.joinsInheritedCondition += 1;
      pushEx(audit.examples.joinsInheritedCondition, line);
      break;
    case 'added_later':
      audit.joinsConditionAddedLater += 1;
      pushEx(audit.examples.joinsConditionAddedLater, line);
      break;
    case 'framework_default':
      audit.joinsFrameworkDefault += 1;
      pushEx(audit.examples.joinsFrameworkDefault, line);
      break;
    case 'unresolved_dynamic':
      audit.joinsDynamicUnresolved += 1;
      pushEx(audit.examples.joinsDynamicUnresolved, line);
      break;
    case 'supplied_by_addcolumn_overload':
      audit.joinsSuppliedByAddColumn += 1;
      pushEx(audit.examples.joinsSuppliedByAddColumn, line);
      break;
    case 'not_provided_in_il':
    default:
      audit.joinsNotProvidedInIl += 1;
      pushEx(audit.examples.joinsNotProvidedInIl, line);
      break;
  }
}

function reconstructMainSource(
  d: Stage2dDatasetModel,
  gw: Stage2dStage2bGatewayHint | null,
  audit: Stage2d1AuditExtras,
): void {
  const joins = d.joins ?? [];
  const joinedObjects = new Set(joins.map((j) => normObj(j.joinedObject)));
  const joinedAliases = new Set(joins.map((j) => normAlias(j.alias)));

  // Collect candidates from join conditions (side that is not a joined alias)
  const fromConditions: Array<{ objectName: string; alias: string; via: string }> = [];
  for (const j of joins) {
    const cond = j.condition ?? parseConditionParts(j.rawCondition);
    if (!cond) continue;
    for (const side of [
      { alias: cond.leftAlias, col: cond.leftColumn },
      { alias: cond.rightAlias, col: cond.rightColumn },
    ]) {
      const a = normAlias(side.alias);
      if (!a) continue;
      // Table-qualified name used as "alias" in condition (NT_KP_...)
      if (/^NT_|^V_|^T_/i.test(side.alias ?? '') && !joinedAliases.has(a)) {
        fromConditions.push({
          objectName: side.alias!,
          alias: side.alias!,
          via: 'join_condition',
        });
      } else if (!joinedAliases.has(a) && !joinedObjects.has(a)) {
        fromConditions.push({
          objectName: side.alias!,
          alias: side.alias!,
          via: 'join_condition_alias',
        });
      }
    }
    // joinedObject side of equality referencing main table name
    const raw = j.rawCondition ?? '';
    const m = raw.match(/\b(NT_[A-Z0-9_]+|V_[A-Z0-9_]+)\b/gi);
    if (m) {
      for (const obj of m) {
        if (!joinedObjects.has(normObj(obj)) && normObj(obj) !== normObj(j.joinedObject)) {
          fromConditions.push({ objectName: obj, alias: obj, via: 'join_condition_object' });
        }
      }
    }
  }

  const existing = d.mainSource;
  const gwView = gw?.viewName || gw?.baseTableName || null;
  const gwAlias = gw?.alias || null;

  if (gwView) {
    // Stage 2B is authoritative when present
    const condMatch = fromConditions.find((c) => normObj(c.objectName) === normObj(gwView));
    d.mainSource = {
      objectName: gwView,
      alias: gwAlias ?? existing?.alias ?? condMatch?.alias ?? gwView,
      objectKind: existing?.objectKind ?? (gw?.viewName ? 'view' : 'table'),
      source: condMatch
        ? 'confirmed_from_join_condition_and_stage2b'
        : 'confirmed_from_stage2b',
      confidence: 'confirmed_from_stage2b',
      evidence: mergeEvidence(existing?.evidence, [
        {
          method: 'Stage2B.gateway',
          assignment: `viewName=${gwView}; alias=${gwAlias}; datasetTable=${gw?.datasetTable}`,
          resolvedMember: gw?.gatewayType ?? null,
        },
      ]),
    };
    audit.datasetsWithConfirmedMainSource += 1;
    pushEx(
      audit.examples.datasetsWithConfirmedMainSource,
      `${d.declaringType}: ${d.mainSource.objectName} AS ${d.mainSource.alias} (${d.mainSource.source})`,
    );
    return;
  }

  if (existing?.objectName && !looksLikeColumnNotDatasetTable(existing.objectName)) {
    d.mainSource = {
      ...existing,
      source: existing.source ?? 'confirmed_from_il',
      confidence: existing.confidence ?? 'confirmed_from_il',
    };
    audit.datasetsWithConfirmedMainSource += 1;
    pushEx(
      audit.examples.datasetsWithConfirmedMainSource,
      `${d.declaringType}: ${d.mainSource.objectName} AS ${d.mainSource.alias} (il)`,
    );
    return;
  }

  if (fromConditions.length > 0) {
    // Prefer NT_ objects appearing most often
    const counts = new Map<string, { c: number; sample: (typeof fromConditions)[0] }>();
    for (const c of fromConditions) {
      const k = normObj(c.objectName);
      const cur = counts.get(k);
      if (!cur) counts.set(k, { c: 1, sample: c });
      else cur.c += 1;
    }
    const best = [...counts.values()].sort((a, b) => b.c - a.c)[0]!.sample;
    d.mainSource = {
      objectName: best.objectName,
      alias: best.alias,
      objectKind: /^NT_/i.test(best.objectName) ? 'view' : 'table',
      source: 'confirmed_from_join_condition',
      confidence: 'confirmed_from_il',
      evidence: [
        {
          method: 'join.condition',
          assignment: `inferred from join condition side (${best.via})`,
        },
      ],
    };
    audit.datasetsWithConfirmedMainSource += 1;
    pushEx(
      audit.examples.datasetsWithConfirmedMainSource,
      `${d.declaringType}: ${d.mainSource.objectName} AS ${d.mainSource.alias} (join)`,
    );
    return;
  }

  if (joins.length > 0) {
    d.mainSource = {
      objectName: null,
      alias: null,
      objectKind: null,
      source: 'unresolved',
      confidence: 'unresolved',
      evidence: [
        {
          method: 'Stage2D.1',
          assignment: 'joins present but no Stage2B gateway / condition side for mainSource',
        },
      ],
    };
    audit.datasetsWithUnresolvedMainSource += 1;
    pushEx(
      audit.examples.datasetsWithUnresolvedMainSource,
      `${d.declaringType}: unresolved (${joins.length} joins)`,
    );
  }
}

function fixDatasetTable(
  d: Stage2dDatasetModel,
  gw: Stage2dStage2bGatewayHint | null,
  typeHint: Stage2dStage2bTypeHint | undefined,
  audit: Stage2d1AuditExtras,
): void {
  const original = d.datasetTable ?? null;
  const wasBad = looksLikeColumnNotDatasetTable(original);

  // Valid IL / already good
  if (looksLikeValidDatasetTable(original) && !wasBad) {
    d.datasetTableStatus = 'confirmed_from_il';
    d.datasetTableEvidence = mergeEvidence(d.evidence, [
      { method: 'IL.datasetTable', assignment: `datasetTable=${original}` },
    ]);
    audit.datasetsWithConfirmedDatasetTable += 1;
    pushEx(
      audit.examples.datasetsWithConfirmedDatasetTable,
      `${d.declaringType}: ${original} (il)`,
    );
    return;
  }

  if (wasBad) {
    audit.datasetTableColumnMisclassificationsFixed += 1;
    pushEx(
      audit.examples.datasetTableColumnMisclassificationsFixed,
      `${d.declaringType}: cleared '${original}' (column-like)`,
    );
    d.datasetTable = null;
  }

  // Stage 2B gateway dataset table
  if (gw?.datasetTable && looksLikeValidDatasetTable(gw.datasetTable)) {
    d.datasetTable = gw.datasetTable;
    d.datasetTableStatus = 'confirmed_from_stage2b';
    d.datasetTableEvidence = [
      {
        method: 'Stage2B.gateway',
        assignment: `datasetTable=${gw.datasetTable}`,
        resolvedMember: gw.gatewayType ?? null,
      },
    ];
    audit.datasetsWithConfirmedDatasetTable += 1;
    pushEx(
      audit.examples.datasetsWithConfirmedDatasetTable,
      `${d.declaringType}: ${d.datasetTable} (stage2b${wasBad ? `; was ${original}` : ''})`,
    );
    return;
  }

  // datasetTables list on type hint
  const fromType = (typeHint?.datasetTables ?? [])
    .map((x) => x.name)
    .find((n) => looksLikeValidDatasetTable(n));
  if (fromType) {
    d.datasetTable = fromType;
    d.datasetTableStatus = 'confirmed_from_stage2b';
    d.datasetTableEvidence = [
      { method: 'Stage2B.type.datasetTables', assignment: `datasetTable=${fromType}` },
    ];
    audit.datasetsWithConfirmedDatasetTable += 1;
    pushEx(
      audit.examples.datasetsWithConfirmedDatasetTable,
      `${d.declaringType}: ${fromType} (stage2b type)`,
    );
    return;
  }

  // Prefer PascalCase stem from type name only as unresolved hint — do NOT invent as confirmed
  d.datasetTable = d.datasetTable && looksLikeValidDatasetTable(d.datasetTable) ? d.datasetTable : null;
  d.datasetTableStatus = 'unresolved';
  d.datasetTableEvidence = [
    {
      method: 'Stage2D.1',
      assignment: wasBad
        ? `rejected column-like '${original}'; no Stage2B/IL table name`
        : 'no confirmed DataSet table name',
    },
  ];
  audit.datasetsWithUnresolvedDatasetTable += 1;
  pushEx(
    audit.examples.datasetsWithUnresolvedDatasetTable,
    `${d.declaringType}: unresolved${wasBad ? ` (was ${original})` : ''}`,
  );
}

/**
 * Normalize Stage 2D IL output into Stage 2D.1 semantic model.
 */
export function normalizeStage2d1(
  datasetsIn: Stage2dDatasetModel[],
  options: Stage2d1NormalizeOptions = {},
): Stage2d1NormalizeResult {
  const audit: Stage2d1AuditExtras = {
    datasetTableColumnMisclassificationsFixed: 0,
    datasetsWithConfirmedDatasetTable: 0,
    datasetsWithUnresolvedDatasetTable: 0,
    datasetsWithConfirmedMainSource: 0,
    datasetsWithUnresolvedMainSource: 0,
    joinsExplicitCondition: 0,
    joinsInheritedCondition: 0,
    joinsConditionAddedLater: 0,
    joinsFrameworkDefault: 0,
    joinsDynamicUnresolved: 0,
    joinsNotProvidedInIl: 0,
    joinsSuppliedByAddColumn: 0,
    duplicateJoinEvidenceMerged: 0,
    conflictingJoinDefinitions: 0,
    inheritedJoins: 0,
    projectedColumnsWithoutExplicitDatasetAlias: 0,
    calculatedExpressionDependenciesParsed: 0,
    examples: emptyExamples(),
  };

  const typeHints = new Map<string, Stage2dStage2bTypeHint>();
  for (const t of options.stage2bTypes ?? []) {
    if (t.fullName) typeHints.set(t.fullName, t);
  }
  const gatewayByType = new Map<string, Stage2dStage2bGatewayHint>();
  for (const g of options.stage2bGateways ?? []) {
    if (g.gatewayType) gatewayByType.set(g.gatewayType, g);
  }
  // Also index gateways from type hints
  for (const t of options.stage2bTypes ?? []) {
    for (const g of t.gateways ?? []) {
      if (g.gatewayType && !gatewayByType.has(g.gatewayType)) {
        gatewayByType.set(g.gatewayType, { ...g, declaringType: t.fullName });
      }
    }
  }

  // Deep-ish copy so we don't mutate caller unexpectedly across retries
  const datasets: Stage2dDatasetModel[] = datasetsIn.map((d) => ({
    ...d,
    joins: (d.joins ?? []).map((j) => ({ ...j, evidence: [...(j.evidence ?? [])] })),
    projectedColumns: (d.projectedColumns ?? []).map((c) => ({
      ...c,
      evidence: [...(c.evidence ?? [])],
    })),
    datasetColumns: (d.datasetColumns ?? []).map((c) => ({ ...c })),
    mainSource: d.mainSource ? { ...d.mainSource } : null,
    evidence: [...(d.evidence ?? [])],
  }));

  // Pass 1: datasetTable, merge joins, projected columns, mainSource (per dataset)
  for (const d of datasets) {
    const full = d.declaringType ?? '';
    const typeHint = typeHints.get(full);
    const gw = pickGatewayForType(full, typeHints, gatewayByType);

    fixDatasetTable(d, gw, typeHint, audit);
    d.joins = mergeJoinsForDataset(d, audit);
    d.projectedColumns = normalizeProjectedColumns(d.projectedColumns ?? undefined, audit, full);
    reconstructMainSource(d, gw, audit);

    for (const j of d.joins ?? []) {
      bumpConditionAudit(j, audit, full);
    }

    d.stage2d1Normalized = true;
  }

  // Pass 2: inheritance (needs all datasets normalized first for base joins)
  applyInheritance(datasets, typeHints, audit);

  // Audit conditionStatus for inherited joins (not counted in pass 1)
  for (const d of datasets) {
    for (const j of d.inheritedJoins ?? []) {
      bumpConditionAudit(j, audit, d.declaringType ?? '');
    }
  }

  return { datasets, audit };
}

export function mergeStage2d1IntoSummary(
  base: Stage2dAuditSummary,
  extras: Stage2d1AuditExtras,
): Stage2dAuditSummary {
  return {
    ...base,
    datasetTableColumnMisclassificationsFixed: extras.datasetTableColumnMisclassificationsFixed,
    datasetsWithConfirmedDatasetTable: extras.datasetsWithConfirmedDatasetTable,
    datasetsWithUnresolvedDatasetTable: extras.datasetsWithUnresolvedDatasetTable,
    datasetsWithConfirmedMainSource: extras.datasetsWithConfirmedMainSource,
    datasetsWithUnresolvedMainSource: extras.datasetsWithUnresolvedMainSource,
    joinsExplicitCondition: extras.joinsExplicitCondition,
    joinsInheritedCondition: extras.joinsInheritedCondition,
    joinsConditionAddedLater: extras.joinsConditionAddedLater,
    joinsFrameworkDefault: extras.joinsFrameworkDefault,
    joinsDynamicUnresolved: extras.joinsDynamicUnresolved,
    joinsNotProvidedInIl: extras.joinsNotProvidedInIl,
    joinsSuppliedByAddColumn: extras.joinsSuppliedByAddColumn,
    duplicateJoinEvidenceMerged: extras.duplicateJoinEvidenceMerged,
    conflictingJoinDefinitions: extras.conflictingJoinDefinitions,
    inheritedJoins: extras.inheritedJoins,
    projectedColumnsWithoutExplicitDatasetAlias: extras.projectedColumnsWithoutExplicitDatasetAlias,
    calculatedExpressionDependenciesParsed: extras.calculatedExpressionDependenciesParsed,
  };
}

export function emptyStage2d1AuditFields(): Pick<
  Stage2dAuditSummary,
  | 'datasetTableColumnMisclassificationsFixed'
  | 'datasetsWithConfirmedDatasetTable'
  | 'datasetsWithUnresolvedDatasetTable'
  | 'datasetsWithConfirmedMainSource'
  | 'datasetsWithUnresolvedMainSource'
  | 'joinsExplicitCondition'
  | 'joinsInheritedCondition'
  | 'joinsConditionAddedLater'
  | 'joinsFrameworkDefault'
  | 'joinsDynamicUnresolved'
  | 'joinsNotProvidedInIl'
  | 'joinsSuppliedByAddColumn'
  | 'duplicateJoinEvidenceMerged'
  | 'conflictingJoinDefinitions'
  | 'inheritedJoins'
  | 'projectedColumnsWithoutExplicitDatasetAlias'
  | 'calculatedExpressionDependenciesParsed'
> {
  return {
    datasetTableColumnMisclassificationsFixed: 0,
    datasetsWithConfirmedDatasetTable: 0,
    datasetsWithUnresolvedDatasetTable: 0,
    datasetsWithConfirmedMainSource: 0,
    datasetsWithUnresolvedMainSource: 0,
    joinsExplicitCondition: 0,
    joinsInheritedCondition: 0,
    joinsConditionAddedLater: 0,
    joinsFrameworkDefault: 0,
    joinsDynamicUnresolved: 0,
    joinsNotProvidedInIl: 0,
    joinsSuppliedByAddColumn: 0,
    duplicateJoinEvidenceMerged: 0,
    conflictingJoinDefinitions: 0,
    inheritedJoins: 0,
    projectedColumnsWithoutExplicitDatasetAlias: 0,
    calculatedExpressionDependenciesParsed: 0,
  };
}
