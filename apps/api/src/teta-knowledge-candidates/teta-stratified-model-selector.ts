import { estimateTokens, type ModelBudgetConfig, DEFAULT_MODEL_BUDGET_CONFIG } from './teta-candidate-model-config';
import type { TopicSectionV1 } from './teta-topic-section.types';
import type { CanonicalSourceRecordV1 } from '../teta-source-extraction/teta-canonical-source.types';
import type { KnowledgeCandidateOccurrenceV1 } from './teta-knowledge-candidate.types';

export type SourceArchetype =
  | 'payroll_scenario'
  | 'teta_edu_hiring'
  | 'year_transition'
  | 'finance_ksef'
  | 'developer_training'
  | 'structured_table'
  | 'blocked_source'
  | 'technical_transcript'
  | 'status_rich'
  | 'formula_parameter'
  | 'unresolved_ambiguous'
  | 'other';

export type StratifiedSelectionCategory =
  | 'scenario_procedure'
  | 'structured_table'
  | 'teta_edu_process'
  | 'year_transition'
  | 'finance_ksef'
  | 'developer_transcript'
  | 'technical_transcript'
  | 'status_rich'
  | 'formula_parameter'
  | 'unresolved_ambiguous';

export type ModelSectionSelection = {
  sectionId: string;
  logicalSourceId: string;
  selectionReason: StratifiedSelectionCategory;
  sourceArchetype: SourceArchetype;
  sectionKind: string;
  inputCharacters: number;
  estimatedTokens: number;
  deterministicCandidateCount: number;
  modelEligibilityReason: string;
  selectedByFilesystemOrder: boolean;
  selectedByArbitraryFirstN: boolean;
};

const CATEGORY_ORDER: StratifiedSelectionCategory[] = [
  'scenario_procedure',
  'structured_table',
  'teta_edu_process',
  'year_transition',
  'finance_ksef',
  'developer_transcript',
  'technical_transcript',
  'status_rich',
  'formula_parameter',
  'unresolved_ambiguous',
];

export function inferSourceArchetype(source: CanonicalSourceRecordV1): SourceArchetype {
  if (source.extractionStatus === 'blocked' || source.metadataOnly) return 'blocked_source';
  const path = `${source.originalRelativePath} ${source.logicalSourceId}`.toLowerCase();
  const domains = source.domainHints.join(' ').toLowerCase();
  if (source.knowledgeAreaHints.includes('developer_training') || /zu1|plugin|dataset/i.test(path)) {
    return 'developer_training';
  }
  if (/ksef|finanse|invoic/i.test(path) || /invoicing|accounting/.test(domains)) return 'finance_ksef';
  if (/przelom|przełom|year/i.test(path)) return 'year_transition';
  if (source.productFamilyHints.includes('teta_edu') || /edu|zatrudn|przyj/i.test(path)) return 'teta_edu_hiring';
  if ((source.sourcePurposeHints ?? []).includes('scenario_or_test_case') || /scenariusz|payroll|płac/i.test(path)) {
    return 'payroll_scenario';
  }
  if (source.contentUnits.some((u) => u.unitKind === 'table_row')) return 'structured_table';
  if (source.sourceType === 'video_training') return 'technical_transcript';
  return 'other';
}

function sectionText(source: CanonicalSourceRecordV1, section: TopicSectionV1): string {
  return source.contentUnits
    .filter((u) => section.contentUnitRefs.includes(u.contentUnitId))
    .map((u) => u.text)
    .join('\n');
}

export function classifySectionCategory(
  source: CanonicalSourceRecordV1,
  section: TopicSectionV1,
  text: string,
  detCount: number,
): StratifiedSelectionCategory | null {
  const archetype = inferSourceArchetype(source);
  if (section.sectionKind === 'table_section') return 'structured_table';
  if (archetype === 'teta_edu_hiring' || /proces|przyjęcie|edu/i.test(section.title ?? '')) return 'teta_edu_process';
  if (archetype === 'year_transition' || /przełom|przelom/i.test(text)) return 'year_transition';
  if (archetype === 'finance_ksef' || /ksef|e-faktur/i.test(text)) return 'finance_ksef';
  if (archetype === 'developer_training') return 'developer_transcript';
  if (section.sectionKind === 'transcript_topic' && /formularz|obiekt|plugin|dataset|funkcj/i.test(text)) {
    return 'technical_transcript';
  }
  if (/\bstatus\b/i.test(text) && detCount > 0) return 'status_rich';
  if (/=/.test(text) || /parametr|formuła|formula/i.test(text)) return 'formula_parameter';
  if (
    /scenariusz|procedura|krok/i.test(text)
    || section.classificationHints.sourcePurposeIds.includes('scenario_or_test_case')
  ) {
    return 'scenario_procedure';
  }
  if (
    section.applicability.scopeStatus === 'requires_review'
    || section.qualityFlags.includes('ambiguous')
    || detCount === 0
  ) {
    return 'unresolved_ambiguous';
  }
  return null;
}

export type StratifiedSelectionResult = {
  selected: ModelSectionSelection[];
  modelSectionsSelectedByArchetype: Record<string, number>;
  modelSectionSelectionCoverage: string[];
  modelSectionsSelectedByFilesystemOrder: number;
  modelSectionsSelectedByArbitraryFirstN: number;
};

export function selectStratifiedModelSections(
  items: Array<{
    source: CanonicalSourceRecordV1;
    section: TopicSectionV1;
    deterministicCandidates: KnowledgeCandidateOccurrenceV1[];
  }>,
  maxSections: number,
  budget: ModelBudgetConfig = DEFAULT_MODEL_BUDGET_CONFIG,
): StratifiedSelectionResult {
  const byCategory = new Map<StratifiedSelectionCategory, ModelSectionSelection[]>();
  for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);

  // Deterministic order: logicalSourceId then sectionId (not filesystem)
  const sorted = [...items].sort((a, b) => {
    const s = a.source.logicalSourceId.localeCompare(b.source.logicalSourceId);
    if (s !== 0) return s;
    return a.section.sectionId.localeCompare(b.section.sectionId);
  });

  for (const item of sorted) {
    const text = sectionText(item.source, item.section);
    const cat = classifySectionCategory(
      item.source,
      item.section,
      text,
      item.deterministicCandidates.length,
    );
    if (!cat) continue;
    const chars = Math.min(text.length, budget.maxModelInputCharacters);
    const sel: ModelSectionSelection = {
      sectionId: item.section.sectionId,
      logicalSourceId: item.source.logicalSourceId,
      selectionReason: cat,
      sourceArchetype: inferSourceArchetype(item.source),
      sectionKind: item.section.sectionKind,
      inputCharacters: chars,
      estimatedTokens: estimateTokens(text.slice(0, chars)),
      deterministicCandidateCount: item.deterministicCandidates.length,
      modelEligibilityReason: `stratified:${cat}`,
      selectedByFilesystemOrder: false,
      selectedByArbitraryFirstN: false,
    };
    byCategory.get(cat)!.push(sel);
  }

  const selected: ModelSectionSelection[] = [];
  const usedSections = new Set<string>();
  // Round-robin prefer one per category first
  for (const cat of CATEGORY_ORDER) {
    if (selected.length >= maxSections) break;
    const pool = byCategory.get(cat) ?? [];
    const pick = pool.find((s) => !usedSections.has(s.sectionId));
    if (pick) {
      selected.push(pick);
      usedSections.add(pick.sectionId);
    }
  }
  // Fill remaining by category order
  for (const cat of CATEGORY_ORDER) {
    if (selected.length >= maxSections) break;
    for (const s of byCategory.get(cat) ?? []) {
      if (selected.length >= maxSections) break;
      if (usedSections.has(s.sectionId)) continue;
      selected.push(s);
      usedSections.add(s.sectionId);
    }
  }

  const byArchetype: Record<string, number> = {};
  for (const s of selected) {
    byArchetype[s.sourceArchetype] = (byArchetype[s.sourceArchetype] ?? 0) + 1;
  }

  return {
    selected,
    modelSectionsSelectedByArchetype: byArchetype,
    modelSectionSelectionCoverage: [...new Set(selected.map((s) => s.selectionReason))],
    modelSectionsSelectedByFilesystemOrder: selected.filter((s) => s.selectedByFilesystemOrder).length,
    modelSectionsSelectedByArbitraryFirstN: selected.filter((s) => s.selectedByArbitraryFirstN).length,
  };
}
