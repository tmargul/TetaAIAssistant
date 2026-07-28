import { readFileSync } from 'fs';
import path from 'path';
import { loadDomainRegistry } from './teta-domain-lexicon-loader';
import type { TetaPolishDomainLexiconCatalog } from './teta-domain-lexicon.types';

export type LexiconValidationReport = {
  duplicateEntryIds: string[];
  duplicateAliasesSameConcept: string[];
  aliasesMappedToMultipleConcepts: string[];
  rulesMappedToUnknownIntent: string[];
  invalidConceptMappings: string[];
  directOracleMappingsDetected: string[];
  arbitraryRegexRulesDetected: string[];
  entriesWithoutProvenance: string[];
  approvedEntriesWithoutAliases: string[];
  unknownDomainIds: string[];
  candidateOverridesApproved: string[];
};

/**
 * Neutral core operation rules may have empty requiredConcepts — they map to
 * capability/scope only (operationRuleId), not to conceptIds.
 * invalidConceptMappings only when requiredConcepts or mapsTo.subject
 * reference unknown conceptIds.
 */
export function validateDomainLexicon(
  catalog: TetaPolishDomainLexiconCatalog,
  configDir?: string,
): LexiconValidationReport {
  const report: LexiconValidationReport = {
    duplicateEntryIds: [],
    duplicateAliasesSameConcept: [],
    aliasesMappedToMultipleConcepts: [],
    rulesMappedToUnknownIntent: [],
    invalidConceptMappings: [],
    directOracleMappingsDetected: [],
    arbitraryRegexRulesDetected: [],
    entriesWithoutProvenance: [],
    approvedEntriesWithoutAliases: [],
    unknownDomainIds: [],
    candidateOverridesApproved: [],
  };
  const registry = loadDomainRegistry(configDir);
  const knownDomains = new Set(registry.domains.filter((d) => d.status === 'approved').map((d) => d.domainId));
  const intentCatalogPath = path.join(
    configDir ?? path.resolve(__dirname, '../../config'),
    'teta-intent-catalog-v1.json',
  );
  const knownIntents = new Set(
    (JSON.parse(readFileSync(intentCatalogPath, 'utf8')) as { intents: Array<{ type: string }> }).intents.map(
      (it) => it.type,
    ),
  );
  const entryIds = new Set<string>();
  const aliasOwners = new Map<string, string>();
  const approvedConceptIds = new Set<string>();
  for (const entry of catalog.entries) {
    if (entry.status === 'approved') approvedConceptIds.add(entry.conceptId);
  }
  for (const entry of catalog.entries) {
    if (!knownDomains.has(entry.domain) && entry.domain !== 'core') report.unknownDomainIds.push(entry.entryId);
    if (entry.status !== 'approved' && approvedConceptIds.has(entry.conceptId)) {
      report.candidateOverridesApproved.push(entry.entryId);
    }
    if (entryIds.has(entry.entryId)) report.duplicateEntryIds.push(entry.entryId);
    entryIds.add(entry.entryId);
    if (!entry.provenance?.sourceId) report.entriesWithoutProvenance.push(entry.entryId);
    if (entry.status === 'approved' && entry.aliases.length === 0) report.approvedEntriesWithoutAliases.push(entry.entryId);
    const localAliases = new Set<string>();
    for (const alias of entry.aliases) {
      const local = `${entry.conceptId}:${alias.text.toLowerCase()}`;
      if (localAliases.has(local)) report.duplicateAliasesSameConcept.push(local);
      localAliases.add(local);
      const global = alias.text.toLowerCase();
      const owner = aliasOwners.get(global);
      if (owner && owner !== entry.conceptId) report.aliasesMappedToMultipleConcepts.push(global);
      aliasOwners.set(global, entry.conceptId);
      if (/(oracle|select|from|join|sql)/i.test(alias.text)) {
        report.directOracleMappingsDetected.push(`${entry.entryId}:${alias.text}`);
      }
    }
  }
  for (const rule of catalog.operationRules) {
    for (const pattern of rule.patterns) {
      if ((pattern as { regex?: string }).regex) report.arbitraryRegexRulesDetected.push(rule.ruleId);
    }
    if (rule.mapsTo.intent && !knownIntents.has(rule.mapsTo.intent)) {
      report.rulesMappedToUnknownIntent.push(rule.ruleId);
    }
    for (const conceptId of rule.requiredConcepts) {
      if (!approvedConceptIds.has(conceptId)) {
        report.invalidConceptMappings.push(`${rule.ruleId}:required:${conceptId}`);
      }
    }
    if (rule.mapsTo.subject && !approvedConceptIds.has(rule.mapsTo.subject)) {
      report.invalidConceptMappings.push(`${rule.ruleId}:subject:${rule.mapsTo.subject}`);
    }
  }
  return report;
}
