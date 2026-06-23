export type VendorWizardStepId =
  | 'environment'
  | 'oracle-access'
  | 'oracle-import'
  | 'doc-sources'
  | 'video-sources'
  | 'build-rag'
  | 'test-chat'
  | 'export-rag'
  | 'ui-map';

/** Zachowane pola legacy — nie używane w UI, tylko przy wczytywaniu starego stanu. */
type VendorWizardAnswersLegacy = {
  pilotModule?: string;
  pilotTables?: string;
  docFormats?: string[];
  videoPlanned?: string;
  oracleSchemas?: string;
  oracleNotes?: string;
};

export type VendorWizardAnswers = VendorWizardAnswersLegacy & {
  /** Pytania kontrolne od zespołu Tety — opcjonalnie, trafiają do eksportu JSON. */
  testQuestions: string;
  manualDone: Partial<Record<VendorWizardStepId, boolean>>;
};

export type VendorWizardState = {
  version: 1;
  currentStepId: VendorWizardStepId;
  answers: VendorWizardAnswers;
};

export const WIZARD_STORAGE_KEY = 'teta-vendor-knowledge-wizard-v1';

const STORAGE_KEY = WIZARD_STORAGE_KEY;

export const WIZARD_STEP_ORDER: VendorWizardStepId[] = [
  'environment',
  'oracle-access',
  'oracle-import',
  'doc-sources',
  'video-sources',
  'build-rag',
  'test-chat',
  'export-rag',
  'ui-map',
];

const LEGACY_STEP_IDS: Record<string, VendorWizardStepId> = {
  'pilot-scope': 'oracle-access',
  'oracle-metadata': 'oracle-import',
};

export const DEFAULT_WIZARD_ANSWERS: VendorWizardAnswers = {
  testQuestions: '',
  manualDone: {},
};

function migrateStepId(id: string): VendorWizardStepId {
  if (LEGACY_STEP_IDS[id]) return LEGACY_STEP_IDS[id];
  if (WIZARD_STEP_ORDER.includes(id as VendorWizardStepId)) return id as VendorWizardStepId;
  return 'environment';
}

export function loadWizardState(): VendorWizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: 1, currentStepId: 'environment', answers: { ...DEFAULT_WIZARD_ANSWERS } };
    }
    const parsed = JSON.parse(raw) as VendorWizardState;
    if (parsed.version !== 1) {
      return { version: 1, currentStepId: 'environment', answers: { ...DEFAULT_WIZARD_ANSWERS } };
    }
    return {
      version: 1,
      currentStepId: migrateStepId(parsed.currentStepId),
      answers: { ...DEFAULT_WIZARD_ANSWERS, ...parsed.answers, manualDone: parsed.answers?.manualDone ?? {} },
    };
  } catch {
    return { version: 1, currentStepId: 'environment', answers: { ...DEFAULT_WIZARD_ANSWERS } };
  }
}

export function saveWizardState(state: VendorWizardState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetWizardState(): VendorWizardState {
  const fresh = { version: 1 as const, currentStepId: 'environment' as const, answers: { ...DEFAULT_WIZARD_ANSWERS } };
  saveWizardState(fresh);
  return fresh;
}
