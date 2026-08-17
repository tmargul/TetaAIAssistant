import fs from 'fs';
import path from 'path';
import type { EvalInteractionTrace } from './aia-eval.types';

export type EvalSession = {
  sessionId: string;
  startedAt: string;
  interactions: EvalInteractionTrace[];
};

export function createSession(repoRoot: string): EvalSession {
  const startedAt = new Date().toISOString();
  const sessionId = startedAt.replace(/[:.]/g, '-');
  const session: EvalSession = {
    sessionId,
    startedAt,
    interactions: [],
  };
  const dir = path.join(repoRoot, '.local', 'aia-eval', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return session;
}

function writeSession(repoRoot: string, session: EvalSession): void {
  const dir = path.join(repoRoot, '.local', 'aia-eval', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session.sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
}

export function appendInteraction(
  repoRoot: string,
  session: EvalSession,
  trace: EvalInteractionTrace,
): void {
  session.interactions.push(trace);
  writeSession(repoRoot, session);
  const traceFile = path.join(
    repoRoot,
    '.local',
    'aia-eval',
    'sessions',
    `${session.sessionId}-${session.interactions.length}.trace.json`,
  );
  fs.writeFileSync(traceFile, JSON.stringify(trace, null, 2), 'utf8');
}

export function attachVerdict(
  repoRoot: string,
  session: EvalSession,
  verdict: string,
): boolean {
  const last = session.interactions[session.interactions.length - 1];
  if (!last) return false;
  last.userVerdict = verdict;
  writeSession(repoRoot, session);
  return true;
}
