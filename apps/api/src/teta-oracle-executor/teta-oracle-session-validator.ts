/**
 * Stage 3F — session preflight.
 *
 * The compiled statement is fully qualified with `TETA_ADMIN` / `TETA_ADMIN_P` objects, so running it
 * as any other session user would either fail late or silently resolve through private synonyms.
 * The preflight settles that question with one metadata query before the business statement runs.
 */
import {
  STAGE3F_PREFLIGHT_SESSION_USER_SQL,
  STAGE3F_REQUIRED_SESSION_USER,
  type Stage3fViolation,
} from './teta-oracle-executor.types';

export type Stage3fSessionValidation = {
  ok: boolean;
  sessionUser: string | null;
  expectedSessionUser: string;
  violation: Stage3fViolation | null;
};

export function preflightSessionUserSql(): string {
  return STAGE3F_PREFLIGHT_SESSION_USER_SQL;
}

/** Oracle reports the session user upper-cased; comparison is case-insensitive and trimmed. */
export function normalizeSessionUser(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed.toUpperCase() : null;
}

export function validateSessionUser(raw: unknown): Stage3fSessionValidation {
  const sessionUser = normalizeSessionUser(raw);

  if (sessionUser === null) {
    return {
      ok: false,
      sessionUser: null,
      expectedSessionUser: STAGE3F_REQUIRED_SESSION_USER,
      violation: {
        code: 'session_user_unavailable',
        message: 'Preflight did not return a session user',
      },
    };
  }

  if (sessionUser !== STAGE3F_REQUIRED_SESSION_USER) {
    return {
      ok: false,
      sessionUser,
      expectedSessionUser: STAGE3F_REQUIRED_SESSION_USER,
      violation: {
        code: 'session_user_not_allowed',
        message: `Session user ${sessionUser} is not allowed; Stage 3F requires ${STAGE3F_REQUIRED_SESSION_USER}`,
      },
    };
  }

  return {
    ok: true,
    sessionUser,
    expectedSessionUser: STAGE3F_REQUIRED_SESSION_USER,
    violation: null,
  };
}
