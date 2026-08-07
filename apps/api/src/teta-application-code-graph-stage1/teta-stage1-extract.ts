import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createHash } from 'crypto';
import {
  STAGE1_CONTRACT_VERSION,
  STAGE1_SOURCE_STAGE,
  emptyStage1Audit,
  emptyStage1Metrics,
  type Stage1ApplicationPath,
  type Stage1Edge,
  type Stage1ExtractionResult,
  type Stage1NodeRef,
  type Stage1Provenance,
  type Stage1RuntimeBoundary,
} from './teta-stage1.types';
import {
  classifyRuntimeBoundary,
  controlAssignedProperty,
  isLateBindingAssignment,
  makeEdge,
  parseAddColumn,
  parseAddJoin,
  parseAddRelation,
  parseBusinessObjectReference,
  parseDictionaryTableAlias,
  parseDictionaryTableName,
  parseGatewayCtorDataset,
  parseSetBaseTableName,
  parseSetTableAlias,
  parseSetTableName,
  parseSetViewName,
  parseSimpleJoinOn,
  parseSumoCommandBuilderPackage,
} from './teta-stage1-parse';
import {
  classifyDuplicateSource,
  emptyBrokenClassificationCounts,
  emptyDuplicateCategoryCounts,
  mergeProvenance,
  nodeKey,
  preferConfidence,
  type BrokenEndpointCase,
  type BrokenEndpointClassification,
  type DuplicateSourceCategory,
} from './teta-stage1-integrity';

export const STAGE1_ARTIFACT_PATHS = {
  stage2a: path.join('.local', 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson'),
  stage2b: path.join('.local', 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson'),
  stage2d: path.join('.local', 'AIA_SQLJOIN_STAGE2D.full.ndjson'),
  stage2e: path.join('.local', 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson'),
};

type GatewayEvidence = {
  method?: string | null;
  offset?: string | null;
  assignment?: string | null;
};

type Stage2bGateway = {
  gatewayType?: string | null;
  gatewayKind?: string | null;
  declaringType?: string | null;
  assemblyName?: string | null;
  datasetTable?: string | null;
  alias?: string | null;
  viewName?: string | null;
  baseTableName?: string | null;
  packageName?: string | null;
  confidence?: string | null;
  evidence?: GatewayEvidence[] | null;
};

type GatewayAccum = {
  assembly?: string;
  kind?: string;
  datasetTable?: string | null;
  viewName?: string | null;
  baseTableName?: string | null;
  alias?: string | null;
  packageName?: string | null;
  dictionaryTableName?: string | null;
  dictionaryTableAlias?: string | null;
  evidence: GatewayEvidence[];
  joins: Array<{
    objectName: string;
    alias: string;
    joinType: string | null;
    onClause: string | null;
  }>;
  columns: Array<{ expression: string; alias: string | null }>;
  relations: Array<NonNullable<ReturnType<typeof parseAddRelation>>>;
};

async function forEachNdjson(
  filePath: string,
  onRow: (row: Record<string, unknown>) => void | Promise<void>,
): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      await onRow(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed
    }
  }
  return true;
}

function prov(
  partial: Omit<Stage1Provenance, 'confidenceClass'> & {
    confidenceClass?: Stage1Provenance['confidenceClass'];
  },
): Stage1Provenance {
  return {
    confidenceClass: partial.confidenceClass ?? 'exact_from_source',
    sourceKind: partial.sourceKind,
    sourceFile: partial.sourceFile,
    sourceAssembly: partial.sourceAssembly ?? null,
    sourceType: partial.sourceType ?? null,
    sourceMember: partial.sourceMember ?? null,
    sourceLineStart: partial.sourceLineStart ?? null,
    sourceLineEnd: partial.sourceLineEnd ?? null,
    extractionMechanism: partial.extractionMechanism,
    rawValue: partial.rawValue ?? null,
    normalizedValue: partial.normalizedValue ?? null,
    evidenceRefs: partial.evidenceRefs,
  };
}

function node(
  kind: Stage1NodeRef['kind'],
  name: string,
  attributes?: Record<string, unknown>,
): Stage1NodeRef {
  return { kind, name, attributes };
}

function accumulateGatewayEvidence(
  existing: GatewayAccum,
  g: Stage2bGateway,
  assembly: string,
): GatewayAccum {
  existing.assembly = existing.assembly || assembly || g.assemblyName || undefined;
  existing.kind = existing.kind || String(g.gatewayKind ?? '');
  existing.datasetTable = existing.datasetTable || g.datasetTable || null;
  existing.viewName = existing.viewName || g.viewName || null;
  existing.baseTableName = existing.baseTableName || g.baseTableName || null;
  existing.alias = existing.alias || g.alias || null;
  existing.packageName = existing.packageName || g.packageName || null;

  for (const ev of g.evidence ?? []) {
    const assignment = String(ev.assignment ?? '');
    if (!assignment) continue;
    existing.evidence.push(ev);

    if (isLateBindingAssignment(assignment)) continue;

    const ds = parseGatewayCtorDataset(assignment);
    if (ds) existing.datasetTable = existing.datasetTable || ds;
    const tn = parseSetTableName(assignment);
    if (tn) existing.viewName = existing.viewName || tn;
    const vn = parseSetViewName(assignment);
    if (vn) existing.viewName = existing.viewName || vn;
    const bn = parseSetBaseTableName(assignment);
    if (bn) existing.baseTableName = existing.baseTableName || bn;
    const ta = parseSetTableAlias(assignment);
    if (ta) existing.alias = existing.alias || ta;
    const pkg = parseSumoCommandBuilderPackage(assignment);
    if (pkg) existing.packageName = existing.packageName || pkg;
    const dict = parseDictionaryTableName(assignment);
    if (dict) existing.dictionaryTableName = existing.dictionaryTableName || dict;
    const dictAlias = parseDictionaryTableAlias(assignment);
    if (dictAlias) existing.dictionaryTableAlias = existing.dictionaryTableAlias || dictAlias;
    const join = parseAddJoin(assignment);
    if (join) existing.joins.push(join);
    const col = parseAddColumn(assignment);
    if (col) existing.columns.push(col);
    const rel = parseAddRelation(assignment);
    if (rel) existing.relations.push(rel);
  }
  return existing;
}

/**
 * Deterministic Stage 1 extraction from existing Stage 2A/2B/2D artifacts.
 * No Oracle connection, no model/RAG, no physical seeds as input.
 */
export async function extractApplicationCodeGraphStage1(input: {
  repoRoot: string;
  /** Optional: limit Stage2A forms (tests / focused runs). */
  formIdentityIncludes?: string[];
  /** Optional: limit Stage2B type names (tests / focused runs). */
  typeNameIncludes?: string[];
  /** When false, edges are not retained in memory (streaming via onEdge). Default true. */
  collectAllEdges?: boolean;
  /** Optional sink for streaming/bounded-memory extraction. */
  onEdge?: (edge: Stage1Edge) => void;
  /** Skip Stage2E base index (tests). Default false = load when file exists. */
  skipBaseGraphIndex?: boolean;
}): Promise<Stage1ExtractionResult> {
  const collectAllEdges = input.collectAllEdges !== false;
  const audit = emptyStage1Audit();
  const metrics = emptyStage1Metrics();
  const edges: Stage1Edge[] = [];
  const edgeById = new Map<string, Stage1Edge>();
  const nodeRegistry = new Map<string, Stage1NodeRef>();
  const runtimeBoundaries: Stage1RuntimeBoundary[] = [];
  const applicationPaths: Stage1ApplicationPath[] = [];
  const duplicateCategoryCounts = emptyDuplicateCategoryCounts();
  const brokenEndpointCases: BrokenEndpointCase[] = [];
  const brokenClassificationCounts = emptyBrokenClassificationCounts();

  const registerNode = (n: Stage1NodeRef) => {
    const k = nodeKey(n);
    if (!nodeRegistry.has(k)) nodeRegistry.set(k, n);
  };

  const addEdge = (e: Stage1Edge) => {
    metrics.rawEdgesProduced += 1;
    registerNode(e.from);
    registerNode(e.to);
    const existing = edgeById.get(e.id);
    if (existing) {
      metrics.duplicateEdgesObservedBeforeDedup += 1;
      metrics.duplicateEdgesRemoved += 1;
      const cat = classifyDuplicateSource(existing, e);
      duplicateCategoryCounts[cat] += 1;
      existing.provenance = mergeProvenance(existing.provenance, e.provenance);
      existing.confidenceClass = preferConfidence(
        existing.confidenceClass,
        e.confidenceClass,
      );
      if (e.attributes) {
        existing.attributes = {
          ...(existing.attributes ?? {}),
          ...e.attributes,
          provenanceSourcesMerged: (Number(existing.attributes?.provenanceSourcesMerged ?? 1) + 1),
        };
      }
      return;
    }
    edgeById.set(e.id, e);
    metrics.uniqueEdgesPersisted += 1;
    if (collectAllEdges) edges.push(e);
    input.onEdge?.(e);
    if (e.confidenceClass === 'exact_from_source') metrics.exactFromSourceEdges += 1;
    else if (e.confidenceClass === 'strong_static_inference') metrics.strongStaticInferenceEdges += 1;
    else if (e.confidenceClass === 'runtime_only') metrics.runtimeOnlyEdges += 1;
    else metrics.unresolvedEdges += 1;
  };

  const formToBo = new Map<string, string[]>();
  const formDatasets = new Map<string, Set<string>>();
  const gatewayByType = new Map<string, GatewayAccum>();
  const boToGateways = new Map<string, Set<string>>();
  const datasetToGateways = new Map<string, Set<string>>();
  const gatewayOwners = new Map<string, Set<string>>(); // gateway → BO/DF owners

  const stage2aPath = path.join(input.repoRoot, STAGE1_ARTIFACT_PATHS.stage2a);
  const stage2bPath = path.join(input.repoRoot, STAGE1_ARTIFACT_PATHS.stage2b);
  const stage2dPath = path.join(input.repoRoot, STAGE1_ARTIFACT_PATHS.stage2d);

  // --- Stage 2A ---
  await forEachNdjson(stage2aPath, (row) => {
    const formIdentity = String(row.formIdentity ?? '');
    if (!formIdentity) return;
    if (
      input.formIdentityIncludes &&
      !input.formIdentityIncludes.some((x) =>
        formIdentity.toLowerCase().includes(x.toLowerCase()),
      )
    ) {
      return;
    }
    metrics.formsScanned += 1;
    const formType = String(row.formType ?? formIdentity);

    const dataSources =
      ((row.dataSources as Array<Record<string, unknown>>) ??
        (row.datasources as Array<Record<string, unknown>>) ??
        []) as Array<Record<string, unknown>>;
    for (const ds of dataSources) {
      const name = String(ds.name ?? '');
      if (!name) continue;
      if (!formDatasets.has(formIdentity)) formDatasets.set(formIdentity, new Set());
      formDatasets.get(formIdentity)!.add(name);
      addEdge(
        makeEdge({
          edgeKind: 'CONTROL_BINDS_DATASET',
          from: node('application_form', formIdentity, { formType }),
          to: node('dataset', name),
          confidenceClass: String(ds.confidence ?? '').includes('confirmed')
            ? 'exact_from_source'
            : 'strong_static_inference',
          provenance: [
            prov({
              sourceKind: 'stage2a_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
              sourceType: formType,
              extractionMechanism: 'DataSourceTableName_or_dataset_table',
              rawValue: name,
              normalizedValue: name,
              evidenceRefs: [
                `stage2a:${formIdentity}`,
                `datasource:${name}`,
                ds.relatedControl ? `control:${ds.relatedControl}` : 'control:unbound',
              ],
            }),
          ],
          attributes: {
            mechanism: 'DataSourceTableName',
            relatedControl: ds.relatedControl ?? null,
            inheritedFromType: ds.inheritedFromType ?? null,
            declaredOnType: ds.declaredOnType ?? null,
            configurationScope: ds.inheritedFromType ? 'inherited' : 'declared',
          },
        }),
      );
      metrics.formToDatasetEdges += 1;
    }

    const controls = (row.controls as Array<Record<string, unknown>>) ?? [];
    for (const c of controls) {
      metrics.controlsScanned += 1;
      const cname = String(c.fieldName ?? c.name ?? '');
      if (!cname) continue;
      const dataset =
        controlAssignedProperty(c, 'DataSourceTableName') ??
        (c.datasetTable ? String(c.datasetTable) : null);
      const column =
        controlAssignedProperty(c, 'ColumnName') ??
        controlAssignedProperty(c, 'DataMember') ??
        (c.dataMember ? String(c.dataMember) : null);

      addEdge(
        makeEdge({
          edgeKind: 'FORM_HAS_CONTROL',
          from: node('application_form', formIdentity),
          to: node('ui_control', `${formIdentity}#${cname}`),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2a_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
              sourceType: formType,
              extractionMechanism: 'InitializeComponent_control',
              rawValue: cname,
              evidenceRefs: [`stage2a:${formIdentity}`, `control:${cname}`],
            }),
          ],
          attributes: {
            inheritedFromType: c.inheritedFromType ?? null,
            configurationScope: c.inheritedFromType ? 'inherited' : 'declared',
          },
        }),
      );
      if (dataset) {
        addEdge(
          makeEdge({
            edgeKind: 'CONTROL_BINDS_DATASET',
            from: node('ui_control', `${formIdentity}#${cname}`),
            to: node('dataset', dataset),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2a_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
                sourceType: formType,
                extractionMechanism: 'Bindings.Table_or_DataSourceTableName',
                rawValue: dataset,
                evidenceRefs: [`control:${cname}`, `dataset:${dataset}`],
              }),
            ],
          }),
        );
      }
      if (column) {
        addEdge(
          makeEdge({
            edgeKind: 'CONTROL_BINDS_COLUMN',
            from: node('ui_control', `${formIdentity}#${cname}`),
            to: node('oracle_column', column, { logicalColumn: true }),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2a_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
                sourceType: formType,
                extractionMechanism: 'Bindings.Column_or_ColumnName',
                rawValue: column,
                evidenceRefs: [`control:${cname}`, `column:${column}`],
              }),
            ],
          }),
        );
      }

      const lookupTable =
        controlAssignedProperty(c, 'LookupTableName') ??
        controlAssignedProperty(c, 'Lookup.ParentTable');
      const lookupDisplay =
        controlAssignedProperty(c, 'LookupDisplayMember') ??
        controlAssignedProperty(c, 'Lookup.DisplayColumn');
      const lookupKey =
        controlAssignedProperty(c, 'LookupValueMember') ??
        controlAssignedProperty(c, 'Lookup.KeyColumn');
      if (lookupTable) {
        metrics.lookupEdges += 1;
        addEdge(
          makeEdge({
            edgeKind: 'LOOKUP_USES_OBJECT',
            from: node('ui_control', `${formIdentity}#${cname}`),
            to: node('dataset', lookupTable, { lookup: true }),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2a_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
                sourceType: formType,
                extractionMechanism: 'LookupTableName',
                rawValue: lookupTable,
                evidenceRefs: [
                  `control:${cname}`,
                  `lookupTable:${lookupTable}`,
                  lookupKey ? `lookupKey:${lookupKey}` : 'lookupKey:unset',
                  lookupDisplay ? `lookupDisplay:${lookupDisplay}` : 'lookupDisplay:unset',
                  column ? `targetColumn:${column}` : 'targetColumn:unset',
                ],
              }),
            ],
            attributes: {
              targetColumn: column,
              lookupKey,
              lookupDisplay,
              note: 'target_and_lookup_semantics_kept_separate',
            },
          }),
        );
      }
    }

    for (const bo of (row.businessObjects as Array<Record<string, unknown>>) ?? []) {
      const to = String(bo.fullType ?? '');
      if (!to) continue;
      if (!formToBo.has(formIdentity)) formToBo.set(formIdentity, []);
      if (!formToBo.get(formIdentity)!.includes(to)) formToBo.get(formIdentity)!.push(to);
      const evidence0 = Array.isArray(bo.evidence)
        ? String((bo.evidence as Array<{ assignment?: string }>)[0]?.assignment ?? '')
        : '';
      const bor = parseBusinessObjectReference(evidence0);
      addEdge(
        makeEdge({
          edgeKind: 'FORM_USES_BUSINESS_OBJECT',
          from: node('application_form', formIdentity),
          to: node('business_object', to),
          confidenceClass: bor ? 'exact_from_source' : 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2a_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
              sourceType: formType,
              sourceMember: 'BusinessObjectReference',
              extractionMechanism: 'BusinessObjectReference',
              rawValue: to,
              evidenceRefs: [`bo:${to}`, evidence0 || 'stage2a:businessObjects'],
            }),
          ],
          attributes: {
            inheritedFromType: bo.inheritedFromType ?? null,
            configurationScope: bo.inheritedFromType ? 'inherited' : 'declared',
            assembly: bo.assembly ?? null,
          },
        }),
      );
      metrics.formToBusinessObjectEdges += 1;
    }

    for (const r of (row.relations as Array<Record<string, unknown>>) ?? []) {
      const rt = String(r.relationType ?? '');
      const from = String(r.from ?? '');
      const to = String(r.to ?? '');
      if (rt === 'formType_BO' || rt === 'form_BO') {
        if (!formToBo.has(formIdentity)) formToBo.set(formIdentity, []);
        if (!formToBo.get(formIdentity)!.includes(to)) formToBo.get(formIdentity)!.push(to);
        addEdge(
          makeEdge({
            edgeKind: 'FORM_USES_BUSINESS_OBJECT',
            from: node('application_form', formIdentity),
            to: node('business_object', to),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2a_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
                sourceType: formType,
                sourceMember: String(r.sourceMethod ?? 'BusinessObjectReference'),
                sourceLineStart: Array.isArray(r.sourceOffsets)
                  ? String((r.sourceOffsets as string[])[0] ?? '')
                  : null,
                extractionMechanism: 'BusinessObjectReference',
                rawValue: to,
                evidenceRefs: [`relation:${rt}`, `bo:${to}`],
              }),
            ],
          }),
        );
        metrics.formToBusinessObjectEdges += 1;
      }
      if (rt === 'form_DF' || rt === 'formType_DF' || rt === 'datasource_DF') {
        metrics.dataFormsScanned += 1;
        addEdge(
          makeEdge({
            edgeKind: 'FORM_USES_DATA_FACTORY',
            from: node('application_form', formIdentity),
            to: node('data_factory', to),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2a_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
                sourceType: formType,
                extractionMechanism: 'DF_Gateway_or_DF_reference',
                rawValue: to,
                evidenceRefs: [`relation:${rt}`, `df:${to}`],
              }),
            ],
          }),
        );
      }
      if (rt === 'control_dataset_table') {
        metrics.relationEdges += 1;
        addEdge(
          makeEdge({
            edgeKind: 'APPLICATION_RELATION',
            from: node('ui_control', `${formIdentity}#${from}`),
            to: node('dataset', to),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2a_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2a,
                extractionMechanism: 'control_dataset_table',
                rawValue: `${from}->${to}`,
                evidenceRefs: [`relation:${rt}`],
              }),
            ],
            attributes: { relationType: rt },
          }),
        );
      }
    }
  });

  // --- Stage 2B ---
  await forEachNdjson(stage2bPath, (row) => {
    const kind = String(row.kind ?? '');
    if (kind !== 'type') return;
    const fullName = String(row.fullName ?? '');
    if (!fullName) return;
    if (
      input.typeNameIncludes &&
      !input.typeNameIncludes.some((x) => fullName.includes(x))
    ) {
      return;
    }
    const role = String(row.technicalRole ?? '');
    const assembly = String(row.assemblyName ?? '');
    if (role === 'BO') metrics.businessObjectsScanned += 1;
    if (role === 'DF') metrics.dataFormsScanned += 1;
    if (role === 'TG' || role === 'MTG') metrics.gatewaysScanned += 1;

    // Type-level constructorFacts / evidence — attach only to self TG/MTG, never to child gateways on BO.
    const extraEvidence: GatewayEvidence[] = [];
    for (const cf of (row.constructorFacts as Array<Record<string, unknown>>) ?? []) {
      for (const ev of (cf.evidence as GatewayEvidence[]) ?? []) extraEvidence.push(ev);
      if (String(cf.calledMember ?? '') === 'set_TableName') {
        const args = cf.arguments as unknown[];
        if (Array.isArray(args) && typeof args[0] === 'string') {
          extraEvidence.push({
            method: String(cf.method ?? '.ctor'),
            offset: String(cf.offset ?? ''),
            assignment: `TableGatewayBase::set_TableName("${args[0]}")`,
          });
        }
      }
      if (String(cf.calledMember ?? '') === '.ctor' && Array.isArray(cf.arguments)) {
        const args = cf.arguments as unknown[];
        const dsArg = args.find((a) => typeof a === 'string');
        if (typeof dsArg === 'string' && (role === 'TG' || role === 'MTG')) {
          extraEvidence.push({
            method: String(cf.method ?? '.ctor'),
            offset: String(cf.offset ?? ''),
            assignment: `::.ctor(null, "${dsArg}")`,
          });
        }
      }
    }
    for (const ev of (row.evidence as GatewayEvidence[]) ?? []) extraEvidence.push(ev);

    const gateways = [...((row.gateways as Stage2bGateway[]) ?? [])];
    if ((role === 'TG' || role === 'MTG') && extraEvidence.length) {
      const selfIdx = gateways.findIndex((g) => String(g.gatewayType ?? '') === fullName);
      if (selfIdx >= 0) {
        gateways[selfIdx] = {
          ...gateways[selfIdx]!,
          evidence: [...(gateways[selfIdx]!.evidence ?? []), ...extraEvidence],
        };
      } else {
        gateways.push({
          gatewayType: fullName,
          gatewayKind: role,
          declaringType: fullName,
          assemblyName: assembly,
          evidence: extraEvidence,
          confidence: 'confirmed_from_il',
        });
      }
    } else if ((role === 'BO' || role === 'DF') && extraEvidence.length) {
      // Keep BO-level relation/join/runtime evidence on a synthetic self bag (not a child TG).
      const existing = gatewayByType.get(fullName) ?? {
        evidence: [],
        joins: [],
        columns: [],
        relations: [],
        kind: role,
        assembly,
      };
      accumulateGatewayEvidence(
        existing,
        {
          gatewayType: fullName,
          gatewayKind: role,
          declaringType: fullName,
          assemblyName: assembly,
          evidence: extraEvidence,
        },
        assembly,
      );
      gatewayByType.set(fullName, existing);
      for (const ev of extraEvidence) {
        const assignment = String(ev.assignment ?? '');
        if (!assignment || !isLateBindingAssignment(assignment)) continue;
        const b = classifyRuntimeBoundary(assignment);
        const id = `runtime:${fullName}:${ev.offset ?? createHash('sha1').update(assignment).digest('hex').slice(0, 8)}`;
        runtimeBoundaries.push({
          id,
          boundaryType: b.boundaryType,
          sourceLocation: `${assembly}:${fullName}:${ev.method ?? '.ctor'}:${ev.offset ?? ''}`,
          symbol: assignment.slice(0, 200),
          knownInputs: [],
          knownOutputs: [],
          missingRuntimeValue: b.missingRuntimeValue,
          evidenceRefs: [`stage2b:${fullName}`, assignment],
          confidenceClass: 'runtime_only',
        });
        addEdge(
          makeEdge({
            edgeKind: 'HAS_RUNTIME_BOUNDARY',
            from: node(role === 'DF' ? 'data_factory' : 'business_object', fullName),
            to: node('runtime_boundary', id),
            confidenceClass: 'runtime_only',
            provenance: [
              prov({
                sourceKind: 'stage2b_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
                sourceAssembly: assembly,
                sourceType: fullName,
                sourceMember: ev.method ?? '.ctor',
                sourceLineStart: ev.offset ?? null,
                extractionMechanism: b.boundaryType,
                rawValue: assignment,
                confidenceClass: 'runtime_only',
                evidenceRefs: [assignment],
              }),
            ],
          }),
        );
        metrics.runtimeBoundaryEdges += 1;
      }
    }

    for (const g of gateways) {
      const gType = String(g.gatewayType ?? g.declaringType ?? fullName);
      const existing = gatewayByType.get(gType) ?? {
        evidence: [],
        joins: [],
        columns: [],
        relations: [],
      };
      accumulateGatewayEvidence(existing, g, assembly);
      gatewayByType.set(gType, existing);

      // Runtime boundaries from gateway evidence
      for (const ev of g.evidence ?? []) {
        const assignment = String(ev.assignment ?? '');
        if (!assignment || !isLateBindingAssignment(assignment)) continue;
        const b = classifyRuntimeBoundary(assignment);
        const id = `runtime:${gType}:${ev.offset ?? createHash('sha1').update(assignment).digest('hex').slice(0, 8)}`;
        runtimeBoundaries.push({
          id,
          boundaryType: b.boundaryType,
          sourceLocation: `${assembly}:${gType}:${ev.method ?? '.ctor'}:${ev.offset ?? ''}`,
          symbol: assignment.slice(0, 200),
          knownInputs: [],
          knownOutputs: [],
          missingRuntimeValue: b.missingRuntimeValue,
          evidenceRefs: [`stage2b:${gType}`, assignment],
          confidenceClass: 'runtime_only',
        });
        addEdge(
          makeEdge({
            edgeKind: 'HAS_RUNTIME_BOUNDARY',
            from: node(
              role === 'BO' || role === 'DF'
                ? role === 'DF'
                  ? 'data_factory'
                  : 'business_object'
                : 'gateway',
              fullName,
            ),
            to: node('runtime_boundary', id),
            confidenceClass: 'runtime_only',
            provenance: [
              prov({
                sourceKind: 'stage2b_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
                sourceAssembly: assembly,
                sourceType: fullName,
                sourceMember: ev.method ?? '.ctor',
                sourceLineStart: ev.offset ?? null,
                extractionMechanism: b.boundaryType,
                rawValue: assignment,
                confidenceClass: 'runtime_only',
                evidenceRefs: [assignment],
              }),
            ],
          }),
        );
        metrics.runtimeBoundaryEdges += 1;
      }

      if (role === 'BO' || role === 'DF') {
        if (!boToGateways.has(fullName)) boToGateways.set(fullName, new Set());
        boToGateways.get(fullName)!.add(gType);
        if (!gatewayOwners.has(gType)) gatewayOwners.set(gType, new Set());
        gatewayOwners.get(gType)!.add(fullName);
        addEdge(
          makeEdge({
            edgeKind: 'BUSINESS_OBJECT_USES_GATEWAY',
            from: node(role === 'DF' ? 'data_factory' : 'business_object', fullName),
            to: node('gateway', gType),
            confidenceClass: String(g.confidence ?? '').includes('confirmed')
              ? 'exact_from_source'
              : 'strong_static_inference',
            provenance: [
              prov({
                sourceKind: 'stage2b_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
                sourceAssembly: assembly,
                sourceType: fullName,
                extractionMechanism: 'BO_Add_gateway_or_MainGateway_assignment',
                rawValue: gType,
                evidenceRefs: [`bo:${fullName}`, `gateway:${gType}`],
              }),
            ],
          }),
        );
      }
    }

    // Field literal NAZWA_TABELI_W_DS on TG types
    if (role === 'TG' || role === 'MTG') {
      const existing = gatewayByType.get(fullName) ?? {
        evidence: [],
        joins: [],
        columns: [],
        relations: [],
      };
      for (const f of (row.fields as Array<Record<string, unknown>>) ?? []) {
        if (String(f.name ?? '') === 'NAZWA_TABELI_W_DS' && f.literalValue) {
          existing.datasetTable = existing.datasetTable || String(f.literalValue);
        }
      }
      gatewayByType.set(fullName, existing);
    }

    const baseType = row.baseType ? String(row.baseType) : null;
    if (baseType && !baseType.startsWith('System.')) {
      addEdge(
        makeEdge({
          edgeKind: 'INHERITS_CONFIGURATION',
          from: node(
            role === 'BO'
              ? 'business_object'
              : role === 'DF'
                ? 'data_factory'
                : role === 'TG' || role === 'MTG'
                  ? 'gateway'
                  : 'business_object',
            fullName,
          ),
          to: node('business_object', baseType),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: fullName,
              extractionMechanism: 'baseType_metadata',
              rawValue: baseType,
              evidenceRefs: [`inherits:${baseType}`],
            }),
          ],
        }),
      );
    }
  });

  // Emit gateway→dataset / oracle / join / dictionary / relation edges after accumulation
  for (const [gType, g] of gatewayByType) {
    const isGatewayRole = !g.kind || g.kind === 'TG' || g.kind === 'MTG';
    if (!isGatewayRole) {
      // BO/DF bags: relations + runtime only (joins handled via Stage2D / child TGs)
      for (const rel of g.relations) {
        metrics.relationEdges += 1;
        const conf =
          rel.keyResolutionStatus === 'resolved' ? 'exact_from_source' : 'unresolved';
        addEdge(
          makeEdge({
            edgeKind: 'APPLICATION_RELATION',
            from: node('business_object', gType),
            to: node(
              'oracle_column',
              rel.childColumns[0] ? `column:${rel.childColumns[0]}` : 'unresolved_child',
            ),
            confidenceClass: conf,
            provenance: [
              prov({
                sourceKind: 'stage2b_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
                sourceType: gType,
                extractionMechanism: rel.mechanism,
                rawValue: JSON.stringify(rel),
                confidenceClass: conf,
                evidenceRefs: [`relation:${rel.mechanism}`, `owner:${gType}`],
              }),
            ],
            attributes: {
              relationMechanism: rel.mechanism,
              parentColumns: rel.parentColumns,
              childColumns: rel.childColumns,
              optionalFlag: rel.optionalFlag,
              keyResolutionStatus: rel.keyResolutionStatus,
            },
          }),
        );
      }
      continue;
    }
    if (g.datasetTable) {
      if (!datasetToGateways.has(g.datasetTable)) datasetToGateways.set(g.datasetTable, new Set());
      datasetToGateways.get(g.datasetTable)!.add(gType);
      addEdge(
        makeEdge({
          edgeKind: 'GATEWAY_BINDS_DATASET',
          from: node('gateway', gType),
          to: node('dataset', g.datasetTable),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceAssembly: g.assembly ?? null,
              sourceType: gType,
              sourceMember: '.ctor',
              extractionMechanism: 'TG_ctor_DataSetTableName',
              rawValue: g.datasetTable,
              evidenceRefs: g.evidence
                .filter((e) => /::\.ctor\([^)]*"/.test(String(e.assignment ?? '')))
                .map((e) => String(e.assignment)),
            }),
          ],
        }),
      );
      metrics.datasetToGatewayEdges += 1;
    }

    if (g.viewName) {
      addEdge(
        makeEdge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          from: node('gateway', gType),
          to: node('oracle_object', `TETA_ADMIN.${g.viewName}`, {
            objectName: g.viewName,
            alias: g.alias,
          }),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceAssembly: g.assembly ?? null,
              sourceType: gType,
              sourceMember: 'set_TableName',
              extractionMechanism: 'TableName_or_ViewName_literal',
              rawValue: g.viewName,
              normalizedValue: `TETA_ADMIN.${g.viewName}`,
              evidenceRefs: g.evidence
                .filter((e) => /set_TableName|set_ViewName/.test(String(e.assignment ?? '')))
                .map((e) => String(e.assignment)),
            }),
          ],
        }),
      );
      metrics.gatewayToOracleEdges += 1;
    }

    if (g.baseTableName) {
      addEdge(
        makeEdge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          from: node('gateway', gType),
          to: node('oracle_object', `TETA_ADMIN.${g.baseTableName}`, {
            objectName: g.baseTableName,
            role: 'base_table',
          }),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              extractionMechanism: 'BaseTableName_literal',
              rawValue: g.baseTableName,
              evidenceRefs: [`baseTable:${g.baseTableName}`],
            }),
          ],
        }),
      );
    }

    if (g.packageName) {
      addEdge(
        makeEdge({
          edgeKind: 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE',
          from: node('gateway', gType),
          to: node('oracle_object', `TETA_ADMIN.${g.packageName}`, {
            objectType: 'PACKAGE',
          }),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              extractionMechanism: 'SumoCommandBuilder_package_literal',
              rawValue: g.packageName,
              evidenceRefs: [`package:${g.packageName}`],
            }),
          ],
        }),
      );
    }

    if (g.dictionaryTableName) {
      metrics.lookupEdges += 1;
      addEdge(
        makeEdge({
          edgeKind: 'LOOKUP_USES_OBJECT',
          from: node('gateway', gType),
          to: node('oracle_object', `TETA_ADMIN.${g.dictionaryTableName}`, {
            alias: g.dictionaryTableAlias,
            dictionary: true,
          }),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              extractionMechanism: 'DictionaryTableName',
              rawValue: g.dictionaryTableName,
              evidenceRefs: [
                `dictionary:${g.dictionaryTableName}`,
                g.dictionaryTableAlias
                  ? `dictionaryAlias:${g.dictionaryTableAlias}`
                  : 'dictionaryAlias:unset',
              ],
            }),
          ],
        }),
      );
    }

    for (const j of g.joins) {
      metrics.joinEdges += 1;
      const pairs = parseSimpleJoinOn(j.onClause);
      addEdge(
        makeEdge({
          edgeKind: 'GATEWAY_JOINS_ORACLE_OBJECT',
          from: node('gateway', gType),
          to: node('oracle_object', `TETA_ADMIN.${j.objectName}`, { alias: j.alias }),
          confidenceClass: j.onClause
            ? pairs.length
              ? 'exact_from_source'
              : 'unresolved'
            : 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              sourceMember: 'AddJoin',
              extractionMechanism: 'SqlSelectCommand.AddJoin',
              rawValue: JSON.stringify(j),
              confidenceClass: j.onClause && !pairs.length ? 'unresolved' : 'exact_from_source',
              evidenceRefs: [`AddJoin:${j.objectName}:${j.alias}`],
            }),
          ],
          attributes: {
            joinType: j.joinType,
            onClause: j.onClause,
            parsedPairs: pairs,
            keyResolutionStatus: j.onClause
              ? pairs.length
                ? 'resolved'
                : 'unresolved'
              : 'not_provided_in_il',
          },
        }),
      );

      // Columns projected from join alias → lookup display candidates (keep separate from target FK)
      const displayCols = g.columns.filter((c) => c.expression.startsWith(`${j.alias}.`));
      if (displayCols.length) {
        metrics.lookupEdges += 1;
        addEdge(
          makeEdge({
            edgeKind: 'LOOKUP_USES_OBJECT',
            from: node('gateway', gType),
            to: node('oracle_object', `TETA_ADMIN.${j.objectName}`, {
              alias: j.alias,
              lookup: true,
            }),
            confidenceClass: 'exact_from_source',
            provenance: [
              prov({
                sourceKind: 'stage2b_ndjson',
                sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
                sourceType: gType,
                extractionMechanism: 'AddJoin_plus_AddColumn_lookup_projection',
                rawValue: j.objectName,
                evidenceRefs: [
                  `lookupObject:${j.objectName}`,
                  `alias:${j.alias}`,
                  ...displayCols.map((c) => `display:${c.expression}`),
                ],
              }),
            ],
            attributes: {
              lookupDisplayColumns: displayCols.map((c) => c.alias ?? c.expression),
              note: 'target_FK_not_inferred_from_display_projection',
            },
          }),
        );
      }
    }

    for (const c of g.columns) {
      addEdge(
        makeEdge({
          edgeKind: 'GATEWAY_PROJECTS_COLUMN',
          from: node('gateway', gType),
          to: node('oracle_column', c.alias ?? c.expression, { expression: c.expression }),
          confidenceClass: 'exact_from_source',
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              sourceMember: 'AddColumn',
              extractionMechanism: 'SumoSqlCommand.AddColumn',
              rawValue: c.expression,
              evidenceRefs: [`AddColumn:${c.expression}`],
            }),
          ],
        }),
      );
    }

    for (const rel of g.relations) {
      metrics.relationEdges += 1;
      const conf =
        rel.keyResolutionStatus === 'resolved' ? 'exact_from_source' : 'unresolved';
      const fromName = rel.parentObject ?? gType;
      const toName =
        rel.childObject ??
        (rel.childColumns[0] ? `column:${rel.childColumns[0]}` : 'unresolved_child');
      addEdge(
        makeEdge({
          edgeKind: 'APPLICATION_RELATION',
          from: node(rel.parentObject ? 'dataset' : 'gateway', fromName),
          to: node(rel.childObject ? 'dataset' : 'oracle_column', toName),
          confidenceClass: conf,
          provenance: [
            prov({
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              extractionMechanism: rel.mechanism,
              rawValue: JSON.stringify(rel),
              confidenceClass: conf,
              evidenceRefs: [`relation:${rel.mechanism}`, `gateway:${gType}`],
            }),
          ],
          attributes: {
            relationMechanism: rel.mechanism,
            parentColumns: rel.parentColumns,
            childColumns: rel.childColumns,
            optionalFlag: rel.optionalFlag,
            keyResolutionStatus: rel.keyResolutionStatus,
            parentObjectStatus: rel.parentObject ? 'exact_from_source' : 'unresolved',
            childObjectStatus: rel.childObject ? 'exact_from_source' : 'unresolved',
          },
        }),
      );
    }
  }

  // --- Stage 2D ---
  await forEachNdjson(stage2dPath, (row) => {
    if (String(row.kind ?? '') !== 'dataset') return;
    const datasetName = String(row.datasetTable ?? '');
    const declaringType = String(row.declaringType ?? '');
    const joins = (
      (row.effectiveJoins as Array<Record<string, unknown>>) ??
      (row.joins as Array<Record<string, unknown>>) ??
      []
    ).concat(
      // Include declared/inherited only when effectiveJoins absent
      row.effectiveJoins
        ? []
        : [
            ...((row.declaredJoins as Array<Record<string, unknown>>) ?? []),
            ...((row.inheritedJoins as Array<Record<string, unknown>>) ?? []),
          ],
    );
    const seen = new Set<string>();
    for (const j of joins) {
      const target = String(j.joinedObject ?? j.objectName ?? j.targetObject ?? 'unresolved');
      const alias = String(j.alias ?? '');
      const key = `${target}|${alias}|${j.sourceApi ?? ''}|${j.inheritanceKind ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      metrics.joinEdges += 1;
      const onClause = j.onClause
        ? String(j.onClause)
        : j.condition
          ? String(j.condition)
          : null;
      const pairs = parseSimpleJoinOn(onClause);
      const conditionStatus = String(j.conditionStatus ?? '');
      const sourceApi = String(j.sourceApi ?? 'AddJoin');
      const conf = pairs.length
        ? 'exact_from_source'
        : conditionStatus.includes('not_provided')
          ? 'unresolved'
          : onClause
            ? 'unresolved'
            : 'exact_from_source';
      const scope = String(j.inheritanceKind ?? 'effective');
      addEdge(
        makeEdge({
          edgeKind: 'APPLICATION_JOIN',
          from: node(
            datasetName ? 'dataset' : 'gateway',
            datasetName || declaringType || 'unresolved_dataset',
          ),
          to: node(
            'oracle_object',
            target.startsWith('TETA_ADMIN.') ? target : `TETA_ADMIN.${target}`,
            { alias },
          ),
          confidenceClass: conf,
          provenance: [
            prov({
              sourceKind: 'stage2d_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2d,
              sourceType: declaringType || null,
              sourceAssembly: row.assemblyName ? String(row.assemblyName) : null,
              extractionMechanism: sourceApi,
              rawValue: onClause ?? `${target}:${alias}`,
              confidenceClass: conf,
              evidenceRefs: [
                `stage2d:${datasetName || declaringType}`,
                `join:${target}`,
                `scope:${scope}`,
                j.declaredOnType ? `declaredOn:${j.declaredOnType}` : 'declaredOn:unset',
              ],
            }),
          ],
          attributes: {
            parsedPairs: pairs,
            joinType: j.joinType ?? null,
            keyResolutionStatus: pairs.length
              ? 'resolved'
              : conditionStatus.includes('not_provided')
                ? 'not_provided_in_il'
                : 'unresolved',
            configurationScope: scope,
            inheritanceKind: j.inheritanceKind ?? null,
          },
        }),
      );
    }
  });

  // --- Paths + incomplete-oracle integrity (former brokenEndpointEdges=91) ---
  const baseGatewayOracle = input.skipBaseGraphIndex
    ? new Map<string, string[]>()
    : await loadBaseGatewayOracleIndex(path.join(input.repoRoot, STAGE1_ARTIFACT_PATHS.stage2e));

  const gatewayHasRuntime = (gType: string): boolean =>
    runtimeBoundaries.some((b) => b.id.includes(gType) || b.sourceLocation.includes(gType)) ||
    (gatewayByType.get(gType)?.evidence ?? []).some((ev) =>
      isLateBindingAssignment(String(ev.assignment ?? '')),
    );

  for (const [formIdentity, datasets] of formDatasets) {
    const bos = formToBo.get(formIdentity) ?? [];
    for (const dataset of datasets) {
      const gateways = [...(datasetToGateways.get(dataset) ?? [])];
      for (const gType of gateways) {
        const g = gatewayByType.get(gType);
        let viewName = g?.viewName ?? null;
        let oracleResolvedVia: 'ace' | 'base' | 'runtime' | 'unresolved' | null = viewName
          ? 'ace'
          : null;

        if (!viewName) {
          const baseOracles = baseGatewayOracle.get(gType) ?? [];
          const pathEdgeId = `path-candidate:${formIdentity}|${dataset}|${gType}`;
          const caseProv: Stage1Provenance[] = [
            {
              sourceKind: 'stage2b_ndjson',
              sourceFile: STAGE1_ARTIFACT_PATHS.stage2b,
              sourceType: gType,
              extractionMechanism: 'path_materialization_missing_viewName',
              rawValue: dataset,
              confidenceClass: 'unresolved',
              evidenceRefs: [`dataset:${dataset}`, `gateway:${gType}`],
            },
          ];

          let classification: BrokenEndpointClassification;
          let reason: string;
          let resolution: string;

          if (baseOracles.length > 0) {
            classification = 'endpoint_exists_in_base_canonical_graph';
            reason = `Gateway ${gType} has no ACE viewName but Stage2E MAPS_TO_ORACLE_OBJECT → ${baseOracles[0]}`;
            resolution = 'resolve_oracle_from_base_union_graph';
            viewName = baseOracles[0]!.replace(/^TETA_ADMIN\./, '');
            oracleResolvedVia = 'base';
            metrics.endpointsResolvedInBaseGraph += 1;
            addEdge(
              makeEdge({
                edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
                from: node('gateway', gType),
                to: node('oracle_object', `TETA_ADMIN.${viewName}`),
                confidenceClass: 'strong_static_inference',
                provenance: [
                  {
                    sourceKind: 'stage2b_ndjson',
                    sourceFile: STAGE1_ARTIFACT_PATHS.stage2e,
                    sourceType: gType,
                    extractionMechanism: 'base_canonical_graph_MAPS_TO_ORACLE_OBJECT',
                    rawValue: viewName,
                    normalizedValue: `TETA_ADMIN.${viewName}`,
                    confidenceClass: 'strong_static_inference',
                    evidenceRefs: [`stage2e:gateway:${gType}`, `oracle:${viewName}`],
                  },
                ],
              }),
            );
            metrics.gatewayToOracleEdges += 1;
          } else if (gatewayHasRuntime(gType)) {
            classification = 'runtime_boundary_should_replace_missing_endpoint';
            reason = `Gateway ${gType} bound to dataset ${dataset} without TableName; late-binding/runtime evidence present`;
            resolution = 'emit_HAS_RUNTIME_BOUNDARY_instead_of_physical_oracle';
            oracleResolvedVia = 'runtime';
            metrics.runtimeBoundaryEndpoints += 1;
            const rbId = `runtime:missing-oracle:${gType}`;
            if (!runtimeBoundaries.some((b) => b.id === rbId)) {
              runtimeBoundaries.push({
                id: rbId,
                boundaryType: 'late_binding_gateway',
                sourceLocation: gType,
                symbol: gType,
                knownInputs: [dataset],
                knownOutputs: [],
                missingRuntimeValue: 'oracle_table_or_view_name',
                evidenceRefs: [`gateway:${gType}`, `dataset:${dataset}`],
                confidenceClass: 'runtime_only',
              });
            }
            addEdge(
              makeEdge({
                edgeKind: 'HAS_RUNTIME_BOUNDARY',
                from: node('gateway', gType),
                to: node('runtime_boundary', rbId),
                confidenceClass: 'runtime_only',
                provenance: caseProv.map((p) => ({ ...p, confidenceClass: 'runtime_only' as const })),
              }),
            );
            metrics.runtimeBoundaryEdges += 1;
          } else {
            // Prefer unresolved endpoint node over dangling / broken path edge
            classification = 'unresolved_external_reference';
            reason = `Gateway ${gType} has dataset ${dataset} but no TableName in ACE and no Stage2E oracle mapping`;
            resolution = 'materialize_unresolved_oracle_endpoint_node';
            oracleResolvedVia = 'unresolved';
            metrics.unresolvedEndpointCandidates += 1;
            const unresolvedName = `unresolved:oracle_for:${gType}`;
            addEdge(
              makeEdge({
                edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
                from: node('gateway', gType),
                to: node('oracle_object', unresolvedName, { unresolved: true }),
                confidenceClass: 'unresolved',
                provenance: caseProv,
                attributes: { unresolvedEndpoint: true },
              }),
            );
          }

          brokenEndpointCases.push({
            edgeId: pathEdgeId,
            edgeType: 'PATH_DATASET_GATEWAY_ORACLE',
            fromId: `gateway|${gType}`,
            toId: viewName
              ? `oracle_object|TETA_ADMIN.${viewName}`
              : oracleResolvedVia === 'runtime'
                ? `runtime_boundary|runtime:missing-oracle:${gType}`
                : `oracle_object|unresolved:oracle_for:${gType}`,
            sourceProvenance: caseProv,
            classification,
            reason,
            resolution,
          });
          brokenClassificationCounts[classification] += 1;
        } else {
          metrics.endpointsResolvedInAce += 1;
        }

        if (!viewName && oracleResolvedVia !== 'ace' && oracleResolvedVia !== 'base') {
          // Path not complete to physical Oracle — still not a dangling edge
          continue;
        }
        if (!viewName) continue;

        const linkedBo =
          bos.find((b) => boToGateways.get(b)?.has(gType)) ??
          [...(gatewayOwners.get(gType) ?? [])].find((b) => bos.includes(b)) ??
          null;
        const hops: Stage1ApplicationPath['hops'] = [
          { role: 'form', node: node('application_form', formIdentity) },
          {
            role: 'dataset',
            node: node('dataset', dataset),
            viaEdgeKind: 'CONTROL_BINDS_DATASET',
            confidenceClass: 'exact_from_source',
          },
        ];
        if (linkedBo) {
          hops.push({
            role: 'business_object',
            node: node('business_object', linkedBo),
            viaEdgeKind: 'FORM_USES_BUSINESS_OBJECT',
            confidenceClass: 'exact_from_source',
          });
          hops.push({
            role: 'gateway',
            node: node('gateway', gType),
            viaEdgeKind: 'BUSINESS_OBJECT_USES_GATEWAY',
            confidenceClass: 'exact_from_source',
          });
        } else {
          hops.push({
            role: 'gateway',
            node: node('gateway', gType),
            viaEdgeKind: 'GATEWAY_BINDS_DATASET',
            confidenceClass: 'exact_from_source',
          });
        }
        hops.push({
          role: 'oracle_object',
          node: node('oracle_object', `TETA_ADMIN.${viewName}`),
          viaEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          confidenceClass:
            oracleResolvedVia === 'base' ? 'strong_static_inference' : 'exact_from_source',
        });
        applicationPaths.push({
          id: `path:${createHash('sha1')
            .update(`${formIdentity}|${dataset}|${gType}|${viewName}`)
            .digest('hex')
            .slice(0, 16)}`,
          conceptHint: dataset,
          hops,
          edgeIds: [],
          confidenceClass:
            oracleResolvedVia === 'base' ? 'strong_static_inference' : 'exact_from_source',
          completeToOracle: true,
        });
        metrics.applicationPathsCompleteToOracle += 1;
      }
    }
  }

  // Union endpoint integrity: every persisted edge endpoint must be registered (ACE nodes).
  const persisted = [...edgeById.values()];
  for (const e of persisted) {
    metrics.endpointReferencesChecked += 2;
    for (const end of [e.from, e.to]) {
      const k = nodeKey(end);
      if (!nodeRegistry.has(k)) {
        registerNode(end);
        metrics.invalidEdgeBugs += 1;
        metrics.danglingEdgesPersisted += 1;
        metrics.brokenEndpointsAgainstUnionGraph += 1;
      }
    }
  }

  // Duplicates in persisted set must be zero (Map keyed by canonical id)
  metrics.persistedDuplicateEdges = 0;
  const idCounts = new Map<string, number>();
  for (const e of persisted) {
    idCounts.set(e.id, (idCounts.get(e.id) ?? 0) + 1);
  }
  for (const c of idCounts.values()) {
    if (c > 1) metrics.persistedDuplicateEdges += c - 1;
  }

  // Former ambiguous metrics — document via integrity block only (not primary counters)
  const oldDuplicateMeaning =
    'v1 duplicateCanonicalEdges counted discarded re-insert attempts of identical edge id (rawValue-in-id); provenance was dropped. Now: merge provenance; duplicateEdgesObservedBeforeDedup/Removed; persistedDuplicateEdges=0.';
  const oldBrokenMeaning =
    'v1 brokenEndpointEdges counted path materialization skips (gateway with dataset but no viewName), NOT dangling graph edges. Now classified A–E against ACE∪Stage2E; brokenEndpointsAgainstUnionGraph=0.';

  return {
    contractVersion: STAGE1_CONTRACT_VERSION,
    sourceStage: STAGE1_SOURCE_STAGE,
    identityVersion: 'teta-aia-canonical-id-v1',
    edges: [...edgeById.values()],
    runtimeBoundaries,
    applicationPaths,
    metrics,
    audit,
    gapMatrixRef: 'docs/AIA_APPLICATION_CODE_GRAPH_STAGE1.json#gapMatrix',
    integrity: {
      duplicateCategoryCounts,
      brokenEndpointCases: brokenEndpointCases.map((c) => ({ ...c })),
      brokenClassificationCounts,
      oldMetricMeanings: {
        duplicateCanonicalEdges_v1: oldDuplicateMeaning,
        brokenEndpointEdges_v1: oldBrokenMeaning,
      },
    },
  };
}

/** Index Stage2E gateway full type name → oracle object names (MAPS_TO_ORACLE_OBJECT). */
async function loadBaseGatewayOracleIndex(
  stage2ePath: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!fs.existsSync(stage2ePath)) return out;
  const gatewayIdToType = new Map<string, string>();
  const pending: Array<{ from: string; toName: string }> = [];

  await forEachNdjson(stage2ePath, (row) => {
    if (row.kind === 'node' && row.type === 'gateway') {
      const id = String(row.id ?? '');
      const name = String(row.name ?? row.canonicalName ?? '');
      // name may be short; prefer attributes.fullName / type name from id suffix
      const full =
        (row.attributes as { fullName?: string; typeName?: string } | undefined)?.fullName ??
        (row.attributes as { typeName?: string } | undefined)?.typeName ??
        (id.includes(':') ? id.slice(id.indexOf(':', id.indexOf(':') + 1) + 1) : name);
      if (id) gatewayIdToType.set(id, String(full));
    }
    if (row.kind === 'edge' && row.type === 'MAPS_TO_ORACLE_OBJECT') {
      const from = String(row.from ?? '');
      const to = String(row.to ?? '');
      // oracle-object:OWNER:TYPE:NAME
      const parts = to.split(':');
      const objName =
        parts.length >= 4 ? `TETA_ADMIN.${parts[parts.length - 1]}` : to;
      const gType = gatewayIdToType.get(from);
      if (gType) {
        if (!out.has(gType)) out.set(gType, []);
        if (!out.get(gType)!.includes(objName)) out.get(gType)!.push(objName);
      } else if (from.startsWith('gateway:')) {
        pending.push({ from, toName: objName });
      }
    }
  });

  // Resolve pending using id suffix as type name
  for (const p of pending) {
    const parts = p.from.split(':');
    const gType = parts.length >= 3 ? parts.slice(2).join(':') : parts[parts.length - 1]!;
    if (!out.has(gType)) out.set(gType, []);
    if (!out.get(gType)!.includes(p.toName)) out.get(gType)!.push(p.toName);
  }
  return out;
}

/** Post-extraction comparison — ground truth must not enter extraction. */
export function comparePayrollReferencePath(result: Stage1ExtractionResult): {
  matched: boolean;
  extractedPath: string[];
  mismatches: string[];
  matches: string[];
} {
  const gt = {
    dataset: 'SkladnikiObliczZamknPrac',
    bo: 'Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO',
    gateway: 'Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG',
    oracle: 'TETA_ADMIN.NT_KP_PLC_SKLADNIKI_OBL',
    lookup: 'NT_KP_SLO_SKLADNIKI_PLAC',
  };
  const pathHit = result.applicationPaths.find(
    (p) =>
      p.hops.some((h) => h.node.name === gt.dataset) &&
      p.hops.some((h) => h.node.name === gt.gateway) &&
      p.hops.some((h) => h.node.name === gt.oracle),
  );
  const extractedPath = pathHit?.hops.map((h) => `${h.role}:${h.node.name}`) ?? [];
  const mismatches: string[] = [];
  const matches: string[] = [];
  const hasDataset = result.edges.some(
    (e) => e.to.name === gt.dataset || e.from.name === gt.dataset,
  );
  const hasBo = result.edges.some(
    (e) => e.edgeKind === 'FORM_USES_BUSINESS_OBJECT' && e.to.name === gt.bo,
  );
  const hasGw = result.edges.some(
    (e) =>
      e.edgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT' &&
      e.from.name === gt.gateway &&
      e.to.name === gt.oracle,
  );
  const hasLookup = result.edges.some(
    (e) =>
      (e.edgeKind === 'GATEWAY_JOINS_ORACLE_OBJECT' || e.edgeKind === 'LOOKUP_USES_OBJECT') &&
      e.to.name.includes(gt.lookup),
  );
  const hasDsGw = result.edges.some(
    (e) =>
      e.edgeKind === 'GATEWAY_BINDS_DATASET' &&
      e.from.name === gt.gateway &&
      e.to.name === gt.dataset,
  );
  for (const [k, ok] of [
    ['dataset', hasDataset],
    ['bo', hasBo],
    ['gateway_oracle', hasGw],
    ['dataset_gateway', hasDsGw],
    ['lookup', hasLookup],
  ] as const) {
    if (ok) matches.push(k);
    else mismatches.push(k);
  }
  return { matched: mismatches.length === 0, extractedPath, mismatches, matches };
}

export function scanExtractorSourceForHardcoding(extractorSource: string): {
  hardcodedPayrollOracleMappingsInExtractor: number;
  hardcodedCurrentPositionMappingsInExtractor: number;
  hardcodedTwgMappingsInExtractor: number;
  expectedAcceptanceMappingsUsedAsInput: number;
} {
  // Only flag if used as extraction seeds / candidate generators, not post-hoc compare helpers.
  const seedSection = extractorSource.split('comparePayrollReferencePath')[0] ?? extractorSource;
  const payrollOracle = (seedSection.match(/NT_KP_PLC_SKLADNIKI_OBL/g) ?? []).length;
  const currentPos = (seedSection.match(/NT_KP_PRC_PRACOWNICY|current.?position/gi) ?? []).length;
  const twg = (seedSection.match(/L_GR_CZ_PRACY|GR_CZ_ID/g) ?? []).length;
  return {
    hardcodedPayrollOracleMappingsInExtractor: payrollOracle,
    hardcodedCurrentPositionMappingsInExtractor: currentPos,
    hardcodedTwgMappingsInExtractor: twg,
    expectedAcceptanceMappingsUsedAsInput: payrollOracle + twg,
  };
}
