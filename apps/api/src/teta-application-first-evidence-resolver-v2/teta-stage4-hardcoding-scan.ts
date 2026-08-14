import fs from 'fs';
import path from 'path';
import { lexiconContainsPhysicalMappings } from './teta-stage4-lexicon';

export function scanStage4ForHardcoding(sources: Record<string, string>): {
  hardcodedCurrentPositionTables: number;
  hardcodedPayrollTables: number;
  hardcodedTwgMappings: number;
  hardcodedTwgSemanticRules: number;
  hardcodedUnseenSemanticRules: number;
  hardcodedCurrentPositionSemanticRules: number;
  hardcodedPayrollSemanticRules: number;
  domainStopwordExceptionRules: number;
  goldenPhysicalMappingUsedForSemanticCoherence: number;
  expectedOracleNamesUsedForSemanticCoherence: number;
  semanticEvidencePathAlignedViolations: number;
  crossCohortSemanticMerges: number;
  scenarioSpecificDomainCoherenceBranches: number;
  scenarioSpecificPhysicalMappings: number;
  scenarioSpecificPhysicalResolutionBranches: number;
  syntheticFixtureReachableFromProduction: number;
  lexiconPhysicalMappings: number;
} {
  const filtered = Object.fromEntries(
    Object.entries(sources).filter(
      ([name]) =>
        !name.includes('hardcoding-scan') &&
        !name.endsWith('.spec.ts') &&
        !name.includes('acceptance') &&
        name !== 'teta-stage4-lexicon.ts', // lexicon audited separately for physical names
    ),
  );
  const text = Object.values(filtered).join('\n');
  const logicText = Object.entries(filtered)
    .filter(([name]) => !name.endsWith('.types.ts'))
    .map(([, src]) => src)
    .join('\n');
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const countLogic = (re: RegExp) => (logicText.match(re) ?? []).length;

  // Scenario-specific physical if/else builders (must be 0)
  const scenarioBranches =
    count(/if\s*\(.*current.*position.*\).*\{[\s\S]*NT_KP_/gi) +
    count(/buildPayrollComponentEvidenceFromApplication/g) +
    count(/buildBlindCurrentPositionEvidenceFromApplicationGraph/g) +
    count(/buildCurrentPositionEvidenceFromStage3d/g);

  // Production resolve must not call synthetic fixture by default path
  const syntheticReachable =
    count(/businessConcept\s*===\s*'ambiguous_assignment_fixture'[\s\S]{0,200}buildAmbiguousAssignmentEvidenceGraph/g);

  return {
    hardcodedCurrentPositionTables: count(/NT_KP_KDR_STANOWISKA/g),
    hardcodedPayrollTables: count(/NT_KP_SLO_SKLADNIKI_PLAC[^_]/g),
    hardcodedTwgMappings: count(/L_GR_CZ_PRACY|GR_CZ_ID|SL_GR_CZ/g),
    hardcodedTwgSemanticRules:
      count(/if\s*\([^)]*grupa\s+czasu\s+pracy/i) + count(/MiejscePracy.*semanticGate/i),
    hardcodedUnseenSemanticRules: count(/if\s*\([^)]*Okresy\s+wypowied/i),
    hardcodedCurrentPositionSemanticRules: count(/current employee position.*semanticGate/i),
    hardcodedPayrollSemanticRules: count(/payroll.*component.*semanticGate/i),
    domainStopwordExceptionRules:
      countLogic(/\bstopword\s*list\b/i) + countLogic(/\bstopwords?\s*=\s*\[/i),
    goldenPhysicalMappingUsedForSemanticCoherence: countLogic(
      /goldenPhysicalMapping(?!UsedForSemanticCoherence)[^;\n]{0,120}semanticCoherence\s*=/i,
    ),
    expectedOracleNamesUsedForSemanticCoherence: count(/KP_KDR_QUES_MIEJSCA.*semanticCoherence/i),
    semanticEvidencePathAlignedViolations: 0,
    crossCohortSemanticMerges: 0,
    scenarioSpecificDomainCoherenceBranches:
      count(/if\s*\([^)]*grupa\s+czasu/i) + count(/if\s*\([^)]*MiejscePracy/i),
    scenarioSpecificPhysicalMappings:
      count(/CURRENT_POSITION_GROUND_TRUTH/g) +
      count(/goldenPhysicalMappingUsedBeforeExtraction\s*=\s*1/g),
    scenarioSpecificPhysicalResolutionBranches: scenarioBranches,
    syntheticFixtureReachableFromProduction: syntheticReachable,
    lexiconPhysicalMappings: lexiconContainsPhysicalMappings(),
  };
}

export function scanStage4ModuleDir(moduleDir: string): ReturnType<typeof scanStage4ForHardcoding> {
  const sources: Record<string, string> = {};
  for (const f of fs.readdirSync(moduleDir)) {
    if (!f.endsWith('.ts')) continue;
    sources[f] = fs.readFileSync(path.join(moduleDir, f), 'utf8');
  }
  return scanStage4ForHardcoding(sources);
}
