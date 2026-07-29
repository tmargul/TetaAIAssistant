import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { TopicSectionV1 } from './teta-topic-section.types';

export function sectionFingerprintInput(section: Pick<
  TopicSectionV1,
  | 'logicalSourceId'
  | 'sourceRevisionId'
  | 'sectionKind'
  | 'title'
  | 'headingPath'
  | 'order'
  | 'contentUnitRefs'
  | 'assetRefs'
  | 'location'
>): Record<string, unknown> {
  return {
    logicalSourceId: section.logicalSourceId,
    sourceRevisionId: section.sourceRevisionId,
    sectionKind: section.sectionKind,
    title: section.title,
    headingPath: section.headingPath,
    order: section.order,
    contentUnitRefs: [...section.contentUnitRefs].sort(),
    assetRefs: [...section.assetRefs].sort(),
    location: section.location,
  };
}

export function computeSectionFingerprintSha256(section: Pick<
  TopicSectionV1,
  | 'logicalSourceId'
  | 'sourceRevisionId'
  | 'sectionKind'
  | 'title'
  | 'headingPath'
  | 'order'
  | 'contentUnitRefs'
  | 'assetRefs'
  | 'location'
>): string {
  return sha256(stableStringify(sectionFingerprintInput(section)));
}

export function sectionIdFromFingerprint(fingerprint: string): string {
  return `section:sha256:${fingerprint}`;
}

export function buildSectionId(section: Parameters<typeof computeSectionFingerprintSha256>[0]): string {
  return sectionIdFromFingerprint(computeSectionFingerprintSha256(section));
}

export function sectionFingerprintSetSha256(fingerprints: string[]): string {
  return sha256(stableStringify([...fingerprints].sort()));
}
