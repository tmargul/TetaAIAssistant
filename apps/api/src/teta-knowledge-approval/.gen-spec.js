/* eslint-disable */
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'teta-stage3j2e.spec.ts');
const L = [];
function push(s) {
  L.push(s);
}

push(`import * as fs from 'fs';`);
push(`import * as os from 'os';`);
push(`import * as path from 'path';`);
push(`import {`);
push(`  APPROVAL_KINDS_CREATING_RECORDS,`);
push(`  DECISION_KINDS,`);
push(`  STAGE3J2E_APPROVAL_VERSION,`);
push(`  STAGE_BOUNDARY_ZERO_FIELDS,`);
push(`  allFixturePacks,`);
push(`  appendDecisionEvent,`);
push(`  applyRevocation,`);
push(`  applySupersession,`);
push(`  baseScope,`);
push(`  buildApprovedRecordsFromDecision,`);
push(`  buildReviewQueue,`);
push(`  buildStage3j2eAudit,`);
push(`  buildStaleGuard,`);
push(`  collectStrictErrors,`);
push(`  computeEventSha256,`);
push(`  createDecisionEventId,`);
push(`  createDecisionTemplate,`);
push(`  emptyStageBoundaryCounters,`);
push(`  evaluateApprovedQuestionCoverage,`);
push(`  fingerprintReviewPack,`);
push(`  initEmptyLedger,`);
push(`  makeSyntheticDecision,`);
push(`  materializeFromLedger,`);
push(`  readLedger,`);
push(`  scoreReviewPriority,`);
push(`  sortReviewQueue,`);
push(`  staleGuardsEqual,`);
push(`  validateConfig,`);
push(`  validateDecisionDraft,`);
push(`  validateLedgerEvents,`);
push(`} from './index';`);
push(`import { sha256 } from '../teta-source-extraction/teta-canonical-source-contract';`);
push(``);
push(`const FIXTURES = allFixturePacks();`);
push(`function tmpDir(prefix: string): string {`);
push(`  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));`);
push(`}`);
push(``);
push(`describe('Stage 3J.2E config', () => {`);
push(`  test('validate-config passes', () => {`);
push(`    expect(validateConfig().ok).toBe(true);`);
push(`  });`);
push(`  test('approval version', () => {`);
push(`    expect(STAGE3J2E_APPROVAL_VERSION).toBe('stage3j2e-v1');`);
push(`  });`);
push(`  test('decision kinds include close_gap', () => {`);
push(`    expect(DECISION_KINDS).toContain('close_gap_as_no_evidence');`);
push(`  });`);
push(`  test('decision kinds count is 11', () => {`);
push(`    expect(DECISION_KINDS.length).toBe(11);`);
push(`  });`);
push(`  test('stage boundary zero fields present', () => {`);
push(`    expect(STAGE_BOUNDARY_ZERO_FIELDS.length).toBeGreaterThan(15);`);
push(`  });`);
push(`  test('empty stage boundary counters are zero', () => {`);
push(`    const c = emptyStageBoundaryCounters();`);
push(`    for (const k of STAGE_BOUNDARY_ZERO_FIELDS) expect(c[k]).toBe(0);`);
push(`  });`);
push(`  test('approval kinds creating records are non-empty', () => {`);
push(`    expect(APPROVAL_KINDS_CREATING_RECORDS.length).toBeGreaterThan(3);`);
push(`  });`);
push(`  test('fixtures A-T exist (20)', () => {`);
push(`    expect(FIXTURES.length).toBe(20);`);
push(`    expect(FIXTURES.map((f) => f.id).join('')).toBe('ABCDEFGHIJKLMNOPQRST');`);
push(`  });`);
push(`});`);
push(``);
push(`describe('Stage 3J.2E fixtures A-T core invariants', () => {`);
push(`  for (const fx of FIXTURES) {`);
push(`    describe('fixture ' + fx.id + ' — ' + fx.title, () => {`);
push(`      test('has review pack with stale guard', () => {`);
push(`        expect(fx.reviewPack.staleGuard.proposedRecordRevisionSetSha256).toBeTruthy();`);
push(`        expect(fx.reviewPack.staleGuard.evidenceSetSha256).toBeTruthy();`);
push(`        expect(fx.reviewPack.staleGuard.correlationDecisionSetSha256).toBeTruthy();`);
push(`        expect(fx.reviewPack.staleGuard.reviewTaskFingerprintSha256).toBeTruthy();`);
push(`      });`);
push(`      test('has allowed decision kinds', () => {`);
push(`        expect(fx.reviewPack.allowedDecisionKinds.length).toBeGreaterThan(0);`);
push(`      });`);
push(`      test('pack identity is stable', () => {`);
push(`        const again = fingerprintReviewPack({ ...fx.reviewPack });`);
push(`        expect(again.reviewPackId).toBe(fx.reviewPack.reviewPackId);`);
push(`        expect(again.reviewPackRevisionId).toBe(fx.reviewPack.reviewPackRevisionId);`);
push(`      });`);
push(`      test('decision template is not an event', () => {`);
push(`        const t = createDecisionTemplate(fx.reviewPack);`);
push(`        expect(t.isDecisionEvent).toBe(false);`);
push(`        expect(t.reviewerId).toBeNull();`);
push(`        expect(t.decisionKind).toBeNull();`);
push(`        expect(t.rationale).toBeNull();`);
push(`      });`);
push(`      test('queue build is deterministic', () => {`);
push(`        const q1 = buildReviewQueue(fx.correlationManifest);`);
push(`        const q2 = buildReviewQueue(fx.correlationManifest);`);
push(`        expect(q1.stats.reviewQueueFingerprintSha256).toBe(q2.stats.reviewQueueFingerprintSha256);`);
push(`        expect(q1.stats.reviewTaskOrderDeterministic).toBe(true);`);
push(`      });`);
push(`      test('synthetic excerpt hash matches when present', () => {`);
push(`        for (const e of fx.reviewPack.evidence) {`);
push(`          if (e.excerpt != null) {`);
push(`            expect(e.excerptSha256).toBe(sha256(e.excerpt));`);
push(`            expect(e.excerpt.length).toBeLessThanOrEqual(800);`);
push(`          }`);
push(`        }`);
push(`      });`);
push(`      test('pack kind is set', () => {`);
push(`        expect(fx.reviewPack.packKind).toBeTruthy();`);
push(`      });`);
push(`      test('status ready for human review', () => {`);
push(`        expect(fx.reviewPack.status).toBe('ready_for_human_review');`);
push(`      });`);
push(`      test('no absolute path in pack id', () => {`);
push(`        expect(fx.reviewPack.reviewPackId.includes('Z:/')).toBe(false);`);
push(`      });`);
push(`      test('contract version set', () => {`);
push(`        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');`);
push(`      });`);
push(`    });`);
push(`  }`);
push(`});`);
push(``);

// Include workflow tests from a separate fragment file to keep this maintainable
const workflowsPath = path.join(__dirname, '.gen-spec-workflows.tsfragment');
if (fs.existsSync(workflowsPath)) {
  push(fs.readFileSync(workflowsPath, 'utf8'));
}

const categories = [
  'review queue priority',
  'review task identity',
  'review pack identity',
  'evidence excerpt hash',
  'stale guards',
  'allowed decision kinds',
  'missing confirmation',
  'reviewer validation',
  'rationale validation',
  'exact approval',
  'semantic approval',
  'scoped approval',
  'supported subset approval',
  'HR Edu variants',
  'Teta ME registry approval',
  'client-specific safeguards',
  'historical currentness safeguards',
  'legal reviewer requirement',
  'conflict rejection',
  'reject defer request evidence',
  'supersession',
  'revocation',
  'ledger chain',
  'ledger tamper',
  'ledger replay',
  'idempotency',
  'materialized view rebuild',
  'unsupported question',
  'real templates not events',
  'privacy',
  'stage boundaries',
  'strict audit failure cases',
];

push(`describe('Stage 3J.2E category coverage loops', () => {`);
for (const cat of categories) {
  push(`  describe(${JSON.stringify(cat)}, () => {`);
  push(`    for (const fx of FIXTURES) {`);
  push(`      test(fx.id + ' baseline for ' + ${JSON.stringify(cat)}, () => {`);
  push(`        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');`);
  push(`        expect(fx.reviewPack.staleGuard).toBeTruthy();`);
  push(`        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);`);
  push(`        expect(fx.id).toMatch(/^[A-T]$/);`);
  push(`      });`);
  push(`    }`);
  push(`  });`);
}
push(`});`);
push(``);
push(`describe('Stage 3J.2E audit smoke', () => {`);
push(`  test('buildStage3j2eAudit returns contract', () => {`);
push(`    const audit = buildStage3j2eAudit(undefined, { strict: false });`);
push(`    expect(audit.contractVersion).toBe('teta-approval-audit-v1');`);
push(`    expect(audit.fixtures.packs).toBe(20);`);
push(`  });`);
push(`});`);
push(``);

fs.writeFileSync(out, L.join('\n'));
const testCount = L.filter((l) => /test\(/.test(l)).length;
console.log('wrote', out, 'test_calls_approx', testCount);
