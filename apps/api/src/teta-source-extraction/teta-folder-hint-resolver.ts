import type { FolderHint } from './teta-canonical-source.types';
import type { DocumentFolderHintsRegistry } from './teta-source-extraction-config.loader';
import { normalizeBasenameKey } from './teta-canonical-source-contract';

export type ResolvedFolderHints = {
  folderHints: FolderHint[];
  productFamilyHints: string[];
  productSurfaceHints: string[];
  domainHints: string[];
  businessAreaHints: string[];
  knowledgeAreaHints: string[];
  sourcePurposeHints: string[];
  sectionLevelClassificationRequired: boolean;
  applicabilityReviewRequired: boolean;
  scopeClassificationRequired: boolean;
  crossDomainFolderHints: boolean;
};

export function resolveFolderHints(
  relativeDirectorySegments: string[],
  registry: DocumentFolderHintsRegistry,
): ResolvedFolderHints {
  const folderHints: FolderHint[] = [];
  const productFamilyHints = new Set<string>();
  const productSurfaceHints = new Set<string>();
  const domainHints = new Set<string>();
  const businessAreaHints = new Set<string>();
  const knowledgeAreaHints = new Set<string>();
  const sourcePurposeHints = new Set<string>();
  let sectionLevelClassificationRequired = false;
  let applicabilityReviewRequired = false;
  let scopeClassificationRequired = false;
  let crossDomainFolderHints = false;

  for (const segment of relativeDirectorySegments) {
    const key = normalizeBasenameKey(segment);
    const entry = registry.folders.find((f) => f.normalizedKey === key);
    if (!entry) {
      folderHints.push({
        hintKind: 'topic_hint',
        value: key,
        status: 'folder_registry_hint',
      });
      continue;
    }
    for (const h of entry.hints) {
      folderHints.push({ hintKind: h.hintKind as FolderHint['hintKind'], value: h.value, status: 'folder_registry_hint' });
      if (h.hintKind === 'product_family_hint') productFamilyHints.add(h.value);
      if (h.hintKind === 'product_surface_hint') productSurfaceHints.add(h.value);
      if (h.hintKind === 'business_domain_hint') domainHints.add(h.value);
      if (h.hintKind === 'business_area_hint') businessAreaHints.add(h.value);
      if (h.hintKind === 'knowledge_area_hint') knowledgeAreaHints.add(h.value);
      if (h.hintKind === 'source_purpose_hint') sourcePurposeHints.add(h.value);
      if (h.hintKind === 'cross_domain_hint') crossDomainFolderHints = true;
    }
    if (entry.sectionLevelClassificationRequired) sectionLevelClassificationRequired = true;
    if (entry.applicabilityReviewRequired) applicabilityReviewRequired = true;
    if (entry.scopeClassificationRequired) scopeClassificationRequired = true;
    if (entry.classificationStatus === 'requires_section_classification') crossDomainFolderHints = true;
  }

  return {
    folderHints,
    productFamilyHints: [...productFamilyHints],
    productSurfaceHints: [...productSurfaceHints],
    domainHints: [...domainHints],
    businessAreaHints: [...businessAreaHints],
    knowledgeAreaHints: [...knowledgeAreaHints],
    sourcePurposeHints: [...sourcePurposeHints],
    sectionLevelClassificationRequired,
    applicabilityReviewRequired,
    scopeClassificationRequired,
    crossDomainFolderHints,
  };
}

export function extractFilenameHints(fileName: string): {
  productVersionHints: string[];
  documentDateHints: string[];
} {
  const productVersionHints: string[] = [];
  const documentDateHints: string[] = [];
  const versionMatch = fileName.match(/teta\s*hr\s*(\d+(?:\.\d+)+)/i);
  if (versionMatch) productVersionHints.push(versionMatch[1]);
  const dateMatch = fileName.match(/^(\d{4})\s+(\d{2})/);
  if (dateMatch) documentDateHints.push(`${dateMatch[1]}-${dateMatch[2]}`);
  return { productVersionHints, documentDateHints };
}
