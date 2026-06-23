import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatRagSourceExtensions } from '@teta/shared';
import type { SystemHealthResponse } from '@teta/shared';
import type { NavItem } from '../layout/Sidebar';
import {
  buildWizardExportPayload,
  computeWizardCompletedMap,
  downloadWizardExport,
  oracleImportStatusLabel,
  WIZARD_STEP_LABELS,
  wizardStepIndex,
} from './vendor-wizard.logic';
import {
  loadWizardState,
  resetWizardState,
  saveWizardState,
  WIZARD_STEP_ORDER,
  type VendorWizardStepId,
} from './vendor-wizard.storage';
import { useVendorWizardSnapshot } from './useVendorWizardSnapshot';
import './vendor-wizard.css';

const SETTINGS_TAB_KEY = 'teta-settings-tab';
const STEP_LABELS = WIZARD_STEP_LABELS;

type VendorKnowledgeWizardProps = {
  health: SystemHealthResponse | null;
  onNavigate: (item: NavItem) => void;
};

function stepIndex(id: VendorWizardStepId): number {
  return wizardStepIndex(id);
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? 'vendor-wizard__check-item--ok' : 'vendor-wizard__check-item--pending'}>
      {ok ? '✓' : '○'} {label}
    </li>
  );
}

export function VendorKnowledgeWizard({ health, onNavigate }: VendorKnowledgeWizardProps) {
  const [wizard, setWizard] = useState(loadWizardState);
  const { ctx, loading, refresh } = useVendorWizardSnapshot(health);

  useEffect(() => {
    saveWizardState(wizard);
  }, [wizard]);

  const completedMap = useMemo(
    () => computeWizardCompletedMap(wizard.answers, ctx),
    [wizard.answers, ctx],
  );

  const currentIndex = stepIndex(wizard.currentStepId);
  const stepId = wizard.currentStepId;
  const answers = wizard.answers;
  const completedCount = WIZARD_STEP_ORDER.filter((id) => completedMap[id]).length;
  const extensionsHint = formatRagSourceExtensions();

  const goToStep = (id: VendorWizardStepId) => {
    setWizard((prev) => ({ ...prev, currentStepId: id }));
  };

  const goNext = () => {
    const next = WIZARD_STEP_ORDER[currentIndex + 1];
    if (next) goToStep(next);
  };

  const goPrev = () => {
    const prev = WIZARD_STEP_ORDER[currentIndex - 1];
    if (prev) goToStep(prev);
  };

  const navigateToSettings = (tab: string) => {
    sessionStorage.setItem(SETTINGS_TAB_KEY, tab);
    onNavigate('settings');
  };

  const patchTestQuestions = (testQuestions: string) => {
    setWizard((prev) => ({ ...prev, answers: { ...prev.answers, testQuestions } }));
  };

  const handleExportJson = useCallback(() => {
    downloadWizardExport(buildWizardExportPayload(wizard, completedMap, ctx));
  }, [wizard, completedMap, ctx]);

  const oracleConfigured = ctx.oracleStatus?.configured === true;
  const metadata = ctx.oracleMetadata;
  const importRunning = metadata?.status === 'running';

  return (
    <div className="vendor-wizard">
      <div className="vendor-wizard__header">
        <p className="vendor-wizard__intro">
          Kreator nie zastępuje pracy — <strong>potwierdza postęp</strong> automatów: połączenie Oracle,
          import metadanych, dokumentacja RAG i eksport paczki. Nie trzeba ręcznie budować schematu —
          importer sam odczyta ALL_TABLES, widoki i zależności w podanym zakresie ownerów.
        </p>
        <button type="button" className="vendor-wizard__btn" onClick={handleExportJson}>
          Eksportuj JSON (postęp POC)
        </button>
      </div>

      <div className="vendor-wizard__layout">
        <nav className="vendor-wizard__steps" aria-label="Kroki kreatora">
          {WIZARD_STEP_ORDER.map((id, idx) => (
            <button
              key={id}
              type="button"
              className={`vendor-wizard__step-btn${
                stepId === id ? ' vendor-wizard__step-btn--active' : ''
              }${completedMap[id] ? ' vendor-wizard__step-btn--done' : ''}`}
              onClick={() => goToStep(id)}
            >
              <span className="vendor-wizard__step-num">{completedMap[id] ? '✓' : idx + 1}</span>
              <span>{STEP_LABELS[id]}</span>
            </button>
          ))}
        </nav>

        <section className="vendor-wizard__panel">
          <p className="vendor-wizard__progress">
            Postęp: {completedCount} / {WIZARD_STEP_ORDER.length}
            {loading ? ' · odświeżanie…' : ''}
          </p>

          {stepId === 'environment' && (
            <>
              <h2 className="vendor-wizard__title">Środowisko</h2>
              <p className="vendor-wizard__desc">Ollama, Qdrant i tryb vendor muszą być online.</p>
              <ul className="vendor-wizard__checklist vendor-wizard__checklist--status">
                <StatusRow ok={!!health} label={`API: ${health ? 'online' : 'łączenie…'}`} />
                <StatusRow
                  ok={health?.ollama.status === 'ok'}
                  label={`Ollama: ${health?.ollama.status === 'ok' ? `OK (${health.ollama.modelCount} modeli)` : 'offline'}`}
                />
                <StatusRow
                  ok={health?.qdrant.status === 'ok'}
                  label={`Qdrant: ${health?.qdrant.status === 'ok' ? health.qdrant.collection : 'offline'}`}
                />
                <StatusRow
                  ok={health?.appMode === 'vendor' && !!health?.vendorEnabled}
                  label={`Tryb vendor: ${health?.appMode === 'vendor' && health.vendorEnabled ? 'aktywny' : 'nieaktywny'}`}
                />
              </ul>
            </>
          )}

          {stepId === 'oracle-access' && (
            <>
              <h2 className="vendor-wizard__title">Dostęp Oracle (read-only)</h2>
              <p className="vendor-wizard__desc">
                Zespół Tety dostarcza konto techniczne i listę ownerów (np. TETA_ADMIN, KP). Ty tylko
                konfigurujesz połączenie — resztę zrobi importer.
              </p>
              <ul className="vendor-wizard__checklist vendor-wizard__checklist--status">
                <StatusRow ok={oracleConfigured} label="Połączenie Oracle skonfigurowane" />
                <StatusRow
                  ok={ctx.oracleStatus?.backendMode === 'real'}
                  label={`Tryb: ${ctx.oracleStatus?.backendMode === 'real' ? 'prawdziwa baza' : 'fake (dev)'}`}
                />
              </ul>
              {metadata?.message && (
                <div className={`vendor-wizard__status${oracleConfigured ? ' vendor-wizard__status--ok' : ' vendor-wizard__status--warn'}`}>
                  {metadata.message}
                </div>
              )}
              <div className="vendor-wizard__actions">
                <button
                  type="button"
                  className="vendor-wizard__btn vendor-wizard__btn--primary"
                  onClick={() => navigateToSettings('oracle')}
                >
                  Ustawienia → Oracle
                </button>
                <button type="button" className="vendor-wizard__btn" onClick={() => refresh()}>
                  Odśwież
                </button>
              </div>
            </>
          )}

          {stepId === 'oracle-import' && (
            <>
              <h2 className="vendor-wizard__title">Import metadanych (automat)</h2>
              <p className="vendor-wizard__desc">
                Importer sam pobierze tabele, kolumny, widoki, pakiety, procedury i zależności z Oracle.
                Moduł pilotażowy POC: <strong>{metadata?.pilotModule ?? 'Kadry / Wykształcenie'}</strong>.
              </p>
              <ul className="vendor-wizard__checklist vendor-wizard__checklist--status">
                <StatusRow ok={oracleConfigured} label="Połączenie Oracle" />
                <StatusRow
                  ok={metadata?.status === 'done'}
                  label={`Import: ${metadata ? oracleImportStatusLabel(metadata.status) : '—'}`}
                />
                <StatusRow
                  ok={(metadata?.counts.tables ?? 0) > 0}
                  label={`Tabele: ${metadata?.counts.tables ?? 0}`}
                />
                <StatusRow
                  ok={(metadata?.counts.views ?? 0) > 0}
                  label={`Widoki: ${metadata?.counts.views ?? 0}`}
                />
                <StatusRow
                  ok={(metadata?.counts.packages ?? 0) > 0}
                  label={`Pakiety: ${metadata?.counts.packages ?? 0}`}
                />
              </ul>
              {importRunning && (
                <div className="vendor-wizard__status vendor-wizard__status--warn">
                  Import w toku — postęp odświeża się automatycznie.
                </div>
              )}
              {metadata?.status === 'done' && metadata.lastImportedAt && (
                <div className="vendor-wizard__status vendor-wizard__status--ok">
                  Ostatni import: {new Date(metadata.lastImportedAt).toLocaleString('pl-PL')}
                  {metadata.tetaVersion ? ` · Teta ${metadata.tetaVersion}` : ''}
                </div>
              )}
              {!metadata?.available && metadata?.status !== 'done' && (
                <div className="vendor-wizard__status vendor-wizard__status--soon">
                  Importer w przygotowaniu — po wdrożeniu uruchomi się sam po skonfigurowaniu Oracle.
                  Kreator pokaże liczniki obiektów bez ręcznego eksportu SQL.
                </div>
              )}
              <div className="vendor-wizard__actions">
                <button type="button" className="vendor-wizard__btn" onClick={() => refresh()}>
                  Odśwież postęp
                </button>
              </div>
            </>
          )}

          {stepId === 'doc-sources' && (
            <>
              <h2 className="vendor-wizard__title">Dokumentacja (DOC_RAG)</h2>
              <p className="vendor-wizard__desc">
                Materiały szkoleniowe do globalnego RAG. Formaty: {extensionsHint}.
              </p>
              <div
                className={`vendor-wizard__status${
                  ctx.sourceCount > 0 ? ' vendor-wizard__status--ok' : ' vendor-wizard__status--warn'
                }`}
              >
                {ctx.sourceCount > 0
                  ? `Załączono ${ctx.sourceCount} plik(ów) w źródłach globalnych.`
                  : 'Brak plików — przejdź do uploadu.'}
              </div>
              <div className="vendor-wizard__actions">
                <button
                  type="button"
                  className="vendor-wizard__btn vendor-wizard__btn--primary"
                  onClick={() => onNavigate('globalSources')}
                >
                  Źródła globalne
                </button>
              </div>
            </>
          )}

          {stepId === 'video-sources' && (
            <>
              <h2 className="vendor-wizard__title">Materiały wideo (opcjonalnie)</h2>
              <p className="vendor-wizard__desc">
                Krok pomijany automatycznie, jeśli nie ma plików MP4. Inaczej — ingest w źródłach globalnych.
              </p>
              <ul className="vendor-wizard__checklist">
                <li>Pliki MP4 w źródłach: {ctx.mp4SourceCount}</li>
                <li>Ukończone ingesty wideo: {ctx.videoDoneCount}</li>
              </ul>
              <div
                className={`vendor-wizard__status${
                  completedMap['video-sources'] ? ' vendor-wizard__status--ok' : ' vendor-wizard__status--warn'
                }`}
              >
                {ctx.mp4SourceCount === 0
                  ? 'Brak MP4 — krok uznany za pominięty.'
                  : ctx.videoDoneCount > 0
                    ? 'Wideo zindeksowane.'
                    : 'Oczekuje na ingest MP4.'}
              </div>
              {ctx.mp4SourceCount > 0 && (
                <div className="vendor-wizard__actions">
                  <button
                    type="button"
                    className="vendor-wizard__btn vendor-wizard__btn--primary"
                    onClick={() => onNavigate('globalSources')}
                  >
                    Źródła globalne
                  </button>
                </div>
              )}
            </>
          )}

          {stepId === 'build-rag' && (
            <>
              <h2 className="vendor-wizard__title">Indeks RAG</h2>
              <ul className="vendor-wizard__checklist">
                <li>Chunków: {ctx.ragStatus?.chunkCount ?? '—'}</li>
                <li>
                  Ostatnia budowa:{' '}
                  {ctx.ragStatus?.lastBuiltAt
                    ? new Date(ctx.ragStatus.lastBuiltAt).toLocaleString('pl-PL')
                    : 'brak'}
                </li>
              </ul>
              <div className="vendor-wizard__actions">
                <button
                  type="button"
                  className="vendor-wizard__btn vendor-wizard__btn--primary"
                  onClick={() => navigateToSettings('packages')}
                >
                  Zbuduj indeks (Paczki)
                </button>
                <button type="button" className="vendor-wizard__btn" onClick={() => refresh()}>
                  Odśwież
                </button>
              </div>
            </>
          )}

          {stepId === 'test-chat' && (
            <>
              <h2 className="vendor-wizard__title">Test w czacie</h2>
              <p className="vendor-wizard__desc">
                Wklej pytania kontrolne od zespołu Tety (opcjonalnie — trafią do eksportu JSON). Przetestuj
                w asystencie: cytowania [1] i odpowiedzi o strukturze Oracle po imporcie.
              </p>
              <div className="vendor-wizard__field">
                <label className="vendor-wizard__label" htmlFor="test-questions">
                  Pytania testowe (jedno na linię)
                </label>
                <textarea
                  id="test-questions"
                  className="vendor-wizard__textarea"
                  value={answers.testQuestions}
                  onChange={(e) => patchTestQuestions(e.target.value)}
                  placeholder={'Gdzie używana jest kolumna LATA_STAZ?\nJakie widoki korzystają z NT_KP_KDR_SZKOLY?'}
                  rows={5}
                />
              </div>
              <div className="vendor-wizard__actions">
                <button
                  type="button"
                  className="vendor-wizard__btn vendor-wizard__btn--primary"
                  onClick={() => onNavigate('chat')}
                >
                  Asystent AI
                </button>
              </div>
            </>
          )}

          {stepId === 'export-rag' && (
            <>
              <h2 className="vendor-wizard__title">Eksport paczki RAG</h2>
              <ul className="vendor-wizard__checklist">
                <li>Wersja paczki: {ctx.ragStatus?.lastVersion ?? 'brak'}</li>
                <li>Chunków: {ctx.ragStatus?.chunkCount ?? '—'}</li>
              </ul>
              <div className="vendor-wizard__actions">
                <button
                  type="button"
                  className="vendor-wizard__btn vendor-wizard__btn--primary"
                  onClick={() => navigateToSettings('packages')}
                >
                  Eksport w Paczkach
                </button>
              </div>
            </>
          )}

          {stepId === 'ui-map' && (
            <>
              <h2 className="vendor-wizard__title">Mapowanie UI → baza</h2>
              <p className="vendor-wizard__desc">Faza po POC — lookup JSON pól formularzy i menu DLL.</p>
              <div className="vendor-wizard__status vendor-wizard__status--soon">
                Zaplanowane po imporcie metadanych Oracle i DOC_RAG.
              </div>
            </>
          )}

          <div className="vendor-wizard__nav">
            <button type="button" className="vendor-wizard__btn" disabled={currentIndex === 0} onClick={goPrev}>
              Wstecz
            </button>
            <div className="vendor-wizard__actions">
              {currentIndex < WIZARD_STEP_ORDER.length - 1 ? (
                <button type="button" className="vendor-wizard__btn vendor-wizard__btn--primary" onClick={goNext}>
                  Dalej
                </button>
              ) : (
                <button
                  type="button"
                  className="vendor-wizard__btn vendor-wizard__btn--primary"
                  onClick={() => setWizard(resetWizardState())}
                >
                  Zacznij od nowa
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
