import type { Stage2aFormBinding } from './teta-stage2a-bindings.types';
import { seedStage2bFromStage2a } from './teta-stage2b.analyze';
import {
  emptyStage2d1AuditFields,
  mergeStage2d1IntoSummary,
  normalizeStage2d1,
  type Stage2d1AuditExtras,
} from './teta-stage2d-normalize';
import { readStage2dBatch } from './teta-stage2d.reader';
import type {
  Stage2dAuditSummary,
  Stage2dBatchRequest,
  Stage2dBatchResult,
  Stage2dDatasetModel,
  Stage2dStage2bGatewayHint,
  Stage2dStage2bTypeHint,
} from './teta-stage2d.types';

/** Reuse Stage 2B seed (bos assemblies + BO/DF types) without modifying Stage 2B. */
export function analyzeStage2d(options: {
  forms: Stage2aFormBinding[];
  searchRoots: string[];
  /** Optional Stage 2B read-only hints for Stage 2D.1 normalization. */
  stage2bTypes?: Stage2dStage2bTypeHint[];
  stage2bGateways?: Stage2dStage2bGatewayHint[];
  /** When false, skip 2D.1 normalize (raw IL only). Default true. */
  normalize?: boolean;
}): {
  seed: ReturnType<typeof seedStage2bFromStage2a>;
  batch: Stage2dBatchResult;
  stage2d1?: Stage2d1AuditExtras;
} {
  const seed = seedStage2bFromStage2a(options.forms);
  const request: Stage2dBatchRequest = {
    searchRoots: options.searchRoots,
    assemblies: seed.assemblies.map((a) => ({
      assemblyName: a.assemblyName,
      types: a.types,
      referencedByForms: a.referencedByForms,
    })),
  };
  const batch = readStage2dBatch(request);

  if (options.normalize === false) {
    return { seed, batch };
  }

  const { datasets, audit } = normalizeStage2d1(batch.datasets ?? [], {
    stage2bTypes: options.stage2bTypes,
    stage2bGateways: options.stage2bGateways,
  });
  batch.datasets = datasets;
  return { seed, batch, stage2d1: audit };
}

export function summarizeStage2d(
  batch: Stage2dBatchResult,
  stage2d1?: Stage2d1AuditExtras,
): Stage2dAuditSummary {
  const datasets = batch.datasets ?? [];
  let joinCount = 0;
  let joinsWithParsedCondition = 0;
  let joinsWithUnknownType = 0;
  let projectedColumnCount = 0;
  let calculatedColumnCount = 0;
  let datasetColumnCount = 0;
  let joinColumns = 0;
  let confirmedFromIl = 0;
  let probable = 0;
  let manualRequired = 0;
  let datasetsWithJoins = 0;
  let datasetsWithMainSource = 0;

  for (const d of datasets) {
    if ((d.joins?.length ?? 0) > 0) datasetsWithJoins += 1;
    if (d.mainSource?.objectName) datasetsWithMainSource += 1;
    for (const j of d.joins ?? []) {
      joinCount += 1;
      if (j.condition?.leftColumn && j.condition?.rightColumn) joinsWithParsedCondition += 1;
      if ((j.joinType ?? 'UNKNOWN').toUpperCase() === 'UNKNOWN') joinsWithUnknownType += 1;
      bumpConfidence(j.confidence);
    }
    for (const c of d.projectedColumns ?? []) {
      projectedColumnCount += 1;
      if (c.calculated) calculatedColumnCount += 1;
      bumpConfidence(c.confidence);
    }
    for (const c of d.datasetColumns ?? []) {
      datasetColumnCount += 1;
      if (c.fromJoin) joinColumns += 1;
    }
    bumpConfidence(d.confidence);
  }

  function bumpConfidence(c?: string | null) {
    if (!c) return;
    if (c.startsWith('confirmed') || c === 'inherited_from_base_type') confirmedFromIl += 1;
    else if (c === 'probable') probable += 1;
    else if (c === 'manual_required') manualRequired += 1;
  }

  const assemblies = batch.assemblies ?? [];
  const base: Stage2dAuditSummary = {
    assembliesResolved: assemblies.filter((a) => {
      const status = (a as { resolutionStatus?: string }).resolutionStatus;
      return status === 'resolved' || status === 'duplicate_same_hash';
    }).length,
    assembliesMissing: assemblies.filter(
      (a) => (a as { resolutionStatus?: string }).resolutionStatus === 'physical_file_missing',
    ).length,
    datasetsAnalyzed: datasets.length,
    datasetsWithJoins,
    datasetsWithMainSource,
    joinCount,
    joinsWithParsedCondition,
    joinsWithUnknownType,
    projectedColumnCount,
    calculatedColumnCount,
    datasetColumnCount,
    joinColumns,
    confirmedFromIl,
    probable,
    manualRequired,
    ...emptyStage2d1AuditFields(),
  };

  return stage2d1 ? mergeStage2d1IntoSummary(base, stage2d1) : base;
}

export function pickReferenceDatasets(datasets: Stage2dDatasetModel[]): Record<string, unknown> {
  const by = (re: RegExp) => datasets.find((d) => re.test(d.declaringType ?? ''));
  const sklad = by(/SkladnikiObliczZamknPracTG$/);
  const narast = by(/SkladnikiNarastajacoBO$/);
  const listyBase = by(/ListyBaseBO$/);
  const jeor = datasets.find((d) =>
    (d.joins ?? []).some((j) => /JEOR|JEDNOSTKI|JEDN_ORG/i.test(`${j.alias}|${j.joinedObject}`)),
  );

  return {
    SkladnikiObliczZamknPracTG: slimDataset(sklad),
    SkladnikiNarastajacoBO: slimDataset(narast),
    ListyBaseBO: slimDataset(listyBase),
    exampleWithJeorJoin: slimDataset(jeor),
  };
}

function slimDataset(d?: Stage2dDatasetModel | null) {
  if (!d) return null;
  return {
    declaringType: d.declaringType,
    datasetTable: d.datasetTable,
    datasetTableStatus: d.datasetTableStatus,
    mainSource: d.mainSource
      ? {
          objectName: d.mainSource.objectName,
          alias: d.mainSource.alias,
          objectKind: d.mainSource.objectKind,
          source: d.mainSource.source,
          confidence: d.mainSource.confidence,
        }
      : null,
    joins: (d.effectiveJoins ?? d.joins ?? []).map((j) => ({
      joinedObject: j.joinedObject,
      alias: j.alias,
      rawAlias: j.rawAlias,
      normalizedAlias: j.normalizedAlias,
      joinType: j.joinType,
      condition: j.condition,
      rawCondition: j.rawCondition,
      conditionStatus: j.conditionStatus,
      sourceApi: j.sourceApi,
      sourceApis: j.sourceApis,
      inheritanceKind: j.inheritanceKind,
      declaredOnType: j.declaredOnType,
      confidence: j.confidence,
    })),
    declaredJoinsCount: d.declaredJoins?.length ?? null,
    inheritedJoinsCount: d.inheritedJoins?.length ?? null,
    projectedColumns: (d.projectedColumns ?? [])
      .filter((c) => c.sourceAlias || c.calculated)
      .slice(0, 25)
      .map((c) => ({
        sourceAlias: c.sourceAlias,
        sourceColumn: c.sourceColumn,
        expression: c.expression,
        datasetColumn: c.datasetColumn,
        datasetColumnExplicit: c.datasetColumnExplicit,
        effectiveDatasetColumn: c.effectiveDatasetColumn,
        effectiveDatasetColumnStatus: c.effectiveDatasetColumnStatus,
        calculated: c.calculated,
        calculatedDependencies: c.calculatedDependencies,
      })),
  };
}
