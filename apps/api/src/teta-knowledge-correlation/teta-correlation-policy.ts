import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { GoldenQuestionDef } from './teta-correlation.types';

export type CorrelationPolicyV1 = {
  policyVersion: string;
  relationTaxonomy: string[];
  semanticDuplicateMinIndependentSignals: number;
  allowLexicalOnlySemanticDuplicate: boolean;
  allowUnknownApplicabilityAutoMerge: boolean;
  allowConflictAutoResolve: boolean;
  allowLocalModel: boolean;
  allowEmbeddings: boolean;
  allowOracleConnections: boolean;
  allowApprovedRecordCreation: boolean;
  folderHintAloneInsufficientForPairing: boolean;
  allowedCrossKindRelations: string[];
  blockingFields: string[];
  exactDuplicateAllowedDiffs: string[];
  strict: Record<string, number>;
};

export type ApplicabilitySeparationPolicyV1 = {
  policyVersion: string;
  neverAutoMerge: Record<string, boolean>;
  productSurfaceRules: Record<
    string,
    { isBusinessDomain: boolean; productFamily: string; sharedDatabaseWith: string }
  >;
  partitionFields: string[];
  invariants: Record<string, number>;
};

export type ExistingKnowledgeAnchorsV1 = {
  policyVersion: string;
  lexicon: Record<string, unknown>;
  payroll: Record<string, unknown>;
  helpGraph: Record<string, unknown>;
  syntheticAnchors: {
    concepts: Record<string, string[]>;
    aliases: Record<string, string[]>;
    payrollCodes: Record<string, { kind: string; semanticKey?: string }>;
    payrollFunctions: Record<string, { kind: string }>;
    graphNodes: Record<string, string[]>;
    graphPaths: Record<string, string[]>;
  };
};

export type GoldenQuestionsSuiteV1 = {
  suiteVersion: string;
  questions: GoldenQuestionDef[];
};

function configDir(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, 'apps', 'api', 'config', 'teta-knowledge-correlation');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadCorrelationPolicy(repoRoot?: string): CorrelationPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-correlation-policy-v1.json'));
}

export function loadApplicabilitySeparationPolicy(repoRoot?: string): ApplicabilitySeparationPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-applicability-separation-policy-v1.json'));
}

export function loadExistingKnowledgeAnchors(repoRoot?: string): ExistingKnowledgeAnchorsV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-existing-knowledge-anchors-v1.json'));
}

export function loadGoldenQuestions(repoRoot?: string): GoldenQuestionsSuiteV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-golden-questions-stage3j2d-pl-v1.json'));
}

export function validateCorrelationConfigs(repoRoot?: string): { ok: boolean; errors: string[]; files: string[] } {
  const dir = configDir(repoRoot);
  const files = [
    'teta-correlation-policy-v1.json',
    'teta-applicability-separation-policy-v1.json',
    'teta-existing-knowledge-anchors-v1.json',
    'teta-golden-questions-stage3j2d-pl-v1.json',
  ];
  const errors: string[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    if (!existsSync(p)) {
      errors.push(`missing:${f}`);
      continue;
    }
    try {
      JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      errors.push(`invalid_json:${f}`);
    }
  }
  if (!errors.length) {
    const policy = loadCorrelationPolicy(repoRoot);
    if (policy.allowLocalModel) errors.push('policy_allows_local_model');
    if (policy.allowEmbeddings) errors.push('policy_allows_embeddings');
    if (policy.allowConflictAutoResolve) errors.push('policy_allows_conflict_auto_resolve');
    if (policy.allowApprovedRecordCreation) errors.push('policy_allows_approved_records');
    const questions = loadGoldenQuestions(repoRoot);
    if (questions.questions.length !== 21) errors.push(`golden_questions_count:${questions.questions.length}`);
    const ids = new Set(questions.questions.map((q) => q.questionId));
    for (let i = 1; i <= 21; i++) {
      const id = `Q${String(i).padStart(2, '0')}`;
      if (!ids.has(id)) errors.push(`missing_question:${id}`);
    }
  }
  return { ok: errors.length === 0, errors, files: files.map((f) => path.join(dir, f)) };
}
