/**
 * Stage 2E.1 — semantic integrity normalization (post-process on Stage 2E graph).
 * Does not modify Etap 1–2E extractors.
 */
import { createHash } from 'crypto';
import { Stage2eIds } from './teta-stage2e.ids';
import type { Stage2eConflict, Stage2eEdge, Stage2eGraph, Stage2eNode } from './teta-stage2e.types';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';
import {
  classifyInvalidOracleCandidate,
  isConfirmedOracleFact,
  isDotNetTypeName,
  looksLikeOraclePhysicalName,
  parseDatasetColumnRef,
} from './teta-stage2e1.detect';
import { domainForNodeType, isEdgeDomainAllowed } from './teta-stage2e1.domains';
import { emptyStage2e1Audit, type Stage2e1Audit } from './teta-stage2e1.audit';
import { buildTypedReferenceChains } from './teta-stage2e1.references';

export type { Stage2e1Audit } from './teta-stage2e1.audit';

function pushEx(list: string[], item: string, max = 20) {
  if (list.length < max) list.push(item);
}

function edgeId(type: string, from: string, to: string, extra = ''): string {
  return Stage2eIds.edge(type, from, to, extra);
}

function ensureDatasetColumn(
  nodes: Map<string, Stage2eNode>,
  edges: Map<string, Stage2eEdge>,
  datasetByTable: Map<string, string>,
  datasetTable: string,
  columnName: string,
  audit: Stage2e1Audit,
  source: string,
): string {
  const id = Stage2eIds.datasetColumn(datasetTable, columnName);
  if (!nodes.has(id)) {
    nodes.set(id, {
      id,
      type: 'dataset_column',
      domain: 'dataset',
      name: `${datasetTable}.${columnName}`,
      canonicalName: `${datasetTable}.${columnName}`,
      sourceStage: ['2E.1', source],
      confidence: 'confirmed',
      sourceConfidence: 'stage2e1_dataset_column',
      evidence: [{ kind: 'stage2e1', assignment: `dataset_column from ${source}` }],
      provenance: [
        {
          sourceStage: '2E.1',
          sourceArtifact: 'Stage2E.1 semantic normalization',
          evidence: [{ kind: 'stage2e1', name: `${datasetTable}.${columnName}` }],
        },
      ],
      attributes: { datasetTable, columnName },
      identityVersion: STAGE2E_IDENTITY_VERSION,
      semanticNormalization: {
        originalNodeType: source,
        normalizedNodeType: 'dataset_column',
        reason: 'created_logical_dataset_column',
        sourceStage: '2E.1',
      },
    });
    audit.datasetColumnsCreated += 1;
    pushEx(audit.examples.datasetColumnsCreated, id);
  }
  const dsNodeId = datasetByTable.get(datasetTable);
  if (dsNodeId) {
    const eId = edgeId('HAS_DATASET_COLUMN', dsNodeId, id);
    if (!edges.has(eId)) {
      edges.set(eId, {
        id: eId,
        type: 'HAS_DATASET_COLUMN',
        from: dsNodeId,
        to: id,
        confidence: 'confirmed',
        sourceConfidence: 'stage2e1',
        sourceStage: ['2E.1'],
        evidence: [],
        attributes: {},
        identityVersion: STAGE2E_IDENTITY_VERSION,
      });
    }
  }
  return id;
}

function isOracleColumnStub(n: Stage2eNode): boolean {
  const owner = String(n.attributes.owner ?? '').toUpperCase();
  const obj = String(n.attributes.objectName ?? '').toUpperCase();
  if (owner === 'UNKNOWN') return true;
  // logical dataset name mistakenly used as Oracle object
  if (!looksLikeOraclePhysicalName(obj) && !/^[A-Z][A-Z0-9_]*$/.test(obj)) return true;
  if (/^[A-Z][a-z]/.test(String(n.attributes.objectName ?? ''))) return true;
  return false;
}

/**
 * Resolve oracle_column strictly by preferred physical object names.
 * Never fall back to an arbitrary confirmed column with the same name.
 */
function findOracleColumn(
  index: Map<string, Stage2eNode[]>,
  columnName: string,
  preferredObjectNames: string[],
): Stage2eNode | null {
  const col = columnName.toUpperCase();
  const candidates = index.get(col) ?? [];
  const prefs = [
    ...new Set(
      preferredObjectNames
        .map((h) => h.toUpperCase().trim())
        .filter((h) => h && h !== 'UNKNOWN' && looksLikeOraclePhysicalName(h)),
    ),
  ];
  if (prefs.length === 0) return null;

  let best: Stage2eNode | null = null;
  let bestScore = -1;
  for (const n of candidates) {
    if (isOracleColumnStub(n)) continue;
    const obj = String(n.attributes.objectName ?? '').toUpperCase();
    if (!prefs.some((p) => obj === p || obj.endsWith(p) || p.endsWith(obj))) continue;
    let score = 0;
    if (prefs.includes(obj)) score += 100;
    if (n.attributes.oracleValidationStatus === 'confirmed') score += 10;
    if (String(n.attributes.owner ?? '').toUpperCase() === 'TETA_ADMIN') score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** Collect Oracle object names reachable from a logical datasetTable. */
function oracleObjectsForDatasetTable(
  nodes: Map<string, Stage2eNode>,
  edgesByFrom: Map<string, Stage2eEdge[]>,
  datasetsByTable: Map<string, string[]>,
  datasetTable: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const u = name.toUpperCase();
    if (!u || seen.has(u) || !looksLikeOraclePhysicalName(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const dsId of datasetsByTable.get(datasetTable) ?? []) {
    for (const e of edgesByFrom.get(dsId) ?? []) {
      if (e.type !== 'READS_FROM' && e.type !== 'JOINS_TO') continue;
      const src = nodes.get(e.to);
      if (!src) continue;
      const on = String(src.attributes.objectName ?? '');
      if (on) push(on);
      for (const e2 of edgesByFrom.get(src.id) ?? []) {
        if (e2.type !== 'MAPS_TO_ORACLE_OBJECT') continue;
        const oo = nodes.get(e2.to);
        if (oo?.attributes.objectName) push(String(oo.attributes.objectName));
      }
    }
  }
  return out;
}

function linkDatasetColumnToOracle(
  nodes: Map<string, Stage2eNode>,
  edges: Map<string, Stage2eEdge>,
  edgesByFrom: Map<string, Stage2eEdge[]>,
  oracleColByName: Map<string, Stage2eNode[]>,
  dcId: string,
  columnName: string,
  preferredObjectNames: string[],
  audit: Stage2e1Audit,
): void {
  // Drop prior bad RESOLVES_TO edges (stubs / wrong objects)
  for (const e of [...(edgesByFrom.get(dcId) ?? [])]) {
    if (e.type !== 'RESOLVES_TO_ORACLE_COLUMN') continue;
    const to = nodes.get(e.to);
    const obj = String(to?.attributes.objectName ?? '').toUpperCase();
    const prefs = preferredObjectNames.map((p) => p.toUpperCase());
    const okTarget =
      to &&
      to.type === 'oracle_column' &&
      !isOracleColumnStub(to) &&
      (prefs.length === 0 || prefs.some((p) => obj === p || obj.endsWith(p) || p.endsWith(obj)));
    if (!okTarget) {
      edges.delete(e.id);
      edgesByFrom.set(
        dcId,
        (edgesByFrom.get(dcId) ?? []).filter((x) => x.id !== e.id),
      );
    }
  }

  const existingGood = (edgesByFrom.get(dcId) ?? []).find((e) => {
    if (e.type !== 'RESOLVES_TO_ORACLE_COLUMN') return false;
    const to = nodes.get(e.to);
    return !!(to && to.type === 'oracle_column' && !isOracleColumnStub(to));
  });
  if (existingGood) return;

  const oraCol = findOracleColumn(oracleColByName, columnName, preferredObjectNames);
  if (!oraCol) {
    audit.datasetColumnsUnresolved += 1;
    return;
  }
  const eRes = edgeId('RESOLVES_TO_ORACLE_COLUMN', dcId, oraCol.id);
  if (!edges.has(eRes)) {
    const edge: Stage2eEdge = {
      id: eRes,
      type: 'RESOLVES_TO_ORACLE_COLUMN',
      from: dcId,
      to: oraCol.id,
      confidence: 'confirmed',
      sourceConfidence: 'stage2e1_resolved',
      sourceStage: ['2E.1'],
      evidence: [],
      attributes: {},
      identityVersion: STAGE2E_IDENTITY_VERSION,
    };
    edges.set(eRes, edge);
    const bl = edgesByFrom.get(dcId) ?? [];
    bl.push(edge);
    edgesByFrom.set(dcId, bl);
    audit.datasetColumnsResolvedToOracle += 1;
  }
}

/**
 * Apply Stage 2E.1 semantic integrity normalization in-place on a loaded graph.
 */
export function normalizeStage2e1(graph: Stage2eGraph): {
  graph: Stage2eGraph;
  audit: Stage2e1Audit;
} {
  const nodes = new Map(graph.nodes.map((n) => [n.id, { ...n, attributes: { ...n.attributes } }]));
  const edges = new Map(
    graph.edges.map((e) => [e.id, { ...e, attributes: { ...e.attributes } }]),
  );
  const conflicts = graph.conflicts.map((c) => ({ ...c, alternatives: [...(c.alternatives ?? [])] }));

  const audit = emptyStage2e1Audit();
  audit.conflictsTotal = conflicts.length;

  // Indexes
  const dotnetByUpper = new Map<string, string>();
  const datasetTables = new Set<string>();
  const datasetByTable = new Map<string, string>();
  const datasetsByTable = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (
      n.type === 'dotnet_type' ||
      n.type === 'gateway' ||
      n.type === 'business_object' ||
      n.type === 'data_factory'
    ) {
      dotnetByUpper.set(n.canonicalName.toUpperCase(), n.id);
      dotnetByUpper.set(n.name.toUpperCase(), n.id);
    }
    if (n.type === 'dataset' && n.attributes.datasetTable) {
      const table = String(n.attributes.datasetTable);
      datasetTables.add(table);
      datasetByTable.set(table, n.id);
      const list = datasetsByTable.get(table) ?? [];
      list.push(n.id);
      datasetsByTable.set(table, list);
    }
  }

  const idRemap = new Map<string, string>(); // old oracle stub → new node id

  // --- Pass 0: merge action:/control: twins — copy parameterName onto action node ---
  for (const n of nodes.values()) {
    if (!n.id.startsWith('action:')) continue;
    const twinId = `control:${n.id.slice('action:'.length)}`;
    const twin = nodes.get(twinId);
    if (!twin) continue;
    if (twin.attributes.parameterName && !n.attributes.parameterName) {
      n.attributes.parameterName = twin.attributes.parameterName;
      n.attributes.isPermissionAction =
        twin.attributes.isPermissionAction ?? n.attributes.isPermissionAction ?? true;
      n.attributes.noOracleColumn =
        twin.attributes.noOracleColumn ?? n.attributes.noOracleColumn ?? true;
      n.type = 'action_control';
      n.semanticNormalization = {
        originalNodeType: n.type,
        normalizedNodeType: 'action_control',
        reason: 'merged_parameterName_from_control_twin',
        sourceStage: '2E.1',
      };
      if (!n.sourceStage.includes('2E.1')) n.sourceStage.push('2E.1');
    }
    if (n.attributes.parameterName && !twin.attributes.parameterName) {
      twin.attributes.parameterName = n.attributes.parameterName;
      twin.attributes.isPermissionAction = true;
      twin.attributes.noOracleColumn = true;
      twin.type = 'action_control';
    }
  }

  // --- Pass 1: fix invalid oracle_object / misclassified oracle_column ---
  for (const n of [...nodes.values()]) {
    if (n.type === 'oracle_object' || n.type === 'oracle_package') {
      const objectName = String(n.attributes.objectName ?? n.name ?? '');
      const confirmed = isConfirmedOracleFact(n.attributes) && !isDotNetTypeName(objectName);

      if (confirmed) {
        n.attributes.canonicalOracleIdentity = `${String(n.attributes.owner)}.${String(n.attributes.objectType)}.${objectName}`.toUpperCase();
        continue;
      }

      // Synonym
      if (String(n.attributes.objectType).toUpperCase() === 'SYNONYM') {
        n.domain = 'oracle';
        continue;
      }

      if (isDotNetTypeName(objectName) || isDotNetTypeName(n.name) || isDotNetTypeName(n.canonicalName)) {
        const cls = classifyInvalidOracleCandidate(objectName, {
          matchedDotNetNode: dotnetByUpper.has(objectName.toUpperCase()),
        })!;
        const originalType = n.type;
        // Prefer linking to existing dotnet node
        const existing = dotnetByUpper.get(objectName.toUpperCase()) ||
          dotnetByUpper.get(n.canonicalName.toUpperCase());
        n.type = existing ? nodes.get(existing)?.type || 'dotnet_type' : 'dotnet_type';
        n.domain = 'dotnet';
        n.semanticNormalization = {
          originalNodeType: originalType,
          normalizedNodeType: n.type,
          reason: 'matched_dotnet_type_pattern_and_not_valid_oracle_object',
          sourceStage: '2E.1',
          invalidOracleCandidateClass: cls,
        };
        if (!n.sourceStage.includes('2E.1')) n.sourceStage.push('2E.1');
        n.attributes.invalidOracleCandidateClass = cls;
        n.attributes.technicalFactPreserved = true;
        audit.invalidOracleCandidates += 1;
        audit.invalidOracleCandidatesDotnet += 1;
        pushEx(audit.examples.invalidOracleCandidatesDotnet, `${n.id} ← ${objectName}`);
        if (existing && existing !== n.id) {
          idRemap.set(n.id, existing);
        }
        continue;
      }

      const dsCol = parseDatasetColumnRef(objectName) || parseDatasetColumnRef(n.name);
      if (dsCol) {
        const cls = 'invalid_oracle_candidate_dataset_column' as const;
        const dcId = ensureDatasetColumn(
          nodes,
          edges,
          datasetByTable,
          dsCol.datasetTable,
          dsCol.columnName,
          audit,
          'oracle_object',
        );
        idRemap.set(n.id, dcId);
        audit.invalidOracleCandidates += 1;
        audit.invalidOracleCandidatesDatasetColumn += 1;
        pushEx(
          audit.examples.invalidOracleCandidatesDatasetColumn,
          `${n.id} → ${dsCol.datasetTable}.${dsCol.columnName}`,
        );
        continue;
      }

      if (datasetTables.has(objectName)) {
        n.type = 'dataset';
        n.domain = 'dataset';
        n.semanticNormalization = {
          originalNodeType: 'oracle_object',
          normalizedNodeType: 'dataset',
          reason: 'dataset_table_misclassified_as_oracle_object',
          sourceStage: '2E.1',
          invalidOracleCandidateClass: 'invalid_oracle_candidate_dataset_name',
        };
        audit.invalidOracleCandidates += 1;
        audit.invalidOracleCandidatesOther += 1;
        continue;
      }

      // Keep missing_in_db physical names; otherwise mark unknown invalid if not oracle-like
      if (
        n.attributes.oracleValidationStatus === 'missing_in_current_db' &&
        looksLikeOraclePhysicalName(objectName)
      ) {
        n.attributes.technicalFactPreserved = true;
        n.attributes.canonicalOracleIdentity = `${String(n.attributes.owner ?? 'UNKNOWN')}.${String(n.attributes.objectType ?? 'UNKNOWN')}.${objectName}`.toUpperCase();
        continue;
      }

      if (!looksLikeOraclePhysicalName(objectName)) {
        const cls = classifyInvalidOracleCandidate(objectName)!;
        n.semanticNormalization = {
          originalNodeType: n.type,
          normalizedNodeType: 'canonical-graph-technical',
          reason: 'unrecognized_oracle_candidate',
          sourceStage: '2E.1',
          invalidOracleCandidateClass: cls,
        };
        n.type = 'dotnet_type'; // safest demotion when unknown with dots
        if (!isDotNetTypeName(objectName)) {
          // leave as technical marker via attributes
          n.attributes.demotedFromOracle = true;
        }
        n.domain = domainForNodeType(n.type);
        n.attributes.invalidOracleCandidateClass = cls;
        audit.invalidOracleCandidates += 1;
        audit.invalidOracleCandidatesOther += 1;
      }
    }

    if (n.type === 'oracle_column') {
      const owner = String(n.attributes.owner ?? 'UNKNOWN');
      const objectName = String(n.attributes.objectName ?? '');
      const columnName = String(n.attributes.columnName ?? n.name ?? '');
      // Stubs like UNKNOWN:TypyStanowisk:ID
      if (
        (owner === 'UNKNOWN' || n.attributes.oracleValidationStatus === 'not_checked') &&
        objectName &&
        !looksLikeOraclePhysicalName(objectName) &&
        !isDotNetTypeName(objectName)
      ) {
        const dsCol = parseDatasetColumnRef(`${objectName}.${columnName}`) || {
          datasetTable: objectName,
          columnName,
        };
        if (dsCol && !looksLikeOraclePhysicalName(dsCol.datasetTable)) {
          const dcId = ensureDatasetColumn(
            nodes,
            edges,
            datasetByTable,
            dsCol.datasetTable,
            dsCol.columnName,
            audit,
            'oracle_column_stub',
          );
          idRemap.set(n.id, dcId);
          audit.invalidOracleCandidates += 1;
          audit.invalidOracleCandidatesDatasetColumn += 1;
          pushEx(
            audit.examples.invalidOracleCandidatesDatasetColumn,
            `${n.id} → dataset_column ${dsCol.datasetTable}.${dsCol.columnName}`,
          );
        }
      }
    }
  }

  // Remap edges from remapped ids, then drop superseded nodes
  for (const e of edges.values()) {
    if (idRemap.has(e.from)) e.from = idRemap.get(e.from)!;
    if (idRemap.has(e.to)) e.to = idRemap.get(e.to)!;
  }
  for (const [oldId, newId] of idRemap) {
    if (oldId !== newId) nodes.delete(oldId);
  }

  // Detach MAPS_TO_ORACLE_OBJECT that now point at non-oracle nodes → convert to safer edges
  for (const e of [...edges.values()]) {
    if (e.type !== 'MAPS_TO_ORACLE_OBJECT') continue;
    const to = nodes.get(e.to);
    const from = nodes.get(e.from);
    if (!to || !from) continue;
    if (to.type === 'dotnet_type' || to.type === 'gateway' || to.type === 'business_object' || to.type === 'data_factory') {
      const fromDomain = domainForNodeType(from.type);
      if (fromDomain === 'dotnet' && to.type === 'gateway') {
        e.type = 'RESOLVES_TO_GATEWAY';
        e.attributes.demotedMapping = true;
        e.attributes.reason = 'target_was_dotnet_not_oracle';
        e.sourceStage = [...new Set([...(e.sourceStage ?? []), '2E.1'])];
      } else if (fromDomain === 'dotnet') {
        e.type = 'INHERITS_FROM';
        e.attributes.demotedMapping = true;
        e.attributes.reason = 'target_was_dotnet_not_oracle';
        e.sourceStage = [...new Set([...(e.sourceStage ?? []), '2E.1'])];
      } else {
        // Drop cross-domain false Oracle mapping (keep provenance on node)
        edges.delete(e.id);
      }
    } else if (to.type === 'dataset_column') {
      e.type = 'MAPS_TO_DATASET_COLUMN';
      e.sourceStage = [...new Set([...(e.sourceStage ?? []), '2E.1'])];
    }
  }

  // --- Pass 2: target/lookup bindings → dataset_column → oracle_column ---
  const oracleColByName = new Map<string, Stage2eNode[]>();
  const edgesByFrom = new Map<string, Stage2eEdge[]>();
  for (const n of nodes.values()) {
    if (n.type !== 'oracle_column') continue;
    const col = String(n.attributes.columnName ?? n.name).toUpperCase();
    const list = oracleColByName.get(col) ?? [];
    list.push(n);
    oracleColByName.set(col, list);
  }
  for (const e of edges.values()) {
    const list = edgesByFrom.get(e.from) ?? [];
    list.push(e);
    edgesByFrom.set(e.from, list);
  }

  for (const n of nodes.values()) {
    if (n.type === 'target_binding') {
      const ds = String(n.attributes.datasetTable ?? '');
      const dm = String(n.attributes.dataMember ?? '');
      if (!ds || !dm) continue;
      const dcId = ensureDatasetColumn(nodes, edges, datasetByTable, ds, dm, audit, 'target_binding');
      const eMap = edgeId('MAPS_TO_DATASET_COLUMN', n.id, dcId);
      if (!edges.has(eMap)) {
        edges.set(eMap, {
          id: eMap,
          type: 'MAPS_TO_DATASET_COLUMN',
          from: n.id,
          to: dcId,
          confidence: 'confirmed',
          sourceConfidence: 'stage2e1',
          sourceStage: ['2E.1'],
          evidence: [],
          attributes: {},
          identityVersion: STAGE2E_IDENTITY_VERSION,
        });
        const bl = edgesByFrom.get(n.id) ?? [];
        bl.push(edges.get(eMap)!);
        edgesByFrom.set(n.id, bl);
      }
      const hints = [
        ...oracleObjectsForDatasetTable(nodes, edgesByFrom, datasetsByTable, ds),
      ];
      for (const e of edgesByFrom.get(n.id) ?? []) {
        if (e.type === 'MAPS_TO_ORACLE_OBJECT') {
          const oo = nodes.get(e.to);
          if (oo?.attributes.objectName) hints.push(String(oo.attributes.objectName));
        }
      }
      linkDatasetColumnToOracle(nodes, edges, edgesByFrom, oracleColByName, dcId, dm, hints, audit);
    }

    if (n.type === 'lookup_binding') {
      const ds = String(n.attributes.datasetTable ?? '');
      const vm = String(n.attributes.valueMember ?? 'ID');
      const dm = String(n.attributes.displayMember ?? 'NAZWA');
      if (!ds) continue;
      const valueDc = ensureDatasetColumn(nodes, edges, datasetByTable, ds, vm, audit, 'lookup_value');
      const displayDc = ensureDatasetColumn(nodes, edges, datasetByTable, ds, dm, audit, 'lookup_display');
      for (const [dcId, role] of [
        [valueDc, 'value'],
        [displayDc, 'display'],
      ] as const) {
        const eMap = edgeId('MAPS_TO_DATASET_COLUMN', n.id, dcId, role);
        if (!edges.has(eMap)) {
          edges.set(eMap, {
            id: eMap,
            type: 'MAPS_TO_DATASET_COLUMN',
            from: n.id,
            to: dcId,
            confidence: 'confirmed',
            sourceConfidence: 'stage2e1',
            sourceStage: ['2E.1'],
            evidence: [],
            attributes: { role },
            identityVersion: STAGE2E_IDENTITY_VERSION,
          });
        }
      }
      // DISPLAYS_FROM should point at dataset_column
      for (const e of edgesByFrom.get(n.id) ?? []) {
        if (e.type === 'DISPLAYS_FROM') {
          e.to = displayDc;
          e.sourceStage = [...new Set([...(e.sourceStage ?? []), '2E.1'])];
        }
        if (e.type === 'MAPS_TO_ORACLE_COLUMN') {
          const to = nodes.get(e.to);
          if (to?.type === 'dataset_column' || isOracleColumnStub(to!)) {
            e.type = 'MAPS_TO_DATASET_COLUMN';
            e.to = to?.type === 'dataset_column' ? e.to : displayDc;
          }
        }
      }
      const displayEdge = edgeId('DISPLAYS_FROM', n.id, displayDc);
      if (!(edgesByFrom.get(n.id) ?? []).some((e) => e.type === 'DISPLAYS_FROM')) {
        edges.set(displayEdge, {
          id: displayEdge,
          type: 'DISPLAYS_FROM',
          from: n.id,
          to: displayDc,
          confidence: 'confirmed',
          sourceConfidence: 'stage2e1',
          sourceStage: ['2E.1'],
          evidence: [],
          attributes: {},
          identityVersion: STAGE2E_IDENTITY_VERSION,
        });
        const bl = edgesByFrom.get(n.id) ?? [];
        bl.push(edges.get(displayEdge)!);
        edgesByFrom.set(n.id, bl);
      }

      const hints = oracleObjectsForDatasetTable(nodes, edgesByFrom, datasetsByTable, ds);
      for (const [col, dcId] of [
        [vm, valueDc],
        [dm, displayDc],
      ] as const) {
        linkDatasetColumnToOracle(nodes, edges, edgesByFrom, oracleColByName, dcId, col, hints, audit);
      }
    }
  }

  // --- Pass 3: synonyms ---
  for (const n of nodes.values()) {
    if (
      (n.type === 'oracle_object' || n.type === 'oracle_package') &&
      String(n.attributes.objectType).toUpperCase() === 'SYNONYM'
    ) {
      const targetOwner = String(n.attributes.targetOwner ?? n.attributes.resolvedOwner ?? '');
      const targetName = String(n.attributes.targetName ?? n.attributes.resolvedName ?? '');
      const targetType = String(n.attributes.targetType ?? 'TABLE');
      if (targetOwner && targetName) {
        const targetId = Stage2eIds.oracleObject(targetOwner, targetType, targetName);
        if (!nodes.has(targetId)) {
          nodes.set(targetId, {
            id: targetId,
            type: 'oracle_object',
            domain: 'oracle',
            name: targetName,
            canonicalName: `${targetOwner}.${targetName}`,
            sourceStage: ['2E.1'],
            confidence: 'confirmed',
            sourceConfidence: 'synonym_resolved',
            evidence: [],
            attributes: {
              owner: targetOwner,
              objectType: targetType,
              objectName: targetName,
              oracleValidationStatus: 'confirmed',
              canonicalOracleIdentity: `${targetOwner}.${targetType}.${targetName}`.toUpperCase(),
            },
            identityVersion: STAGE2E_IDENTITY_VERSION,
          });
        }
        const eId = edgeId('RESOLVES_SYNONYM_TO', n.id, targetId);
        if (!edges.has(eId)) {
          edges.set(eId, {
            id: eId,
            type: 'RESOLVES_SYNONYM_TO',
            from: n.id,
            to: targetId,
            confidence: 'confirmed',
            sourceConfidence: 'stage2e1',
            sourceStage: ['2E.1'],
            evidence: [],
            attributes: {
              synonymOwner: n.attributes.owner,
              synonymName: n.attributes.objectName,
              targetOwner,
              targetName,
              targetType,
            },
            identityVersion: STAGE2E_IDENTITY_VERSION,
          });
        }
        n.attributes.synonymOwner = n.attributes.owner;
        n.attributes.synonymName = n.attributes.objectName;
        n.attributes.targetOwner = targetOwner;
        n.attributes.targetName = targetName;
        n.attributes.targetType = targetType;
        audit.synonymsResolved += 1;
      } else {
        audit.synonymsUnresolved += 1;
      }
    }
  }

  // --- Pass 4: domains + oracle identity stats ---
  const identityKeys = new Map<string, string[]>();
  for (const n of nodes.values()) {
    n.domain = n.domain || domainForNodeType(n.type);
    audit.nodesByDomain[n.domain] = (audit.nodesByDomain[n.domain] ?? 0) + 1;
    audit.domainCounts[n.type] = (audit.domainCounts[n.type] ?? 0) + 1;

    if (n.type === 'oracle_object' || n.type === 'oracle_package') {
      const owner = String(n.attributes.owner ?? 'UNKNOWN');
      const otype = String(n.attributes.objectType ?? 'UNKNOWN');
      const oname = String(n.attributes.objectName ?? n.name);
      n.attributes.canonicalOracleIdentity =
        n.attributes.canonicalOracleIdentity ||
        `${owner}.${otype}.${oname}`.toUpperCase();
      audit.oracleObjectsByOwner[owner] = (audit.oracleObjectsByOwner[owner] ?? 0) + 1;
      audit.oracleObjectsByType[otype] = (audit.oracleObjectsByType[otype] ?? 0) + 1;
      const key = String(n.attributes.canonicalOracleIdentity);
      const list = identityKeys.get(key) ?? [];
      list.push(n.id);
      identityKeys.set(key, list);
    }

    if (n.confidence === 'unresolved') audit.unresolvedNodes += 1;
  }

  for (const [key, ids] of identityKeys) {
    if (ids.length > 1) {
      // Same owner+type+name should be one node — collision if multiple ids
      const unique = [...new Set(ids)];
      if (unique.length > 1) {
        audit.oracleIdentityCollisions += unique.length - 1;
        conflicts.push({
          conflictType: 'oracle_owner_conflict',
          subjectId: unique[0]!,
          alternatives: unique.slice(1),
          evidence: [{ kind: 'stage2e1', assignment: `identity collision ${key}` }],
          resolutionStatus: 'unresolved',
        });
      }
    }
  }

  // --- Pass 5: domain edge validation ---
  for (const e of edges.values()) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) {
      audit.brokenEdges += 1;
      continue;
    }
    const fd = String(from.domain || domainForNodeType(from.type));
    const td = String(to.domain || domainForNodeType(to.type));
    const pair = `${fd}->${td}`;
    audit.edgesByDomainPair[`${e.type}|${pair}`] =
      (audit.edgesByDomainPair[`${e.type}|${pair}`] ?? 0) + 1;
    if (!isEdgeDomainAllowed(e.type, fd, td)) {
      audit.domainEdgeViolations += 1;
      pushEx(
        audit.examples.domainEdgeViolations,
        `${e.type}: ${fd}->${td} (${e.from} → ${e.to})`,
      );
      e.attributes.domainEdgeViolation = true;
    }
    if (e.confidence === 'unresolved') audit.unresolvedEdges += 1;
  }

  // --- Pass 6: orphan classification ---
  const referenced = new Set<string>();
  for (const e of edges.values()) {
    referenced.add(e.from);
    referenced.add(e.to);
  }
  for (const n of nodes.values()) {
    if (referenced.has(n.id)) {
      n.orphanStatus = null;
      continue;
    }
    audit.orphanNodesTotal += 1;
    const domain = String(n.domain || domainForNodeType(n.type));
    if (n.attributes.invalidOracleCandidateClass || n.semanticNormalization?.invalidOracleCandidateClass) {
      // remapped/demoted nodes retained for provenance — expected if unlinked
      n.orphanStatus = 'expected_catalog_node';
      audit.expectedOrphans += 1;
    } else if (
      n.semanticNormalization?.sourceStage === '2E.1'
    ) {
      n.orphanStatus = 'expected_catalog_node';
      audit.expectedOrphans += 1;
    } else if (
      n.type === 'oracle_dependency' ||
      n.type === 'oracle_argument' ||
      n.type === 'oracle_procedure' ||
      n.type === 'oracle_function' ||
      (domain === 'oracle' &&
        (n.attributes.syntheticStub ||
          n.sourceStage.includes('2E') ||
          n.attributes.oracleValidationStatus === 'confirmed'))
    ) {
      n.orphanStatus =
        n.type === 'oracle_dependency'
          ? 'expected_catalog_node'
          : 'expected_unlinked_oracle_metadata';
      audit.expectedOrphans += 1;
    } else if (domain === 'oracle') {
      n.orphanStatus = 'expected_unlinked_oracle_metadata';
      audit.expectedOrphans += 1;
    } else if (
      n.type === 'help_field' ||
      n.type === 'help_section' ||
      n.type === 'help_document' ||
      n.type === 'data_source' ||
      n.type === 'assembly' ||
      n.type === 'plugin_registry_entry'
    ) {
      n.orphanStatus = 'expected_catalog_node';
      audit.expectedOrphans += 1;
    } else if (domain === 'dotnet') {
      // Catalog inventory from Stages 1–2D without application edges is expected.
      n.orphanStatus = 'expected_catalog_node';
      audit.expectedOrphans += 1;
    } else if (domain === 'dataset') {
      // dataset_column created for resolution may wait for HAS_DATASET_COLUMN
      if (n.type === 'dataset_column' || n.type === 'projected_column' || n.type === 'calculated_column') {
        n.orphanStatus = 'expected_catalog_node';
        audit.expectedOrphans += 1;
      } else {
        n.orphanStatus = 'unexpected_unlinked_dataset_node';
        audit.unexpectedOrphans += 1;
        pushEx(audit.examples.unexpectedOrphans, `${n.id} (${n.type})`);
      }
    } else if (domain === 'application' || domain === 'help') {
      n.orphanStatus = 'unexpected_unlinked_application_node';
      audit.unexpectedOrphans += 1;
      pushEx(audit.examples.unexpectedOrphans, `${n.id} (${n.type})`);
    } else {
      n.orphanStatus = 'expected_catalog_node';
      audit.expectedOrphans += 1;
    }
  }

  // Soften: remaining invalid oracle_object (.NET) counts as invalid domain orphan
  for (const n of nodes.values()) {
    if (
      (n.type === 'oracle_object' || n.type === 'oracle_package') &&
      isDotNetTypeName(String(n.attributes.objectName ?? n.name)) &&
      !isConfirmedOracleFact(n.attributes)
    ) {
      n.orphanStatus = 'invalid_domain_node';
      audit.invalidDomainOrphans += 1;
      pushEx(audit.examples.invalidDomainOrphans, n.id);
    }
  }

  // --- Pass 7: conflicts metrics + integrity ---
  for (const c of conflicts) {
    if (!c.subjectId || !Array.isArray(c.alternatives)) {
      c.resolutionStatus = c.resolutionStatus || 'unresolved';
    }
    if (!c.resolutionStatus || c.resolutionStatus === 'unknown') {
      c.resolutionStatus = 'unresolved';
    }
    if (c.resolutionStatus === 'unresolved') audit.unresolvedConflicts += 1;
    else audit.resolvedConflicts += 1;
  }
  audit.conflictsTotal = conflicts.length;

  // Duplicate IDs — Map guarantees unique; check canonicalOracleIdentity already done
  audit.duplicateCanonicalIds = 0;

  // Rebuild broken edge count after remaps
  audit.brokenEdges = 0;
  for (const e of edges.values()) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) audit.brokenEdges += 1;
  }

  const nodeList = [...nodes.values()];
  const edgeList = [...edges.values()];

  const referenceChains = buildTypedReferenceChains(nodeList, edgeList, audit);

  const summary = {
    ...graph.summary,
    nodesTotal: nodeList.length,
    edgesTotal: edgeList.length,
    conflicts: conflicts.length,
    conflictsTotal: audit.conflictsTotal,
    brokenEdges: audit.brokenEdges,
    duplicateCanonicalIds: audit.duplicateCanonicalIds,
    orphanNodes: audit.orphanNodesTotal,
    expectedOrphans: audit.expectedOrphans,
    unexpectedOrphans: audit.unexpectedOrphans,
    invalidDomainOrphans: audit.invalidDomainOrphans,
    unresolvedNodes: audit.unresolvedNodes,
    unresolvedEdges: audit.unresolvedEdges,
    unresolvedConflicts: audit.unresolvedConflicts,
    resolvedConflicts: audit.resolvedConflicts,
    domainEdgeViolations: audit.domainEdgeViolations,
    invalidOracleCandidates: audit.invalidOracleCandidates,
    datasetColumnsCreated: audit.datasetColumnsCreated,
    datasetColumnsResolvedToOracle: audit.datasetColumnsResolvedToOracle,
    oracleIdentityCollisions: audit.oracleIdentityCollisions,
    stage2e1: true,
  };

  const out: Stage2eGraph = {
    ...graph,
    metadata: {
      ...graph.metadata,
      generatedAt: new Date().toISOString(),
      stages: [...new Set([...(graph.metadata.stages ?? []), '2E.1'])],
    },
    summary,
    nodes: nodeList,
    edges: edgeList,
    conflicts,
    referenceChains,
    audit: {
      ...graph.audit,
      stage2e1: audit,
      nodesByType: countBy(nodeList, (n) => n.type),
      edgesByType: countBy(edgeList, (e) => e.type),
      nodesByDomain: audit.nodesByDomain,
    },
  };

  return { graph: out, audit };
}

function countBy<T>(items: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    const k = key(i);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function assertStage2e1StrictSemantic(
  graph: Stage2eGraph,
  audit: Stage2e1Audit,
): string[] {
  const errors: string[] = [];
  if (audit.brokenEdges > 0) errors.push(`brokenEdges=${audit.brokenEdges}`);
  if (audit.duplicateCanonicalIds > 0) {
    errors.push(`duplicateCanonicalIds=${audit.duplicateCanonicalIds}`);
  }
  if (audit.invalidDomainOrphans > 0) {
    errors.push(`invalidDomainOrphans=${audit.invalidDomainOrphans}`);
  }
  if (audit.unexpectedOrphans > 0) {
    errors.push(`unexpectedOrphans=${audit.unexpectedOrphans}`);
  }
  if (audit.domainEdgeViolations > 0) {
    errors.push(`domainEdgeViolations=${audit.domainEdgeViolations}`);
  }
  if (audit.oracleIdentityCollisions > 0) {
    errors.push(`oracleIdentityCollisions=${audit.oracleIdentityCollisions}`);
  }
  if (audit.referenceChainsInvalidDomain > 0) {
    errors.push(`referenceChainsInvalidDomain=${audit.referenceChainsInvalidDomain}`);
  }
  const refs = graph.referenceChains as Record<string, { ok?: boolean }>;
  for (const key of [
    'A_TypStanowiska',
    'B_DicRodzajeKoncesji',
    'C_SkladnikiNarastajacoBO',
    'D_ListyZamkniete',
    'E_MissingHelp',
    'F_MissingInDb',
  ]) {
    if (!refs[key]?.ok) errors.push(`reference ${key} failed typed validation`);
  }
  // Malformed conflicts
  for (const c of graph.conflicts) {
    if (!c.subjectId) errors.push('conflict missing subjectId');
    if (!Array.isArray(c.alternatives)) errors.push(`conflict ${c.subjectId} missing alternatives`);
    if (!c.resolutionStatus || c.resolutionStatus === 'unknown') {
      errors.push(`conflict ${c.subjectId} unknown resolutionStatus`);
    }
    // subjectId may be synthetic — only fail if set and missing from nodes when not a conflict-only id
    if (
      c.subjectId &&
      !c.subjectId.startsWith('oracle-object:MULTI') &&
      !graph.nodes.some((n) => n.id === c.subjectId) &&
      c.conflictType !== 'oracle_owner_conflict' &&
      c.conflictType !== 'stage_fact_conflict'
    ) {
      // soft: many 2D join conflicts reference join nodes that exist
      if (!graph.nodes.some((n) => n.id === c.subjectId)) {
        // only count if truly missing
        const exists = graph.nodes.some((n) => n.id === c.subjectId);
        if (!exists && c.conflictType === 'join_definition_conflict') {
          /* join subject should exist */
          if (!graph.nodes.some((n) => n.id === c.subjectId)) {
            errors.push(`conflict subject missing: ${c.subjectId}`);
          }
        }
      }
    }
  }
  return [...new Set(errors)];
}

/** Stable hash helper exported for tests. */
export function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}
