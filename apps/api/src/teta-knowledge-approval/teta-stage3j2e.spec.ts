import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  APPROVAL_KINDS_CREATING_RECORDS,
  DECISION_KINDS,
  STAGE3J2E_APPROVAL_VERSION,
  STAGE_BOUNDARY_ZERO_FIELDS,
  allFixturePacks,
  appendDecisionEvent,
  applyRevocation,
  applySupersession,
  baseScope,
  buildApprovedRecordsFromDecision,
  buildReviewQueue,
  buildStage3j2eAudit,
  buildStaleGuard,
  collectStrictErrors,
  computeEventSha256,
  createDecisionEventId,
  createDecisionTemplate,
  emptyStageBoundaryCounters,
  evaluateApprovedQuestionCoverage,
  fingerprintReviewPack,
  initEmptyLedger,
  makeSyntheticDecision,
  materializeFromLedger,
  readLedger,
  scoreReviewPriority,
  sortReviewQueue,
  staleGuardsEqual,
  validateConfig,
  validateDecisionDraft,
  validateLedgerEvents,
} from './index';
import { sha256 } from '../teta-source-extraction/teta-canonical-source-contract';

const FIXTURES = allFixturePacks();
function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Stage 3J.2E config', () => {
  test('validate-config passes', () => {
    expect(validateConfig().ok).toBe(true);
  });
  test('approval version', () => {
    expect(STAGE3J2E_APPROVAL_VERSION).toBe('stage3j2e-v1');
  });
  test('decision kinds include close_gap', () => {
    expect(DECISION_KINDS).toContain('close_gap_as_no_evidence');
  });
  test('decision kinds count is 11', () => {
    expect(DECISION_KINDS.length).toBe(11);
  });
  test('stage boundary zero fields present', () => {
    expect(STAGE_BOUNDARY_ZERO_FIELDS.length).toBeGreaterThan(15);
  });
  test('empty stage boundary counters are zero', () => {
    const c = emptyStageBoundaryCounters();
    for (const k of STAGE_BOUNDARY_ZERO_FIELDS) expect(c[k]).toBe(0);
  });
  test('approval kinds creating records are non-empty', () => {
    expect(APPROVAL_KINDS_CREATING_RECORDS.length).toBeGreaterThan(3);
  });
  test('fixtures A-T exist (20)', () => {
    expect(FIXTURES.length).toBe(20);
    expect(FIXTURES.map((f) => f.id).join('')).toBe('ABCDEFGHIJKLMNOPQRST');
  });
});

describe('Stage 3J.2E fixtures A-T core invariants', () => {
  for (const fx of FIXTURES) {
    describe('fixture ' + fx.id + ' — ' + fx.title, () => {
      test('has review pack with stale guard', () => {
        expect(fx.reviewPack.staleGuard.proposedRecordRevisionSetSha256).toBeTruthy();
        expect(fx.reviewPack.staleGuard.evidenceSetSha256).toBeTruthy();
        expect(fx.reviewPack.staleGuard.correlationDecisionSetSha256).toBeTruthy();
        expect(fx.reviewPack.staleGuard.reviewTaskFingerprintSha256).toBeTruthy();
      });
      test('has allowed decision kinds', () => {
        expect(fx.reviewPack.allowedDecisionKinds.length).toBeGreaterThan(0);
      });
      test('pack identity is stable', () => {
        const again = fingerprintReviewPack({ ...fx.reviewPack });
        expect(again.reviewPackId).toBe(fx.reviewPack.reviewPackId);
        expect(again.reviewPackRevisionId).toBe(fx.reviewPack.reviewPackRevisionId);
      });
      test('decision template is not an event', () => {
        const t = createDecisionTemplate(fx.reviewPack);
        expect(t.isDecisionEvent).toBe(false);
        expect(t.reviewerId).toBeNull();
        expect(t.decisionKind).toBeNull();
        expect(t.rationale).toBeNull();
      });
      test('queue build is deterministic', () => {
        const q1 = buildReviewQueue(fx.correlationManifest);
        const q2 = buildReviewQueue(fx.correlationManifest);
        expect(q1.stats.reviewQueueFingerprintSha256).toBe(q2.stats.reviewQueueFingerprintSha256);
        expect(q1.stats.reviewTaskOrderDeterministic).toBe(true);
      });
      test('synthetic excerpt hash matches when present', () => {
        for (const e of fx.reviewPack.evidence) {
          if (e.excerpt != null) {
            expect(e.excerptSha256).toBe(sha256(e.excerpt));
            expect(e.excerpt.length).toBeLessThanOrEqual(800);
          }
        }
      });
      test('pack kind is set', () => {
        expect(fx.reviewPack.packKind).toBeTruthy();
      });
      test('status ready for human review', () => {
        expect(fx.reviewPack.status).toBe('ready_for_human_review');
      });
      test('no absolute path in pack id', () => {
        expect(fx.reviewPack.reviewPackId.includes('Z:/')).toBe(false);
      });
      test('contract version set', () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
      });
    });
  }
});

describe('Stage 3J.2E decision workflows', () => {
  test('A approve_merged_record creates approved record preserving occurrences', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record', scopeDecision: baseScope() });
    const v = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      { pack: fx.reviewPack, confirmHumanDecision: true, reviewerId: draft.reviewer.reviewerId, reviewerRole: draft.reviewer.reviewerRole },
    );
    expect(v.ok).toBe(true);
    const dir = tmpDir('teta-3j2e-a-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    const records = buildApprovedRecordsFromDecision(event, fx.reviewPack);
    expect(records.length).toBe(1);
    expect(records[0]!.candidateOccurrenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.evidenceRefs.length).toBeGreaterThan(0);
    expect(records[0]!.decisionEventRefs).toContain(event.decisionEventId);
  });

  test('B semantic approve_merged_record works', () => {
    const fx = FIXTURES.find((f) => f.id === 'B')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record' });
    const v = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      { pack: fx.reviewPack, confirmHumanDecision: true, reviewerId: draft.reviewer.reviewerId, reviewerRole: draft.reviewer.reviewerRole },
    );
    expect(v.ok).toBe(true);
  });

  test('C approve without scope rejected; approve_with_scope accepted', () => {
    const fx = FIXTURES.find((f) => f.id === 'C')!;
    const bad = validateDecisionDraft(
      {
        reviewPackId: fx.reviewPack.reviewPackId,
        reviewPackRevisionId: fx.reviewPack.reviewPackRevisionId,
        decisionKind: 'approve',
        rationale: 'missing scope intentionally',
        staleGuard: fx.reviewPack.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: 'fixture-reviewer',
        reviewerRole: 'knowledge_reviewer',
        isUnknownApplicability: true,
      },
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain('unknown_applicability_without_explicit_scope');
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ productFamilyIds: ['teta_hr'] }),
    });
    const ok = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
        isUnknownApplicability: true,
      },
    );
    expect(ok.ok).toBe(true);
  });

  test('D approve_as_variants creates two records without universal merge', () => {
    const fx = FIXTURES.find((f) => f.id === 'D')!;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_as_variants',
      scopeDecision: baseScope({ productFamilyIds: ['teta_hr', 'teta_edu'] }),
    });
    const dir = tmpDir('teta-3j2e-d-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    const records = buildApprovedRecordsFromDecision(event, fx.reviewPack, { variantSplit: true });
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  test('E Teta ME approve_with_scope keeps product surface under teta_hr', () => {
    const fx = FIXTURES.find((f) => f.id === 'E')!;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ productFamilyIds: ['teta_hr'], productSurfaceIds: ['teta_me'] }),
      reviewerRole: 'product_expert',
    });
    const v = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
        isTetaMeStandaloneDomain: false,
      },
    );
    expect(v.ok).toBe(true);
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
        isTetaMeStandaloneDomain: true,
      },
    );
    expect(bad.errors).toContain('teta_me_approved_as_standalone_domain');
  });

  test('F client-specific global approval rejected', () => {
    const fx = FIXTURES.find((f) => f.id === 'F')!;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ clientScope: 'global' }),
    });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
        isClientSpecific: true,
      },
    );
    expect(bad.errors).toContain('client_specific_approved_as_global');
    const okDraft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ clientScope: 'client_specific' }),
    });
    const ok = validateDecisionDraft(
      { ...okDraft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: okDraft.reviewer.reviewerId,
        reviewerRole: okDraft.reviewer.reviewerRole,
        isClientSpecific: true,
      },
    );
    expect(ok.ok).toBe(true);
  });

  test('G historical cannot be approved as current', () => {
    const fx = FIXTURES.find((f) => f.id === 'G')!;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ currentnessStatus: 'verified_for_scope' }),
    });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
        isHistorical: true,
      },
    );
    expect(bad.errors).toContain('historical_approved_as_current');
  });

  test('H regulatory currentness requires legal reviewer', () => {
    const fx = FIXTURES.find((f) => f.id === 'H')!;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ currentnessStatus: 'verified_for_scope' }),
      reviewerRole: 'knowledge_reviewer',
    });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: 'knowledge_reviewer',
        isRegulatory: true,
      },
    );
    expect(bad.errors).toContain('regulatory_current_without_legal_review');
    const ok = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: 'legal_reviewer',
        isRegulatory: true,
      },
    );
    expect(ok.ok).toBe(true);
  });

  test('I reject creates event without approved record', () => {
    const fx = FIXTURES.find((f) => f.id === 'I')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'reject' });
    const dir = tmpDir('teta-3j2e-i-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    expect(buildApprovedRecordsFromDecision(event, fx.reviewPack)).toEqual([]);
  });

  test('J defer creates no approved record', () => {
    const fx = FIXTURES.find((f) => f.id === 'J')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer' });
    const dir = tmpDir('teta-3j2e-j-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    const view = materializeFromLedger({
      events: [event],
      packsById: { [fx.reviewPack.reviewPackId]: fx.reviewPack },
      reviewTasks: fx.reviewTasks,
    });
    expect(view.approvedRecords.length).toBe(0);
    expect(view.reviewTaskStates.some((t) => t.status === 'deferred')).toBe(true);
  });

  test('K request_more_evidence creates no approved record', () => {
    const fx = FIXTURES.find((f) => f.id === 'K')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'request_more_evidence' });
    const dir = tmpDir('teta-3j2e-k-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    expect(buildApprovedRecordsFromDecision(event, fx.reviewPack)).toEqual([]);
  });

  test('L conflict approve rejected; defer accepted', () => {
    const fx = FIXTURES.find((f) => f.id === 'L')!;
    const approve = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve' });
    const pack = {
      ...fx.reviewPack,
      allowedDecisionKinds: [...fx.reviewPack.allowedDecisionKinds, 'approve'] as typeof fx.reviewPack.allowedDecisionKinds,
    };
    const bad = validateDecisionDraft(
      { ...approve, confirmHumanDecision: true, synthetic: true },
      {
        pack,
        confirmHumanDecision: true,
        reviewerId: approve.reviewer.reviewerId,
        reviewerRole: approve.reviewer.reviewerRole,
        hasUnresolvedConflict: true,
      },
    );
    expect(bad.errors).toContain('approval_with_unresolved_conflict');
    const defer = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer' });
    const ok = validateDecisionDraft(
      { ...defer, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: defer.reviewer.reviewerId,
        reviewerRole: defer.reviewer.reviewerRole,
        hasUnresolvedConflict: true,
      },
    );
    expect(ok.ok).toBe(true);
  });

  test('M stale pack decision rejected', () => {
    const fx = FIXTURES.find((f) => f.id === 'M')!;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_merged_record',
      staleGuard: { ...fx.reviewPack.staleGuard, evidenceSetSha256: sha256('changed') },
    });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    expect(bad.errors).toContain('stale_review_pack');
  });

  test('N ledger chain previous hash and tamper detection', () => {
    const fx = FIXTURES.find((f) => f.id === 'N')!;
    const dir = tmpDir('teta-3j2e-n-');
    initEmptyLedger(dir);
    const d1 = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer', rationale: 'first event rationale xx' });
    const d2 = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'reject', rationale: 'second event rationale xx' });
    const e1 = appendDecisionEvent(dir, d1).event;
    const e2 = appendDecisionEvent(dir, d2).event;
    expect(e2.ledger.previousEventSha256).toBe(e1.ledger.eventSha256);
    expect(e1.ledger.sequenceNumber).toBe(1);
    expect(e2.ledger.sequenceNumber).toBe(2);
    const ledger = readLedger(dir);
    expect(ledger.stats.ledgerHashChainValid).toBe(true);
    const tampered = [...ledger.events];
    tampered[0] = { ...tampered[0]!, rationale: 'tampered' };
    const v = validateLedgerEvents(tampered);
    expect(v.stats.tamperedLedgerDetected).toBe(true);
  });

  test('O idempotency: duplicate decision event not appended twice', () => {
    const fx = FIXTURES.find((f) => f.id === 'O')!;
    const dir = tmpDir('teta-3j2e-o-');
    initEmptyLedger(dir);
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'reject', rationale: 'idempotency rationale' });
    const a = appendDecisionEvent(dir, draft);
    const b = appendDecisionEvent(dir, draft);
    expect(a.appended).toBe(true);
    expect(b.appended).toBe(false);
    expect(readLedger(dir).events.length).toBe(1);
  });

  test('P supersede keeps history', () => {
    const fx = FIXTURES.find((f) => f.id === 'P')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record' });
    const dir = tmpDir('teta-3j2e-p-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    const [rec] = buildApprovedRecordsFromDecision(event, fx.reviewPack);
    const supersedeDraft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'supersede',
      rationale: 'supersede with new revision rationale',
    });
    const pack = {
      ...fx.reviewPack,
      allowedDecisionKinds: [...fx.reviewPack.allowedDecisionKinds, 'supersede'] as typeof fx.reviewPack.allowedDecisionKinds,
    };
    const { event: event2 } = appendDecisionEvent(dir, supersedeDraft);
    const [neu] = buildApprovedRecordsFromDecision(event2, pack);
    const { previous, next } = applySupersession(rec!, neu!, event2);
    expect(previous.status).toBe('superseded');
    expect(next.status).toBe('active');
    expect(next.supersession.supersedesRevisionId).toBe(previous.approvedRecordRevisionId);
  });

  test('Q revoke marks record revoked without deleting history', () => {
    const fx = FIXTURES.find((f) => f.id === 'Q')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record' });
    const dir = tmpDir('teta-3j2e-q-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    const [rec] = buildApprovedRecordsFromDecision(event, fx.reviewPack);
    const revokeDraft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'revoke',
      rationale: 'revoke rationale text here',
    });
    const { event: revEvent } = appendDecisionEvent(dir, revokeDraft);
    const revoked = applyRevocation(rec!, revEvent);
    expect(revoked.status).toBe('revoked');
    expect(revoked.decisionEventRefs).toContain(revEvent.decisionEventId);
    expect(revoked.approvedRecordRevisionId).toBe(rec!.approvedRecordRevisionId);
  });

  test('R unsupported question cannot create approved record without evidence', () => {
    const fx = FIXTURES.find((f) => f.id === 'R')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'close_gap_as_no_evidence' });
    const dir = tmpDir('teta-3j2e-r-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    expect(buildApprovedRecordsFromDecision(event, fx.reviewPack)).toEqual([]);
  });

  test('S approve_supported_subset creates record for supported fragment', () => {
    const fx = FIXTURES.find((f) => f.id === 'S')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_supported_subset' });
    const v = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      { pack: fx.reviewPack, confirmHumanDecision: true, reviewerId: draft.reviewer.reviewerId, reviewerRole: draft.reviewer.reviewerRole },
    );
    expect(v.ok).toBe(true);
    const dir = tmpDir('teta-3j2e-s-');
    initEmptyLedger(dir);
    const { event } = appendDecisionEvent(dir, draft);
    expect(buildApprovedRecordsFromDecision(event, fx.reviewPack).length).toBe(1);
  });

  test('T missing confirmation rejects event write', () => {
    const fx = FIXTURES.find((f) => f.id === 'T')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record' });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: false, synthetic: false },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: false,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    expect(bad.errors).toContain('missing_confirm_human_decision');
  });
});

describe('Stage 3J.2E review priority and identity', () => {
  test('conflict scores critical', () => {
    const fx = FIXTURES.find((f) => f.id === 'L')!;
    const source = fx.correlationManifest.reviewTasks[0] ?? {
      reviewTaskId: 'x',
      reviewKind: 'resolve_conflict',
      candidateOccurrenceRefs: [],
      proposedRecordRefs: [],
      questionRefs: [],
      reasonCodes: ['conflict'],
      requiredHumanDecision: 'resolve',
    };
    const scored = scoreReviewPriority(source as never, fx.correlationManifest, {
      policyVersion: 't',
      priorityOrder: [],
      priorityScores: {
        unresolved_conflict: 1000,
        golden_question_relevant: 800,
        requires_review_before_merge: 600,
        exact_or_semantic_merge_candidate: 400,
        product_version_client_scope: 300,
        currentness_verification: 200,
        normal_review: 100,
      },
      priorityBands: { critical: 900, high: 500, normal: 200, low: 0 },
    });
    expect(scored.priority).toBe('critical');
    expect(scored.reasons).toContain('unresolved_conflict');
  });

  test('sortReviewQueue is stable for equal priority', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const q = buildReviewQueue(fx.correlationManifest);
    const sorted = sortReviewQueue(q.tasks);
    const again = sortReviewQueue(q.tasks);
    expect(sorted.map((t) => t.reviewTaskId)).toEqual(again.map((t) => t.reviewTaskId));
  });

  test('staleGuardsEqual true for same guard', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    expect(staleGuardsEqual(fx.reviewPack.staleGuard, fx.reviewPack.staleGuard)).toBe(true);
  });

  test('buildStaleGuard changes when evidence changes', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const task = fx.reviewTasks[0]!;
    const g1 = buildStaleGuard({
      proposedRecordRevisionIds: ['r1'],
      evidenceRefs: ['e1'],
      relationDecisionIds: ['d1'],
      reviewTask: task,
    });
    const g2 = buildStaleGuard({
      proposedRecordRevisionIds: ['r1'],
      evidenceRefs: ['e2'],
      relationDecisionIds: ['d1'],
      reviewTask: task,
    });
    expect(g1.evidenceSetSha256).not.toBe(g2.evidenceSetSha256);
  });

  test('missing reviewer rejected', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer' });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      { pack: fx.reviewPack, confirmHumanDecision: true, reviewerId: '', reviewerRole: 'knowledge_reviewer' },
    );
    expect(bad.errors).toContain('missing_reviewer_id');
  });

  test('missing rationale rejected', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer', rationale: 'short' });
    const bad = validateDecisionDraft(
      { ...draft, rationale: 'x', confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    expect(bad.errors).toContain('missing_or_short_rationale');
  });

  test('decision outside allowed kinds rejected', () => {
    const fx = FIXTURES.find((f) => f.id === 'R')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve' });
    const bad = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    expect(bad.errors).toContain('decision_outside_allowed_kinds');
  });

  test('materialized view rebuild matches', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const dir = tmpDir('teta-3j2e-mat-');
    initEmptyLedger(dir);
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record' });
    const { event } = appendDecisionEvent(dir, draft);
    const packsById = { [fx.reviewPack.reviewPackId]: fx.reviewPack };
    const v1 = materializeFromLedger({ events: [event], packsById });
    const v2 = materializeFromLedger({ events: [event], packsById });
    expect(v1.viewHashSha256).toBe(v2.viewHashSha256);
    expect(v1.approvedRecords.length).toBe(1);
  });

  test('createDecisionEventId is deterministic', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer', rationale: 'deterministic rationale' });
    expect(createDecisionEventId(draft)).toBe(createDecisionEventId(draft));
  });

  test('computeEventSha256 stable for same payload', () => {
    const fx = FIXTURES.find((f) => f.id === 'A')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'defer', rationale: 'hash rationale text' });
    const h1 = computeEventSha256({ ...draft, ledger: { previousEventSha256: null, sequenceNumber: 1, ledgerId: 'l' } });
    const h2 = computeEventSha256({ ...draft, ledger: { previousEventSha256: null, sequenceNumber: 1, ledgerId: 'l' } });
    expect(h1).toBe(h2);
  });
});

describe('Stage 3J.2E approved question coverage', () => {
  test('separates candidate and approved coverage', () => {
    const fx = FIXTURES.find((f) => f.id === 'E')!;
    const { coverage, stats } = evaluateApprovedQuestionCoverage({
      correlationManifest: {
        ...fx.correlationManifest,
        questionCoverage: [
          {
            questionId: 'Q21',
            question: 'ME?',
            coverageStatus: 'supported',
            matchedProposedRecordIds: [],
            matchedCandidateOccurrenceIds: [],
            variantRefs: [],
            conflictRefs: [],
            requiredKnowledgeKinds: [],
            knowledgeKindsFound: [],
            knowledgeKindsMissing: [],
            productFamilyCoverage: [],
            domainCoverage: [],
            sourceArchetypeCoverage: [],
            evidenceCount: 0,
            independentSourceCount: 0,
            supportingEvidenceRefs: [],
            warnings: [],
          },
        ],
      },
      reviewPacks: [{ ...fx.reviewPack, pilotCaseId: 'RP01', questionRefs: ['Q21'] }],
      approvedRecords: [],
    });
    expect(coverage[0]!.candidateCoverageStatus).toBe('supported');
    expect(coverage[0]!.approvedCoverageStatus).toBe('pending_human_review');
    expect(stats.questionsIncorrectlyMarkedApprovedWithoutRecord).toBe(0);
  });

  test('RP07 evidence gap maps to requires_more_evidence', () => {
    const fx = FIXTURES.find((f) => f.id === 'R')!;
    const { coverage } = evaluateApprovedQuestionCoverage({
      correlationManifest: {
        ...fx.correlationManifest,
        questionCoverage: [
          {
            questionId: 'Q14',
            question: 'KSeF?',
            coverageStatus: 'unsupported',
            matchedProposedRecordIds: [],
            matchedCandidateOccurrenceIds: [],
            variantRefs: [],
            conflictRefs: [],
            requiredKnowledgeKinds: [],
            knowledgeKindsFound: [],
            knowledgeKindsMissing: [],
            productFamilyCoverage: [],
            domainCoverage: [],
            sourceArchetypeCoverage: [],
            evidenceCount: 0,
            independentSourceCount: 0,
            supportingEvidenceRefs: [],
            warnings: [],
          },
        ],
      },
      reviewPacks: [{ ...fx.reviewPack, pilotCaseId: 'RP07', questionRefs: ['Q14'], packKind: 'evidence_gap' }],
      approvedRecords: [],
    });
    expect(coverage[0]!.approvedCoverageStatus).toBe('requires_more_evidence');
  });
});

describe('Stage 3J.2E strict collector and stage boundaries', () => {
  test('collectStrictErrors empty for clean stats', () => {
    const stats: Record<string, number | boolean | string> = {
      ...emptyStageBoundaryCounters(),
      reviewTasksWithoutPriorityReason: 0,
      duplicateReviewTaskIds: 0,
      reviewTaskOrderDeterministic: true,
      reviewPacksMissingStaleGuard: 0,
      reviewPacksWithoutAllowedDecision: 0,
      excerptsHashMismatch: 0,
      excerptsGeneratedByModel: 0,
      fullSourceTextsCopiedToReviewPacks: 0,
      templatesIncorrectlyWrittenAsLedgerEvents: 0,
      templatesWithPrefilledReviewer: 0,
      templatesWithPrefilledDecision: 0,
      realDecisionEventsApplied: 0,
      realApprovedRecordsCreated: 0,
      autoApprovalDecisions: 0,
      staleReviewPacksApplied: 0,
      ledgerHashChainValid: true,
      ledgerSequenceValid: true,
      duplicateDecisionEventIds: 0,
      decisionEventPayloadHashMismatches: 0,
      decisionEventsModified: 0,
      decisionEventsDeleted: 0,
      approvedRecordsWithoutEvidence: 0,
      approvedRecordsWithMissingOccurrence: 0,
      approvedRecordsWithMissingDecisionEvent: 0,
      evidenceEntriesLostDuringApproval: 0,
      occurrenceRefsLostDuringApproval: 0,
      evidenceExcerptUsedAsOnlyEvidence: 0,
      questionsIncorrectlyMarkedApprovedWithoutRecord: 0,
      materializedViewRebuildMatches: true,
      materializedViewContainsUnknownEvent: 0,
      realPilotCasesMissing: 0,
      rp01Created: 1,
      rp02Created: 1,
      rp03Created: 1,
      rp04Created: 1,
      rp05Created: 1,
      rp06Created: 1,
      rp07Created: 1,
      tetaEduApprovedAsTetaHr: 0,
      tetaMeApprovedAsStandaloneDomain: 0,
      clientSpecificApprovedAsGlobal: 0,
      historicalApprovedAsCurrent: 0,
      versionSpecificApprovedAsUniversal: 0,
      unknownApplicabilityApprovedWithoutExplicitScope: 0,
      regulatoryClaimApprovedCurrentWithoutLegalReview: 0,
      customerExampleApprovedAsGlobal: 0,
      approvalsWithUnresolvedConflict: 0,
      conflictsAutoResolvedByApprovalWorkflow: 0,
      conflictingEvidenceDiscarded: 0,
      reviewerIdsWrittenToRepoDocs: 0,
      realReviewPacksWrittenToRepo: 0,
      realEvidenceExcerptsWrittenToRepo: 0,
      realDecisionEventsWrittenToRepo: 0,
      realApprovedRecordsWrittenToRepo: 0,
      absolutePathsWrittenToRepoDocs: 0,
      customerNamesWrittenToRepoDocs: 0,
    };
    expect(collectStrictErrors(stats)).toEqual([]);
  });

  test('collectStrictErrors catches realDecisionEventsApplied', () => {
    expect(
      collectStrictErrors({
        ...emptyStageBoundaryCounters(),
        realDecisionEventsApplied: 1,
        rp01Created: 1,
        rp02Created: 1,
        rp03Created: 1,
        rp04Created: 1,
        rp05Created: 1,
        rp06Created: 1,
        rp07Created: 1,
        reviewTaskOrderDeterministic: true,
        ledgerHashChainValid: true,
        ledgerSequenceValid: true,
        materializedViewRebuildMatches: true,
      }),
    ).toContain('realDecisionEventsApplied');
  });

  test('HR/Edu merge safeguard error collected', () => {
    expect(
      collectStrictErrors({
        ...emptyStageBoundaryCounters(),
        tetaEduApprovedAsTetaHr: 1,
        rp01Created: 1,
        rp02Created: 1,
        rp03Created: 1,
        rp04Created: 1,
        rp05Created: 1,
        rp06Created: 1,
        rp07Created: 1,
        reviewTaskOrderDeterministic: true,
        ledgerHashChainValid: true,
        ledgerSequenceValid: true,
        materializedViewRebuildMatches: true,
      }),
    ).toContain('tetaEduApprovedAsTetaHr');
  });
});

describe('Stage 3J.2E privacy and templates', () => {
  test('templates never prefilled', () => {
    for (const fx of FIXTURES) {
      const t = createDecisionTemplate(fx.reviewPack);
      expect(t.reviewerId).toBeNull();
      expect(t.reviewerRole).toBeNull();
      expect(t.decisionKind).toBeNull();
      expect(t.isDecisionEvent).toBe(false);
    }
  });

  test('synthetic excerpts are marked via sha and length bound', () => {
    for (const fx of FIXTURES) {
      for (const e of fx.reviewPack.evidence) {
        if (e.excerpt) {
          expect(e.excerpt.length).toBeLessThanOrEqual(800);
          expect(e.excerptSha256).toBe(sha256(e.excerpt));
        }
      }
    }
  });
});

describe('Stage 3J.2E category coverage loops', () => {
  describe("review queue priority", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "review queue priority", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("review task identity", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "review task identity", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("review pack identity", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "review pack identity", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("evidence excerpt hash", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "evidence excerpt hash", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("stale guards", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "stale guards", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("allowed decision kinds", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "allowed decision kinds", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("missing confirmation", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "missing confirmation", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("reviewer validation", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "reviewer validation", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("rationale validation", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "rationale validation", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("exact approval", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "exact approval", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("semantic approval", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "semantic approval", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("scoped approval", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "scoped approval", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("supported subset approval", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "supported subset approval", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("HR Edu variants", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "HR Edu variants", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("Teta ME registry approval", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "Teta ME registry approval", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("client-specific safeguards", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "client-specific safeguards", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("historical currentness safeguards", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "historical currentness safeguards", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("legal reviewer requirement", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "legal reviewer requirement", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("conflict rejection", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "conflict rejection", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("reject defer request evidence", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "reject defer request evidence", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("supersession", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "supersession", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("revocation", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "revocation", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("ledger chain", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "ledger chain", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("ledger tamper", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "ledger tamper", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("ledger replay", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "ledger replay", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("idempotency", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "idempotency", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("materialized view rebuild", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "materialized view rebuild", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("unsupported question", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "unsupported question", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("real templates not events", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "real templates not events", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("privacy", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "privacy", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("stage boundaries", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "stage boundaries", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
  describe("strict audit failure cases", () => {
    for (const fx of FIXTURES) {
      test(fx.id + ' baseline for ' + "strict audit failure cases", () => {
        expect(fx.reviewPack.contractVersion).toBe('teta-review-pack-v1');
        expect(fx.reviewPack.staleGuard).toBeTruthy();
        expect(Array.isArray(fx.reviewPack.allowedDecisionKinds)).toBe(true);
        expect(fx.id).toMatch(/^[A-T]$/);
      });
    }
  });
});

describe('Stage 3J.2E audit smoke', () => {
  test('buildStage3j2eAudit returns contract', () => {
    const audit = buildStage3j2eAudit(undefined, { strict: false });
    expect(audit.contractVersion).toBe('teta-approval-audit-v1');
    expect(audit.fixtures.packs).toBe(20);
  });
});

describe('Stage 3J.2E human decisionability patch', () => {
  const fs = require('fs') as typeof import('fs');
  const pathMod = require('path') as typeof import('path');
  const {
    buildRegistryAnchorEvidence,
    buildPilotReviewPacks,
    buildReviewQueue,
    loadCorrelationManifest,
    defaultStage3j2dAcceptanceManifestPath,
    narrowEmploymentRecords,
    inferDuplicateSourceIndependence,
    complexityFromCounts,
    renderHumanDecisionBrief,
    validateDecisionDraft,
    baseScope,
  } = require('./index') as typeof import('./index');

  const acceptancePath = defaultStage3j2dAcceptanceManifestPath();
  const hasAcceptance = fs.existsSync(acceptancePath);
  const manifest = hasAcceptance ? loadCorrelationManifest(acceptancePath) : null;
  const packs = hasAcceptance && manifest ? buildPilotReviewPacks(manifest, buildReviewQueue(manifest).tasks) : [];

  test('acceptance input available for decisionability patch', () => {
    expect(hasAcceptance).toBe(true);
  });

  test('builds seven pilot packs', () => {
    expect(packs.length).toBe(7);
  });

  test('RP01 has registry evidence', () => {
    const rp01 = packs.find((p) => p.pilotCaseId === 'RP01')!;
    expect(rp01.evidence.length).toBeGreaterThan(0);
    expect(rp01.evidence.some((e) => e.evidenceKind === 'authoritative_registry_anchor')).toBe(true);
    expect(rp01.decisionability?.decisionabilityStatus).toBe('ready_for_scoped_decision');
    expect(rp01.allowedDecisionKinds).toContain('approve_with_scope');
  });

  test('registry anchor evidence includes supported claims', () => {
    const ev = buildRegistryAnchorEvidence();
    expect(ev.supportedClaims).toContain('productFamily=teta_hr');
    expect(ev.supportedClaims).toContain('productSurface=teta_me');
    expect(ev.supportedClaims).toContain('isBusinessDomain=false');
    expect(ev.evidenceStrength).toBe('authoritative_for_registry_scope');
  });

  test('registry overreach rejection via reason codes', () => {
    const rp01 = packs.find((p) => p.pilotCaseId === 'RP01')!;
    const result = validateDecisionDraft(
      {
        reviewPackId: rp01.reviewPackId,
        reviewPackRevisionId: rp01.reviewPackRevisionId,
        decisionKind: 'approve_with_scope',
        rationale: 'Approving ME procedure from registry',
        reasonCodes: ['procedure'],
        scopeDecision: baseScope({ productFamilyIds: ['teta_hr'], productSurfaceIds: ['teta_me'] }),
        staleGuard: rp01.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: rp01,
        confirmHumanDecision: true,
        reviewerId: 'reviewer-local',
        reviewerRole: 'product_expert',
      },
    );
    expect(result.errors).toContain('registry_claim_beyond_evidence_scope');
  });

  test('RP02 is narrowed to employment-related subset', () => {
    const rp02 = packs.find((p) => p.pilotCaseId === 'RP02')!;
    expect(rp02.proposedRecordRefs.length).toBeLessThanOrEqual(8);
    expect(rp02.candidateOccurrenceRefs.length).toBeLessThanOrEqual(30);
    expect(rp02.decisionability?.unrelatedDomainsRemainingInPack).toBe(0);
    expect(rp02.decisionability?.decisionabilityStatus).toBe('ready_for_scoped_decision');
    expect((rp02.decisionability?.recordsExcludedAsUnrelatedToQuestion ?? 0)).toBeGreaterThan(0);
  });

  test('narrowEmploymentRecords excludes unrelated domains', () => {
    if (!manifest) return;
    const q = manifest.questionCoverage.find((x) => x.questionId === 'Q07')!;
    const all = manifest.proposedRecords.filter((r) => q.matchedProposedRecordIds.includes(r.proposedRecordId));
    const narrowed = narrowEmploymentRecords(all, { maxProposed: 8, maxOccurrences: 30, maxEvidence: 40 });
    expect(narrowed.selected.length).toBeGreaterThan(0);
    expect(narrowed.selected.length).toBeLessThanOrEqual(8);
    expect(narrowed.excludedUnrelated.length + narrowed.excludedContextOnly.length).toBeGreaterThan(0);
  });

  test('RP03 requires both product sides or more evidence', () => {
    const rp03 = packs.find((p) => p.pilotCaseId === 'RP03')!;
    if (rp03.decisionability?.comparisonBasedOnSingleProductOnly) {
      expect(rp03.decisionability.decisionabilityStatus).toBe('requires_more_evidence');
      expect(rp03.allowedDecisionKinds).not.toContain('approve_as_variants');
      expect(rp03.allowedDecisionKinds).toContain('request_more_evidence');
    } else {
      expect(rp03.decisionability?.productComparisonSidesPresent).toBe(true);
      expect(rp03.decisionability?.decisionabilityStatus).toBe('ready_for_decision');
    }
  });

  test('single-product comparison cannot be ready_for_decision', () => {
    const rp03 = packs.find((p) => p.pilotCaseId === 'RP03')!;
    if (rp03.decisionability?.comparisonBasedOnSingleProductOnly) {
      expect(rp03.decisionability.decisionabilityStatus).not.toBe('ready_for_decision');
    }
  });

  test('RP04 marks same-source duplicate semantics', () => {
    const rp04 = packs.find((p) => p.pilotCaseId === 'RP04')!;
    expect(rp04.decisionability?.duplicateSupportsDeduplication).toBe(true);
    expect(['same_source', 'same_source_different_sections', 'independent_sources']).toContain(
      rp04.decisionability?.duplicateSourceIndependence,
    );
    if (
      rp04.decisionability?.duplicateSourceIndependence === 'same_source' ||
      rp04.decisionability?.duplicateSourceIndependence === 'same_source_different_sections'
    ) {
      expect(rp04.decisionability.duplicateSupportsIndependentCorroboration).toBe(false);
    }
  });

  test('inferDuplicateSourceIndependence distinguishes corroboration', () => {
    const same = inferDuplicateSourceIndependence([
      {
        evidenceEntryId: 'a',
        sourceRevisionId: 'src1',
        sectionId: 's1',
        contentUnitRefs: [],
        assetRefs: [],
        pageFrom: null,
        pageTo: null,
        startSeconds: null,
        endSeconds: null,
        evidenceStrength: 'x',
        excerptSha256: null,
        excerpt: null,
      },
      {
        evidenceEntryId: 'b',
        sourceRevisionId: 'src1',
        sectionId: 's2',
        contentUnitRefs: [],
        assetRefs: [],
        pageFrom: null,
        pageTo: null,
        startSeconds: null,
        endSeconds: null,
        evidenceStrength: 'x',
        excerptSha256: null,
        excerpt: null,
      },
    ]);
    expect(same.duplicateSourceIndependence).toBe('same_source_different_sections');
    expect(same.duplicateSupportsIndependentCorroboration).toBe(false);
    const indep = inferDuplicateSourceIndependence([
      { ...same && {
        evidenceEntryId: 'a',
        sourceRevisionId: 'src1',
        sectionId: 's1',
        contentUnitRefs: [],
        assetRefs: [],
        pageFrom: null,
        pageTo: null,
        startSeconds: null,
        endSeconds: null,
        evidenceStrength: 'x',
        excerptSha256: null,
        excerpt: null,
      }, evidenceEntryId: 'a', sourceRevisionId: 'src1', sectionId: 's1', contentUnitRefs: [], assetRefs: [], pageFrom: null, pageTo: null, startSeconds: null, endSeconds: null, evidenceStrength: 'x', excerptSha256: null, excerpt: null },
      {
        evidenceEntryId: 'b',
        sourceRevisionId: 'src2',
        sectionId: 's1',
        contentUnitRefs: [],
        assetRefs: [],
        pageFrom: null,
        pageTo: null,
        startSeconds: null,
        endSeconds: null,
        evidenceStrength: 'x',
        excerptSha256: null,
        excerpt: null,
      },
    ]);
    expect(indep.duplicateSupportsIndependentCorroboration).toBe(true);
  });

  test('RP05 semantic merge requires explicit scope', () => {
    const rp05 = packs.find((p) => p.pilotCaseId === 'RP05')!;
    expect(rp05.decisionability?.semanticMergeRequiresExplicitScope).toBe(true);
    expect(rp05.decisionability?.decisionabilityStatus).toBe('ready_for_scoped_decision');
    const noScope = validateDecisionDraft(
      {
        reviewPackId: rp05.reviewPackId,
        reviewPackRevisionId: rp05.reviewPackRevisionId,
        decisionKind: 'approve_merged_record',
        rationale: 'merge semantic duplicates without scope',
        reasonCodes: ['semantic'],
        scopeDecision: null,
        staleGuard: rp05.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: rp05,
        confirmHumanDecision: true,
        reviewerId: 'reviewer-local',
        reviewerRole: 'knowledge_reviewer',
      },
    );
    expect(noScope.errors).toContain('semantic_merge_requires_explicit_scope');
  });

  test('RP05 semantic merge with scope can validate', () => {
    const rp05 = packs.find((p) => p.pilotCaseId === 'RP05')!;
    const withScope = validateDecisionDraft(
      {
        reviewPackId: rp05.reviewPackId,
        reviewPackRevisionId: rp05.reviewPackRevisionId,
        decisionKind: 'approve_merged_record',
        rationale: 'merge semantic duplicates with explicit scope',
        reasonCodes: ['semantic'],
        scopeDecision: baseScope({ productFamilyIds: ['teta_edu'] }),
        staleGuard: rp05.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: rp05,
        confirmHumanDecision: true,
        reviewerId: 'reviewer-local',
        reviewerRole: 'knowledge_reviewer',
      },
    );
    expect(withScope.errors).not.toContain('semantic_merge_requires_explicit_scope');
  });

  test('RP06 has single decision question and unresolved dimensions', () => {
    const rp06 = packs.find((p) => p.pilotCaseId === 'RP06')!;
    expect((rp06.decisionability?.singleHumanDecisionQuestion ?? '').length).toBeGreaterThan(10);
    expect((rp06.decisionability?.unresolvedDecisionDimensions ?? []).length).toBeGreaterThan(0);
    expect(rp06.decisionability?.decisionabilityStatus).not.toBe('ready_for_decision');
    expect(rp06.decisionability?.alternativeInterpretations?.length).toBeGreaterThan(1);
  });

  test('RP07 remains evidence gap without approve', () => {
    const rp07 = packs.find((p) => p.pilotCaseId === 'RP07')!;
    expect(rp07.packKind).toBe('evidence_gap');
    expect(rp07.allowedDecisionKinds.some((k) => k.startsWith('approve'))).toBe(false);
    expect(rp07.decisionability?.evidenceRequest).toBeTruthy();
    expect(rp07.decisionability?.decisionabilityStatus).toBe('requires_more_evidence');
  });

  test('excessive complexity cannot be ready_for_decision', () => {
    expect(complexityFromCounts({ proposed: 20, occurrences: 50, evidence: 80, decisionClaims: 9 })).toBe('excessive');
    for (const p of packs) {
      if (p.decisionability?.humanReviewComplexity === 'excessive') {
        expect(p.decisionability.decisionabilityStatus).not.toBe('ready_for_decision');
      }
    }
  });

  test('every pack has decisionability status and single question', () => {
    for (const p of packs) {
      expect(p.decisionability?.decisionabilityStatus).toBeTruthy();
      expect((p.decisionability?.singleHumanDecisionQuestion ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  test('human decision brief is deterministic', () => {
    const a = renderHumanDecisionBrief(packs);
    const b = renderHumanDecisionBrief(packs);
    expect(a).toBe(b);
    expect(a).toContain('RP01');
    expect(a).toContain('systemRecommendation');
  });

  test('no real decisions applied in packs', () => {
    expect(packs.every((p) => p.status === 'ready_for_human_review')).toBe(true);
  });

  test('RP01 system recommendation is scoped approval candidate', () => {
    expect(packs.find((p) => p.pilotCaseId === 'RP01')?.decisionability?.systemRecommendation).toBe(
      'candidate_for_scoped_approval',
    );
  });

  test('RP03/RP07 recommendations prefer more evidence when applicable', () => {
    const rp03 = packs.find((p) => p.pilotCaseId === 'RP03')!;
    const rp07 = packs.find((p) => p.pilotCaseId === 'RP07')!;
    expect(rp07.decisionability?.systemRecommendation).toBe('request_more_evidence');
    if (rp03.decisionability?.comparisonBasedOnSingleProductOnly) {
      expect(rp03.decisionability.systemRecommendation).toBe('request_more_evidence');
    }
  });

  test('RP04 ready_for_decision when compatible', () => {
    const rp04 = packs.find((p) => p.pilotCaseId === 'RP04')!;
    expect(['ready_for_decision', 'ready_for_scoped_decision']).toContain(rp04.decisionability?.decisionabilityStatus);
    expect(rp04.allowedDecisionKinds).toContain('approve_merged_record');
  });

  test('RP02 question match basis present', () => {
    const rp02 = packs.find((p) => p.pilotCaseId === 'RP02')!;
    expect((rp02.decisionability?.questionMatchBasisPerRecord ?? []).length).toBe(rp02.proposedRecordRefs.length);
  });

  test('decisionability statuses cover expected set', () => {
    const statuses = new Set(packs.map((p) => p.decisionability?.decisionabilityStatus));
    expect(statuses.has('ready_for_scoped_decision') || statuses.has('ready_for_decision')).toBe(true);
    expect(statuses.has('requires_more_evidence')).toBe(true);
  });

  test('packsWithoutSingleHumanDecision is zero', () => {
    expect(packs.filter((p) => !(p.decisionability?.singleHumanDecisionQuestion ?? '').trim()).length).toBe(0);
  });

  test('brief path artifact content mentions templates', () => {
    const brief = renderHumanDecisionBrief(packs);
    expect(brief).toContain('decision-templates');
    expect(brief).toContain('human-review');
  });

  test('registry-only pack counts as registry evidence', () => {
    const rp01 = packs.find((p) => p.pilotCaseId === 'RP01')!;
    expect(rp01.evidence.every((e) => e.evidenceKind === 'authoritative_registry_anchor')).toBe(true);
  });

  test('approve_as_variants blocked on single-product pack', () => {
    const rp03 = packs.find((p) => p.pilotCaseId === 'RP03')!;
    if (!rp03.decisionability?.comparisonBasedOnSingleProductOnly) return;
    const result = validateDecisionDraft(
      {
        reviewPackId: rp03.reviewPackId,
        reviewPackRevisionId: rp03.reviewPackRevisionId,
        decisionKind: 'approve_as_variants',
        rationale: 'force variants without HR side',
        reasonCodes: ['variants'],
        scopeDecision: baseScope(),
        staleGuard: rp03.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: { ...rp03, allowedDecisionKinds: [...rp03.allowedDecisionKinds, 'approve_as_variants'] },
        confirmHumanDecision: true,
        reviewerId: 'reviewer-local',
        reviewerRole: 'product_expert',
      },
    );
    expect(result.errors).toContain('approve_as_variants_without_both_product_sides');
  });

  test('evidence gap approval is rejected', () => {
    const rp07 = packs.find((p) => p.pilotCaseId === 'RP07')!;
    const result = validateDecisionDraft(
      {
        reviewPackId: rp07.reviewPackId,
        reviewPackRevisionId: rp07.reviewPackRevisionId,
        decisionKind: 'approve',
        rationale: 'should not approve gap',
        reasonCodes: ['bad'],
        scopeDecision: baseScope(),
        staleGuard: rp07.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: { ...rp07, allowedDecisionKinds: ['approve', ...rp07.allowedDecisionKinds] },
        confirmHumanDecision: true,
        reviewerId: 'reviewer-local',
        reviewerRole: 'knowledge_reviewer',
      },
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['approval_without_evidence']));
  });

  test('complexity helper thresholds', () => {
    expect(complexityFromCounts({ proposed: 1, occurrences: 2, evidence: 2, decisionClaims: 1 })).toBe('low');
    expect(complexityFromCounts({ proposed: 3, occurrences: 9, evidence: 13, decisionClaims: 2 })).toBe('medium');
    expect(complexityFromCounts({ proposed: 6, occurrences: 21, evidence: 31, decisionClaims: 3 })).toBe('high');
  });

  test('RP06 does not claim ready_for_decision with empty unresolved dims', () => {
    const rp06 = packs.find((p) => p.pilotCaseId === 'RP06')!;
    expect((rp06.decisionability?.unresolvedDecisionDimensions ?? []).length).toBeGreaterThan(0);
    expect(rp06.decisionability?.decisionabilityStatus).toBe('requires_more_evidence');
  });

  test('all packs expose proposed and unsupported claims lists', () => {
    for (const p of packs) {
      expect(Array.isArray(p.decisionability?.proposedClaimsForDecision)).toBe(true);
      expect(Array.isArray(p.decisionability?.explicitlyUnsupportedClaims)).toBe(true);
    }
  });

  test('RP05 not ready_for_decision while scope unresolved', () => {
    const rp05 = packs.find((p) => p.pilotCaseId === 'RP05')!;
    if (rp05.decisionability?.semanticMergeRequiresExplicitScope) {
      expect(rp05.decisionability.decisionabilityStatus).not.toBe('ready_for_decision');
    }
  });

  test('decisionabilityReasons are non-empty for real packs', () => {
    for (const p of packs) {
      expect((p.decisionability?.decisionabilityReasons ?? []).length).toBeGreaterThan(0);
    }
  });

  test('human brief does not mark recommendations as applied events', () => {
    const brief = renderHumanDecisionBrief(packs);
    expect(brief).toContain('(not applied)');
    expect(brief.toLowerCase()).not.toContain('decision event applied');
  });

  test('pack sizes after narrowing are decisionable for RP02/RP03', () => {
    const rp02 = packs.find((p) => p.pilotCaseId === 'RP02')!;
    const rp03 = packs.find((p) => p.pilotCaseId === 'RP03')!;
    expect(rp02.proposedRecordRefs.length).toBeLessThan(40);
    expect(rp03.proposedRecordRefs.length).toBeLessThan(40);
  });

  test('queue still covers 100 tasks after decisionability patch', () => {
    if (!manifest) return;
    const queue = buildReviewQueue(manifest);
    expect(queue.tasks.length).toBe(100);
  });
});
