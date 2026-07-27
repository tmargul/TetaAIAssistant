import { Injectable } from '@nestjs/common';
import {
  traceDependencies,
} from './teta-payroll-dependency-extractor';
import { TetaPayrollSnapshotRepository } from './teta-payroll-snapshot-repository';

@Injectable()
export class TetaPayrollSnapshotQueryService {
  constructor(private readonly repository: TetaPayrollSnapshotRepository) {}

  getInstallationScopeId(): string {
    return this.repository.getOrCreateInstallationScopeId();
  }

  getActiveSummary() {
    const scope = this.repository.getOrCreateInstallationScopeId();
    const active = this.repository.getActive(scope);
    if (!active) return null;
    return {
      snapshotId: active.snapshotId,
      status: active.status,
      importedAt: active.source.importedAt,
      reportGeneratedAt: active.source.reportGeneratedAt,
      kpVersion: active.source.kpVersion,
      paVersion: active.source.paVersion,
      fileSha256: active.source.fileSha256,
      fileName: active.source.fileName,
      summary: active.summary,
      parserVersion: active.parserVersion,
    };
  }

  getHistory() {
    const scope = this.repository.getOrCreateInstallationScopeId();
    return this.repository.listHistory(scope).map((s) => ({
      snapshotId: s.snapshotId,
      status: s.status,
      importedAt: s.source.importedAt,
      reportGeneratedAt: s.source.reportGeneratedAt,
      fileSha256: s.source.fileSha256,
      summary: s.summary,
    }));
  }

  inspectComponent(code: string) {
    const scope = this.repository.getOrCreateInstallationScopeId();
    const active = this.repository.getActive(scope);
    if (!active) return { status: 'no_active_snapshot' as const };
    const component = this.repository.getComponent(active.snapshotId, code);
    if (!component) {
      return {
        status: 'not_found' as const,
        reportGeneratedAt: active.source.reportGeneratedAt,
      };
    }
    const deps = this.repository.listDirectDependencies(active.snapshotId, code);
    return {
      status: 'found' as const,
      snapshotId: active.snapshotId,
      code: component.code,
      title: component.title,
      typeCode: component.typeCode,
      hintId: component.hintId,
      correctionMode: component.correctionMode,
      hasFormula: Boolean(component.formulaRaw),
      // Do not return formulaRaw to API clients in Stage 3I summary endpoints by default
      directDependencies: deps.map((d) => ({
        toComponentCode: d.toComponentCode,
        relationType: d.relationType,
        sourceFunction: d.sourceFunction,
        confidence: d.confidence,
      })),
      directDependencyCount: deps.length,
    };
  }

  traceComponent(code: string, depth = 5) {
    const scope = this.repository.getOrCreateInstallationScopeId();
    const active = this.repository.getActive(scope);
    if (!active) return { status: 'no_active_snapshot' as const };
    const all = this.repository.listAllDependencies(active.snapshotId);
    const traced = traceDependencies(all, code, depth);
    return { status: 'ok' as const, code, depth, ...traced };
  }
}
