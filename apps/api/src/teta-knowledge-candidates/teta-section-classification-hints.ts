import type { CanonicalSourceRecordV1 } from '../teta-source-extraction/teta-canonical-source.types';
import type {
  SectionClassificationStatus,
  TopicSectionClassificationHints,
  TopicSectionV1,
} from './teta-topic-section.types';

const EXPLICIT_LABEL_DOMAINS: Record<string, string[]> = {
  kadry: ['hr'],
  płace: ['payroll'],
  place: ['payroll'],
  rcp: ['time_and_attendance'],
  czas: ['time_and_attendance'],
  faktur: ['invoicing'],
  ksef: ['invoicing', 'accounting'],
  księg: ['accounting'],
  nadgodzin: ['time_and_attendance', 'payroll'],
  'przekazanie nadgodzin': ['time_and_attendance', 'payroll'],
};

export function classifySectionHints(
  source: CanonicalSourceRecordV1,
  section: Pick<TopicSectionV1, 'title' | 'headingPath' | 'contentUnitRefs'>,
  sectionText: string,
): { hints: TopicSectionClassificationHints; status: SectionClassificationStatus; warnings: string[] } {
  const hints: TopicSectionClassificationHints = {
    productFamilyIds: [...source.productFamilyHints],
    productSurfaceIds: [...source.productSurfaceHints],
    domainIds: [],
    businessAreaIds: [...source.businessAreaHints],
    knowledgeAreaIds: [...source.knowledgeAreaHints],
    sourcePurposeIds: [...(source.sourcePurposeHints ?? [])],
    temporalContextIds: [],
  };
  const warnings: string[] = [];
  const textLower = `${section.title ?? ''} ${section.headingPath.join(' ')} ${sectionText}`.toLowerCase();

  if (source.relativeDirectorySegments.some((s) => s.toLowerCase().includes('przelom') || s.toLowerCase().includes('przełom'))) {
    hints.temporalContextIds.push('calendar_year_transition');
  }
  if (source.relativeDirectorySegments.some((s) => s.toLowerCase().includes('scenariusz'))) {
    hints.sourcePurposeIds.push('scenario_or_test_case');
  }
  if (source.relativeDirectorySegments.some((s) => s.toLowerCase().includes('workflow') || s.toLowerCase().includes('obd'))) {
    warnings.push('client_specific_risk_high_from_folder');
  }

  const textDomains = new Set<string>();
  for (const [label, domains] of Object.entries(EXPLICIT_LABEL_DOMAINS)) {
    if (textLower.includes(label)) domains.forEach((d) => textDomains.add(d));
  }

  const folderOnlyDomains = [...source.domainHints];
  const combinedDomains = new Set([...textDomains, ...folderOnlyDomains]);

  if (textDomains.size === 0 && folderOnlyDomains.length > 0) {
    hints.domainIds = [...folderOnlyDomains];
    return { hints, status: 'hint_only', warnings: [...warnings, 'folder_hint_only_no_text_evidence'] };
  }

  hints.domainIds = [...combinedDomains];

  if (hints.domainIds.length > 1) {
    return { hints, status: 'multi_domain', warnings };
  }
  if (hints.domainIds.length === 1) {
    return { hints, status: 'recognized', warnings };
  }
  if (hints.productFamilyIds.length || hints.productSurfaceIds.length) {
    return { hints, status: 'ambiguous', warnings };
  }
  return { hints, status: 'unresolved', warnings };
}

export function applyApplicabilityFromSource(
  source: CanonicalSourceRecordV1,
  hints: TopicSectionClassificationHints,
): TopicSectionV1['applicability'] {
  const clientRisk =
    source.relativeDirectorySegments.some((s) => /workflow|obd/i.test(s))
    || hints.sourcePurposeIds.includes('scenario_or_test_case')
      ? 'high' as const
      : 'unknown' as const;
  const regulatory =
    hints.domainIds.some((d) => d.includes('ksef') || d.includes('invoicing'))
    || source.relativeDirectorySegments.some((s) => /finanse|ksef/i.test(s));
  return {
    productVersionHints: [...(source.productVersionHints ?? [])],
    documentDateHints: [...(source.documentDateHints ?? [])],
    currentnessStatus: regulatory ? 'not_verified' : 'not_verified',
    scopeStatus: clientRisk === 'high' ? 'requires_review' : 'requires_review',
    clientSpecificRisk: clientRisk,
  };
}

export function countApplicabilityViolations(
  candidate: {
    applicability: {
      productFamilyIds: string[];
      productSurfaceIds: string[];
      domainIds: string[];
      scopeStatus: string;
      currentnessStatus: string;
      productVersionHints: string[];
    };
  },
  sectionHints: TopicSectionClassificationHints,
): {
  tetaEduAssignedToHr: boolean;
  tetaMeStandaloneDomain: boolean;
  clientPromotedToGlobal: boolean;
  versionUniversalized: boolean;
  regulatoryMarkedCurrent: boolean;
} {
  const edu = candidate.applicability.productFamilyIds.includes('teta_edu');
  const hrDomain = candidate.applicability.domainIds.includes('hr');
  const tetaMeSurface = candidate.applicability.productSurfaceIds.includes('teta_me');
  const tetaMeDomain = candidate.applicability.domainIds.includes('teta_me');
  return {
    tetaEduAssignedToHr: edu && hrDomain && !sectionHints.domainIds.includes('hr'),
    tetaMeStandaloneDomain: tetaMeSurface && tetaMeDomain,
    clientPromotedToGlobal: candidate.applicability.scopeStatus === 'global_candidate'
      && sectionHints.sourcePurposeIds.includes('scenario_or_test_case'),
    versionUniversalized: candidate.applicability.scopeStatus === 'global_candidate'
      && (candidate.applicability.productVersionHints.length > 0),
    regulatoryMarkedCurrent: candidate.applicability.currentnessStatus !== 'not_verified'
      && sectionHints.domainIds.some((d) => d.includes('ksef') || d.includes('invoicing')),
  };
}
