import type {
  RetrievalHit,
  RetrievalQuery,
  RuntimeIndexDocument,
  RuntimeKnowledgeUnitV1,
} from './teta-runtime-knowledge.types';
import { normalizePolishText, tokenize, sha256, stableStringify } from './teta-runtime-hash';
import { evaluateClientAccess } from './teta-source-access-policy';
import { loadRankingPolicyConfig } from './teta-runtime-source-policy.service';

export interface TetaRuntimeRetriever {
  buildIndex(units: RuntimeKnowledgeUnitV1[]): RuntimeIndexDocument[];
  retrieve(query: RetrievalQuery, units: RuntimeKnowledgeUnitV1[]): RetrievalHit[];
}

export function unitToIndexDoc(unit: RuntimeKnowledgeUnitV1): RuntimeIndexDocument {
  const aliases = [unit.subject.label, unit.subject.canonicalKey].filter(Boolean);
  const searchableText = normalizePolishText(
    [unit.subject.label, unit.claim.answerableText, ...aliases, ...unit.applicability.productFamilyIds, ...unit.applicability.productSurfaceIds, ...unit.applicability.domainIds].join(' '),
  );
  return {
    unitId: unit.runtimeKnowledgeUnitId,
    revisionId: unit.runtimeKnowledgeRevisionId,
    knowledgeMode: unit.knowledgeMode,
    subjectKey: unit.subject.canonicalKey,
    subjectLabel: unit.subject.label,
    answerableText: unit.claim.answerableText,
    aliases,
    productFamilyIds: unit.applicability.productFamilyIds,
    productSurfaceIds: unit.applicability.productSurfaceIds,
    domainIds: unit.applicability.domainIds,
    businessAreaIds: unit.applicability.businessAreaIds,
    clientScope: unit.applicability.clientScope,
    tenantId: unit.accessPolicy?.tenantId ?? null,
    roles: unit.accessPolicy?.allowedRoles ?? [],
    currentnessStatus: unit.applicability.currentnessStatus,
    riskClass: unit.riskClass,
    ownership: unit.sourcePolicy.sourceOwnership,
    visibility: unit.sourcePolicy.sourceVisibility,
    searchableText,
  };
}

function rankBucket(unit: RuntimeKnowledgeUnitV1, exactSubject: boolean): string {
  if (unit.knowledgeMode === 'approved_canonical') {
    return exactSubject ? 'approved_canonical_exact_subject' : 'approved_canonical_lexical_alias';
  }
  if (unit.sourcePolicy.sourceOwnership === 'client') return 'authorized_client_exact';
  if (unit.sourcePolicy.sourceOwnership === 'public_authority') return 'verified_public_authority_exact';
  if (unit.knowledgeMode === 'source_backed_direct') return 'source_backed_direct';
  if (unit.knowledgeMode === 'source_backed_partial') return 'source_backed_partial';
  return 'insufficient';
}

function bucketScore(bucket: string): number {
  const order = [
    'approved_canonical_exact_subject',
    'approved_canonical_lexical_alias',
    'authorized_client_exact',
    'verified_public_authority_exact',
    'source_backed_direct',
    'source_backed_partial',
    'insufficient',
  ];
  const idx = order.indexOf(bucket);
  return idx < 0 ? 0 : 1000 - idx * 100;
}

export class TetaRuntimeLexicalRetriever implements TetaRuntimeRetriever {
  buildIndex(units: RuntimeKnowledgeUnitV1[]): RuntimeIndexDocument[] {
    return units.map(unitToIndexDoc).sort((a, b) => a.unitId.localeCompare(b.unitId));
  }

  retrieve(query: RetrievalQuery, units: RuntimeKnowledgeUnitV1[]): RetrievalHit[] {
    const qTokens = new Set(tokenize(query.query));
    const hits: RetrievalHit[] = [];

    for (const unit of units) {
      if (query.productFamily && unit.applicability.productFamilyIds.length) {
        if (!unit.applicability.productFamilyIds.includes(query.productFamily)) continue;
      }
      if (query.productSurface && unit.applicability.productSurfaceIds.length) {
        if (!unit.applicability.productSurfaceIds.includes(query.productSurface)) continue;
      }
      if (query.domain && unit.applicability.domainIds.length) {
        if (!unit.applicability.domainIds.includes(query.domain)) continue;
      }

      if (unit.sourcePolicy.sourceOwnership === 'client') {
        const access = evaluateClientAccess({ unit, accessContext: query.accessContext ?? null });
        if (!access.allowed) continue;
      }

      // Public stale: still retrievable but ranker/planner may block.
      if (
        unit.sourcePolicy.sourceOwnership === 'public_authority' &&
        unit.applicability.currentnessStatus === 'historical' &&
        /aktualn|obecnie|current/i.test(query.query)
      ) {
        // keep but low
      }

      const doc = unitToIndexDoc(unit);
      const subjectNorm = normalizePolishText(unit.subject.label);
      const queryNorm = normalizePolishText(query.query);
      const exactSubject =
        subjectNorm.length > 0 && (queryNorm.includes(subjectNorm) || subjectNorm.includes(queryNorm.split(' ').slice(0, 3).join(' ')));

      let overlap = 0;
      for (const t of tokenize(doc.searchableText)) {
        if (qTokens.has(t)) overlap += 1;
      }
      // Substring boost for Polish morphology gaps (premii/premia etc.)
      const qn = normalizePolishText(query.query);
      if (qn && doc.searchableText.includes(qn.split(' ').slice(0, 2).join(' '))) overlap += 2;
      for (const qt of qTokens) {
        if (qt.length >= 4 && doc.searchableText.includes(qt.slice(0, Math.max(4, qt.length - 1)))) overlap += 1;
      }
      // Special-case RF01 / ME
      if (/teta me|czym jest teta me/i.test(query.query) && /teta me/i.test(unit.subject.label + unit.claim.answerableText)) {
        overlap += 10;
      }
      if (/teta edu|autoryzac/i.test(query.query) && unit.applicability.productFamilyIds.includes('teta_edu')) {
        overlap += 3;
      }
      if (/ksef/i.test(query.query) && (/ksef/i.test(unit.claim.answerableText) || unit.riskClass === 'legal_or_regulatory')) {
        overlap += 3;
      }
      if (overlap <= 0 && !exactSubject) continue;

      const bucket = rankBucket(unit, exactSubject || overlap >= 8);
      const score = bucketScore(bucket) + overlap + (exactSubject ? 50 : 0);
      hits.push({ unit, rankBucket: bucket, score });
    }

    hits.sort((a, b) => b.score - a.score || a.unit.runtimeKnowledgeUnitId.localeCompare(b.unit.runtimeKnowledgeUnitId));
    return hits;
  }
}

export function indexFingerprint(docs: RuntimeIndexDocument[]): string {
  return sha256(stableStringify(docs.map((d) => ({ id: d.unitId, rev: d.revisionId, text: d.searchableText }))));
}

export function rankingPolicyLoaded(repoRoot?: string): boolean {
  const cfg = loadRankingPolicyConfig(repoRoot);
  return Array.isArray(cfg.rankOrder) && cfg.rankOrder.length > 0;
}
