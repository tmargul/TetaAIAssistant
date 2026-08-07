import type {
  EvidenceClaim,
  EvidenceObject,
  EvidenceRelation,
  LogicalRoleId,
  SchemaEvidenceGraph,
} from './teta-schema-role-resolution.types';

const DICT_NAME_HINTS = /^(NAZWA|NAME|DESCRIPTION|TITLE|LABEL|DISPLAY_NAME)$/i;
const DICT_ID_HINTS = /^(ID|KEY|CODE|GROUP_KEY|DICT_ID)$/i;
const SUBJECT_REF_HINTS = /(PRAC|EMPLOYEE|PERSON|WORKER|EMP)_?(ID|KEY|REF)?$|^(PRAC_ID|EMPLOYEE_ID|PERSON_KEY|WORKER_REF)$/i;
const VALID_FROM_HINTS = /^(DATA_OD|DATE_FROM|VALID_FROM|EFFECTIVE_FROM|START_DATE)$/i;
const VALID_TO_HINTS = /^(DATA_DO|DATE_TO|VALID_TO|EFFECTIVE_UNTIL|EFFECTIVE_TO|END_DATE)$/i;
const CURRENT_FLAG_HINTS = /^(AKTUALNY|IS_CURRENT|CURRENT_FLAG|UP_TO_DATE)$/i;

export type InferredColumnRole = {
  objectRef: string;
  column: string;
  role: LogicalRoleId;
  conventionOnly: boolean;
  evidenceRefs: string[];
};

/**
 * Generic role inference — patterns are illustrative across naming styles,
 * never treated as sole proof (conventionOnly=true when only name matched).
 */
export function inferColumnRoles(
  graph: SchemaEvidenceGraph,
  subjectIdentityType?: string,
): InferredColumnRole[] {
  const out: InferredColumnRole[] = [];
  for (const obj of graph.objects) {
    for (const col of obj.columns ?? []) {
      const refs = [`object:${obj.objectRef}`, `column:${col.name}`];
      if (DICT_NAME_HINTS.test(col.name)) {
        out.push({
          objectRef: obj.objectRef,
          column: col.name,
          role: 'dictionary_display_name',
          conventionOnly: true,
          evidenceRefs: [...refs, 'schema_convention:display_name_shape'],
        });
      }
      if (DICT_ID_HINTS.test(col.name) || col.isPk) {
        out.push({
          objectRef: obj.objectRef,
          column: col.name,
          role: 'dictionary_identity',
          conventionOnly: !col.isPk,
          evidenceRefs: [
            ...refs,
            col.isPk ? 'oracle_structural:pk' : 'schema_convention:id_shape',
          ],
        });
      }
      const fkToSubject =
        Boolean(col.isFk) &&
        Boolean(col.references) &&
        graph.objects.some(
          (o) =>
            o.objectRef === col.references &&
            (o.tags?.includes('subject') || o.objectRef.includes('PERSON') || o.objectRef.includes('PRAC')),
        );
      const nameLooksLikeSubjectRef = SUBJECT_REF_HINTS.test(col.name);
      if (nameLooksLikeSubjectRef || fkToSubject) {
        const typeOk =
          !subjectIdentityType ||
          !col.dataType ||
          typesCompatible(subjectIdentityType, col.dataType);
        const joinOk = hasJoinEvidence(graph, obj.objectRef, col.name);
        out.push({
          objectRef: obj.objectRef,
          column: col.name,
          role: 'subject_reference',
          conventionOnly: !fkToSubject && !joinOk,
          evidenceRefs: [
            ...refs,
            fkToSubject ? 'oracle_structural:fk_to_subject' : 'schema_convention:subject_ref_shape',
            ...(joinOk ? ['relation_join_evidence'] : []),
            ...(typeOk ? ['type_compatible'] : ['type_incompatible']),
          ],
        });
      }
      if (VALID_FROM_HINTS.test(col.name)) {
        out.push({
          objectRef: obj.objectRef,
          column: col.name,
          role: 'valid_from',
          conventionOnly: true,
          evidenceRefs: [...refs, 'schema_convention:valid_from_shape'],
        });
      }
      if (VALID_TO_HINTS.test(col.name)) {
        out.push({
          objectRef: obj.objectRef,
          column: col.name,
          role: 'valid_to',
          conventionOnly: true,
          evidenceRefs: [...refs, 'schema_convention:valid_to_shape'],
        });
      }
      if (CURRENT_FLAG_HINTS.test(col.name)) {
        out.push({
          objectRef: obj.objectRef,
          column: col.name,
          role: 'current_flag',
          conventionOnly: true,
          evidenceRefs: [...refs, 'schema_convention:current_flag_shape'],
        });
      }
    }
  }

  // Elevate convention → not convention-only when join/usage claims exist
  for (const role of out) {
    if (
      role.conventionOnly &&
      (hasJoinEvidence(graph, role.objectRef, role.column) ||
        hasUsageClaim(graph.claims, role.objectRef, role.column, role.role))
    ) {
      role.conventionOnly = false;
      role.evidenceRefs.push('implementation_usage_or_relation_elevated');
    }
  }
  return out;
}

export function typesCompatible(a: string, b: string): boolean {
  const na = normalizeType(a);
  const nb = normalizeType(b);
  if (na === nb) return true;
  const numeric = new Set(['NUMBER', 'INTEGER', 'INT', 'BIGINT', 'DECIMAL', 'NUMERIC']);
  const text = new Set(['VARCHAR', 'VARCHAR2', 'NVARCHAR', 'CHAR', 'NCHAR', 'TEXT', 'STRING']);
  if (numeric.has(na) && numeric.has(nb)) return true;
  if (text.has(na) && text.has(nb)) return true;
  const dates = new Set(['DATE', 'TIMESTAMP', 'DATETIME']);
  if (dates.has(na) && dates.has(nb)) return true;
  return false;
}

function normalizeType(t: string): string {
  return t.replace(/\(.*\)/, '').trim().toUpperCase();
}

function hasJoinEvidence(
  graph: SchemaEvidenceGraph,
  objectRef: string,
  column: string,
): boolean {
  return graph.relations.some(
    (r) =>
      (r.fromObject === objectRef && r.fromColumn === column) ||
      (r.toObject === objectRef && r.toColumn === column),
  );
}

function hasUsageClaim(
  claims: EvidenceClaim[],
  objectRef: string,
  column: string,
  role: string,
): boolean {
  return claims.some(
    (c) =>
      (c.family === 'implementation_usage' || c.family === 'application_technical') &&
      c.object === objectRef &&
      (c.column === column || c.roleHint === role),
  );
}

export function findDictionaryShape(obj: EvidenceObject): {
  idColumn: string | null;
  nameColumn: string | null;
} {
  const cols = obj.columns ?? [];
  const id =
    cols.find((c) => c.isPk)?.name ??
    cols.find((c) => DICT_ID_HINTS.test(c.name))?.name ??
    null;
  const name = cols.find((c) => DICT_NAME_HINTS.test(c.name))?.name ?? null;
  return { idColumn: id, nameColumn: name };
}

export function relationsFrom(
  graph: SchemaEvidenceGraph,
  objectRef: string,
): EvidenceRelation[] {
  return graph.relations.filter((r) => r.fromObject === objectRef || r.toObject === objectRef);
}
