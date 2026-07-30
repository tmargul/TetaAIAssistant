import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import path from 'path';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { DecisionEventV1, LedgerManifestV1 } from './teta-approval.types';
import { TETA_DECISION_LEDGER_MANIFEST_CONTRACT_VERSION } from './teta-approval.types';

export type LedgerValidation = {
  events: DecisionEventV1[];
  manifest: LedgerManifestV1;
  stats: {
    decisionEventsRead: number;
    decisionEventsAppended: number;
    decisionEventsModified: number;
    decisionEventsDeleted: number;
    ledgerHashChainValid: boolean;
    ledgerSequenceValid: boolean;
    duplicateDecisionEventIds: number;
    decisionEventPayloadHashMismatches: number;
    decisionEventsWithoutReviewer: number;
    decisionEventsWithoutRationale: number;
    tamperedLedgerDetected: boolean;
  };
};

function eventPayloadForHash(event: Omit<DecisionEventV1, 'ledger'> & { ledger?: Partial<DecisionEventV1['ledger']> }) {
  const { ledger: _l, ...rest } = event;
  return rest;
}

export function computeEventSha256(
  event: Omit<DecisionEventV1, 'ledger'> & { ledger?: { previousEventSha256: string | null; sequenceNumber: number; ledgerId: string } },
): string {
  return sha256(
    stableStringify({
      payload: eventPayloadForHash(event),
      previousEventSha256: event.ledger?.previousEventSha256 ?? null,
      sequenceNumber: event.ledger?.sequenceNumber ?? 0,
      ledgerId: event.ledger?.ledgerId ?? null,
    }),
  );
}

export function createDecisionEventId(event: Omit<DecisionEventV1, 'decisionEventId' | 'ledger'>): string {
  return `decision:sha256:${sha256(
    stableStringify({
      reviewPackId: event.reviewPackId,
      reviewPackRevisionId: event.reviewPackRevisionId,
      decisionKind: event.decisionKind,
      reviewerId: event.reviewer.reviewerId,
      rationale: event.rationale,
      reasonCodes: event.reasonCodes,
      staleGuard: event.staleGuard,
    }),
  )}`;
}

export function emptyLedgerManifest(ledgerId = 'ledger:stage3j2e'): LedgerManifestV1 {
  return {
    contractVersion: TETA_DECISION_LEDGER_MANIFEST_CONTRACT_VERSION,
    ledgerId,
    eventCount: 0,
    headEventSha256: null,
    chainValid: true,
    sequenceValid: true,
  };
}

export function readLedger(ledgerDir: string): LedgerValidation {
  const jsonlPath = path.join(ledgerDir, 'approval-decisions.jsonl');
  const manifestPath = path.join(ledgerDir, 'ledger-manifest.json');
  const events: DecisionEventV1[] = [];
  if (existsSync(jsonlPath)) {
    const raw = readFileSync(jsonlPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line) as DecisionEventV1);
    }
  }
  const validation = validateLedgerEvents(events);
  const manifest: LedgerManifestV1 = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as LedgerManifestV1)
    : {
        ...emptyLedgerManifest(),
        eventCount: events.length,
        headEventSha256: events.length ? events[events.length - 1]!.ledger.eventSha256 : null,
        chainValid: validation.stats.ledgerHashChainValid,
        sequenceValid: validation.stats.ledgerSequenceValid,
      };
  return { ...validation, events, manifest };
}

export function validateLedgerEvents(events: DecisionEventV1[]): Omit<LedgerValidation, 'events' | 'manifest'> & {
  events?: DecisionEventV1[];
  manifest?: LedgerManifestV1;
} {
  let previous: string | null = null;
  let chainValid = true;
  let sequenceValid = true;
  let payloadMismatches = 0;
  const ids = new Set<string>();
  let duplicates = 0;
  let withoutReviewer = 0;
  let withoutRationale = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ids.has(ev.decisionEventId)) duplicates += 1;
    ids.add(ev.decisionEventId);
    if (!ev.reviewer?.reviewerId) withoutReviewer += 1;
    if (!ev.rationale?.trim()) withoutRationale += 1;
    if (ev.ledger.previousEventSha256 !== previous) chainValid = false;
    if (ev.ledger.sequenceNumber !== i + 1) sequenceValid = false;
    const expected = computeEventSha256({
      ...ev,
      ledger: {
        previousEventSha256: ev.ledger.previousEventSha256,
        sequenceNumber: ev.ledger.sequenceNumber,
        ledgerId: ev.ledger.ledgerId,
      },
    });
    if (expected !== ev.ledger.eventSha256) {
      payloadMismatches += 1;
      chainValid = false;
    }
    previous = ev.ledger.eventSha256;
  }

  return {
    stats: {
      decisionEventsRead: events.length,
      decisionEventsAppended: 0,
      decisionEventsModified: 0,
      decisionEventsDeleted: 0,
      ledgerHashChainValid: chainValid,
      ledgerSequenceValid: sequenceValid,
      duplicateDecisionEventIds: duplicates,
      decisionEventPayloadHashMismatches: payloadMismatches,
      decisionEventsWithoutReviewer: withoutReviewer,
      decisionEventsWithoutRationale: withoutRationale,
      tamperedLedgerDetected: !chainValid || payloadMismatches > 0 || duplicates > 0,
    },
  };
}

export function appendDecisionEvent(
  ledgerDir: string,
  eventWithoutLedger: Omit<DecisionEventV1, 'ledger' | 'decisionEventId'> & { decisionEventId?: string },
): { event: DecisionEventV1; appended: boolean; reason?: string } {
  mkdirSync(ledgerDir, { recursive: true });
  const existing = readLedger(ledgerDir);
  const decisionEventId = eventWithoutLedger.decisionEventId ?? createDecisionEventId(eventWithoutLedger as never);
  if (existing.events.some((e) => e.decisionEventId === decisionEventId)) {
    return { event: existing.events.find((e) => e.decisionEventId === decisionEventId)!, appended: false, reason: 'duplicate' };
  }

  const previousEventSha256 = existing.events.length
    ? existing.events[existing.events.length - 1]!.ledger.eventSha256
    : null;
  const sequenceNumber = existing.events.length + 1;
  const ledgerId = existing.manifest.ledgerId || 'ledger:stage3j2e';
  const partial = {
    ...eventWithoutLedger,
    decisionEventId,
    ledger: { previousEventSha256, sequenceNumber, ledgerId },
  };
  const eventSha256 = computeEventSha256(partial);
  const event: DecisionEventV1 = {
    ...eventWithoutLedger,
    decisionEventId,
    ledger: {
      ledgerId,
      sequenceNumber,
      previousEventSha256,
      eventSha256,
    },
  };

  const jsonlPath = path.join(ledgerDir, 'approval-decisions.jsonl');
  appendFileSync(jsonlPath, `${JSON.stringify(event)}\n`, 'utf8');
  const manifest: LedgerManifestV1 = {
    contractVersion: TETA_DECISION_LEDGER_MANIFEST_CONTRACT_VERSION,
    ledgerId,
    eventCount: sequenceNumber,
    headEventSha256: eventSha256,
    chainValid: true,
    sequenceValid: true,
  };
  writeFileSync(path.join(ledgerDir, 'ledger-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { event, appended: true };
}

export function initEmptyLedger(ledgerDir: string): void {
  mkdirSync(ledgerDir, { recursive: true });
  const jsonlPath = path.join(ledgerDir, 'approval-decisions.jsonl');
  writeFileSync(jsonlPath, '', 'utf8');
  writeFileSync(path.join(ledgerDir, 'ledger-manifest.json'), `${JSON.stringify(emptyLedgerManifest(), null, 2)}\n`);
}
