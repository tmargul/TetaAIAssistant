/**
 * Stage 3J — payroll component explanation orchestrator.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { parsePayrollFormula } from '../teta-payroll-snapshots/teta-payroll-formula-parser';
import { TetaPayrollSnapshotRepository } from '../teta-payroll-snapshots/teta-payroll-snapshot-repository';
import { analyzeComponentImpact } from './teta-payroll-component-impact.service';
import {
  buildPayrollComponentRequest,
  detectPayrollExplanationFocus,
  detectPayrollExplanationIntent,
  detectUnsupportedPayrollIntent,
  isStage3jSupportedIntent,
} from './teta-payroll-component-explanation-planner';
import { traverseDependencies } from './teta-payroll-component-graph.service';
import {
  buildCapabilityNotAvailableExplanation,
  formatExplanationAsPlainText,
} from './teta-payroll-component-response-mapper';
import { resolvePayrollComponent } from './teta-payroll-component-resolver';
import { searchPayrollComponents } from './teta-payroll-component-selector';
import {
  buildFingerprintFromExplanation,
  computeExplanationFingerprint,
} from './teta-payroll-explanation-contract';
import type {
  PayrollExplanationDiagnostic,
  PayrollExplanationFocus,
  PayrollExplanationRequest,
  TetaPayrollComponentExplanation,
} from './teta-payroll-explanation.types';
import {
  STAGE3J_DEFAULT_DEPTH,
  STAGE3J_EXPLANATION_CONTRACT_VERSION,
  STAGE3J_MAX_DEPTH,
} from './teta-payroll-explanation.types';
import { explainPayrollFormula, summarizeFormulaSteps } from './teta-payroll-formula-explainer';
import {
  loadPayrollSemanticsCatalog,
  lookupComponentTypeMeaning,
  lookupCorrectionModeMeaning,
  lookupRelationTypeMeaning,
} from './teta-payroll-semantics-catalog';

@Injectable()
export class TetaPayrollComponentExplanationService {
  constructor(private readonly repository: TetaPayrollSnapshotRepository) {}

  explain(request: PayrollExplanationRequest): TetaPayrollComponentExplanation {
    const query = request.query?.trim() ?? '';
    const intent = request.intent ?? (query ? detectPayrollExplanationIntent(query) : null);
    const unsupported = query ? detectUnsupportedPayrollIntent(query) : null;
    if (unsupported || (intent && !isStage3jSupportedIntent(intent as never))) {
      return buildCapabilityNotAvailableExplanation(query);
    }

    const focus =
      request.focus ??
      (query ? detectPayrollExplanationFocus(query) : ('full' as PayrollExplanationFocus));
    const depth = Math.min(
      Math.max(1, request.depth ?? STAGE3J_DEFAULT_DEPTH),
      STAGE3J_MAX_DEPTH,
    );
    const scopeId = this.repository.getOrCreateInstallationScopeId();
    const rawSelector = request.code ?? request.title ?? query;
    const { active, selection } = resolvePayrollComponent({
      repository: this.repository,
      installationScopeId: scopeId,
      rawSelector,
      exactCode: request.code ?? null,
    });

    const catalog = loadPayrollSemanticsCatalog();
    const explanationId = randomUUID();

    if (!active) {
      return this.snapshotRequired(explanationId, focus, depth, catalog.catalogVersion);
    }

    if (selection.ambiguous && selection.candidates.length) {
      return this.ambiguousComponent(
        explanationId,
        focus,
        depth,
        active,
        catalog,
        selection.candidates,
      );
    }

    if (!selection.resolved) {
      const reportDate = active.source.reportGeneratedAt;
      return this.componentNotFound(explanationId, focus, depth, active, catalog, rawSelector, reportDate);
    }

    return this.buildExplanation({
      explanationId,
      snapshot: active,
      code: selection.resolved.code,
      focus,
      depth,
      catalogSha256: catalog.catalogSha256,
      catalogVersion: catalog.catalogVersion,
      intent: intent ?? detectPayrollExplanationIntent(query || selection.resolved.code),
    });
  }

  searchComponents(query: string) {
    const scopeId = this.repository.getOrCreateInstallationScopeId();
    const active = this.repository.getActive(scopeId);
    if (!active) return { status: 'snapshot_required' as const, candidates: [] };
    const all = this.repository.listComponentSummaries(active.snapshotId);
    return {
      status: 'ok' as const,
      candidates: searchPayrollComponents(all, query),
    };
  }

  formatText(explanation: TetaPayrollComponentExplanation): string {
    return formatExplanationAsPlainText(explanation);
  }

  private buildExplanation(input: {
    explanationId: string;
    snapshot: NonNullable<ReturnType<TetaPayrollSnapshotRepository['getActive']>>;
    code: string;
    focus: PayrollExplanationFocus;
    depth: number;
    catalogSha256: string;
    catalogVersion: string;
    intent: string;
  }): TetaPayrollComponentExplanation {
    const catalog = loadPayrollSemanticsCatalog();
    const component = this.repository.getComponent(input.snapshot.snapshotId, input.code);
    if (!component) {
      return this.componentNotFound(
        input.explanationId,
        input.focus,
        input.depth,
        input.snapshot,
        catalog,
        input.code,
        input.snapshot.source.reportGeneratedAt,
      );
    }

    const allDeps = this.repository.listAllDependencies(input.snapshot.snapshotId);
    const directDepRows = this.repository.listDirectDependencies(
      input.snapshot.snapshotId,
      input.code,
    );
    const summaries = this.repository.listComponentSummaries(input.snapshot.snapshotId);
    const titleByCode = new Map(summaries.map((s) => [s.code, s.title]));
    const knownCodes = new Set(summaries.map((s) => s.code));

    const graph = traverseDependencies({
      dependencies: allDeps,
      rootCode: input.code,
      maxDepth: input.depth,
      titleByCode,
      knownCodes,
    });

    const typeLookup = lookupComponentTypeMeaning(catalog, component.typeCode);
    const correctionLookup = lookupCorrectionModeMeaning(catalog, component.correctionMode);

    const ast = parsePayrollFormula(component.formulaRaw);
    const formulaExplain = explainPayrollFormula({ ast, catalog });

    const direct = directDepRows.map((d) => {
      const semantic = lookupRelationTypeMeaning(d.relationType);
      return {
        componentCode: d.toComponentCode,
        componentTitle: titleByCode.get(d.toComponentCode) ?? null,
        relationType: d.relationType,
        sourceFunction: d.sourceFunction,
        sourceFragment: d.sourceFragment,
        semanticMeaning: semantic,
        confidence: d.confidence,
        componentFound: knownCodes.has(d.toComponentCode),
        provenance: 'graph_exact' as const,
      };
    });

    const sqlCount = this.repository.countSqlFormulas(input.snapshot.snapshotId);
    const calcRefs = this.repository.listCalculationFormulaRefsByComponent(
      input.snapshot.snapshotId,
      input.code,
    );
    const impact = analyzeComponentImpact({
      dependencies: allDeps,
      targetCode: input.code,
      maxDepth: input.depth,
      titleByCode,
      calculationFormulaRefs: calcRefs,
      sqlFormulaCount: sqlCount,
      sqlReferencesIndexed: false,
    });

    const diagnostics: PayrollExplanationDiagnostic[] = [];
    if (graph.missingTargets.length) {
      for (const code of graph.missingTargets) {
        diagnostics.push({
          code: 'missing_dependency_target',
          message: `Wzór odwołuje się do składnika ${code}, którego nie ma w snapshotcie.`,
          severity: 'warning',
          provenance: 'graph_exact',
        });
      }
    }
    if (graph.selfReferences.length) {
      diagnostics.push({
        code: 'self_reference',
        message: `Składnik ${input.code} odwołuje się do samego siebie.`,
        severity: 'warning',
        provenance: 'graph_exact',
      });
    }
    if (graph.cycles.length) {
      diagnostics.push({
        code: 'dependency_cycle',
        message: 'Wykryto cykl w grafie zależności składników.',
        severity: 'warning',
        provenance: 'graph_exact',
      });
    }
    if (graph.truncated) {
      diagnostics.push({
        code: 'graph_truncated',
        message: 'Przegląd zależności został obcięty z powodu limitu głębokości lub liczby węzłów.',
        severity: 'info',
        provenance: 'graph_exact',
      });
    }
    if (ast.status === 'malformed' || ast.status === 'unsupported') {
      diagnostics.push({
        code: 'formula_unparsed',
        message: 'Parser nie rozpoznał w pełni wzoru składnika.',
        severity: 'warning',
        provenance: 'parser_diagnostic',
      });
    }
    for (const fn of formulaExplain.unknownFunctions) {
      diagnostics.push({
        code: 'formula_unknown_function',
        message: `Nieznana funkcja we wzorze: ${fn}.`,
        severity: 'warning',
        provenance: 'unknown',
      });
    }
    if (typeLookup.unknown) {
      diagnostics.push({
        code: 'unknown_component_type',
        message: typeLookup.meaning ?? 'Nieznany typ składnika.',
        severity: 'info',
        provenance: 'unknown',
      });
    }
    if (correctionLookup.unknown) {
      diagnostics.push({
        code: 'unknown_correction_mode',
        message: correctionLookup.meaning ?? 'Nieznany tryb korekty.',
        severity: 'info',
        provenance: 'unknown',
      });
    }
    if (impact.sqlFormulaUses.some((s) => s.status === 'not_indexed')) {
      diagnostics.push({
        code: 'sql_formula_references_not_indexed',
        message:
          'Snapshot zawiera formuły SQL, ale ten rodzaj zależności nie został jeszcze jednoznacznie zindeksowany.',
        severity: 'info',
        provenance: 'parser_diagnostic',
      });
    }
    if (input.snapshot.source.reportGeneratedAt) {
      diagnostics.push({
        code: 'snapshot_date_historical',
        message: `Analiza opiera się na raporcie z dnia ${input.snapshot.source.reportGeneratedAt}. Jeżeli parametryzacja została później zmieniona, załaduj aktualny raport.`,
        severity: 'info',
        provenance: 'snapshot_exact',
      });
    }

    const directCodes = direct.map((d) => d.componentCode);
    const transitiveCodes = graph.transitive.map((t) => t.componentCode);
    const dependencyExplanation = buildDependencyNarrative(
      input.code,
      directCodes,
      transitiveCodes,
      graph.transitive,
    );
    const impactExplanation = buildImpactNarrative(input.code, impact, true);
    const summary = buildSummaryNarrative(input.code, directCodes, transitiveCodes);

    const evidenceSummary = {
      snapshotExactFacts: 3,
      graphExactFacts: direct.length + graph.transitive.length + impact.directDependents.length,
      verifiedSemanticFacts: formulaExplain.steps.filter(
        (s) => s.provenance === 'training_semantics_verified',
      ).length,
      unknownSemanticFacts: formulaExplain.unknownFunctions.length + (typeLookup.unknown ? 1 : 0),
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    };

    let status: TetaPayrollComponentExplanation['status'] = 'completed';
    if (
      evidenceSummary.unknownSemanticFacts > 0 ||
      diagnostics.some((d) => d.severity === 'warning')
    ) {
      status = 'completed_with_warnings';
    }

    const explanation: TetaPayrollComponentExplanation = {
      contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      status,
      explanationId: input.explanationId,
      explanationFingerprintSha256: '',
      request: {
        focus: input.focus,
        requestedDepth: input.depth,
        intent: input.intent,
      },
      source: {
        snapshotId: input.snapshot.snapshotId,
        snapshotFileSha256: input.snapshot.source.fileSha256,
        reportGeneratedAt: input.snapshot.source.reportGeneratedAt,
        kpVersion: input.snapshot.source.kpVersion,
        paVersion: input.snapshot.source.paVersion,
        parserVersion: input.snapshot.parserVersion,
        semanticsCatalogVersion: input.catalogVersion,
      },
      component: {
        code: component.code,
        title: component.title,
        typeCode: component.typeCode,
        typeMeaning: typeLookup.meaning,
        hintId: component.hintId,
        correctionMode: component.correctionMode,
        correctionModeMeaning: correctionLookup.meaning,
        obligatory: component.obligatory,
        civilContract: component.civilContract,
        context: component.contextRaw,
        parameters: component.parameters,
        meaning: component.meaningRaw,
      },
      formula: {
        available: Boolean(component.formulaRaw),
        raw: component.formulaRaw,
        parseStatus: ast.status,
        plainLanguageSteps: formulaExplain.steps,
        references: ast.directComponentCodes,
        unknownCalls: ast.unknownCalls,
        warnings: formulaExplain.warnings,
      },
      dependencies: {
        direct,
        transitive: graph.transitive,
        maximumDepthReached: graph.maximumDepthReached,
        truncated: graph.truncated,
        cycles: graph.cycles,
        missingTargets: graph.missingTargets,
      },
      impact,
      diagnostics,
      evidenceSummary,
      narrative: {
        summary,
        formulaExplanation: summarizeFormulaSteps(formulaExplain.steps),
        dependencyExplanation,
        impactExplanation,
        warnings: diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message),
      },
    };

    explanation.explanationFingerprintSha256 = buildFingerprintFromExplanation(
      explanation,
      input.catalogSha256,
      component.sourceEvidence.recordHash,
    );
    return explanation;
  }

  private snapshotRequired(
    explanationId: string,
    focus: PayrollExplanationFocus,
    depth: number,
    catalogVersion: string,
  ): TetaPayrollComponentExplanation {
    return {
      contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      status: 'snapshot_required',
      explanationId,
      explanationFingerprintSha256: computeExplanationFingerprint({
        contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
        snapshotFileSha256: '',
        componentRecordHash: '',
        componentCode: '',
        focus,
        requestedDepth: depth,
        semanticsCatalogVersion: catalogVersion,
        semanticsCatalogSha256: loadPayrollSemanticsCatalog().catalogSha256,
        directDependencyCodes: [],
        transitiveDependencyCodes: [],
        directDependentCodes: [],
        calculationFormulaReferenceIds: [],
        diagnosticCodes: ['snapshot_required'],
      }),
      request: { focus, requestedDepth: depth },
      source: null,
      component: null,
      formula: emptyFormula(),
      dependencies: emptyDeps(),
      impact: emptyImpact(),
      diagnostics: [
        {
          code: 'snapshot_required',
          message: 'Brak aktywnego raportu parametrów płacowych.',
          severity: 'error',
          provenance: 'snapshot_exact',
        },
      ],
      evidenceSummary: emptyEvidence(),
      narrative: {
        summary:
          'Aby przeanalizować składniki płacowe w Państwa bazie, potrzebuję systemowego raportu parametrów płacowych.',
        formulaExplanation: '',
        dependencyExplanation: '',
        impactExplanation: '',
        warnings: [],
      },
    };
  }

  private componentNotFound(
    explanationId: string,
    focus: PayrollExplanationFocus,
    depth: number,
    snapshot: NonNullable<ReturnType<TetaPayrollSnapshotRepository['getActive']>>,
    catalog: ReturnType<typeof loadPayrollSemanticsCatalog>,
    selector: string,
    reportDate: string | null,
  ): TetaPayrollComponentExplanation {
    const dateLabel = reportDate ?? 'nieznana';
    return {
      contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      status: 'component_not_found',
      explanationId,
      explanationFingerprintSha256: computeExplanationFingerprint({
        contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
        snapshotFileSha256: snapshot.source.fileSha256,
        componentRecordHash: '',
        componentCode: selector,
        focus,
        requestedDepth: depth,
        semanticsCatalogVersion: catalog.catalogVersion,
        semanticsCatalogSha256: catalog.catalogSha256,
        directDependencyCodes: [],
        transitiveDependencyCodes: [],
        directDependentCodes: [],
        calculationFormulaReferenceIds: [],
        diagnosticCodes: ['component_not_found'],
      }),
      request: { focus, requestedDepth: depth },
      source: {
        snapshotId: snapshot.snapshotId,
        snapshotFileSha256: snapshot.source.fileSha256,
        reportGeneratedAt: reportDate,
        kpVersion: snapshot.source.kpVersion,
        paVersion: snapshot.source.paVersion,
        parserVersion: snapshot.parserVersion,
        semanticsCatalogVersion: catalog.catalogVersion,
      },
      component: null,
      formula: emptyFormula(),
      dependencies: emptyDeps(),
      impact: emptyImpact(),
      diagnostics: [],
      evidenceSummary: emptyEvidence(),
      narrative: {
        summary: `Składnik nie występuje w aktualnie załadowanym raporcie parametrów płacowych. Raport wygenerowano dnia ${dateLabel}. Jeżeli składnik został dodany później, załaduj aktualny raport.`,
        formulaExplanation: '',
        dependencyExplanation: '',
        impactExplanation: '',
        warnings: [],
      },
    };
  }

  private ambiguousComponent(
    explanationId: string,
    focus: PayrollExplanationFocus,
    depth: number,
    snapshot: NonNullable<ReturnType<TetaPayrollSnapshotRepository['getActive']>>,
    catalog: ReturnType<typeof loadPayrollSemanticsCatalog>,
    candidates: Array<{ code: string; title: string | null; typeCode: string | null }>,
  ): TetaPayrollComponentExplanation {
    return {
      contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      status: 'ambiguous_component',
      explanationId,
      explanationFingerprintSha256: computeExplanationFingerprint({
        contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
        snapshotFileSha256: snapshot.source.fileSha256,
        componentRecordHash: '',
        componentCode: '',
        focus,
        requestedDepth: depth,
        semanticsCatalogVersion: catalog.catalogVersion,
        semanticsCatalogSha256: catalog.catalogSha256,
        directDependencyCodes: [],
        transitiveDependencyCodes: [],
        directDependentCodes: [],
        calculationFormulaReferenceIds: [],
        diagnosticCodes: ['ambiguous_component'],
      }),
      request: { focus, requestedDepth: depth },
      source: {
        snapshotId: snapshot.snapshotId,
        snapshotFileSha256: snapshot.source.fileSha256,
        reportGeneratedAt: snapshot.source.reportGeneratedAt,
        kpVersion: snapshot.source.kpVersion,
        paVersion: snapshot.source.paVersion,
        parserVersion: snapshot.parserVersion,
        semanticsCatalogVersion: catalog.catalogVersion,
      },
      component: null,
      candidates,
      formula: emptyFormula(),
      dependencies: emptyDeps(),
      impact: emptyImpact(),
      diagnostics: [],
      evidenceSummary: emptyEvidence(),
      narrative: {
        summary: `Znaleziono ${candidates.length} składników pasujących do nazwy. Wybierz kod składnika, aby kontynuować analizę.`,
        formulaExplanation: '',
        dependencyExplanation: '',
        impactExplanation: '',
        warnings: [],
      },
    };
  }
}

function emptyFormula(): TetaPayrollComponentExplanation['formula'] {
  return {
    available: false,
    raw: null,
    parseStatus: 'unsupported',
    plainLanguageSteps: [],
    references: [],
    unknownCalls: [],
    warnings: [],
  };
}

function emptyDeps(): TetaPayrollComponentExplanation['dependencies'] {
  return {
    direct: [],
    transitive: [],
    maximumDepthReached: 0,
    truncated: false,
    cycles: [],
    missingTargets: [],
  };
}

function emptyImpact(): TetaPayrollComponentExplanation['impact'] {
  return {
    directDependents: [],
    transitiveDependents: [],
    calculationFormulaUses: [],
    sqlFormulaUses: [],
    maximumDepthReached: 0,
    truncated: false,
  };
}

function emptyEvidence(): TetaPayrollComponentExplanation['evidenceSummary'] {
  return {
    snapshotExactFacts: 0,
    graphExactFacts: 0,
    verifiedSemanticFacts: 0,
    unknownSemanticFacts: 0,
    warnings: 0,
  };
}

function buildSummaryNarrative(
  code: string,
  direct: string[],
  transitive: string[],
): string {
  if (!direct.length && !transitive.length) {
    return `Składnik ${code} nie ma zarejestrowanych zależności od innych składników w aktywnym snapshotcie.`;
  }
  const directPart = direct.length
    ? `zależy bezpośrednio od składników ${direct.join(', ')}`
    : 'nie ma bezpośrednich zależności';
  const via = transitive.length ? `. Przez łańcuch zależności obejmuje także: ${transitive.join(', ')}` : '';
  return `Składnik ${code} ${directPart}${via}.`;
}

function buildDependencyNarrative(
  code: string,
  direct: string[],
  transitive: string[],
  transitiveDetails: Array<{ componentCode: string; minimumDepth: number; paths: string[][] }>,
): string {
  const parts: string[] = [];
  if (direct.length) {
    parts.push(`Składnik ${code} zależy bezpośrednio od: ${direct.join(', ')}.`);
  } else {
    parts.push(`Składnik ${code} nie ma bezpośrednich zależności w snapshotcie.`);
  }
  if (transitive.length) {
    parts.push(`Zależności pośrednie obejmują: ${transitive.join(', ')}.`);
    for (const t of transitiveDetails.slice(0, 5)) {
      const path = t.paths[0]?.join(' → ');
      if (path) parts.push(`Ścieżka do ${t.componentCode}: ${path}.`);
    }
  }
  return parts.join(' ');
}

function buildImpactNarrative(
  code: string,
  impact: TetaPayrollComponentExplanation['impact'],
  sqlNotIndexed: boolean,
): string {
  const parts: string[] = [];
  if (impact.directDependents.length) {
    const deps = impact.directDependents.map((d) => d.componentCode).join(', ');
    parts.push(`Składnik ${code} jest bezpośrednio używany przez: ${deps}.`);
    for (const d of impact.directDependents) {
      parts.push(
        `Zmiana składnika ${code} może wpłynąć na składnik ${d.componentCode}, ponieważ jego wzór zawiera bezpośrednie odwołanie do ${code}.`,
      );
    }
  } else {
    parts.push(
      `W aktywnym snapshotcie nie znaleziono innych składników, które bezpośrednio odwołują się do składnika ${code}.`,
    );
  }
  if (impact.transitiveDependents.length) {
    parts.push(
      `Pośrednio zależą także: ${impact.transitiveDependents.map((d) => d.componentCode).join(', ')}.`,
    );
  }
  if (impact.calculationFormulaUses.length) {
    parts.push(
      `Składnik jest także wykorzystywany w ${impact.calculationFormulaUses.length} formułach kalkulacyjnych.`,
    );
  }
  if (sqlNotIndexed) {
    parts.push(
      'Nie oznacza to, że składnik nie występuje w niezindeksowanych formułach SQL.',
    );
  }
  return parts.join(' ');
}

export { buildPayrollComponentRequest };
