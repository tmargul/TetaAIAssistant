import type {
  Stage2aAuditSummary,
  Stage2aControl,
  Stage2aFormBinding,
} from './teta-stage2a-bindings.types';

const UI_TYPE_HINT =
  /Control|Grid|TextBox|TextEdit|Date|CheckBox|Combo|LookUp|Lookup|ListOfValues|Tree|Tab|Group|Button|ToolBar|ToolStrip|ColumnStyle|Filter|Label|Spin|Panel|gtf|Sumo/i;

const NON_UI_TYPE =
  /^(System\.)?(String|Boolean|Int\d+|UInt\d+|Byte|Decimal|Double|Single|Object|DataSet|DataTable|DataRow|DataColumn|IBusinessObject|OperationResult|IContainer|Guid|DateTime)$/i;

const FORMAT_LIKE = /^(d|D|f|F\d*|N\d*|P\d*|C\d*|g|G|yyyy|yy|MM|dd|HH|mm|ss|[dDfFgGnNpPcC]\d*)$/;

export type FieldCategory =
  | 'uiControls'
  | 'dataObjects'
  | 'businessObjectFields'
  | 'constants'
  | 'technicalFields'
  | 'syntheticTargets';

export type Stage2aAnomalyStats = {
  bindingsWithMultipleDataMembers: number;
  formatValuesPreviouslyMisclassified: number;
  parameterNamesPreviouslyMisclassified: number;
  syntheticItemTargetsRemoved: number;
  nonUiFieldsRemovedFromControls: number;
  formDfCount: number;
  controlDfCount: number;
  columnDfCount: number;
  datasourceDfCount: number;
  uncertainDfRelations: number;
  uiControlCount: number;
  dataObjectCount: number;
  technicalFieldCount: number;
  constantCount: number;
  syntheticTargetCount: number;
  /** @deprecated use uiControlCount */
  controlCount: number;
};

export type Stage2aNormalizedForm = Omit<
  Stage2aFormBinding,
  | 'controls'
  | 'uiControls'
  | 'dataObjects'
  | 'businessObjectFields'
  | 'constants'
  | 'technicalFields'
  | 'syntheticTargets'
  | 'dataOperations'
> & {
  controls?: Stage2aControl[];
  uiControls?: Stage2aControl[];
  dataObjects?: Stage2aControl[];
  businessObjectFields?: Stage2aControl[];
  constants?: Stage2aControl[];
  technicalFields?: Stage2aControl[];
  syntheticTargets?: Stage2aControl[];
  dataOperations?: Array<{
    operationKind?: string | null;
    target?: string | null;
    targetType?: string | null;
    key?: string | null;
    value?: unknown;
    method?: string | null;
    offset?: string | null;
    confidence?: string | null;
  }>;
  anomalyNotes?: string[];
};

export function classifyFieldCategory(field: Stage2aControl): FieldCategory {
  const name = field.fieldName ?? '';
  const type = field.fieldType ?? '';

  if (!name || name === 'Item') return 'syntheticTargets';
  if (NON_UI_TYPE.test(type.split(/[.<]/)[0] ?? '') || /^(String|Boolean|Int\d+)$/i.test(type)) {
    if (/^[A-Z0-9_]+$/.test(name) && name === name.toUpperCase()) return 'constants';
    if (/DataSet|DataTable|DataRow/i.test(type)) return 'dataObjects';
    if (/IBusinessObject|\.BO\.|BusinessObject/i.test(type) || /^m_BO$/i.test(name)) {
      return 'businessObjectFields';
    }
    return 'technicalFields';
  }
  if (/DataSet|DataTable/i.test(type)) return 'dataObjects';
  if (/IBusinessObject|\.BO\./i.test(type) || name === 'm_BO') return 'businessObjectFields';
  if (/^[A-Z][A-Z0-9_]*$/.test(name) && !UI_TYPE_HINT.test(type)) return 'constants';
  if (UI_TYPE_HINT.test(type) || field.createdInMethod === 'InitializeComponent') {
    if (/^m_/i.test(name) && !UI_TYPE_HINT.test(type)) return 'technicalFields';
    return 'uiControls';
  }
  if (/^m_/i.test(name)) return 'technicalFields';
  return 'technicalFields';
}

function isFormatValue(value: unknown): boolean {
  if (value == null) return false;
  return FORMAT_LIKE.test(String(value));
}

/** Normalize one form after Stage 2A IL analysis (semantic cleanup 2A.1). */
export function normalizeStage2aForm(form: Stage2aFormBinding): Stage2aNormalizedForm {
  const notes: string[] = [];
  const out: Stage2aNormalizedForm = {
    ...form,
    controls: form.controls ?? undefined,
    uiControls: form.uiControls ?? undefined,
    dataObjects: form.dataObjects ?? undefined,
    businessObjectFields: form.businessObjectFields ?? undefined,
    constants: form.constants ?? undefined,
    technicalFields: form.technicalFields ?? undefined,
    syntheticTargets: form.syntheticTargets ?? undefined,
    dataOperations: form.dataOperations ?? undefined,
    anomalyNotes: notes,
  };

  // Prefer categories already produced by the C# reader; otherwise classify from fields.
  const hasCategories =
    (form.uiControls?.length ?? 0) +
      (form.dataObjects?.length ?? 0) +
      (form.businessObjectFields?.length ?? 0) +
      (form.constants?.length ?? 0) +
      (form.technicalFields?.length ?? 0) +
      (form.syntheticTargets?.length ?? 0) >
    0;

  if (hasCategories) {
    out.uiControls = form.uiControls ?? form.controls ?? [];
    out.dataObjects = form.dataObjects ?? [];
    out.businessObjectFields = form.businessObjectFields ?? [];
    out.constants = form.constants ?? [];
    out.technicalFields = form.technicalFields ?? [];
    out.syntheticTargets = form.syntheticTargets ?? [];
    out.controls = out.uiControls;
  } else {
    const buckets: Record<FieldCategory, Stage2aControl[]> = {
      uiControls: [],
      dataObjects: [],
      businessObjectFields: [],
      constants: [],
      technicalFields: [],
      syntheticTargets: [],
    };
    const allFields = [
      ...(form.controls ?? []),
      ...(form.uiControls ?? []),
      ...(form.dataObjects ?? []),
      ...(form.businessObjectFields ?? []),
      ...(form.constants ?? []),
      ...(form.technicalFields ?? []),
      ...(form.syntheticTargets ?? []),
    ];
    const seen = new Set<string>();
    for (const c of allFields) {
      const key = `${c.fieldName}|${c.fieldType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      buckets[classifyFieldCategory(c)].push(c);
    }
    out.uiControls = buckets.uiControls;
    out.dataObjects = buckets.dataObjects;
    out.businessObjectFields = buckets.businessObjectFields;
    out.constants = buckets.constants;
    out.technicalFields = buckets.technicalFields;
    out.syntheticTargets = buckets.syntheticTargets;
    out.controls = buckets.uiControls;
  }

  // Move Item bindings → dataOperations
  const dataOps = [...(form.dataOperations ?? [])];
  const cleanedBindings = [];
  for (const b of form.bindings ?? []) {
    if (b.control === 'Item') {
      const members = flattenMembers(b.binding?.dataMember ?? b.dataMember);
      for (const key of members) {
        dataOps.push({
          operationKind: 'indexer_assignment',
          target: 'unresolved',
          key: String(key),
          method: b.evidence?.[0]?.method,
          offset: b.evidence?.[0]?.offset,
          confidence: 'probable_from_local_sequence',
        });
      }
      notes.push(`removed synthetic Item control binding (${members.length} keys)`);
      continue;
    }

    // Split misclassified format values out of dataMember arrays
    const bag = { ...(b.binding ?? {}) };
    let dataMember: unknown = b.dataMember ?? bag.dataMember;
    let format: unknown = b.format ?? bag.format ?? null;
    const datasetTable = b.datasetTable ?? bag.datasetTable ?? null;
    const parameterName =
      b.parameterName ?? bag.parameterName ?? b.propertyBindings?.parameterName ?? null;
    const idColumn = b.idColumn ?? bag.idColumn ?? null;
    const parentIdColumn = b.parentIdColumn ?? bag.parentIdColumn ?? null;
    const nameColumn = bag.nameColumn ?? null;
    const valueColumn = bag.valueColumn ?? null;
    const valueMember = b.valueMember ?? bag.valueMember ?? null;
    const displayMember = b.displayMember ?? bag.displayMember ?? null;
    const filterExpression = b.filterExpression ?? bag.filterExpression ?? null;

    if (Array.isArray(dataMember)) {
      const formats = dataMember.filter(isFormatValue);
      const cols = dataMember.filter((x) => !isFormatValue(x));
      if (formats.length) {
        format = format ?? formats[0];
        notes.push(`split format from dataMember on ${b.control}: ${formats.join(',')}`);
      }
      dataMember = cols.length === 1 ? cols[0] : cols.length > 1 ? cols : null;
    } else if (isFormatValue(dataMember) && !format) {
      format = dataMember;
      dataMember = null;
      notes.push(`reclassified dataMember as format on ${b.control}`);
    }

    // ParameterName must not live as dataMember
    if (
      parameterName &&
      dataMember &&
      String(dataMember) === String(parameterName)
    ) {
      dataMember = null;
      notes.push(`cleared parameterName masquerading as dataMember on ${b.control}`);
    }
    if (
      !parameterName &&
      typeof dataMember === 'string' &&
      /^KP_UPR_/i.test(dataMember) &&
      /parameterName/i.test(b.evidence?.[0]?.assignment ?? '')
    ) {
      cleanedBindings.push({
        ...b,
        dataMember: null,
        datasetTable,
        format,
        parameterName: dataMember,
        valueMember,
        displayMember,
        idColumn,
        parentIdColumn,
        propertyBindings: { parameterName: dataMember },
        binding: {
          ...(datasetTable != null ? { datasetTable } : {}),
          ...(format != null ? { format } : {}),
          parameterName: dataMember,
          ...(idColumn != null ? { idColumn } : {}),
          ...(parentIdColumn != null ? { parentIdColumn } : {}),
        },
      });
      notes.push(`moved KP_UPR_* from dataMember to parameterName on ${b.control}`);
      continue;
    }

    cleanedBindings.push({
      ...b,
      dataMember,
      datasetTable,
      format,
      parameterName,
      valueMember,
      displayMember,
      filterExpression,
      idColumn,
      parentIdColumn,
      binding: {
        ...(dataMember != null ? { dataMember } : {}),
        ...(datasetTable != null ? { datasetTable } : {}),
        ...(format != null ? { format } : {}),
        ...(parameterName != null ? { parameterName } : {}),
        ...(valueMember != null ? { valueMember } : {}),
        ...(displayMember != null ? { displayMember } : {}),
        ...(filterExpression != null ? { filterExpression } : {}),
        ...(idColumn != null ? { idColumn } : {}),
        ...(parentIdColumn != null ? { parentIdColumn } : {}),
        ...(nameColumn != null ? { nameColumn } : {}),
        ...(valueColumn != null ? { valueColumn } : {}),
      },
    });
  }
  out.bindings = cleanedBindings;
  out.dataOperations = dataOps;

  // Clear heuristic relatedDf unless datasource_DF relation exists
  const dsDf = new Set(
    (form.relations ?? [])
      .filter((r) => r.relationType === 'datasource_DF')
      .map((r) => `${r.from}|${r.to}`),
  );
  out.dataSources = (form.dataSources ?? []).map((d) => {
    const key = `${d.name}|${d.relatedDf}`;
    if (d.relatedDf && !dsDf.has(key) && !dsDf.has(`${d.name}|${d.relatedDf}`)) {
      // Keep only if explicit relation present
      const has = (form.relations ?? []).some(
        (r) =>
          r.relationType === 'datasource_DF' &&
          r.from === d.name &&
          r.to === d.relatedDf,
      );
      if (!has) {
        return { ...d, relatedDf: null, relatedAssembly: d.relatedAssembly };
      }
    }
    return d;
  });

  return out;
}

function flattenMembers(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export function collectAnomalyStats(forms: Stage2aNormalizedForm[]): Stage2aAnomalyStats & {
  examples: Record<string, string[]>;
} {
  const stats: Stage2aAnomalyStats = {
    bindingsWithMultipleDataMembers: 0,
    formatValuesPreviouslyMisclassified: 0,
    parameterNamesPreviouslyMisclassified: 0,
    syntheticItemTargetsRemoved: 0,
    nonUiFieldsRemovedFromControls: 0,
    formDfCount: 0,
    controlDfCount: 0,
    columnDfCount: 0,
    datasourceDfCount: 0,
    uncertainDfRelations: 0,
    uiControlCount: 0,
    dataObjectCount: 0,
    technicalFieldCount: 0,
    constantCount: 0,
    syntheticTargetCount: 0,
    controlCount: 0,
  };
  const examples: Record<string, string[]> = {
    bindingsWithMultipleDataMembers: [],
    formatValuesPreviouslyMisclassified: [],
    parameterNamesPreviouslyMisclassified: [],
    syntheticItemTargetsRemoved: [],
    nonUiFieldsRemovedFromControls: [],
    formDf: [],
    controlDf: [],
    columnDf: [],
    datasourceDf: [],
    uncertainDf: [],
  };

  for (const form of forms) {
    stats.uiControlCount += form.uiControls?.length ?? 0;
    stats.dataObjectCount += form.dataObjects?.length ?? 0;
    stats.technicalFieldCount += form.technicalFields?.length ?? 0;
    stats.constantCount += form.constants?.length ?? 0;
    stats.syntheticTargetCount += form.syntheticTargets?.length ?? 0;
    stats.controlCount = stats.uiControlCount;

    const nonUi =
      (form.dataObjects?.length ?? 0) +
      (form.technicalFields?.length ?? 0) +
      (form.constants?.length ?? 0) +
      (form.businessObjectFields?.length ?? 0);
    stats.nonUiFieldsRemovedFromControls += nonUi;
    if (nonUi && examples.nonUiFieldsRemovedFromControls.length < 20) {
      examples.nonUiFieldsRemovedFromControls.push(
        `${form.formType}: nonUi=${nonUi} ui=${form.uiControls?.length ?? 0}`,
      );
    }

    for (const note of form.anomalyNotes ?? []) {
      // residual TS cleanup notes (legacy dumps); primary counts come from live fields above
      if (note.includes('Item') && examples.syntheticItemTargetsRemoved.length < 20) {
        examples.syntheticItemTargetsRemoved.push(`${form.formType}: ${note}`);
      }
    }

    for (const b of form.bindings ?? []) {
      if (Array.isArray(b.dataMember) || Array.isArray(b.binding?.dataMember)) {
        stats.bindingsWithMultipleDataMembers += 1;
        if (examples.bindingsWithMultipleDataMembers.length < 20) {
          examples.bindingsWithMultipleDataMembers.push(
            `${form.formType}.${b.control}: ${JSON.stringify(b.dataMember ?? b.binding?.dataMember)}`,
          );
        }
      }
      const fmt = b.format ?? b.binding?.format;
      if (fmt != null && isFormatValue(fmt)) {
        stats.formatValuesPreviouslyMisclassified += 1;
        if (examples.formatValuesPreviouslyMisclassified.length < 20) {
          examples.formatValuesPreviouslyMisclassified.push(
            `${form.formType}.${b.control}: format=${fmt} dataMember=${JSON.stringify(b.dataMember ?? b.binding?.dataMember)}`,
          );
        }
      }
      const pn = b.parameterName ?? b.binding?.parameterName ?? b.propertyBindings?.parameterName;
      if (pn != null) {
        stats.parameterNamesPreviouslyMisclassified += 1;
        if (examples.parameterNamesPreviouslyMisclassified.length < 20) {
          examples.parameterNamesPreviouslyMisclassified.push(
            `${form.formType}.${b.control}: parameterName=${pn}`,
          );
        }
      }
    }

    for (const op of form.dataOperations ?? []) {
      if (op.operationKind === 'indexer_assignment') {
        stats.syntheticItemTargetsRemoved += 1;
        if (examples.syntheticItemTargetsRemoved.length < 20) {
          examples.syntheticItemTargetsRemoved.push(
            `${form.formType}: key=${op.key} method=${op.method ?? ''} @ ${op.offset ?? ''}`,
          );
        }
      }
    }

    for (const r of form.relations ?? []) {
      switch (r.relationType) {
        case 'form_DF':
        case 'formType_DF':
          stats.formDfCount += 1;
          if (examples.formDf.length < 20) {
            examples.formDf.push(`${form.formType} → ${r.to}`);
          }
          break;
        case 'control_DF':
          stats.controlDfCount += 1;
          if (examples.controlDf.length < 20) {
            examples.controlDf.push(`${r.from} → ${r.to}`);
          }
          break;
        case 'column_DF':
          stats.columnDfCount += 1;
          if (examples.columnDf.length < 20) {
            examples.columnDf.push(`${r.from} → ${r.to}`);
          }
          break;
        case 'datasource_DF':
          stats.datasourceDfCount += 1;
          if (examples.datasourceDf.length < 20) {
            examples.datasourceDf.push(`${r.from} → ${r.to}`);
          }
          break;
        default:
          break;
      }
    }

    // DF present but only form_DF and many datasources → uncertain if not datasource_DF
    const dfs = form.dataFactories?.length ?? 0;
    const ds = form.dataSources?.length ?? 0;
    const dsDf = (form.relations ?? []).filter((r) => r.relationType === 'datasource_DF').length;
    if (dfs > 0 && ds > 1 && dsDf === 0) {
      stats.uncertainDfRelations += 1;
      if (examples.uncertainDf.length < 20) {
        examples.uncertainDf.push(
          `${form.formType}: ${dfs} DF, ${ds} DS, no datasource_DF`,
        );
      }
    }
  }

  return { ...stats, examples };
}

export function summarizeStage2aNormalized(
  forms: Stage2aNormalizedForm[],
): Stage2aAuditSummary & Stage2aAnomalyStats {
  const base = {
    formsAnalyzed: forms.length,
    formsWithInitializeComponent: 0,
    formsWithControlBinding: 0,
    controlCount: 0,
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
  const anomaly = collectAnomalyStats(forms);
  const bos = new Set<string>();
  const df = new Set<string>();
  const bo = new Set<string>();
  const ds = new Set<string>();

  for (const form of forms) {
    if (form.hasInitializeComponent) base.formsWithInitializeComponent += 1;
    const hasBinding = (form.bindings ?? []).some(
      (b) => b.dataMember != null || b.datasetTable != null || (b.binding && Object.keys(b.binding).length > 0),
    );
    if (hasBinding) base.formsWithControlBinding += 1;
    base.controlCount += form.uiControls?.length ?? form.controls?.length ?? 0;
    for (const b of form.bindings ?? []) {
      if (b.confidence === 'confirmed_from_il' || b.confidence === 'confirmed_from_metadata') {
        base.confirmedBindings += 1;
      } else if (b.confidence === 'probable_from_local_sequence') {
        base.probableBindings += 1;
      } else if (b.confidence === 'candidate') {
        base.candidateOnly += 1;
      }
    }
    for (const x of form.businessObjects ?? []) if (x.fullType) bo.add(x.fullType);
    for (const x of form.dataFactories ?? []) if (x.fullType) df.add(x.fullType);
    for (const x of form.assemblies ?? []) if (x.role === 'bos' && x.name) bos.add(x.name);
    for (const x of form.dataSources ?? []) if (x.name) ds.add(x.name);
    base.lookupCount += form.lookups?.length ?? 0;
    base.filterCount += form.filters?.length ?? 0;
    base.conflictCount += form.conflicts?.length ?? 0;
  }
  base.businessObjectCount = bo.size;
  base.dataFactoryCount = df.size;
  base.bosDllCount = bos.size;
  base.dataSourceCount = ds.size;

  return { ...base, ...anomaly };
}
