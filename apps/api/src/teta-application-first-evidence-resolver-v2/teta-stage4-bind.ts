/**
 * Generic evidence-to-role adapter.
 * Derives SchemaEvidenceGraph records from ACE + Stage 2 facts.
 * No scenario physical names. No new graph store.
 */
import type {
  EvidenceClaim,
  EvidenceObject,
  EvidenceRelation,
  LogicalRoleId,
  SchemaEvidenceGraph,
} from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import type { ApplicationAnchorResolveResult } from './teta-stage4-anchors';
import type { AceTraversedEdge, AceTraversalResult } from './teta-stage4-ace-traverse';
import {
  parseOracleEndpointName,
  type OracleCandidate,
  type OracleExpandResult,
} from './teta-stage4-oracle-expand';

export type BindAdapterMetrics = {
  relationEvidenceItemsBuilt: number;
  columnRelationEvidenceItemsBuilt: number;
  lookupEvidenceItemsBuilt: number;
  temporalEvidenceItemsBuilt: number;
  viewLineageEvidenceItemsBuilt: number;
};

export type DiscoveredSubject = {
  owner: string;
  objectType: string;
  objectName: string;
  identityColumn?: string;
};

export type RoleBindResult = {
  graph: SchemaEvidenceGraph;
  metrics: BindAdapterMetrics;
  discoveredSubject: DiscoveredSubject | null;
  fingerprints: string[];
};

type Pair = {
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
};

function originFingerprint(kind: string, parts: Array<string | null | undefined>): string {
  return `evidenceOriginFingerprint:${kind}:${parts.filter(Boolean).join('|')}`;
}

function oracleRefFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name.replace(/^oracle_object\|/i, '').replace(/^dataset\|/i, '').trim();
  const parsed = parseOracleEndpointName(cleaned.includes('.') ? cleaned : cleaned);
  if (!parsed) return null;
  if (!/[A-Z0-9_$#]/i.test(parsed.objectName)) return null;
  return `${parsed.owner}.${parsed.objectName}`;
}

function stage2IdToObjectRef(id: string): string | null {
  const m = /^oracle-object:([^:]+):(?:VIEW|TABLE|UNKNOWN):([^:]+)$/i.exec(id);
  if (m) return `${m[1]!.toUpperCase()}.${m[2]!.toUpperCase()}`;
  return oracleRefFromName(id);
}

function objectShortName(objectRef: string): string {
  return objectRef.split('.')[1] ?? objectRef;
}

function aliasMatchesObject(alias: string, objectRef: string): boolean {
  const a = alias.toUpperCase();
  const n = objectShortName(objectRef).toUpperCase();
  if (a === n) return true;
  if (n.endsWith(`_${a}`) || n.startsWith(`${a}_`)) return true;
  return false;
}

function ensureObject(
  objects: EvidenceObject[],
  objectRef: string,
  extra?: { objectType?: string; tags?: string[] },
): EvidenceObject {
  let obj = objects.find((o) => o.objectRef === objectRef);
  if (!obj) {
    const [owner, objectName] = objectRef.split('.');
    obj = {
      objectRef,
      owner,
      objectType: extra?.objectType ?? 'VIEW',
      objectName: objectName ?? objectRef,
      columns: [],
      tags: extra?.tags ? [...extra.tags] : [],
    };
    objects.push(obj);
  }
  if (extra?.objectType && obj.objectType === 'VIEW' && extra.objectType !== 'VIEW') {
    obj.objectType = extra.objectType;
  }
  if (extra?.tags) {
    obj.tags = [...new Set([...(obj.tags ?? []), ...extra.tags])];
  }
  return obj;
}

function ensureColumn(obj: EvidenceObject, name: string, extra?: { isPk?: boolean; isFk?: boolean; references?: string | null }): void {
  if (!name || name === 'UNKNOWN') return;
  obj.columns = obj.columns ?? [];
  if (obj.columns.some((c) => c.name === name)) {
    const col = obj.columns.find((c) => c.name === name)!;
    if (extra?.isPk) col.isPk = true;
    if (extra?.isFk) col.isFk = true;
    if (extra?.references) col.references = extra.references;
    return;
  }
  obj.columns.push({
    name,
    isPk: extra?.isPk,
    isFk: extra?.isFk,
    references: extra?.references,
  });
}

function addRelation(
  relations: EvidenceRelation[],
  seen: Set<string>,
  rel: EvidenceRelation,
  metrics: BindAdapterMetrics,
): void {
  const key = [
    rel.fromObject,
    rel.fromColumn,
    rel.toObject,
    rel.toColumn,
    rel.relationType,
  ].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  relations.push(rel);
  metrics.relationEvidenceItemsBuilt += 1;
  if (rel.fromColumn !== 'UNKNOWN' && rel.toColumn !== 'UNKNOWN') {
    metrics.columnRelationEvidenceItemsBuilt += 1;
  }
  if (rel.relationType.includes('lookup')) metrics.lookupEvidenceItemsBuilt += 1;
  if (rel.relationType.includes('lineage') || rel.relationType.includes('reads_from')) {
    metrics.viewLineageEvidenceItemsBuilt += 1;
  }
}

function confidenceFromAce(conf: string): 'exact_static' | 'strong_static' | 'unresolved' {
  if (conf.startsWith('exact')) return 'exact_static';
  if (conf.includes('unresolved')) return 'unresolved';
  return 'strong_static';
}

function extractPairs(attrs: Record<string, unknown> | undefined): Pair[] {
  const raw = attrs?.parsedPairs;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is Pair =>
      Boolean(p) &&
      typeof p === 'object' &&
      typeof (p as Pair).leftColumn === 'string' &&
      typeof (p as Pair).rightColumn === 'string',
  );
}

function resolvePairSides(
  fromRef: string,
  toRef: string,
  pair: Pair,
): { fromObject: string; fromColumn: string; toObject: string; toColumn: string } {
  const leftIsTo = aliasMatchesObject(pair.leftAlias, toRef) && !aliasMatchesObject(pair.leftAlias, fromRef);
  const rightIsFrom = aliasMatchesObject(pair.rightAlias, fromRef) && !aliasMatchesObject(pair.rightAlias, toRef);
  if (leftIsTo || rightIsFrom) {
    return {
      fromObject: fromRef,
      fromColumn: pair.rightColumn.toUpperCase(),
      toObject: toRef,
      toColumn: pair.leftColumn.toUpperCase(),
    };
  }
  return {
    fromObject: fromRef,
    fromColumn: pair.leftColumn.toUpperCase(),
    toObject: toRef,
    toColumn: pair.rightColumn.toUpperCase(),
  };
}

const TEMPORAL_PREDICATE =
  /\b(SYSDATE|CURRENT_DATE|TRUNC\s*\(\s*SYSDATE)\b/i;

function extractTemporalOperands(expr: string): Array<{ column: string; op: string }> {
  const out: Array<{ column: string; op: string }> = [];
  const re =
    /([A-Z][A-Z0-9_$#]*)\s*(>=|<=|<>|!=|>|<|=)\s*(?:TRUNC\s*\(\s*)?(SYSDATE|CURRENT_DATE)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    out.push({ column: m[1]!.toUpperCase(), op: m[2]! });
  }
  const nullRe = /([A-Z][A-Z0-9_$#]*)\s+IS\s+(NOT\s+)?NULL/gi;
  while ((m = nullRe.exec(expr))) {
    if (TEMPORAL_PREDICATE.test(expr)) {
      out.push({ column: m[1]!.toUpperCase(), op: m[2] ? 'IS_NOT_NULL' : 'IS_NULL' });
    }
  }
  return out;
}

function subjectTokens(subjectRole?: string): string[] {
  if (!subjectRole) return [];
  const r = subjectRole.toLowerCase();
  const tokens = [r];
  if (/employee|pracownik|person|worker/.test(r)) {
    tokens.push('pracownik', 'employee', 'person', 'plgpracownik');
  }
  return [...new Set(tokens.filter((t) => t.length >= 4))];
}

function pathLooksLikeSubject(acePath: string[], tokens: string[]): boolean {
  if (!tokens.length) return false;
  const blob = acePath.join('|').toLowerCase();
  return tokens.some((t) => blob.includes(t.toLowerCase()));
}

/**
 * Convert ACE + Stage 2 + Stage 3 claims into a Stage 0 SchemaEvidenceGraph.
 */
export function bindEvidenceToRoleGraph(input: {
  anchors: ApplicationAnchorResolveResult;
  ace: AceTraversalResult;
  oracle: OracleExpandResult;
  stage3Claims?: EvidenceClaim[];
  approvedReuseGraph?: SchemaEvidenceGraph | null;
  subjectRole?: string;
  /** When true (approved mode), blind oracle candidates must not contaminate assignment tags. */
  approvedExclusive?: boolean;
}): RoleBindResult {
  const objects: EvidenceObject[] = [];
  const relations: EvidenceRelation[] = [];
  const claims: EvidenceClaim[] = [];
  const relSeen = new Set<string>();
  const fingerprints = new Set<string>();
  const metrics: BindAdapterMetrics = {
    relationEvidenceItemsBuilt: 0,
    columnRelationEvidenceItemsBuilt: 0,
    lookupEvidenceItemsBuilt: 0,
    temporalEvidenceItemsBuilt: 0,
    viewLineageEvidenceItemsBuilt: 0,
  };

  if (input.approvedReuseGraph) {
    objects.push(...input.approvedReuseGraph.objects);
    relations.push(...input.approvedReuseGraph.relations);
    claims.push(...input.approvedReuseGraph.claims);
  }

  const approvedExclusive = input.approvedExclusive ?? false;
  if (approvedExclusive && input.approvedReuseGraph) {
    return {
      graph: { objects, relations, claims },
      metrics,
      discoveredSubject: null,
      fingerprints: [...fingerprints],
    };
  }

  const candByRef = new Map<string, OracleCandidate>();
  for (const c of input.oracle.candidates) {
    const objectRef = `${c.owner}.${c.objectName}`;
    candByRef.set(objectRef, c);
    const tags: string[] = [];
    const approvedAssignment =
      input.approvedReuseGraph?.objects.some(
        (o) => o.objectRef === objectRef && o.tags?.includes('assignment_candidate'),
      ) ?? false;
    const approvedHasAssignment =
      input.approvedReuseGraph?.objects.some((o) => o.tags?.includes('assignment_candidate')) ??
      false;
    if (c.candidateRoleHypotheses.includes('assignment_source')) {
      if (!approvedHasAssignment || approvedAssignment) tags.push('assignment_candidate');
    }
    if (c.candidateRoleHypotheses.includes('dictionary_identity')) tags.push('dictionary_candidate');
    ensureObject(objects, objectRef, {
      objectType: c.objectType === 'UNKNOWN' ? 'VIEW' : c.objectType,
      tags,
    });
  }

  // Semantic anchors: attach ONLY to assignment surfaces whose ACE path aligns
  // with the anchor (no global unattached claims — they pollute all candidates).
  for (const a of input.anchors.anchors) {
    const fp = originFingerprint('semantic_anchor', [a.anchorId]);
    fingerprints.add(fp);
    const formNeedle = (a.formRef ?? a.label ?? '').toLowerCase();
    const tokens = (a.matchTokens ?? []).map((t) => t.toLowerCase()).filter((t) => t.length >= 4);
    let attached = false;
    for (const c of input.oracle.candidates) {
      if (!c.candidateRoleHypotheses.includes('assignment_source')) continue;
      const pathBlob = c.acePath.join('|').toLowerCase();
      const reached = (c.reachedFromApplicationNode ?? '').toLowerCase();
      const blob = `${pathBlob}|${reached}`;
      const hit =
        (formNeedle.length >= 4 &&
          blob.includes(formNeedle.slice(0, Math.min(formNeedle.length, 24)))) ||
        tokens.some((t) => blob.includes(t));
      if (!hit) continue;
      attached = true;
      const objectRef = `${c.owner}.${c.objectName}`;
      claims.push({
        family: 'application_semantic',
        claimType: 'application_anchor',
        object: objectRef,
        roleHint: 'assignment_source',
        weight: a.recognitionConfidence === 'exact' ? 3 : 2,
        provenance: [fp, ...a.semanticEvidence.slice(0, 4), `ace_path_hit:${objectRef}`, `cohort_anchor:${a.anchorId}`],
        notes: a.label,
        subject: a.formRef ? `form:${a.formRef}` : undefined,
      });
    }
    if (!attached && (a.anchorType === 'pa_plugin' || a.anchorType === 'pa_form_token')) {
      // Path-unreachable PA anchor — record as negative scope signal, not global semantic proof.
      claims.push({
        family: 'application_semantic',
        claimType: 'negative_unaligned_application_anchor',
        weight: 1,
        provenance: [fp, ...a.semanticEvidence.slice(0, 2), 'semantic_path_not_reached'],
        notes: a.label,
        subject: a.formRef ? `form:${a.formRef}` : undefined,
      });
    }
  }

  const oracleNameToRef = new Map<string, string>();
  for (const c of input.oracle.candidates) {
    oracleNameToRef.set(c.objectName.toUpperCase(), `${c.owner}.${c.objectName}`);
    oracleNameToRef.set(`${c.owner}.${c.objectName}`.toUpperCase(), `${c.owner}.${c.objectName}`);
  }

  function resolveAceOracle(name: string): string | null {
    return oracleRefFromName(name) ?? oracleNameToRef.get(name.toUpperCase()) ?? null;
  }

  const subjTok = subjectTokens(input.subjectRole);

  for (const e of input.ace.edges) {
    const fp = originFingerprint('ace', [e.edgeId, e.edgeKind]);
    fingerprints.add(fp);
    const conf = confidenceFromAce(e.confidence);
    const fromRef = resolveAceOracle(e.fromName);
    const toRef = resolveAceOracle(e.toName);
    const claimWeight = conf === 'exact_static' ? 3 : conf === 'unresolved' ? 1 : 2;

    if (e.edgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT' && toRef) {
      const approvedHasAssignment =
        input.approvedReuseGraph?.objects.some((o) => o.tags?.includes('assignment_candidate')) ??
        false;
      const approvedObject =
        input.approvedReuseGraph?.objects.some(
          (o) => o.objectRef === toRef && o.tags?.includes('assignment_candidate'),
        ) ?? false;
      if (approvedHasAssignment && !approvedObject) {
        claims.push({
          family: 'application_technical',
          claimType: 'gateway_reads_oracle_supporting',
          object: toRef,
          subject: e.fromName,
          weight: claimWeight,
          provenance: [fp, `ace:${e.edgeId}`, `edgeKind:${e.edgeKind}`, ...e.provenance.slice(0, 2)],
          notes: `confidence:${conf};approved_mode_not_assignment_candidate`,
        });
      } else {
        claims.push({
          family: 'application_technical',
          claimType: 'assignment_gateway',
          object: toRef,
          subject: e.fromName,
          roleHint: 'assignment_source',
          weight: claimWeight,
          provenance: [fp, `ace:${e.edgeId}`, `edgeKind:${e.edgeKind}`, ...e.provenance.slice(0, 2)],
          notes: `confidence:${conf}`,
        });
      }
    }

    if (
      (e.edgeKind === 'BUSINESS_OBJECT_USES_GATEWAY' ||
        e.edgeKind === 'FORM_USES_BUSINESS_OBJECT' ||
        e.edgeKind === 'CONTROL_BINDS_DATASET' ||
        e.edgeKind === 'GATEWAY_BINDS_DATASET') &&
      toRef
    ) {
      claims.push({
        family: 'application_technical',
        claimType: e.edgeKind.toLowerCase(),
        object: toRef,
        subject: e.fromName,
        weight: claimWeight,
        provenance: [fp, `ace:${e.edgeId}`, `edgeKind:${e.edgeKind}`],
      });
    }

    if (e.edgeKind === 'LOOKUP_USES_OBJECT' && toRef) {
      metrics.lookupEvidenceItemsBuilt += 1;
      const attrs = e.attributes ?? {};
      const lookupKey = typeof attrs.lookupKey === 'string' ? attrs.lookupKey.toUpperCase() : null;
      const lookupDisplay =
        typeof attrs.lookupDisplay === 'string'
          ? attrs.lookupDisplay.toUpperCase()
          : Array.isArray(attrs.lookupDisplayColumns)
            ? String(attrs.lookupDisplayColumns[0] ?? '')
                .replace(/^.*\./, '')
                .toUpperCase()
            : null;
      const targetColumn =
        typeof attrs.targetColumn === 'string' ? attrs.targetColumn.toUpperCase() : null;
      const dictObj = ensureObject(objects, toRef, { tags: ['dictionary_candidate'] });
      if (lookupKey) {
        ensureColumn(dictObj, lookupKey, { isPk: true });
        claims.push({
          family: 'application_technical',
          claimType: 'lookup_key',
          object: toRef,
          column: lookupKey,
          roleHint: 'dictionary_identity',
          weight: 3,
          provenance: [fp, `ace:${e.edgeId}`, `lookupKey:${lookupKey}`],
        });
      }
      if (lookupDisplay) {
        ensureColumn(dictObj, lookupDisplay);
        claims.push({
          family: 'application_technical',
          claimType: 'lookup_display',
          object: toRef,
          column: lookupDisplay,
          roleHint: 'dictionary_display_name',
          weight: 3,
          provenance: [fp, `ace:${e.edgeId}`, `lookupDisplay:${lookupDisplay}`],
        });
      }
      claims.push({
        family: 'application_technical',
        claimType: 'lookup_uses_object',
        object: toRef,
        subject: e.fromName,
        roleHint: 'dictionary_identity',
        weight: claimWeight,
        provenance: [fp, `ace:${e.edgeId}`, `edgeKind:${e.edgeKind}`],
      });
      // Source-side lookup key on assignment if targetColumn known and from is a gateway reading an assignment
      if (targetColumn && fromRef) {
        const src = ensureObject(objects, fromRef);
        ensureColumn(src, targetColumn, { isFk: true, references: toRef });
        addRelation(
          relations,
          relSeen,
          {
            fromObject: fromRef,
            fromColumn: targetColumn,
            toObject: toRef,
            toColumn: lookupKey ?? 'UNKNOWN',
            relationType: 'application_lookup',
            family: 'application_technical',
            provenance: [fp, `ace:${e.edgeId}`, `targetColumn:${targetColumn}`],
          },
          metrics,
        );
        claims.push({
          family: 'application_technical',
          claimType: 'lookup_reference',
          object: fromRef,
          column: targetColumn,
          roleHint: 'dictionary_reference',
          weight: 3,
          provenance: [fp, `column:${targetColumn}`],
        });
      } else if (targetColumn) {
        const samePathAssignments = input.oracle.candidates.filter(
          (x) =>
            x.candidateRoleHypotheses.includes('assignment_source') &&
            (x.reachedFromApplicationNode === e.fromId || x.acePath.includes(e.fromId)),
        );
        for (const c of samePathAssignments) {
          const aRef = `${c.owner}.${c.objectName}`;
          const src = ensureObject(objects, aRef, { tags: ['assignment_candidate'] });
          ensureColumn(src, targetColumn, { isFk: true, references: toRef });
          addRelation(
            relations,
            relSeen,
            {
              fromObject: aRef,
              fromColumn: targetColumn,
              toObject: toRef,
              toColumn: lookupKey ?? 'UNKNOWN',
              relationType: 'application_lookup',
              family: 'application_technical',
              provenance: [fp, `ace:${e.edgeId}`, `targetColumn:${targetColumn}`, `via_gateway:${e.fromName}`],
            },
            metrics,
          );
          claims.push({
            family: 'application_technical',
            claimType: 'lookup_reference',
            object: aRef,
            column: targetColumn,
            roleHint: 'dictionary_reference',
            weight: 3,
            provenance: [fp, `column:${targetColumn}`],
          });
        }
      }
    }

    if (e.edgeKind === 'GATEWAY_JOINS_ORACLE_OBJECT' && toRef) {
      const pairs = extractPairs(e.attributes);
      const onClause = typeof e.attributes?.onClause === 'string' ? e.attributes.onClause : null;
      claims.push({
        family: 'application_technical',
        claimType: 'gateway_joins_oracle_object',
        object: toRef,
        subject: e.fromName,
        roleHint: 'dictionary_identity',
        weight: claimWeight,
        provenance: [fp, `ace:${e.edgeId}`],
      });
      ensureObject(objects, toRef, { tags: ['dictionary_candidate'] });
      const assignmentRefs = input.oracle.candidates
        .filter(
          (c) =>
            c.candidateRoleHypotheses.includes('assignment_source') &&
            (c.reachedFromApplicationNode === e.fromId || c.acePath.includes(e.fromId)),
        )
        .map((c) => `${c.owner}.${c.objectName}`);
      for (const pair of pairs) {
        for (const aRef of assignmentRefs.length ? assignmentRefs : fromRef ? [fromRef] : []) {
          const sides = resolvePairSides(aRef, toRef, pair);
          const aObj = ensureObject(objects, sides.fromObject);
          const bObj = ensureObject(objects, sides.toObject);
          ensureColumn(aObj, sides.fromColumn, { isFk: true, references: sides.toObject });
          ensureColumn(bObj, sides.toColumn);
          addRelation(
            relations,
            relSeen,
            {
              fromObject: sides.fromObject,
              fromColumn: sides.fromColumn,
              toObject: sides.toObject,
              toColumn: sides.toColumn,
              relationType: 'application_join',
              family: 'application_technical',
              provenance: [fp, `ace:${e.edgeId}`, onClause ? `onClause:${onClause}` : 'onClause:absent'],
            },
            metrics,
          );
          claims.push({
            family: 'application_technical',
            claimType: 'lookup_reference',
            object: sides.fromObject,
            column: sides.fromColumn,
            roleHint: 'dictionary_reference',
            weight: 3,
            provenance: [fp, `column:${sides.fromColumn}`],
          });
        }
      }
      maybeTemporalFromExpression(onClause, toRef, fp, claims, metrics);
    }

    if (e.edgeKind === 'APPLICATION_JOIN' || e.edgeKind === 'APPLICATION_RELATION') {
      const pairs = extractPairs(e.attributes);
      const parentCols = Array.isArray(e.attributes?.parentColumns)
        ? (e.attributes!.parentColumns as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const childCols = Array.isArray(e.attributes?.childColumns)
        ? (e.attributes!.childColumns as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const onClause = typeof e.attributes?.onClause === 'string' ? e.attributes.onClause : null;
      if (fromRef && toRef) {
        claims.push({
          family: 'application_technical',
          claimType: e.edgeKind.toLowerCase(),
          object: toRef,
          subject: fromRef,
          weight: claimWeight,
          provenance: [fp, `ace:${e.edgeId}`],
        });
        if (pairs.length) {
          for (const pair of pairs) {
            const sides = resolvePairSides(fromRef, toRef, pair);
            attachColumnRelation(
              objects,
              relations,
              relSeen,
              metrics,
              claims,
              sides,
              e.edgeKind === 'APPLICATION_JOIN' ? 'application_join' : 'application_relation',
              'application_technical',
              [fp, `ace:${e.edgeId}`],
              subjTok,
              e,
              candByRef.get(sides.toObject) ?? candByRef.get(sides.fromObject),
            );
          }
        } else if (parentCols.length && childCols.length) {
          const n = Math.min(parentCols.length, childCols.length);
          for (let i = 0; i < n; i++) {
            attachColumnRelation(
              objects,
              relations,
              relSeen,
              metrics,
              claims,
              {
                fromObject: fromRef,
                fromColumn: parentCols[i]!.toUpperCase(),
                toObject: toRef,
                toColumn: childCols[i]!.toUpperCase(),
              },
              'application_relation',
              'application_technical',
              [fp, `ace:${e.edgeId}`],
              subjTok,
              e,
              candByRef.get(toRef) ?? candByRef.get(fromRef),
            );
          }
        }
      }
      maybeTemporalFromExpression(onClause, toRef ?? fromRef ?? '', fp, claims, metrics);
    }

    if (e.edgeKind === 'GATEWAY_PROJECTS_COLUMN') {
      const expr = String((e.attributes as { expression?: string } | undefined)?.expression ?? e.toName ?? '');
      const col = expr.includes('.') ? expr.split('.').pop()!.toUpperCase() : e.toName.toUpperCase();
      for (const c of input.oracle.candidates) {
        if (c.reachedFromApplicationNode !== e.fromId && !c.acePath.includes(e.fromId)) continue;
        const objectRef = `${c.owner}.${c.objectName}`;
        const isDict = c.candidateRoleHypotheses.includes('dictionary_identity');
        if (isDict) continue;
        const obj = ensureObject(objects, objectRef);
        ensureColumn(obj, col);
      }
    }
  }

  // Stage 2 neighborhood: joins, reads, lineage — reuse canonical facts, same origin fingerprint.
  for (const c of input.oracle.candidates) {
    const objectRef = `${c.owner}.${c.objectName}`;
    for (const role of c.candidateRoleHypotheses) {
      claims.push({
        family: 'application_technical',
        claimType: 'ace_reached_oracle_endpoint',
        object: objectRef,
        roleHint: role as LogicalRoleId,
        weight: 3,
        provenance: c.supportingEvidence.slice(0, 8),
      });
    }

    for (const detail of c.stage2Facts.joinDetails) {
      const fromRef = stage2IdToObjectRef(detail.fromId);
      const toRef = stage2IdToObjectRef(detail.toId);
      if (!fromRef || !toRef) continue;
      const fp = originFingerprint('stage2_join', [detail.fromId, detail.toId, detail.onClause]);
      fingerprints.add(fp);
      ensureObject(objects, fromRef);
      ensureObject(objects, toRef);
      claims.push({
        family: 'oracle_structural',
        claimType: 'joins_to',
        object: objectRef,
        subject: `${fromRef}->${toRef}`,
        weight: 2,
        provenance: [fp, ...detail.provenance.slice(0, 3)],
      });
      if (detail.parsedPairs.length) {
        for (const pair of detail.parsedPairs) {
          const sides = resolvePairSides(fromRef, toRef, pair);
          attachColumnRelation(
            objects,
            relations,
            relSeen,
            metrics,
            claims,
            sides,
            'stage2_joins_to',
            'oracle_structural',
            [fp, ...detail.provenance.slice(0, 2)],
            subjTok,
            undefined,
            candByRef.get(sides.toObject) ?? c,
          );
        }
      }
      maybeTemporalFromExpression(detail.onClause, objectRef, fp, claims, metrics);
    }

    for (const r of c.stage2Facts.readsFrom) {
      const toRef = stage2IdToObjectRef(r);
      const fp = originFingerprint('stage2_reads', [c.oracleCanonicalId, r]);
      fingerprints.add(fp);
      claims.push({
        family: 'oracle_structural',
        claimType: 'reads_from',
        object: objectRef,
        subject: r,
        weight: 2,
        provenance: [fp, `stage2:READS_FROM:${r}`],
      });
      if (toRef && toRef !== objectRef) {
        ensureObject(objects, toRef);
        addRelation(
          relations,
          relSeen,
          {
            fromObject: objectRef,
            fromColumn: 'UNKNOWN',
            toObject: toRef,
            toColumn: 'UNKNOWN',
            relationType: 'view_lineage_reads_from',
            family: 'oracle_structural',
            provenance: [fp, `stage2:READS_FROM:${r}`, 'grain_not_implied'],
          },
          metrics,
        );
      }
    }

    for (const w of c.stage2Facts.writesTo) {
      const fp = originFingerprint('stage2_writes', [w, c.oracleCanonicalId]);
      fingerprints.add(fp);
      claims.push({
        family: 'implementation_usage',
        claimType: 'writes_to_target',
        object: objectRef,
        subject: w,
        weight: 2,
        provenance: [fp, `stage2:WRITES_TO:${w}`],
      });
    }

    for (const ref of c.stage2Facts.references) {
      const [fromId, toId] = ref.split('->');
      const fromRef = fromId ? stage2IdToObjectRef(fromId) : null;
      const toRef = toId ? stage2IdToObjectRef(toId) : null;
      if (!fromRef || !toRef) continue;
      const fp = originFingerprint('stage2_ref', [fromId, toId]);
      fingerprints.add(fp);
      claims.push({
        family: 'oracle_structural',
        claimType: 'references',
        object: fromRef,
        subject: toRef,
        weight: 2,
        provenance: [fp, `stage2:REFERENCES:${ref}`],
      });
    }
  }

  if (input.stage3Claims?.length) {
    for (const c of input.stage3Claims) {
      claims.push(c);
    }
  }

  // Role-specific negatives (not global unrelated-object spam)
  const assignmentRefs = objects.filter((o) => o.tags?.includes('assignment_candidate')).map((o) => o.objectRef);
  for (const dict of objects.filter((o) => o.tags?.includes('dictionary_candidate'))) {
    const linked = relations.some(
      (r) =>
        r.toObject === dict.objectRef &&
        assignmentRefs.includes(r.fromObject) &&
        r.fromColumn !== 'UNKNOWN',
    );
    if (!linked) {
      claims.push({
        family: 'application_technical',
        claimType: 'negative_no_relation_from_source',
        object: dict.objectRef,
        roleHint: 'dictionary_identity',
        weight: 0,
        provenance: [`role:dictionary_identity|no_relation_from_selected_source`, dict.objectRef],
        notes: 'negative',
      });
    }
    const displayClaim = claims.some(
      (c) => c.object === dict.objectRef && c.roleHint === 'dictionary_display_name' && c.column,
    );
    if (!displayClaim) {
      claims.push({
        family: 'application_technical',
        claimType: 'negative_display_not_application_lookup',
        object: dict.objectRef,
        roleHint: 'dictionary_display_name',
        weight: 0,
        provenance: [`role:dictionary_display_name|not_application_lookup_display_field`, dict.objectRef],
        notes: 'negative',
      });
    }
  }

  for (const aRef of assignmentRefs) {
    const hasTemporal = claims.some(
      (c) =>
        c.object === aRef &&
        (c.claimType === 'temporal_predicate' || c.roleHint === 'valid_from' || c.roleHint === 'valid_to'),
    );
    if (!hasTemporal) {
      claims.push({
        family: 'application_technical',
        claimType: 'negative_no_temporal_predicate',
        object: aRef,
        roleHint: 'valid_from',
        weight: 0,
        provenance: [`role:valid_from|no_predicate_evidence`, aRef],
        notes: 'negative',
      });
    }
  }

  const discoveredSubject = discoverSubject(objects, relations, claims, input.oracle, subjTok);

  return {
    graph: { objects, relations, claims },
    metrics,
    discoveredSubject,
    fingerprints: [...fingerprints],
  };
}

function attachColumnRelation(
  objects: EvidenceObject[],
  relations: EvidenceRelation[],
  relSeen: Set<string>,
  metrics: BindAdapterMetrics,
  claims: EvidenceClaim[],
  sides: { fromObject: string; fromColumn: string; toObject: string; toColumn: string },
  relationType: string,
  family: EvidenceRelation['family'],
  provenance: string[],
  subjTok: string[],
  aceEdge?: AceTraversedEdge,
  oracleCand?: OracleCandidate,
): void {
  const a = ensureObject(objects, sides.fromObject);
  const b = ensureObject(objects, sides.toObject);
  const fromIsAssignment = a.tags?.includes('assignment_candidate');
  const toIsDict = b.tags?.includes('dictionary_candidate');
  const targetPathIsSubject = pathLooksLikeSubject(
    oracleCand?.acePath ?? (aceEdge ? [aceEdge.toName, aceEdge.toId] : [sides.toObject]),
    subjTok,
  );
  const toIsSubject =
    Boolean(b.tags?.includes('subject')) ||
    (fromIsAssignment &&
      !toIsDict &&
      !b.tags?.includes('assignment_candidate') &&
      targetPathIsSubject &&
      subjTok.length > 0);

  if (toIsSubject && fromIsAssignment) {
    b.tags = [...new Set([...(b.tags ?? []), 'subject'])];
    ensureColumn(a, sides.fromColumn, { isFk: true, references: sides.toObject });
    ensureColumn(b, sides.toColumn, { isPk: true });
    claims.push({
      family: 'application_technical',
      claimType: 'subject_reference_relation',
      object: sides.fromObject,
      column: sides.fromColumn,
      roleHint: 'subject_reference',
      weight: 3,
      provenance: [...provenance, `column:${sides.fromColumn}`],
    });
  } else {
    ensureColumn(a, sides.fromColumn, { isFk: toIsDict, references: toIsDict ? sides.toObject : undefined });
    ensureColumn(b, sides.toColumn, { isPk: toIsDict });
    if (toIsDict && fromIsAssignment) {
      claims.push({
        family: family === 'oracle_structural' ? 'oracle_structural' : 'application_technical',
        claimType: 'dictionary_reference_relation',
        object: sides.fromObject,
        column: sides.fromColumn,
        roleHint: 'dictionary_reference',
        weight: 3,
        provenance: [...provenance, `column:${sides.fromColumn}`],
      });
    }
  }

  addRelation(
    relations,
    relSeen,
    {
      fromObject: sides.fromObject,
      fromColumn: sides.fromColumn,
      toObject: sides.toObject,
      toColumn: sides.toColumn,
      relationType,
      family,
      provenance,
    },
    metrics,
  );
}

function maybeTemporalFromExpression(
  expr: string | null | undefined,
  objectRef: string,
  fp: string,
  claims: EvidenceClaim[],
  metrics: BindAdapterMetrics,
): void {
  if (!expr || !objectRef || !TEMPORAL_PREDICATE.test(expr)) return;
  const ops = extractTemporalOperands(expr);
  for (const op of ops) {
    const role: LogicalRoleId =
      op.op === '>=' || op.op === '>' || op.op === '=' ? 'valid_from' : 'valid_to';
    claims.push({
      family: 'oracle_structural',
      claimType: 'temporal_predicate',
      object: objectRef,
      column: op.column,
      roleHint: role,
      weight: 3,
      provenance: [
        fp,
        `predicate:${expr.slice(0, 180)}`,
        `operator:${op.op}`,
        `nullSemantics:${op.op.includes('NULL') ? op.op : 'none'}`,
      ],
      notes: `inclusive_exclusive:${op.op}`,
    });
    metrics.temporalEvidenceItemsBuilt += 1;
  }
}

function discoverSubject(
  objects: EvidenceObject[],
  relations: EvidenceRelation[],
  claims: EvidenceClaim[],
  oracle: OracleExpandResult,
  subjTok: string[],
): DiscoveredSubject | null {
  const subjectRefs = new Set<string>();
  for (const r of relations) {
    const to = objects.find((o) => o.objectRef === r.toObject);
    const from = objects.find((o) => o.objectRef === r.fromObject);
    if (from?.tags?.includes('assignment_candidate') && to?.tags?.includes('subject')) {
      subjectRefs.add(to.objectRef);
    }
  }
  if (subjTok.length) {
    for (const c of oracle.candidates) {
      if (!pathLooksLikeSubject(c.acePath, subjTok)) continue;
      if (c.candidateRoleHypotheses.includes('assignment_source')) continue;
      if (c.candidateRoleHypotheses.includes('dictionary_identity')) continue;
      const ref = `${c.owner}.${c.objectName}`;
      const obj = objects.find((o) => o.objectRef === ref);
      if (obj && relations.some((r) => r.toObject === ref || r.fromObject === ref)) {
        obj.tags = [...new Set([...(obj.tags ?? []), 'subject'])];
        subjectRefs.add(ref);
      }
    }
  }
  if (subjectRefs.size !== 1) return null;
  const objectRef = [...subjectRefs][0]!;
  const obj = objects.find((o) => o.objectRef === objectRef);
  if (!obj) return null;
  const pk = obj.columns?.find((c) => c.isPk)?.name;
  const idClaim = claims.find((c) => c.object === objectRef && c.column && /^(ID|KEY)$/i.test(c.column));
  return {
    owner: obj.owner ?? objectRef.split('.')[0]!,
    objectType: obj.objectType ?? 'VIEW',
    objectName: obj.objectName,
    identityColumn: pk ?? idClaim?.column,
  };
}

/** Test helper: convert a Stage 3-like success with no usable facts. */
export function unusedStage3Reason(input: {
  succeeded: boolean;
  writers: number;
  dml: number;
  lookups: number;
  gateways: number;
  relevantFacts: number;
}): string | null {
  if (!input.succeeded) return 'stage3_analysis_failed';
  if (input.relevantFacts > 0) return null;
  if (input.writers === 0 && input.dml === 0 && input.lookups === 0 && input.gateways === 0) {
    return 'no_dml_or_lookup_or_writer_facts_relevant';
  }
  return 'stage3_facts_not_relevant_to_candidate_roles';
}
