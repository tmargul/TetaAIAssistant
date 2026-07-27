/**
 * Stage 3I — import pipeline (validate → parse → transactional persist).
 * Never executes formulas/SQL. Never writes Oracle.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { detectPayrollParametersReport } from './teta-payroll-report-detector';
import {
  countGenericRecords,
  parseComponentRows,
  parseReportSections,
} from './teta-payroll-report-section-parser';
import {
  annotateMissingCalculationTargets,
  parseCalculationFormulaRows,
} from './teta-payroll-calculation-formula-parser';
import { extractComponentDependencies } from './teta-payroll-dependency-extractor';
import { TetaPayrollRtfTextExtractor } from './teta-payroll-rtf-text-extractor';
import { TetaPayrollSnapshotRepository } from './teta-payroll-snapshot-repository';
import {
  STAGE3I_PARSER_VERSION,
  STAGE3I_SNAPSHOT_CONTRACT_VERSION,
  STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
  STAGE3I_SOURCE_TYPE,
  type TetaPayrollParameterSnapshot,
} from './teta-payroll-snapshot.types';

export type PayrollImportResult =
  | {
      status: 'imported' | 'already_imported' | 'older_report_requires_activation';
      snapshot: TetaPayrollParameterSnapshot;
      detectionStatus: string;
      diagnostics: Record<string, unknown>;
    }
  | {
      status: 'rejected';
      detectionStatus: string;
      errors: string[];
      diagnostics: Record<string, unknown>;
    };

@Injectable()
export class TetaPayrollSnapshotImportService {
  private readonly logger = new Logger(TetaPayrollSnapshotImportService.name);
  private readonly extractor = new TetaPayrollRtfTextExtractor();

  constructor(private readonly repository: TetaPayrollSnapshotRepository) {}

  validateOnly(buffer: Buffer, fileName: string): PayrollImportResult {
    return this.runPipeline(buffer, fileName, {
      persist: false,
      sourceScope: 'customer_installation',
    });
  }

  importBuffer(
    buffer: Buffer,
    fileName: string,
    options?: {
      sourceScope?: 'customer_installation' | typeof STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE;
    },
  ): PayrollImportResult {
    return this.runPipeline(buffer, fileName, {
      persist: true,
      sourceScope: options?.sourceScope ?? 'customer_installation',
    });
  }

  private runPipeline(
    buffer: Buffer,
    fileName: string,
    options: {
      persist: boolean;
      sourceScope: 'customer_installation' | typeof STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE;
    },
  ): PayrollImportResult {
    const ext = fileName.toLowerCase().endsWith('.rtf') ? '.rtf' : '';
    if (ext !== '.rtf') {
      return {
        status: 'rejected',
        detectionStatus: 'unsupported_rtf_report',
        errors: ['invalid_extension'],
        diagnostics: { invalidExtensions: 1 },
      };
    }

    const fileSha256 = createHash('sha256').update(buffer).digest('hex');
    const installationScopeId = this.repository.getOrCreateInstallationScopeId();

    if (options.persist) {
      const existing = this.repository.findByScopeAndSha(installationScopeId, fileSha256);
      if (existing) {
        this.logger.log(
          `payroll snapshot already_imported snapshotId=${existing.snapshotId} sha=${fileSha256.slice(0, 12)}`,
        );
        return {
          status: 'already_imported',
          snapshot: existing,
          detectionStatus: 'valid_payroll_parameters_report',
          diagnostics: { importsAlreadyPresent: 1 },
        };
      }
    }

    const extracted = this.extractor.extractFromBuffer(buffer);
    if (!extracted.ok) {
      return {
        status: 'rejected',
        detectionStatus: extracted.code === 'parse_timeout' ? 'rejected_by_limits' : extracted.code,
        errors: [extracted.code],
        diagnostics: { extractError: extracted.code },
      };
    }

    const detection = detectPayrollParametersReport(extracted.text);
    if (detection.status !== 'valid_payroll_parameters_report') {
      return {
        status: 'rejected',
        detectionStatus: detection.status,
        errors: detection.reasons,
        diagnostics: {
          optionalSectionsFound: detection.optionalSectionsFound.length,
        },
      };
    }

    const sectionParse = parseReportSections(extracted.text);
    if (sectionParse.truncated) {
      return {
        status: 'rejected',
        detectionStatus: 'rejected_by_limits',
        errors: ['too_many_sections'],
        diagnostics: {},
      };
    }

    const reconciliation = sectionParse.inventory.reconciliation;
    const snapshotId = randomUUID();
    const componentSection = sectionParse.sections.find((s) => s.summary.kind === 'components');
    const contextSection = sectionParse.sections.find(
      (s) => s.summary.kind === 'context_components',
    );
    const sqlSection = sectionParse.sections.find((s) => s.summary.kind === 'sql_formulas');
    const calcSection = sectionParse.sections.find(
      (s) => s.summary.kind === 'calculation_formulas',
    );

    const parsedComponents = componentSection
      ? parseComponentRows(componentSection, snapshotId)
      : { components: [], unparsed: 0, duplicateCodes: [], duplicateInternalIds: [] };

    if (contextSection) countGenericRecords(contextSection);
    if (sqlSection) countGenericRecords(sqlSection);
    for (const section of sectionParse.sections) {
      if (
        section.summary.kind === 'recognized_generic' ||
        section.summary.kind === 'unknown_section'
      ) {
        countGenericRecords(section);
      }
    }

    const calcParsed = calcSection
      ? parseCalculationFormulaRows(calcSection, snapshotId)
      : {
          formulas: [],
          unparsed: 0,
          parseFailures: 0,
          componentReferences: [],
          missingComponentTargets: [],
          unknownCalls: [],
        };

    const knownCodes = new Set(parsedComponents.components.map((c) => c.code));
    const calcMissing = annotateMissingCalculationTargets(
      calcParsed.componentReferences,
      knownCodes,
    );

    const deps = extractComponentDependencies(snapshotId, parsedComponents.components);
    const warnings: string[] = [];
    if (deps.cycles.length) warnings.push(`cycles_detected:${deps.cycles.length}`);
    if (deps.missingTargets.length) warnings.push(`missing_targets:${deps.missingTargets.length}`);
    if (parsedComponents.duplicateCodes.length) {
      warnings.push(`duplicate_codes:${parsedComponents.duplicateCodes.length}`);
    }
    if (reconciliation.missingBodySections.length) {
      warnings.push(`missing_body_sections:${reconciliation.missingBodySections.length}`);
    }
    if (calcMissing.length) {
      warnings.push(`calculation_formula_missing_targets:${calcMissing.length}`);
    }

    const errors: string[] = [];
    if (reconciliation.missingCoreBodySections.length) {
      errors.push(
        `missing_core_body_sections:${reconciliation.missingCoreBodySections.join(',')}`,
      );
    }

    const summary = {
      componentCount: parsedComponents.components.length,
      componentFormulaCount: parsedComponents.components.filter((c) => Boolean(c.formulaRaw)).length,
      directDependencyCount: deps.dependencies.length,
      sqlFormulaCount: sqlSection?.summary.recordCount ?? 0,
      calculationFormulaCount: calcParsed.formulas.length,
      calculationFormulaComponentReferences: calcParsed.componentReferences.length,
      contextRecordCount: contextSection?.summary.recordCount ?? 0,
      unparsedRecordCount: parsedComponents.unparsed + calcParsed.unparsed,
      warningCount: warnings.length,
      sectionCount: reconciliation.totalSectionsDetected,
      totalSectionsDetected: reconciliation.totalSectionsDetected,
      coreSectionsNormalized: reconciliation.coreSectionsNormalized,
      genericSectionsPreserved: reconciliation.genericSectionsPreserved,
      unknownSectionsPreserved: reconciliation.unknownSectionsPreserved,
      tocSectionCount: reconciliation.tocSectionCount,
      bodySectionCount: reconciliation.bodySectionCount,
      matchedSectionCount: reconciliation.matchedSectionCount,
    };

    const importedAt = new Date().toISOString();
    const active = this.repository.getActive(installationScopeId);
    let activate = errors.length === 0;
    let status: TetaPayrollParameterSnapshot['status'] = activate ? 'active' : 'rejected';
    let importStatus: 'imported' | 'older_report_requires_activation' = 'imported';

    if (errors.length) {
      activate = false;
      status = 'rejected';
    } else if (!detection.reportGeneratedAt) {
      activate = false;
      status = 'inactive';
      importStatus = 'older_report_requires_activation';
    } else if (active?.source.reportGeneratedAt) {
      if (detection.reportGeneratedAt < active.source.reportGeneratedAt) {
        activate = false;
        status = 'inactive';
        importStatus = 'older_report_requires_activation';
      }
    }

    if (errors.length && options.persist) {
      return {
        status: 'rejected',
        detectionStatus: 'incomplete_payroll_parameters_report',
        errors,
        diagnostics: {
          reconciliation,
          calculationFormulaSectionDetected: Boolean(calcSection),
        },
      };
    }

    const snapshot: TetaPayrollParameterSnapshot = {
      contractVersion: STAGE3I_SNAPSHOT_CONTRACT_VERSION,
      snapshotId,
      parserVersion: STAGE3I_PARSER_VERSION,
      installationScopeId,
      status,
      source: {
        type: STAGE3I_SOURCE_TYPE,
        sourceScope: options.sourceScope,
        fileName,
        fileSha256,
        fileSizeBytes: buffer.byteLength,
        reportGeneratedAt: detection.reportGeneratedAt,
        importedAt,
        kpVersion: detection.kpVersion,
        paVersion: detection.paVersion,
        companyScope: [],
        reportDateParseStatus: detection.reportDateParseStatus,
        reportDateSourceEvidence: detection.reportDateSourceEvidence,
      },
      sections: sectionParse.sections.map((s) => s.summary),
      summary,
      validation: {
        ok: errors.length === 0,
        errors,
        warnings,
      },
    };

    const diagnostics = {
      detectionStatus: detection.status,
      reportDateParseStatus: detection.reportDateParseStatus,
      kpVersion: detection.kpVersion,
      paVersion: detection.paVersion,
      reconciliation,
      calculationFormulaSectionDetected: Boolean(calcSection),
      calculationFormulaSectionNormalized: Boolean(
        calcSection?.summary.canonicalId === 'calculation_formulas',
      ),
      calculationFormulaRecordsParsed: calcParsed.formulas.length,
      calculationFormulaParseFailures: calcParsed.parseFailures,
      calculationFormulaComponentReferences: calcParsed.componentReferences.length,
      calculationFormulaMissingComponentTargets: calcMissing.length,
      calculationFormulaUnknownCalls: calcParsed.unknownCalls.length,
      cyclesDetected: deps.cycles.length,
      missingTargets: deps.missingTargets.length,
      selfReferences: deps.selfReferences.length,
      forwardReferences: deps.forwardReferences.length,
      duplicateCodes: parsedComponents.duplicateCodes.length,
      duplicateInternalIds: parsedComponents.duplicateInternalIds.length,
      extractElapsedMs: extracted.elapsedMs,
      formulasExecuted: 0,
      sqlFormulasExecuted: 0,
    };

    if (!options.persist) {
      return {
        status: importStatus,
        snapshot,
        detectionStatus: detection.status,
        diagnostics,
      };
    }

    try {
      this.repository.insertSnapshotTransaction({
        snapshot,
        sections: sectionParse.sections.map((s) => s.summary),
        components: parsedComponents.components,
        dependencies: deps.dependencies,
        calculationFormulas: calcParsed.formulas,
        calculationFormulaRefs: calcParsed.componentReferences,
        diagnosticsJson: JSON.stringify(diagnostics),
        activate,
      });
      snapshot.status = activate ? 'active' : status;
      this.logger.log(
        `payroll snapshot ${importStatus} snapshotId=${snapshotId} components=${summary.componentCount} deps=${summary.directDependencyCount} calc=${summary.calculationFormulaCount} sections=${summary.sectionCount}`,
      );
      return {
        status: importStatus,
        snapshot,
        detectionStatus: detection.status,
        diagnostics,
      };
    } catch (error) {
      this.logger.warn(
        `payroll snapshot import rolled back code=${error instanceof Error ? error.message : 'error'}`,
      );
      return {
        status: 'rejected',
        detectionStatus: 'malformed_rtf',
        errors: ['persist_failed'],
        diagnostics: { transactionsRolledBack: 1 },
      };
    }
  }
}
