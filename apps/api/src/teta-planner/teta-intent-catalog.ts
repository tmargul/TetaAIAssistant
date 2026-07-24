/**
 * Stage 3B — load & validate planner configuration.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  ALL_PLANNER_ENTITY_TYPES,
  STAGE3B_CONTRACT_VERSION,
  STAGE3B_PLANNER_CONFIG_VERSION,
  type PlannerEntityType,
  type PlannerIntentType,
} from './teta-stage3b.types';

export type IntentSignal = { id: string; pattern: string; weight: number };
export type IntentDef = {
  type: PlannerIntentType;
  minScore: number;
  requiredEntityTypes: PlannerEntityType[];
  clarificationEntityOrder: PlannerEntityType[];
  signals: IntentSignal[];
};

export type EvidenceTemplateItem = {
  evidenceType: string;
  required: boolean;
  graphQuery: Record<string, unknown> | null;
  runtimeSourceRequired: boolean;
  defaultStatus: string;
  missingWhenNoEntity?: string[];
  missingReason?: string;
  notes?: string;
};

export type PlannerLanguageConfig = {
  version: string;
  clarificationQuestions: Record<string, string>;
  monthNames: Record<string, number>;
  reportSubjects: Array<{ id: string; patterns: string[] }>;
  relativeDateExpressions: Array<{ expression: string; patterns: string[] }>;
  genericTokensForbiddenAlone: string[];
};

export type PlannerConfigs = {
  catalogVersion: string;
  contractVersion: string;
  intentCatalog: IntentDef[];
  evidenceTemplates: Record<string, EvidenceTemplateItem[]>;
  language: PlannerLanguageConfig;
  configDir: string;
};

const REQUIRED_INTENTS: PlannerIntentType[] = [
  'explain_payroll_component',
  'validate_import_file',
  'build_employee_report',
  'explain_application_field',
  'trace_application_to_oracle',
  'unsupported',
];

export function defaultPlannerConfigDir(apiRoot: string): string {
  return path.join(apiRoot, 'config');
}

export function loadPlannerConfigs(configDir: string): PlannerConfigs {
  const catalogPath = path.join(configDir, 'teta-intent-catalog-v1.json');
  const templatesPath = path.join(configDir, 'teta-evidence-templates-v1.json');
  const languagePath = path.join(configDir, 'teta-planner-language-pl-v1.json');

  for (const p of [catalogPath, templatesPath, languagePath]) {
    if (!existsSync(p)) {
      throw new Error(`Brak pliku konfiguracji Stage 3B: ${p}`);
    }
  }

  const catalogRaw = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
    version: string;
    contractVersion: string;
    intents: IntentDef[];
  };
  const templatesRaw = JSON.parse(readFileSync(templatesPath, 'utf8')) as {
    version: string;
    templates: Record<string, EvidenceTemplateItem[]>;
  };
  const language = JSON.parse(readFileSync(languagePath, 'utf8')) as PlannerLanguageConfig;

  const errors = validatePlannerConfigs(catalogRaw, templatesRaw, language);
  if (errors.length) {
    throw new Error(`Niepoprawna konfiguracja Stage 3B:\n- ${errors.join('\n- ')}`);
  }

  return {
    catalogVersion: catalogRaw.version,
    contractVersion: catalogRaw.contractVersion,
    intentCatalog: catalogRaw.intents,
    evidenceTemplates: templatesRaw.templates,
    language,
    configDir,
  };
}

export function validatePlannerConfigs(
  catalog: { version: string; contractVersion: string; intents: IntentDef[] },
  templates: { templates: Record<string, EvidenceTemplateItem[]> },
  language: PlannerLanguageConfig,
): string[] {
  const errors: string[] = [];
  if (catalog.version !== STAGE3B_PLANNER_CONFIG_VERSION) {
    errors.push(`catalog.version expected ${STAGE3B_PLANNER_CONFIG_VERSION}, got ${catalog.version}`);
  }
  if (catalog.contractVersion !== STAGE3B_CONTRACT_VERSION) {
    errors.push(`contractVersion expected ${STAGE3B_CONTRACT_VERSION}`);
  }

  const present = new Set(catalog.intents.map((i) => i.type));
  for (const t of REQUIRED_INTENTS) {
    if (!present.has(t)) errors.push(`missing required intent: ${t}`);
  }

  const entitySet = new Set<string>(ALL_PLANNER_ENTITY_TYPES);
  for (const intent of catalog.intents) {
    if (!intent.signals?.length) errors.push(`intent ${intent.type}: empty signals`);
    for (const e of intent.requiredEntityTypes ?? []) {
      if (!entitySet.has(e)) errors.push(`intent ${intent.type}: unknown entity ${e}`);
    }
    for (const e of intent.clarificationEntityOrder ?? []) {
      if (!entitySet.has(e)) errors.push(`intent ${intent.type}: unknown clarification entity ${e}`);
      if (!language.clarificationQuestions[e]) {
        errors.push(`empty/missing clarification template for entity ${e}`);
      }
    }
    for (const s of intent.signals ?? []) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(s.pattern, 'iu');
      } catch {
        errors.push(`intent ${intent.type}: invalid signal pattern ${s.id}`);
      }
    }
  }

  for (const [intentType, items] of Object.entries(templates.templates)) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.evidenceType)) {
        errors.push(`duplicate evidenceType ${item.evidenceType} in ${intentType}`);
      }
      seen.add(item.evidenceType);
    }
  }

  for (const [k, v] of Object.entries(language.clarificationQuestions)) {
    if (!String(v ?? '').trim()) errors.push(`empty clarification question for ${k}`);
  }

  return errors;
}
