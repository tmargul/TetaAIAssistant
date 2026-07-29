import type { CanonicalSourceRecordV1, ContentUnitV1 } from '../teta-source-extraction/teta-canonical-source.types';
import {
  STAGE3J2C_EXTRACTOR_VERSION,
  TETA_TOPIC_SECTION_CONTRACT_VERSION,
  type SectionBuildStats,
  type TopicSectionKind,
  type TopicSectionV1,
} from './teta-topic-section.types';
import { applyApplicabilityFromSource, classifySectionHints } from './teta-section-classification-hints';
import { buildSectionId, computeSectionFingerprintSha256 } from './teta-topic-section-contract';

const EXPLICIT_BOUNDARY_LABELS = [
  'cel',
  'warunki wstępne',
  'warunki wstepne',
  'kroki',
  'oczekiwany wynik',
  'uwaga',
  'uwagi',
  'ostrzeżenie',
  'przypadek',
  'scenariusz',
  'konfiguracja',
  'parametry',
  'korekta',
];

function unitText(units: ContentUnitV1[], ids: string[]): string {
  const set = new Set(ids);
  return units.filter((u) => set.has(u.contentUnitId)).map((u) => u.text).join('\n');
}

function collectAssetRefs(units: ContentUnitV1[], ids: string[]): string[] {
  const set = new Set(ids);
  const refs = new Set<string>();
  for (const u of units.filter((x) => set.has(x.contentUnitId))) {
    for (const a of u.assetRefs) refs.add(a);
  }
  return [...refs].sort();
}

function pageRange(units: ContentUnitV1[], ids: string[]): { pageFrom: number | null; pageTo: number | null } {
  const pages = units
    .filter((u) => ids.includes(u.contentUnitId) && u.location.pageNumber != null)
    .map((u) => u.location.pageNumber as number);
  if (!pages.length) return { pageFrom: null, pageTo: null };
  return { pageFrom: Math.min(...pages), pageTo: Math.max(...pages) };
}

type SectionPartial = {
  logicalSourceId: string;
  sourceRevisionId: string;
  sourceType: 'document' | 'video_training';
  sectionKind: TopicSectionKind;
  title: string | null;
  headingPath: string[];
  order: number;
  contentUnitRefs: string[];
  assetRefs: string[];
  location: TopicSectionV1['location'];
  qualityFlags: string[];
  warnings: string[];
  segmentRefs?: string[];
  precedingFrameRefs?: string[];
  nearestFrameRefs?: string[];
  followingFrameRefs?: string[];
};

function finalizeSection(
  source: CanonicalSourceRecordV1,
  partial: SectionPartial,
  units: ContentUnitV1[],
): TopicSectionV1 {
  const fp = computeSectionFingerprintSha256(partial);
  const text = unitText(units, partial.contentUnitRefs);
  const { hints, status, warnings: classWarnings } = classifySectionHints(source, partial, text);
  return {
    contractVersion: TETA_TOPIC_SECTION_CONTRACT_VERSION,
    sectionId: buildSectionId(partial),
    sectionFingerprintSha256: fp,
    ...partial,
    classificationHints: hints,
    classificationStatus: status,
    applicability: applyApplicabilityFromSource(source, hints),
    warnings: [...partial.warnings, ...classWarnings],
    extractorVersion: STAGE3J2C_EXTRACTOR_VERSION,
  };
}

function isExplicitBoundary(unit: ContentUnitV1): boolean {
  if (unit.unitKind === 'table') return true;
  const t = unit.text.trim().toLowerCase();
  return EXPLICIT_BOUNDARY_LABELS.some((l) => t === l || t.startsWith(`${l}:`) || t.startsWith(`${l} `));
}

function isHeadingUnit(unit: ContentUnitV1): boolean {
  return unit.unitKind === 'heading';
}

function headingLevel(unit: ContentUnitV1): number {
  const m = unit.text.match(/^#{1,6}\s/);
  if (m) return m[0].trim().length;
  if (unit.unitKind === 'heading') return unit.headingPath.length || 1;
  return 1;
}

export function buildDocumentSections(source: CanonicalSourceRecordV1): {
  sections: TopicSectionV1[];
  stats: SectionBuildStats;
} {
  const units = [...source.contentUnits].sort((a, b) => a.order - b.order);
  const sections: TopicSectionV1[] = [];
  const assigned = new Map<string, number>();
  let order = 0;

  const headings = units.filter(isHeadingUnit);
  if (headings.length > 0) {
    const firstHeadingIdx = units.findIndex((u) => u.contentUnitId === headings[0].contentUnitId);
    if (firstHeadingIdx > 0) {
      const preambleRefs = units.slice(0, firstHeadingIdx).map((u) => u.contentUnitId);
      preambleRefs.forEach((id) => assigned.set(id, (assigned.get(id) ?? 0) + 1));
      order += 1;
      sections.push(
        finalizeSection(
          source,
          {
            logicalSourceId: source.logicalSourceId,
            sourceRevisionId: source.sourceRevisionId,
            sourceType: source.sourceType,
            sectionKind: 'document_section',
            title: 'Preamble',
            headingPath: [],
            order,
            contentUnitRefs: preambleRefs,
            assetRefs: collectAssetRefs(units, preambleRefs),
            location: { ...pageRange(units, preambleRefs), startSeconds: null, endSeconds: null },
            qualityFlags: [],
            warnings: ['preamble_before_first_heading'],
          },
          units,
        ),
      );
    }
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const hIdx = units.findIndex((u) => u.contentUnitId === h.contentUnitId);
      // Exclusive ranges: next heading of any level ends the section (avoids multi-assignment nesting).
      let endIdx = units.length;
      for (let j = hIdx + 1; j < units.length; j++) {
        if (isHeadingUnit(units[j])) {
          endIdx = j;
          break;
        }
      }
      const refs = units.slice(hIdx, endIdx).map((u) => u.contentUnitId);
      refs.forEach((id) => assigned.set(id, (assigned.get(id) ?? 0) + 1));
      const kind: TopicSectionKind =
        refs.some((id) => {
          const uk = units.find((u) => u.contentUnitId === id)?.unitKind;
          return uk === 'table' || uk === 'table_row';
        })
          ? 'table_section'
          : 'document_section';
      order += 1;
      const partial = {
        logicalSourceId: source.logicalSourceId,
        sourceRevisionId: source.sourceRevisionId,
        sourceType: source.sourceType,
        sectionKind: kind,
        title: h.text.replace(/^#+\s*/, '').trim() || null,
        headingPath: h.headingPath.length ? h.headingPath : [h.text],
        order,
        contentUnitRefs: refs,
        assetRefs: collectAssetRefs(units, refs),
        location: { ...pageRange(units, refs), startSeconds: null, endSeconds: null },
        qualityFlags: [],
        warnings: [] as string[],
      };
      sections.push(finalizeSection(source, partial, units));
    }
  } else {
    let current: ContentUnitV1[] = [];
    const flush = (kind: TopicSectionKind, title: string | null) => {
      if (!current.length) return;
      const refs = current.map((u) => u.contentUnitId);
      refs.forEach((id) => assigned.set(id, (assigned.get(id) ?? 0) + 1));
      order += 1;
      const partial = {
        logicalSourceId: source.logicalSourceId,
        sourceRevisionId: source.sourceRevisionId,
        sourceType: source.sourceType,
        sectionKind: kind,
        title,
        headingPath: title ? [title] : [],
        order,
        contentUnitRefs: refs,
        assetRefs: collectAssetRefs(units, refs),
        location: { ...pageRange(units, refs), startSeconds: null, endSeconds: null },
        qualityFlags: [],
        warnings: [] as string[],
      };
      sections.push(finalizeSection(source, partial, units));
      current = [];
    };

    for (const u of units) {
      if (u.unitKind === 'table' || u.unitKind === 'table_row') {
        flush('document_section', null);
        const refs = [u.contentUnitId];
        assigned.set(u.contentUnitId, (assigned.get(u.contentUnitId) ?? 0) + 1);
        order += 1;
        sections.push(
          finalizeSection(
            source,
            {
              logicalSourceId: source.logicalSourceId,
              sourceRevisionId: source.sourceRevisionId,
              sourceType: source.sourceType,
              sectionKind: 'table_section',
              title: 'Tabela',
              headingPath: [],
              order,
              contentUnitRefs: refs,
              assetRefs: collectAssetRefs(units, refs),
              location: { ...pageRange(units, refs), startSeconds: null, endSeconds: null },
              qualityFlags: [],
              warnings: [],
            },
            units,
          ),
        );
        continue;
      }
      if (isExplicitBoundary(u) && current.length) {
        flush('document_section', u.text.slice(0, 80));
      }
      if (u.location.pageNumber != null && current.length) {
        const lastPage = current[current.length - 1]?.location.pageNumber;
        if (lastPage != null && u.location.pageNumber !== lastPage) {
          flush('document_section', null);
        }
      }
      if (u.text.trim() === '' && current.length >= 3) {
        flush('document_section', null);
        continue;
      }
      current.push(u);
    }
    flush('document_section', null);
  }

  const stats = reconcileAssignment(units, assigned, sections, []);
  return { sections, stats };
}

function reconcileAssignment(
  units: ContentUnitV1[],
  assigned: Map<string, number>,
  sections: TopicSectionV1[],
  noiseBuckets: SectionBuildStats['noiseBuckets'],
): SectionBuildStats {
  const segments = units.filter((u) => u.unitKind === 'transcript_segment');
  const docUnits = units.filter((u) => u.unitKind !== 'transcript_segment');
  let lost = 0;
  let multi = 0;
  for (const u of docUnits) {
    const c = assigned.get(u.contentUnitId) ?? 0;
    if (c === 0) lost += 1;
    if (c > 1) multi += 1;
  }
  const segAssigned = new Map<string, number>();
  for (const s of sections) {
    for (const ref of s.segmentRefs ?? []) {
      segAssigned.set(ref, (segAssigned.get(ref) ?? 0) + 1);
    }
  }
  for (const b of noiseBuckets) {
    for (const ref of b.segmentRefs) {
      segAssigned.set(ref, (segAssigned.get(ref) ?? 0) + 1);
    }
  }
  let segLost = 0;
  let segMulti = 0;
  let segTopics = 0;
  let segNoise = 0;
  for (const seg of segments) {
    const c = segAssigned.get(seg.contentUnitId) ?? 0;
    if (c === 0) segLost += 1;
    if (c > 1) segMulti += 1;
  }
  for (const s of sections) segTopics += s.segmentRefs?.length ?? 0;
  for (const b of noiseBuckets) segNoise += b.segmentRefs.length;

  return {
    sectionsCreated: sections.length,
    contentUnitsAssigned: docUnits.length - lost,
    contentUnitsLost: lost,
    contentUnitsAssignedMultipleTimes: multi,
    transcriptSegmentsTotal: segments.length,
    transcriptSegmentsAssignedToTopics: segTopics,
    transcriptSegmentsAssignedToNoise: segNoise,
    transcriptSegmentsLost: segLost,
    transcriptSegmentsAssignedMultipleTimes: segMulti,
    noiseBuckets,
  };
}

export { reconcileAssignment };
