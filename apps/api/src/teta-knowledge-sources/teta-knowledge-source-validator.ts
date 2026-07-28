import type { KnowledgeSourceInventoryResult, KnowledgeSourceRecordV1 } from './teta-knowledge-source.types';
import type { LoadedKnowledgeSourceRegistries } from './teta-knowledge-source-registry.loader';

export function validateKnowledgeSourceInventory(
  inventory: KnowledgeSourceInventoryResult,
  regs: LoadedKnowledgeSourceRegistries,
): {
  unknownSeries: string[];
  tetaMeClassifiedAsStandaloneBusinessDomain: number;
  tetaMeSourcesWithoutProductSurface: number;
  tetaMeSourcesWrongProductFamily: number;
  legacyTetaMeDomainAssignmentsCreated: number;
  tetaEduClassifiedAsTetaHr: number;
  tetaEduInheritedHrConceptsWithoutEvidence: number;
  scopeAutoApprovedFromSeriesName: number;
  fuzzyPairsAutomaticallyAccepted: number;
  duplicateLogicalSourceIds: string[];
  absolutePathsInRecords: number;
} {
  const unknownSeries: string[] = [];
  let tetaMeClassifiedAsStandaloneBusinessDomain = 0;
  let tetaMeSourcesWithoutProductSurface = 0;
  let tetaMeSourcesWrongProductFamily = 0;
  let legacyTetaMeDomainAssignmentsCreated = 0;
  let tetaEduClassifiedAsTetaHr = 0;
  let tetaEduInheritedHrConceptsWithoutEvidence = 0;
  let scopeAutoApprovedFromSeriesName = 0;
  let absolutePathsInRecords = 0;
  const logicalCounts = new Map<string, number>();

  const seriesIds = new Set(regs.series.map((s) => s.seriesId));

  for (const s of inventory.sources) {
    logicalCounts.set(s.logicalSourceId, (logicalCounts.get(s.logicalSourceId) ?? 0) + 1);
    if (s.sourceSeriesId && !seriesIds.has(s.sourceSeriesId)) unknownSeries.push(s.sourceSeriesId);
    if (s.scope === 'global_teta') scopeAutoApprovedFromSeriesName += 1;
    if (s.domainHints.some((d) => d.domainId === 'teta_me')) {
      tetaMeClassifiedAsStandaloneBusinessDomain += 1;
      legacyTetaMeDomainAssignmentsCreated += 1;
    }
    if (s.sourceSeriesId === 'ME' || s.productSurfaceIds.includes('teta_me')) {
      if (!s.productSurfaceIds.includes('teta_me')) tetaMeSourcesWithoutProductSurface += 1;
      if (!s.productFamilyIds.includes('teta_hr')) tetaMeSourcesWrongProductFamily += 1;
    }
    if (s.sourceSeriesId === 'EDU' || s.productFamilyIds.includes('teta_edu')) {
      if (s.productFamilyIds.includes('teta_hr')) tetaEduClassifiedAsTetaHr += 1;
      if (s.domainHints.some((d) => d.domainId === 'hr') && s.domainHints.every((d) => d.source === 'approved_series_registry' && d.domainId === 'hr' && s.sourceSeriesId === 'EDU')) {
        // EDU series registry must not have HR hints; if present that's inheritance without evidence
      }
      if (s.sourceSeriesId === 'EDU' && s.domainHints.some((d) => d.domainId === 'hr')) {
        tetaEduInheritedHrConceptsWithoutEvidence += 1;
      }
    }
    const absCheck = JSON.stringify(s);
    if (/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(absCheck)) absolutePathsInRecords += 1;
  }

  const duplicateLogicalSourceIds = [...logicalCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id);

  return {
    unknownSeries,
    tetaMeClassifiedAsStandaloneBusinessDomain,
    tetaMeSourcesWithoutProductSurface,
    tetaMeSourcesWrongProductFamily,
    legacyTetaMeDomainAssignmentsCreated,
    tetaEduClassifiedAsTetaHr,
    tetaEduInheritedHrConceptsWithoutEvidence,
    scopeAutoApprovedFromSeriesName,
    fuzzyPairsAutomaticallyAccepted: inventory.pairs.filter((p) => p.pairingStatus === 'exact' && p.reason === 'similar_name_not_exact').length,
    duplicateLogicalSourceIds,
    absolutePathsInRecords,
  };
}

export function assertNoContentExtraction(record: KnowledgeSourceRecordV1): boolean {
  return !('extractedConcepts' in record) && !('chunks' in record);
}
