import type {
  GlobalRagStatusResponse,
  OracleConnectionStatusResponse,
  OracleMetadataStatusResponse,
  SystemHealthResponse,
} from '@teta/shared';
import type { VendorWizardAnswers, VendorWizardState, VendorWizardStepId } from './vendor-wizard.storage';
import { WIZARD_STEP_ORDER } from './vendor-wizard.storage';

export const WIZARD_STEP_LABELS: Record<VendorWizardStepId, string> = {
  environment: 'Środowisko',
  'oracle-access': 'Dostęp Oracle',
  'oracle-import': 'Import metadanych Oracle',
  'doc-sources': 'Dokumentacja (DOC_RAG)',
  'video-sources': 'Materiały wideo',
  'build-rag': 'Indeks RAG',
  'test-chat': 'Test w czacie',
  'export-rag': 'Eksport paczki',
  'ui-map': 'Mapowanie UI',
};

export type WizardRuntimeContext = {
  health: SystemHealthResponse | null;
  ragStatus: GlobalRagStatusResponse | null;
  oracleStatus: OracleConnectionStatusResponse | null;
  oracleMetadata: OracleMetadataStatusResponse | null;
  sourceCount: number;
  mp4SourceCount: number;
  videoDoneCount: number;
};

export function wizardStepIndex(id: VendorWizardStepId): number {
  return WIZARD_STEP_ORDER.indexOf(id);
}

export function isWizardStepComplete(
  id: VendorWizardStepId,
  answers: VendorWizardAnswers,
  ctx: WizardRuntimeContext,
): boolean {
  if (answers.manualDone[id]) return true;

  switch (id) {
    case 'environment':
      return (
        ctx.health?.ollama.status === 'ok' &&
        ctx.health?.qdrant.status === 'ok' &&
        ctx.health?.appMode === 'vendor' &&
        ctx.health?.vendorEnabled === true
      );
    case 'oracle-access':
      return ctx.oracleStatus?.configured === true;
    case 'oracle-import':
      return (
        ctx.oracleMetadata?.status === 'done' &&
        (ctx.oracleMetadata.counts.tables > 0 || ctx.oracleMetadata.counts.views > 0)
      );
    case 'doc-sources':
      return ctx.sourceCount > 0;
    case 'video-sources':
      return ctx.mp4SourceCount === 0 || ctx.videoDoneCount > 0;
    case 'build-rag':
      return (ctx.ragStatus?.chunkCount ?? 0) > 0 && !!ctx.ragStatus?.lastBuiltAt;
    case 'test-chat':
      return answers.testQuestions.trim().length > 0;
    case 'export-rag':
      return !!ctx.ragStatus?.lastVersion;
    case 'ui-map':
      return false;
    default:
      return false;
  }
}

export function computeWizardCompletedMap(
  answers: VendorWizardAnswers,
  ctx: WizardRuntimeContext,
): Record<VendorWizardStepId, boolean> {
  const map = {} as Record<VendorWizardStepId, boolean>;
  for (const id of WIZARD_STEP_ORDER) {
    map[id] = isWizardStepComplete(id, answers, ctx);
  }
  return map;
}

export type WizardProgressSummary = {
  currentStepId: VendorWizardStepId;
  currentStepNumber: number;
  currentStepLabel: string;
  completedCount: number;
  totalSteps: number;
  isMainFlowComplete: boolean;
  isFullyComplete: boolean;
};

export function getWizardProgressSummary(
  state: VendorWizardState,
  completedMap: Record<VendorWizardStepId, boolean>,
): WizardProgressSummary {
  const completedCount = WIZARD_STEP_ORDER.filter((id) => completedMap[id]).length;
  const currentStepId = state.currentStepId;
  const currentStepNumber = wizardStepIndex(currentStepId) + 1;
  const isMainFlowComplete = completedMap['export-rag'];
  const isFullyComplete = completedCount >= WIZARD_STEP_ORDER.length;

  return {
    currentStepId,
    currentStepNumber,
    currentStepLabel: WIZARD_STEP_LABELS[currentStepId],
    completedCount,
    totalSteps: WIZARD_STEP_ORDER.length,
    isMainFlowComplete,
    isFullyComplete,
  };
}

export type VendorWizardExportPayload = {
  format: 'teta-vendor-wizard-export-v1';
  exportedAt: string;
  wizard: VendorWizardState;
  progress: {
    completedCount: number;
    totalSteps: number;
    steps: { id: VendorWizardStepId; label: string; complete: boolean }[];
  };
  ragSnapshot: {
    chunkCount: number | null;
    lastBuiltAt: string | null;
    lastVersion: string | null;
    indexedSourceCount: number | null;
    sourceFileCount: number;
    videoIngestDoneCount: number;
  };
  oracleSnapshot: {
    configured: boolean;
    metadata: OracleMetadataStatusResponse | null;
  };
};

export function buildWizardExportPayload(
  state: VendorWizardState,
  completedMap: Record<VendorWizardStepId, boolean>,
  ctx: WizardRuntimeContext,
): VendorWizardExportPayload {
  const completedCount = WIZARD_STEP_ORDER.filter((id) => completedMap[id]).length;

  return {
    format: 'teta-vendor-wizard-export-v1',
    exportedAt: new Date().toISOString(),
    wizard: state,
    progress: {
      completedCount,
      totalSteps: WIZARD_STEP_ORDER.length,
      steps: WIZARD_STEP_ORDER.map((id) => ({
        id,
        label: WIZARD_STEP_LABELS[id],
        complete: completedMap[id],
      })),
    },
    ragSnapshot: {
      chunkCount: ctx.ragStatus?.chunkCount ?? null,
      lastBuiltAt: ctx.ragStatus?.lastBuiltAt ?? null,
      lastVersion: ctx.ragStatus?.lastVersion ?? null,
      indexedSourceCount: ctx.ragStatus?.sources?.length ?? null,
      sourceFileCount: ctx.sourceCount,
      videoIngestDoneCount: ctx.videoDoneCount,
    },
    oracleSnapshot: {
      configured: ctx.oracleStatus?.configured ?? false,
      metadata: ctx.oracleMetadata,
    },
  };
}

export function downloadWizardExport(payload: VendorWizardExportPayload): void {
  const date = payload.exportedAt.slice(0, 10);
  const filename = `teta-wizard-${date}.json`;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function countMp4Sources(files: { name: string }[]): number {
  return files.filter((f) => f.name.toLowerCase().endsWith('.mp4')).length;
}
