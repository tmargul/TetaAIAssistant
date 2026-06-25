import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  GlobalRagStatusResponse,
  GlobalSourcesListResponse,
  OracleConnectionStatusResponse,
  OracleMetadataStatusResponse,
  SystemHealthResponse,
  VideoIngestJobsListResponse,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { readResponseJson } from '../../lib/read-response-json';
import {
  computeWizardCompletedMap,
  countMp4Sources,
  getWizardProgressSummary,
  type WizardRuntimeContext,
  type WizardProgressSummary,
} from './vendor-wizard.logic';
import { loadWizardState, WIZARD_STORAGE_KEY, type VendorWizardState } from './vendor-wizard.storage';
import type { VendorWizardStepId } from './vendor-wizard.storage';

export type VendorWizardSnapshot = {
  wizard: VendorWizardState;
  progress: WizardProgressSummary;
  completedMap: Record<VendorWizardStepId, boolean>;
  ctx: WizardRuntimeContext;
  loading: boolean;
  refresh: () => void;
};

export function useVendorWizardSnapshot(health: SystemHealthResponse | null): VendorWizardSnapshot {
  const [wizard, setWizard] = useState(loadWizardState);
  const [ragStatus, setRagStatus] = useState<GlobalRagStatusResponse | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  const [mp4SourceCount, setMp4SourceCount] = useState(0);
  const [videoDoneCount, setVideoDoneCount] = useState(0);
  const [oracleStatus, setOracleStatus] = useState<OracleConnectionStatusResponse | null>(null);
  const [oracleMetadata, setOracleMetadata] = useState<OracleMetadataStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadWizard = useCallback(() => {
    setWizard(loadWizardState());
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    reloadWizard();
    try {
      const [ragRes, sourcesRes, videoRes, oracleRes, metadataRes] = await Promise.all([
        authFetch('/api/vendor/rag/status'),
        authFetch('/api/vendor/rag/sources'),
        authFetch('/api/vendor/rag/ingest/video'),
        authFetch('/api/oracle/status'),
        authFetch('/api/oracle/metadata/status'),
      ]);
      if (ragRes.ok) {
        setRagStatus((await ragRes.json()) as GlobalRagStatusResponse);
      }
      if (sourcesRes.ok) {
        const data = (await sourcesRes.json()) as GlobalSourcesListResponse;
        setSourceCount(data.files.length);
        setMp4SourceCount(countMp4Sources(data.files));
      }
      if (videoRes.ok) {
        const data = (await videoRes.json()) as VideoIngestJobsListResponse;
        setVideoDoneCount(data.jobs.filter((j) => j.status === 'done').length);
      }
      if (oracleRes.ok) {
        setOracleStatus((await oracleRes.json()) as OracleConnectionStatusResponse);
      }
      if (metadataRes.ok) {
        setOracleMetadata(await readResponseJson<OracleMetadataStatusResponse>(metadataRes));
      }
    } catch {
      // opcjonalne — kreator działa na danych lokalnych
    } finally {
      setLoading(false);
    }
  }, [reloadWizard]);

  useEffect(() => {
    refreshData().catch(() => undefined);
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIZARD_STORAGE_KEY) reloadWizard();
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(() => {
      refreshData().catch(() => undefined);
    }, 20000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [refreshData, reloadWizard]);

  const ctx = useMemo<WizardRuntimeContext>(
    () => ({
      health,
      ragStatus,
      oracleStatus,
      oracleMetadata,
      sourceCount,
      mp4SourceCount,
      videoDoneCount,
    }),
    [health, ragStatus, oracleStatus, oracleMetadata, sourceCount, mp4SourceCount, videoDoneCount],
  );

  const completedMap = useMemo(
    () => computeWizardCompletedMap(wizard.answers, ctx),
    [wizard.answers, ctx],
  );

  const progress = useMemo(
    () => getWizardProgressSummary(wizard, completedMap),
    [wizard, completedMap],
  );

  return {
    wizard,
    progress,
    completedMap,
    ctx,
    loading,
    refresh: refreshData,
  };
}
