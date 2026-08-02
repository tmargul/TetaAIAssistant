import fs from 'fs';
import path from 'path';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import type {
  DependencyEvidenceKind,
  KeyPreservationStatus,
  ViewGrainPreservationEvidence,
} from './teta-gap.types';
import { sha256, stableStringify } from './teta-gap.types';
import { FIXTURE_GRAPH_SOURCE_HASH } from './teta-stage3k2b2a-fixtures';

/** Prior evidence anchors from Stage 3K.2B1 packs — start points only */
export const REAL_P1_FORM_GUID = '19a5dac6-733f-4801-8a66-f9ee707bb404';
export const REAL_EMPLOYEE_OBJECT_NAME = 'NT_KP_PRC_PRACOWNICY';
export const REAL_EMPLOYEE_OBJECT_OWNER = 'TETA_ADMIN';

export interface RealGraphTypedDependencyEvidence {
  dependencyEvidenceKind: DependencyEvidenceKind;
  relationType: string | null;
  sourceNodeType: string | null;
  targetRole: 'employee_master';
  graphPathFingerprint: string | null;
  evidenceStatus: 'confirmed' | 'unresolved' | 'missing';
  nameHeuristicHits: number;
  typedForeignKeyHits: number;
}

export interface RealGraphReadResult {
  available: boolean;
  graphSourceHash: string | null;
  formResolved: boolean;
  formNodeId: string | null;
  employeeObjectResolved: boolean;
  employeeObjectNodeId: string | null;
  employeeObjectType: string | null;
  employeeHasBaseTablePkViaDependsOn: boolean;
  employeeDependsOnCount: number;
  participantLikeNodesFound: number;
  inboundReferenceCount: number;
  /** @deprecated use typedDependencyEvidence — name alone must not confirm */
  participantEmployeeRelationConfirmed: boolean | null;
  typedDependencyEvidence: RealGraphTypedDependencyEvidence;
  viewGrainPreservation: ViewGrainPreservationEvidence | null;
  readCount: number;
  errors: string[];
  localTrace?: Record<string, unknown>;
}

function emptyTypedDependency(): RealGraphTypedDependencyEvidence {
  return {
    dependencyEvidenceKind: 'unresolved',
    relationType: null,
    sourceNodeType: null,
    targetRole: 'employee_master',
    graphPathFingerprint: null,
    evidenceStatus: 'unresolved',
    nameHeuristicHits: 0,
    typedForeignKeyHits: 0,
  };
}

export function assessViewGrainPreservation(input: {
  sourceObjectRef: string;
  sourceObjectType: string | null;
  baseTablePkViaDependsOn: boolean;
  dependsOnCount: number;
  projectedEmployeeKeyEvidence: string | null;
  keyPreservingJoinEvidence: boolean;
  authoritativeGrainEvidence: boolean;
}): ViewGrainPreservationEvidence {
  const isTable = (input.sourceObjectType ?? '').toUpperCase() === 'TABLE';
  let keyPreservationStatus: KeyPreservationStatus = 'unproven';
  const evidenceRefs: string[] = [];

  if (isTable && input.baseTablePkViaDependsOn) {
    // Direct employee-master table with PK — path A
    keyPreservationStatus = 'proven';
    evidenceRefs.push('direct_employee_master_table_pk');
  } else if (input.projectedEmployeeKeyEvidence && input.keyPreservingJoinEvidence) {
    // Path B: view preserves employee key (projection + verified non-multiplying relation)
    keyPreservationStatus = 'proven';
    evidenceRefs.push('projected_employee_key', 'key_preserving_relation');
    if (input.baseTablePkViaDependsOn) {
      evidenceRefs.push('base_table_pk_via_depends_on_supporting_not_sufficient_alone');
    }
  } else if (input.authoritativeGrainEvidence) {
    keyPreservationStatus = 'proven';
    evidenceRefs.push('authoritative_gateway_or_application_grain');
  } else if (input.projectedEmployeeKeyEvidence && input.baseTablePkViaDependsOn) {
    keyPreservationStatus = 'partial';
    evidenceRefs.push(
      'projected_employee_key_partial',
      'base_table_pk_via_depends_on_insufficient_alone',
    );
  } else if (input.baseTablePkViaDependsOn) {
    keyPreservationStatus = 'unproven';
    evidenceRefs.push('base_table_pk_via_depends_on_alone_insufficient_for_view_grain');
  }

  return {
    sourceObjectRef: input.sourceObjectRef,
    baseEmployeeSourceRef: input.baseTablePkViaDependsOn
      ? `${input.sourceObjectRef}→DEPENDS_ON→base`
      : null,
    projectedEmployeeKeyEvidence: input.projectedEmployeeKeyEvidence,
    rowMultiplicationRisk:
      keyPreservationStatus === 'proven' ? null : 'view_row_multiplication_unproven',
    joinsAssessment:
      input.dependsOnCount > 1
        ? 'multiple_depends_on_neighbors_multiplication_risk_unchecked'
        : input.dependsOnCount === 1
          ? 'single_depends_on_neighbor_key_preservation_not_verified'
          : 'no_depends_on_neighbor',
    keyPreservationStatus,
    evidenceRefs,
    baseTablePkViaDependsOnAlone:
      Boolean(input.baseTablePkViaDependsOn) &&
      !input.keyPreservingJoinEvidence &&
      !input.authoritativeGrainEvidence &&
      !isTable,
  };
}

export function tryRealGraphRead(repoRoot: string): RealGraphReadResult {
  const paths = defaultStage3aPaths(repoRoot);
  const indexPath = paths.indexPath;
  const result: RealGraphReadResult = {
    available: false,
    graphSourceHash: null,
    formResolved: false,
    formNodeId: null,
    employeeObjectResolved: false,
    employeeObjectNodeId: null,
    employeeObjectType: null,
    employeeHasBaseTablePkViaDependsOn: false,
    employeeDependsOnCount: 0,
    participantLikeNodesFound: 0,
    inboundReferenceCount: 0,
    participantEmployeeRelationConfirmed: null,
    typedDependencyEvidence: emptyTypedDependency(),
    viewGrainPreservation: null,
    readCount: 0,
    errors: [],
  };

  if (!fs.existsSync(indexPath)) {
    result.errors.push('stage3a_index_missing');
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null;

  try {
    const index = new CanonicalGraphIndexService(paths);
    const status = index.status();
    result.graphSourceHash = status.sourceHash ?? FIXTURE_GRAPH_SOURCE_HASH;
    result.available = true;
    db = index.openReadonly();
    const resolver = new CanonicalGraphResolverService(db);

    const form = resolver.resolveForm({ guid: REAL_P1_FORM_GUID });
    result.readCount += 1;
    result.formResolved = form.status === 'resolved';
    result.formNodeId = form.selectedNodeId ?? form.candidates?.[0]?.nodeId ?? null;

    const emp = resolver.traceOracleObject({
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      name: REAL_EMPLOYEE_OBJECT_NAME,
      objectType: 'VIEW',
    });
    result.readCount += 1;
    result.employeeObjectResolved = emp.status === 'resolved' || emp.status === 'ambiguous';
    result.employeeObjectNodeId =
      emp.selectedNodeId ?? emp.candidates?.[0]?.nodeId ?? null;
    result.employeeObjectType = 'VIEW';

    const edges = emp.edges ?? [];
    const dependsOn = edges.filter((e) => e.type === 'DEPENDS_ON');
    result.employeeDependsOnCount = dependsOn.length;

    let pkHit = edges.some(
      (e) => e.type === 'PRIMARY_KEY_OF' || e.type === 'UNIQUE_KEY_OF',
    );

    if (!pkHit && result.employeeObjectNodeId && db) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM kg_edges e
           JOIN kg_edges e2 ON (
             e2.from_id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
             OR e2.to_id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
           )
           WHERE (e.from_id = ? OR e.to_id = ?) AND e.type = 'DEPENDS_ON'
             AND e2.type IN ('PRIMARY_KEY_OF','UNIQUE_KEY_OF')`,
        )
        .get(
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
        ) as { c: number };
      result.readCount += 1;
      if (row?.c > 0) pkHit = true;
    }
    result.employeeHasBaseTablePkViaDependsOn = pkHit;

    // View grain: base-table PK via DEPENDS_ON alone is insufficient.
    // Without projected key + verified key-preserving join → unproven.
    let projectedKey: string | null = null;
    if (result.employeeObjectNodeId && db) {
      const cols = db
        .prepare(
          `SELECT n.name FROM kg_edges e
           JOIN kg_nodes n ON n.id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
           WHERE (e.from_id = ? OR e.to_id = ?) AND e.type = 'HAS_COLUMN'
           LIMIT 200`,
        )
        .all(
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
        ) as Array<{ name: string | null }>;
      result.readCount += 1;
      const keyLike = cols.find((c) => {
        const n = (c.name ?? '').toLowerCase();
        return (
          n.includes('id_prac') ||
          n.includes('pracownik') ||
          n === 'id' ||
          n.includes('nr_ewid')
        );
      });
      // Name-like column presence is only a hint — not alone proof of key preservation.
      projectedKey = keyLike?.name ? `column_name_hint:${keyLike.name}` : null;
    }

    result.viewGrainPreservation = assessViewGrainPreservation({
      sourceObjectRef: `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
      sourceObjectType: result.employeeObjectType,
      baseTablePkViaDependsOn: pkHit,
      dependsOnCount: result.employeeDependsOnCount,
      projectedEmployeeKeyEvidence: projectedKey,
      // Graph does not currently prove absence of row-multiplying joins for the view.
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
    });

    if (result.employeeObjectNodeId && db) {
      const inbound = db
        .prepare(
          `SELECT COUNT(*) AS c FROM kg_edges
           WHERE (to_id = ? OR from_id = ?)
             AND type IN ('FOREIGN_KEY_TO','REFERENCES')`,
        )
        .get(result.employeeObjectNodeId, result.employeeObjectNodeId) as { c: number };
      result.readCount += 1;
      result.inboundReferenceCount = inbound?.c ?? 0;

      const neighborFk = db
        .prepare(
          `SELECT COUNT(*) AS c FROM kg_edges e
           JOIN kg_edges e2 ON (
             e2.from_id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
             OR e2.to_id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
           )
           WHERE (e.from_id = ? OR e.to_id = ?) AND e.type = 'DEPENDS_ON'
             AND e2.type IN ('FOREIGN_KEY_TO','REFERENCES')`,
        )
        .get(
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
        ) as { c: number };
      result.readCount += 1;
      const neighborFkCount = neighborFk?.c ?? 0;

      const typedEdges = db
        .prepare(
          `SELECT e.type AS edgeType, n.id AS nodeId, n.name AS nodeName, n.type AS nodeType
           FROM kg_edges e
           JOIN kg_nodes n ON n.id = CASE WHEN e.to_id = ? THEN e.from_id ELSE e.to_id END
           WHERE (e.to_id = ? OR e.from_id = ?)
             AND e.type IN ('FOREIGN_KEY_TO','REFERENCES')
           LIMIT 80`,
        )
        .all(
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
        ) as Array<{
        edgeType: string;
        nodeId: string;
        nodeName: string | null;
        nodeType: string | null;
      }>;
      result.readCount += 1;

      const participantHints = typedEdges.filter((n) => {
        const name = (n.nodeName ?? '').toLowerCase();
        return (
          name.includes('szkol') ||
          name.includes('participant') ||
          name.includes('uczest') ||
          name.includes('kurs')
        );
      });
      result.participantLikeNodesFound = participantHints.length;

      const typedFkHits = result.inboundReferenceCount + neighborFkCount;
      const typed = emptyTypedDependency();
      typed.nameHeuristicHits = participantHints.length;
      typed.typedForeignKeyHits = typedFkHits;

      // Confirmation requires typed FK/REFERENCES path — never name similarity alone.
      if (typedFkHits > 0 && participantHints.length > 0) {
        const sample = participantHints[0];
        typed.dependencyEvidenceKind = 'typed_foreign_key_reference';
        typed.relationType = sample.edgeType;
        typed.sourceNodeType = sample.nodeType;
        typed.graphPathFingerprint = sha256(
          stableStringify({
            edgeType: sample.edgeType,
            from: sample.nodeId,
            to: result.employeeObjectNodeId,
            targetRole: 'employee_master',
          }),
        );
        typed.evidenceStatus = 'confirmed';
        result.participantEmployeeRelationConfirmed = true;
      } else if (typedFkHits > 0) {
        // Typed FKs exist but not attributable to training_participant without name heuristic confirmation.
        // Fail closed for training_participant specifically: unresolved (typed path not participant-scoped).
        typed.dependencyEvidenceKind = 'unresolved';
        typed.relationType = typedEdges[0]?.edgeType ?? 'FOREIGN_KEY_TO';
        typed.sourceNodeType = typedEdges[0]?.nodeType ?? null;
        typed.graphPathFingerprint = sha256(
          stableStringify({
            note: 'typed_fk_present_but_training_participant_not_attributable',
            typedFkHits,
          }),
        );
        typed.evidenceStatus = 'unresolved';
        result.participantEmployeeRelationConfirmed = false;
      } else if (participantHints.length > 0) {
        typed.dependencyEvidenceKind = 'inferred_name_only';
        typed.evidenceStatus = 'unresolved';
        result.participantEmployeeRelationConfirmed = false;
      } else {
        typed.dependencyEvidenceKind = 'unresolved';
        typed.evidenceStatus = 'unresolved';
        result.participantEmployeeRelationConfirmed = false;
      }
      result.typedDependencyEvidence = typed;
    }

    result.localTrace = {
      formStatus: form.status,
      empStatus: emp.status,
      edgeCount: edges.length,
      edgeTypes: [...new Set(edges.map((e) => e.type))],
      pkHit,
      inboundReferenceCount: result.inboundReferenceCount,
      typedDependency: result.typedDependencyEvidence,
      viewGrain: result.viewGrainPreservation,
    };

    const outDir = path.join(repoRoot, '.local', 'stage3k2b2a', 'real-graph-traces');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'p1-real-graph-read.json'),
      JSON.stringify({ ...result, localTrace: result.localTrace }, null, 2),
      'utf8',
    );
  } catch (err) {
    result.errors.push(`graph_read_failed:${err instanceof Error ? err.message : String(err)}`);
    result.available = false;
  } finally {
    try {
      db?.close?.();
    } catch {
      /* ignore */
    }
  }

  return result;
}
