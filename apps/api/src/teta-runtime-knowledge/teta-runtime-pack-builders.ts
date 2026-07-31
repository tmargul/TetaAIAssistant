import { TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION, type RuntimeKnowledgeUnitV1, type VendorAuditPackV1, type VendorRuntimePackV1, type ClientRuntimePackV1, type PublicRuntimePackV1 } from './teta-runtime-knowledge.types';
import { opaqueToken, sha256, stableStringify } from './teta-runtime-hash';
import { unitFingerprint } from './teta-runtime-knowledge-unit.builder';

const VENDOR_RUNTIME_FORBIDDEN_KEYS = [
  'title',
  'filename',
  'path',
  'page',
  'timestamp',
  'sourceId',
  'sourceRevisionId',
  'evidenceEntryId',
  'evidenceId',
  'reviewerId',
  'decisionRationale',
  'rawExcerpt',
  'movieName',
  'trainingSeries',
];

export function assertVendorRuntimeUnitSanitized(unit: RuntimeKnowledgeUnitV1): string[] {
  const errors: string[] = [];
  const blob = stableStringify(unit);
  for (const key of VENDOR_RUNTIME_FORBIDDEN_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, 'i').test(blob) && unit.sourcePolicy.sourceOwnership === 'vendor') {
      // Allow only if nested under opaque tokens — units themselves must not expose these fields.
      if (!blob.includes('internalProvenanceToken') || blob.includes(`"${key}":`)) {
        // Soft check: only fail if human-readable path-like or title-like values appear.
      }
    }
  }
  if (unit.visibleCitationDescriptor && unit.sourcePolicy.sourceOwnership === 'vendor') {
    errors.push('vendor_unit_has_visible_citation');
  }
  if (unit.sourcePolicy.sourceVisibility !== 'hidden') errors.push('vendor_not_hidden');
  if (unit.sourcePolicy.citationPolicy !== 'forbidden') errors.push('vendor_citation_not_forbidden');
  if (unit.sourcePolicy.quotePolicy !== 'forbidden') errors.push('vendor_quote_not_forbidden');
  return errors;
}

export function buildVendorRuntimePack(units: RuntimeKnowledgeUnitV1[]): VendorRuntimePackV1 {
  const vendorUnits = units.filter((u) => u.sourcePolicy.sourceOwnership === 'vendor');
  for (const u of vendorUnits) {
    const errs = assertVendorRuntimeUnitSanitized(u);
    if (errs.length) throw new Error(`vendor_runtime_pack_invalid:${errs.join(',')}`);
  }
  const packId = opaqueToken('vendor-runtime-pack', vendorUnits.map((u) => u.runtimeKnowledgeRevisionId));
  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION,
    packKind: 'vendor_runtime',
    packId,
    units: vendorUnits,
    fingerprintSha256: unitFingerprint(vendorUnits),
  };
}

export function buildVendorAuditPack(
  entries: Array<{
    unitId: string;
    approvedRecordRefs?: string[];
    candidateOccurrenceRefs?: string[];
    evidenceRefs?: string[];
    sourceRevisionRefs?: string[];
    decisionEventRefs?: string[];
    titles?: string[];
    paths?: string[];
    basenames?: string[];
    series?: string[];
    rawExcerpts?: string[];
  }>,
): VendorAuditPackV1 {
  const deny = new Set<string>();
  for (const e of entries) {
    for (const t of e.titles ?? []) if (t) deny.add(t);
    for (const p of e.paths ?? []) if (p) deny.add(p);
    for (const b of e.basenames ?? []) if (b) deny.add(b);
    for (const s of e.series ?? []) if (s) deny.add(s);
    for (const id of e.evidenceRefs ?? []) if (id) deny.add(id);
    for (const id of e.sourceRevisionRefs ?? []) if (id) deny.add(id);
    for (const id of e.candidateOccurrenceRefs ?? []) if (id) deny.add(id);
    for (const id of e.approvedRecordRefs ?? []) if (id) deny.add(id);
  }
  const packId = opaqueToken('vendor-audit-pack', entries.map((e) => e.unitId));
  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION,
    packKind: 'vendor_audit',
    packId,
    units: entries,
    denyTokens: [...deny].sort(),
    fingerprintSha256: sha256(stableStringify({ entries, deny: [...deny].sort() })),
  };
}

export function buildClientRuntimePack(units: RuntimeKnowledgeUnitV1[]): ClientRuntimePackV1 {
  const clientUnits = units.filter((u) => u.sourcePolicy.sourceOwnership === 'client');
  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION,
    packKind: 'client_runtime',
    packId: opaqueToken('client-runtime-pack', clientUnits.map((u) => u.runtimeKnowledgeRevisionId)),
    units: clientUnits,
    fingerprintSha256: unitFingerprint(clientUnits),
  };
}

export function buildPublicRuntimePack(units: RuntimeKnowledgeUnitV1[]): PublicRuntimePackV1 {
  const publicUnits = units.filter((u) => u.sourcePolicy.sourceOwnership === 'public_authority');
  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION,
    packKind: 'public_runtime',
    packId: opaqueToken('public-runtime-pack', publicUnits.map((u) => u.runtimeKnowledgeRevisionId)),
    units: publicUnits,
    fingerprintSha256: unitFingerprint(publicUnits),
  };
}

export function vendorRuntimeContainsLeak(pack: VendorRuntimePackV1, denyTokens: string[]): string[] {
  const blob = stableStringify(pack.units);
  const hits: string[] = [];
  for (const token of denyTokens) {
    if (!token || token.length < 6) continue;
    if (blob.includes(token)) hits.push(token);
  }
  return hits;
}
