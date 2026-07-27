/**
 * Stage 3I — SQLite persistence for payroll parameter snapshots.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import type {
  PayrollSnapshotStatus,
  TetaPayrollCalculationFormulaComponentReference,
  TetaPayrollCalculationFormulaDefinition,
  TetaPayrollComponentDefinition,
  TetaPayrollComponentDependency,
  TetaPayrollParameterSnapshot,
  TetaPayrollSectionSummary,
} from './teta-payroll-snapshot.types';

const SCOPE_KEY = 'payroll.installation_scope_id';

@Injectable()
export class TetaPayrollSnapshotRepository {
  constructor(private readonly db: DatabaseService) {}

  getOrCreateInstallationScopeId(): string {
    const conn = this.db.connection;
    const row = conn.prepare('SELECT value FROM app_settings WHERE key = ?').get(SCOPE_KEY) as
      | { value: string }
      | undefined;
    if (row?.value) return row.value;
    const id = randomUUID();
    conn
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(SCOPE_KEY, id, new Date().toISOString());
    return id;
  }

  findByScopeAndSha(
    installationScopeId: string,
    fileSha256: string,
  ): TetaPayrollParameterSnapshot | null {
    const row = this.db.connection
      .prepare(
        `SELECT * FROM teta_payroll_parameter_snapshots
         WHERE installation_scope_id = ? AND file_sha256 = ?
         ORDER BY imported_at DESC LIMIT 1`,
      )
      .get(installationScopeId, fileSha256) as Record<string, unknown> | undefined;
    return row ? this.mapSnapshot(row) : null;
  }

  getActive(installationScopeId: string): TetaPayrollParameterSnapshot | null {
    const row = this.db.connection
      .prepare(
        `SELECT * FROM teta_payroll_parameter_snapshots
         WHERE installation_scope_id = ? AND status = 'active'
         ORDER BY imported_at DESC LIMIT 1`,
      )
      .get(installationScopeId) as Record<string, unknown> | undefined;
    return row ? this.mapSnapshot(row) : null;
  }

  listHistory(installationScopeId: string, limit = 50): TetaPayrollParameterSnapshot[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM teta_payroll_parameter_snapshots
         WHERE installation_scope_id = ?
         ORDER BY imported_at DESC LIMIT ?`,
      )
      .all(installationScopeId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapSnapshot(r));
  }

  getComponent(
    snapshotId: string,
    code: string,
  ): TetaPayrollComponentDefinition | null {
    const row = this.db.connection
      .prepare(
        `SELECT * FROM teta_payroll_components WHERE snapshot_id = ? AND code = ? LIMIT 1`,
      )
      .get(snapshotId, code) as Record<string, unknown> | undefined;
    return row ? this.mapComponent(row) : null;
  }

  listDirectDependencies(
    snapshotId: string,
    fromCode: string,
  ): TetaPayrollComponentDependency[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM teta_payroll_component_dependencies
         WHERE snapshot_id = ? AND from_component_code = ?
         ORDER BY to_component_code`,
      )
      .all(snapshotId, fromCode) as Record<string, unknown>[];
    return rows.map((r) => this.mapDependency(r));
  }

  listAllDependencies(snapshotId: string): TetaPayrollComponentDependency[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM teta_payroll_component_dependencies WHERE snapshot_id = ?
         ORDER BY from_component_code, to_component_code`,
      )
      .all(snapshotId) as Record<string, unknown>[];
    return rows.map((r) => this.mapDependency(r));
  }

  /**
   * Transactional insert. On activate=true, supersedes previous active for scope.
   */
  insertSnapshotTransaction(input: {
    snapshot: TetaPayrollParameterSnapshot;
    sections: TetaPayrollSectionSummary[];
    components: TetaPayrollComponentDefinition[];
    dependencies: TetaPayrollComponentDependency[];
    calculationFormulas?: TetaPayrollCalculationFormulaDefinition[];
    calculationFormulaRefs?: TetaPayrollCalculationFormulaComponentReference[];
    diagnosticsJson: string;
    activate: boolean;
  }): void {
    const conn = this.db.connection;
    const tx = conn.transaction(() => {
      if (input.activate) {
        conn
          .prepare(
            `UPDATE teta_payroll_parameter_snapshots
             SET status = 'superseded'
             WHERE installation_scope_id = ? AND status = 'active'`,
          )
          .run(input.snapshot.installationScopeId);
      }

      const status: PayrollSnapshotStatus = input.activate ? 'active' : input.snapshot.status;
      conn
        .prepare(
          `INSERT INTO teta_payroll_parameter_snapshots (
            snapshot_id, contract_version, parser_version, installation_scope_id,
            status, file_name, file_sha256, file_size_bytes,
            report_generated_at, imported_at, kp_version, pa_version,
            company_scope_json, summary_json, validation_json, source_scope
          ) VALUES (
            @snapshot_id, @contract_version, @parser_version, @installation_scope_id,
            @status, @file_name, @file_sha256, @file_size_bytes,
            @report_generated_at, @imported_at, @kp_version, @pa_version,
            @company_scope_json, @summary_json, @validation_json, @source_scope
          )`,
        )
        .run({
          snapshot_id: input.snapshot.snapshotId,
          contract_version: input.snapshot.contractVersion,
          parser_version: input.snapshot.parserVersion,
          installation_scope_id: input.snapshot.installationScopeId,
          status,
          file_name: input.snapshot.source.fileName,
          file_sha256: input.snapshot.source.fileSha256,
          file_size_bytes: input.snapshot.source.fileSizeBytes,
          report_generated_at: input.snapshot.source.reportGeneratedAt,
          imported_at: input.snapshot.source.importedAt,
          kp_version: input.snapshot.source.kpVersion,
          pa_version: input.snapshot.source.paVersion,
          company_scope_json: JSON.stringify([]), // never persist company names in Stage 3I docs; store empty for privacy default
          summary_json: JSON.stringify(input.snapshot.summary),
          validation_json: JSON.stringify(input.snapshot.validation),
          source_scope: input.snapshot.source.sourceScope,
        });

      const insertSection = conn.prepare(
        `INSERT INTO teta_payroll_snapshot_sections (
          snapshot_id, section_id, title, kind, ordinal, record_count
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const section of input.sections) {
        insertSection.run(
          input.snapshot.snapshotId,
          section.sectionId,
          section.title,
          section.kind,
          section.ordinal,
          section.recordCount,
        );
      }

      const insertComponent = conn.prepare(
        `INSERT INTO teta_payroll_components (
          snapshot_id, component_internal_id, code, title, type_code, hint_id,
          formula_raw, correction_mode, meaning_raw, parameters_json,
          section_title, record_ordinal, record_hash
        ) VALUES (
          @snapshot_id, @component_internal_id, @code, @title, @type_code, @hint_id,
          @formula_raw, @correction_mode, @meaning_raw, @parameters_json,
          @section_title, @record_ordinal, @record_hash
        )`,
      );
      for (const c of input.components) {
        insertComponent.run({
          snapshot_id: c.snapshotId,
          component_internal_id: c.componentInternalId,
          code: c.code,
          title: c.title,
          type_code: c.typeCode,
          hint_id: c.hintId,
          formula_raw: c.formulaRaw,
          correction_mode: c.correctionMode,
          meaning_raw: c.meaningRaw,
          parameters_json: JSON.stringify(c.parameters),
          section_title: c.sourceEvidence.section,
          record_ordinal: c.sourceEvidence.recordOrdinal,
          record_hash: c.sourceEvidence.recordHash,
        });
      }

      const insertDep = conn.prepare(
        `INSERT INTO teta_payroll_component_dependencies (
          snapshot_id, from_component_code, to_component_code, relation_type,
          source_function, source_fragment, confidence, section_title, record_ordinal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const d of input.dependencies) {
        insertDep.run(
          d.snapshotId,
          d.fromComponentCode,
          d.toComponentCode,
          d.relationType,
          d.sourceFunction,
          d.sourceFragment,
          d.confidence,
          d.sourceEvidence.section,
          d.sourceEvidence.recordOrdinal,
        );
      }

      const insertCalc = conn.prepare(
        `INSERT INTO teta_payroll_calculation_formulas (
          snapshot_id, formula_id, internal_id, title, formula_type_raw, formula_raw,
          source_label, canonical_id, ordinal, record_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const f of input.calculationFormulas ?? []) {
        insertCalc.run(
          f.snapshotId,
          f.formulaId,
          f.internalId,
          f.title,
          f.formulaTypeRaw,
          f.formulaRaw,
          f.sourceEvidence.sourceLabel,
          f.sourceEvidence.sectionCanonicalId,
          f.sourceEvidence.recordOrdinal,
          f.sourceEvidence.recordHash,
        );
      }

      const insertCalcRef = conn.prepare(
        `INSERT INTO teta_payroll_calculation_formula_component_refs (
          snapshot_id, calculation_formula_id, component_code, source_function, confidence
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const r of input.calculationFormulaRefs ?? []) {
        insertCalcRef.run(
          r.snapshotId,
          r.calculationFormulaId,
          r.componentCode,
          r.sourceFunction,
          r.confidence,
        );
      }

      conn
        .prepare(
          `INSERT INTO teta_payroll_snapshot_diagnostics (snapshot_id, diagnostics_json)
           VALUES (?, ?)`,
        )
        .run(input.snapshot.snapshotId, input.diagnosticsJson);
    });
    tx();
  }

  private mapSnapshot(row: Record<string, unknown>): TetaPayrollParameterSnapshot {
    const sections = this.db.connection
      .prepare(
        `SELECT section_id, title, kind, ordinal, record_count
         FROM teta_payroll_snapshot_sections WHERE snapshot_id = ? ORDER BY ordinal`,
      )
      .all(row.snapshot_id) as Array<{
      section_id: string;
      title: string;
      kind: TetaPayrollSectionSummary['kind'];
      ordinal: number;
      record_count: number;
    }>;

    return {
      contractVersion: row.contract_version as TetaPayrollParameterSnapshot['contractVersion'],
      snapshotId: String(row.snapshot_id),
      parserVersion: row.parser_version as TetaPayrollParameterSnapshot['parserVersion'],
      installationScopeId: String(row.installation_scope_id),
      status: row.status as PayrollSnapshotStatus,
      source: {
        type: 'teta_payroll_parameters_report',
        sourceScope: (row.source_scope as 'customer_example' | 'customer_installation') ??
          'customer_installation',
        fileName: String(row.file_name),
        fileSha256: String(row.file_sha256),
        fileSizeBytes: Number(row.file_size_bytes),
        reportGeneratedAt: (row.report_generated_at as string | null) ?? null,
        importedAt: String(row.imported_at),
        kpVersion: (row.kp_version as string | null) ?? null,
        paVersion: (row.pa_version as string | null) ?? null,
        companyScope: [],
      },
      sections: sections.map((s) => ({
        sectionId: s.section_id,
        title: s.title,
        kind: s.kind,
        ordinal: s.ordinal,
        recordCount: s.record_count,
      })),
      summary: JSON.parse(String(row.summary_json)),
      validation: JSON.parse(String(row.validation_json)),
    };
  }

  private mapComponent(row: Record<string, unknown>): TetaPayrollComponentDefinition {
    return {
      snapshotId: String(row.snapshot_id),
      componentInternalId: (row.component_internal_id as string | null) ?? null,
      code: String(row.code),
      title: (row.title as string | null) ?? null,
      typeCode: (row.type_code as string | null) ?? null,
      hintId: (row.hint_id as string | null) ?? null,
      formulaRaw: (row.formula_raw as string | null) ?? null,
      correctionMode: (row.correction_mode as string | null) ?? null,
      meaningRaw: (row.meaning_raw as string | null) ?? null,
      parameters: JSON.parse(String(row.parameters_json ?? '{}')),
      obligatory: null,
      civilContract: null,
      accountingRaw: null,
      splitByCostCenter: null,
      contextRaw: null,
      creationModificationRaw: null,
      sourceEvidence: {
        section: String(row.section_title),
        recordOrdinal: Number(row.record_ordinal),
        recordHash: String(row.record_hash),
      },
    };
  }

  private mapDependency(row: Record<string, unknown>): TetaPayrollComponentDependency {
    return {
      snapshotId: String(row.snapshot_id),
      fromComponentCode: String(row.from_component_code),
      toComponentCode: String(row.to_component_code),
      relationType: row.relation_type as TetaPayrollComponentDependency['relationType'],
      sourceFunction: (row.source_function as string | null) ?? null,
      sourceFragment: String(row.source_fragment),
      confidence: row.confidence as TetaPayrollComponentDependency['confidence'],
      sourceEvidence: {
        section: String(row.section_title),
        recordOrdinal: Number(row.record_ordinal),
      },
    };
  }
}
