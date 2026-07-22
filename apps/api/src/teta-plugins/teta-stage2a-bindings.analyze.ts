import * as path from 'path';
import type { TetaPluginRegistryEntry } from './teta-plugin-form-registry.types';
import { readStage2aBindingsBatch } from './teta-stage2a-bindings.reader';
import type {
  Stage2aAuditSummary,
  Stage2aFormBinding,
} from './teta-stage2a-bindings.types';
import {
  collectAnomalyStats,
  normalizeStage2aForm,
  type Stage2aNormalizedForm,
} from './teta-stage2a-normalize';

const VERIFIED = new Set([
  'verified_exact',
  'verified_normalized',
  'verified_case_insensitive',
  'matched_unique_simple_name',
]);

export function selectStage2aRegistryEntries(
  entries: TetaPluginRegistryEntry[],
): TetaPluginRegistryEntry[] {
  return entries.filter(
    (e) =>
      e.dllStatus === 'resolved' &&
      e.resolvedDllPath &&
      e.className &&
      VERIFIED.has(e.classVerificationStatus),
  );
}

export function analyzeStage2aForms(options: {
  entries: TetaPluginRegistryEntry[];
  pluginsRoot: string;
  chunkSize?: number;
}): Stage2aNormalizedForm[] {
  const selected = selectStage2aRegistryEntries(options.entries);
  const byDll = new Map<string, TetaPluginRegistryEntry[]>();
  for (const entry of selected) {
    const key = path.resolve(entry.resolvedDllPath!).toLowerCase();
    const list = byDll.get(key) ?? [];
    list.push(entry);
    byDll.set(key, list);
  }

  const forms: Stage2aNormalizedForm[] = [];
  const requests = [...byDll.entries()].map(([, group]) => ({
    dllPath: group[0].resolvedDllPath!,
    match: [...new Set(group.map((g) => g.className!).filter(Boolean))],
    pluginsRoot: options.pluginsRoot,
  }));

  const chunkSize = options.chunkSize ?? 8;
  for (let i = 0; i < requests.length; i += chunkSize) {
    const chunk = requests.slice(i, i + chunkSize);
    const results = readStage2aBindingsBatch(chunk);
    for (const result of results) {
      if (!result.ok || !result.forms) continue;
      for (const form of result.forms) {
        const matchEntry = selected.find(
          (e) =>
            e.className === form.formType ||
            (e.matchedType?.fullName && e.matchedType.fullName === form.formType),
        );
        if (matchEntry) {
          form.registryId = matchEntry.registryId;
          form.guid = matchEntry.guid;
          form.formIdentity = matchEntry.formIdentity;
          form.pluginType = matchEntry.pluginType;
        }
        forms.push(normalizeStage2aForm(form));
      }
    }
  }
  return forms;
}

export function summarizeStage2a(forms: Stage2aFormBinding[]): Stage2aAuditSummary {
  const summary: Stage2aAuditSummary = {
    formsAnalyzed: forms.length,
    formsWithInitializeComponent: 0,
    formsWithControlBinding: 0,
    controlCount: 0,
    uiControlCount: 0,
    dataObjectCount: 0,
    technicalFieldCount: 0,
    constantCount: 0,
    syntheticTargetCount: 0,
    confirmedBindings: 0,
    probableBindings: 0,
    candidateOnly: 0,
    businessObjectCount: 0,
    dataFactoryCount: 0,
    bosDllCount: 0,
    dataSourceCount: 0,
    lookupCount: 0,
    filterCount: 0,
    conflictCount: 0,
    formsWithoutTechnicalKnowledge: 0,
  };

  const bos = new Set<string>();
  const df = new Set<string>();
  const bo = new Set<string>();
  const ds = new Set<string>();

  for (const form of forms) {
    const n = form as Stage2aNormalizedForm;
    if (form.hasInitializeComponent) summary.formsWithInitializeComponent += 1;
    const bindings = form.bindings ?? [];
    const hasBinding = bindings.some(
      (b) =>
        b.dataMember != null ||
        b.datasetTable != null ||
        b.parameterName != null ||
        (b.binding && Object.keys(b.binding).length > 0),
    );
    if (hasBinding) summary.formsWithControlBinding += 1;
    const ui = n.uiControls?.length ?? form.controls?.length ?? 0;
    summary.uiControlCount = (summary.uiControlCount ?? 0) + ui;
    summary.controlCount = summary.uiControlCount;
    summary.dataObjectCount =
      (summary.dataObjectCount ?? 0) + (n.dataObjects?.length ?? 0);
    summary.technicalFieldCount =
      (summary.technicalFieldCount ?? 0) + (n.technicalFields?.length ?? 0);
    summary.constantCount = (summary.constantCount ?? 0) + (n.constants?.length ?? 0);
    summary.syntheticTargetCount =
      (summary.syntheticTargetCount ?? 0) + (n.syntheticTargets?.length ?? 0);
    for (const b of bindings) {
      if (b.confidence === 'confirmed_from_il' || b.confidence === 'confirmed_from_metadata') {
        summary.confirmedBindings += 1;
      } else if (b.confidence === 'probable_from_local_sequence') {
        summary.probableBindings += 1;
      } else if (b.confidence === 'candidate') {
        summary.candidateOnly += 1;
      }
    }
    for (const x of form.businessObjects ?? []) if (x.fullType) bo.add(x.fullType);
    for (const x of form.dataFactories ?? []) if (x.fullType) df.add(x.fullType);
    for (const x of form.assemblies ?? []) {
      if (x.role === 'bos' && x.name) bos.add(x.name);
    }
    for (const x of form.dataSources ?? []) if (x.name) ds.add(x.name);
    summary.lookupCount += form.lookups?.length ?? 0;
    summary.filterCount += form.filters?.length ?? 0;
    summary.conflictCount += form.conflicts?.length ?? 0;

    const hasTech =
      hasBinding ||
      (form.businessObjects?.length ?? 0) > 0 ||
      (form.dataFactories?.length ?? 0) > 0 ||
      (form.assemblies?.some((a) => a.role === 'bos') ?? false) ||
      (form.dataSources?.length ?? 0) > 0 ||
      (form.lookups?.length ?? 0) > 0 ||
      (form.filters?.length ?? 0) > 0;
    if (!hasTech) summary.formsWithoutTechnicalKnowledge += 1;
  }

  summary.businessObjectCount = bo.size;
  summary.dataFactoryCount = df.size;
  summary.bosDllCount = bos.size;
  summary.dataSourceCount = ds.size;

  const anomaly = collectAnomalyStats(forms as Stage2aNormalizedForm[]);
  Object.assign(summary, {
    bindingsWithMultipleDataMembers: anomaly.bindingsWithMultipleDataMembers,
    formatValuesPreviouslyMisclassified: anomaly.formatValuesPreviouslyMisclassified,
    parameterNamesPreviouslyMisclassified: anomaly.parameterNamesPreviouslyMisclassified,
    syntheticItemTargetsRemoved: anomaly.syntheticItemTargetsRemoved,
    nonUiFieldsRemovedFromControls: anomaly.nonUiFieldsRemovedFromControls,
    formDfCount: anomaly.formDfCount,
    controlDfCount: anomaly.controlDfCount,
    columnDfCount: anomaly.columnDfCount,
    datasourceDfCount: anomaly.datasourceDfCount,
    uncertainDfRelations: anomaly.uncertainDfRelations,
  });

  return summary;
}

export function slimFormForStorage(form: Stage2aFormBinding): Stage2aNormalizedForm {
  const n = form as Stage2aNormalizedForm;
  return {
    formIdentity: form.formIdentity,
    registryId: form.registryId,
    guid: form.guid,
    formType: form.formType,
    pluginType: form.pluginType,
    declaredOnType: form.declaredOnType,
    assembly: form.assembly,
    resolvedDllPath: form.resolvedDllPath,
    hasInitializeComponent: form.hasInitializeComponent,
    controls: (n.uiControls ?? form.controls ?? []).map((c) => ({
      fieldName: c.fieldName,
      fieldType: c.fieldType,
      controlKind: c.controlKind,
      declaringType: c.declaringType,
      inheritedFromType: c.inheritedFromType,
      confidence: c.confidence,
      assignedProperties: (c.assignedProperties ?? [])
        .filter((p) =>
          /DataMember|ColumnName|TableName|DataSource|Filter|IDColumn|Parent|Display|ValueMember|Preselection|ShortAssembly|Format|ParameterName/i.test(
            p.property ?? '',
          ),
        )
        .slice(0, 20),
    })),
    uiControls: n.uiControls ?? form.controls ?? undefined,
    dataObjects: n.dataObjects ?? undefined,
    businessObjectFields: n.businessObjectFields ?? undefined,
    constants: n.constants ?? undefined,
    technicalFields: n.technicalFields ?? undefined,
    syntheticTargets: n.syntheticTargets ?? undefined,
    dataSources: form.dataSources,
    businessObjects: form.businessObjects,
    dataFactories: form.dataFactories,
    assemblies: form.assemblies,
    bindings: form.bindings,
    dataOperations: form.dataOperations ?? undefined,
    filters: form.filters,
    lookups: form.lookups,
    relations: (form.relations ?? []).filter((r) =>
      /BO|DF|bos|control_column|dataset|lookup|tree|filter|parameter/i.test(r.relationType ?? ''),
    ),
    unresolvedEvidence: form.unresolvedEvidence,
    conflicts: form.conflicts,
    anomalyNotes: n.anomalyNotes,
  };
}

/** Pure helpers used by unit tests (confidence / structural checks). */
export function isConfirmedIlBinding(binding: {
  confidence?: string | null;
  evidence?: Array<{ assignment?: string | null; offset?: string | null }> | null;
}): boolean {
  if (binding.confidence !== 'confirmed_from_il') return false;
  return (binding.evidence ?? []).some((e) => Boolean(e.assignment && e.offset));
}

export function extractDataMembers(binding: Record<string, unknown> | null | undefined): string[] {
  if (!binding) return [];
  const raw = binding.dataMember;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [String(raw)];
}

export function getBindingField(
  b:
    | {
        dataMember?: unknown;
        datasetTable?: unknown;
        format?: unknown;
        parameterName?: unknown;
        binding?: Record<string, unknown> | null;
      }
    | null
    | undefined,
  field: 'dataMember' | 'datasetTable' | 'format' | 'parameterName',
): unknown {
  if (!b) return null;
  if (b[field] != null) return b[field];
  return b.binding?.[field] ?? null;
}
