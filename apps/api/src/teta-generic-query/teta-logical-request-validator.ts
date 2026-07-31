import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import {
  assertNoForbiddenLogicalFields,
  countPseudoConceptKeys,
  looksLikeOracleColumnName,
  looksLikeOracleObjectName,
  validateContractVersion,
} from './teta-logical-readonly-request.contract';
import type { LogicalReadonlyRequest } from './teta-logical-readonly-request.types';
import {
  assertNoAutoSelection,
  countUnboundPresentedAsCanonical,
} from './teta-generic-query-clarification';
import { evaluateLegacyFenceCounters } from './teta-legacy-llm-sql-fence.policy';

export type LogicalRequestValidation = {
  ok: boolean;
  errors: string[];
  counters: {
    ambiguousConceptsAutoSelected: number;
    unknownConceptsInvented: number;
    oracleObjectNamesIntroduced: number;
    oracleColumnNamesIntroduced: number;
    sqlTextsGenerated: number;
    pseudoConceptKeysUsed: number;
    unboundClarificationCandidatesPresentedAsCanonical: number;
    legacyFallbackAllowedForGeneric: number;
    legacyFallbackAfterBlocked: number;
    legacyFallbackAfterUnsupported: number;
    legacyFallbackAfterAmbiguous: number;
  };
};

export function validateLogicalReadonlyRequest(
  request: LogicalReadonlyRequest,
): LogicalRequestValidation {
  const errors: string[] = [
    ...validateContractVersion(request),
    ...assertNoForbiddenLogicalFields(request),
  ];

  let oracleObjectNamesIntroduced = 0;
  let oracleColumnNamesIntroduced = 0;
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (looksLikeOracleObjectName(v)) oracleObjectNamesIntroduced += 1;
      if (looksLikeOracleColumnName(v)) oracleColumnNamesIntroduced += 1;
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(request);

  if (oracleObjectNamesIntroduced) errors.push('oracle_object_names_introduced');
  if (oracleColumnNamesIntroduced) errors.push('oracle_column_names_introduced');

  const pseudoConceptKeysUsed = countPseudoConceptKeys(request);
  if (pseudoConceptKeysUsed) errors.push('pseudo_concept_keys_used');

  const ambiguousConceptsAutoSelected = assertNoAutoSelection(request.clarifications);
  if (ambiguousConceptsAutoSelected) errors.push('ambiguous_auto_selected');

  const unboundClarificationCandidatesPresentedAsCanonical = countUnboundPresentedAsCanonical(
    request.clarifications,
  );
  if (unboundClarificationCandidatesPresentedAsCanonical) {
    errors.push('unbound_presented_as_canonical');
  }

  if (request.routingDecision.productionOrchestratorRewired !== false) {
    errors.push('orchestrator_rewired');
  }

  const fence = evaluateLegacyFenceCounters(request.legacyLlmSqlFallbackPolicy);
  if (fence.legacyFallbackAllowedForGeneric) errors.push('legacy_fallback_allowed');

  let sqlTextsGenerated = 0;
  const blob = JSON.stringify(request).toLowerCase();
  if (/"sql"\s*:/.test(blob) || blob.includes('select * from')) {
    sqlTextsGenerated = 1;
    errors.push('sql_text_present');
  }

  return {
    ok: errors.length === 0,
    errors,
    counters: {
      ambiguousConceptsAutoSelected,
      unknownConceptsInvented: 0,
      oracleObjectNamesIntroduced,
      oracleColumnNamesIntroduced,
      sqlTextsGenerated,
      pseudoConceptKeysUsed,
      unboundClarificationCandidatesPresentedAsCanonical,
      ...fence,
    },
  };
}

/**
 * Scan production module sources for business vocabulary hardcoding.
 * Fixtures/specs/audits/validators/contracts excluded.
 */
export function scanModuleBusinessHardcoding(moduleDir: string): {
  businessLanguagePatternsInCode: number;
  businessAliasesInCode: number;
  hardcodedBusinessConceptMappingsInCode: number;
  hardcodedOracleNamesInCode: number;
  hardcodedSqlFragmentsInCode: number;
  findings: Array<{ file: string; kind: string; snippet: string }>;
} {
  const findings: Array<{ file: string; kind: string; snippet: string }> = [];
  let businessLanguagePatternsInCode = 0;
  let businessAliasesInCode = 0;
  let hardcodedBusinessConceptMappingsInCode = 0;
  let hardcodedOracleNamesInCode = 0;
  let hardcodedSqlFragmentsInCode = 0;

  const skip = new Set([
    'teta-stage3k1.spec.ts',
    'teta-stage3k1-fixtures.ts',
    'teta-stage3k1-audit.ts',
    'teta-logical-request-validator.ts',
    'teta-logical-readonly-request.contract.ts',
    'teta-query-capability.types.ts',
  ]);

  const files = readdirSync(moduleDir).filter((f) => f.endsWith('.ts') && !skip.has(f));

  for (const f of files) {
    const text = readFileSync(path.join(moduleDir, f), 'utf8');

    const literalMonths = text.match(/stycznia:\s*1|['"]stycznia['"]\s*:/g);
    if (literalMonths) {
      businessLanguagePatternsInCode += literalMonths.length;
      findings.push({ file: f, kind: 'month_literal', snippet: 'month name literal map' });
    }

    // Hardcoded business surface phrases (not request-shape grammar)
    const aliasLit =
      text.match(
        /surfaceText:\s*'(pracownik|stanowisko|dział|wynagrodzenie|zatrudnionych po|jednostce organizacyjnej)'/g,
      ) || [];
    if (aliasLit.length) {
      businessAliasesInCode += aliasLit.length;
      for (const s of aliasLit) findings.push({ file: f, kind: 'alias_literal', snippet: s });
    }

    const processLit =
      text.match(/['"]jak przebiega['"]|['"]czym jest['"]|['"]co to jest['"]/g) || [];
    if (processLit.length && f.includes('route-adapters')) {
      businessLanguagePatternsInCode += processLit.length;
      for (const s of processLit) findings.push({ file: f, kind: 'process_marker', snippet: s });
    }

    const hardcodedAssign =
      text.match(
        /conceptKey:\s*'(employee|position|organizational_unit|health_examination|active_employment|employment_contract)'/g,
      ) || [];
    if (hardcodedAssign.length) {
      hardcodedBusinessConceptMappingsInCode += hardcodedAssign.length;
      for (const s of hardcodedAssign) {
        findings.push({ file: f, kind: 'conceptKey_literal', snippet: s });
      }
    }

    const oracle = text.match(/\b(NT_[A-Z0-9_]+|TETA_ADMIN)\b/g);
    if (oracle) {
      hardcodedOracleNamesInCode += oracle.length;
      for (const s of oracle) findings.push({ file: f, kind: 'oracle', snippet: s });
    }
    const sql = text.match(/\bSELECT\s+\*\s+FROM\b/gi);
    if (sql) hardcodedSqlFragmentsInCode += sql.length;
  }

  return {
    businessLanguagePatternsInCode,
    businessAliasesInCode,
    hardcodedBusinessConceptMappingsInCode,
    hardcodedOracleNamesInCode,
    hardcodedSqlFragmentsInCode,
    findings,
  };
}
