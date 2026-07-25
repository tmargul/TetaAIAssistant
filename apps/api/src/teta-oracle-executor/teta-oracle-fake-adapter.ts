/**
 * Stage 3F — in-memory fake Oracle adapter for unit tests and offline audit.
 *
 * Never loads `oracledb`. Callers configure the session user, rows, latency and failure modes.
 */
import {
  STAGE3F_REQUIRED_SESSION_USER,
  type Stage3fAdapterCounters,
  type Stage3fAdapterSelectOptions,
  type Stage3fAdapterSelectResult,
  type Stage3fOracleAdapter,
} from './teta-oracle-executor.types';
import { Stage3fTimeoutError } from './teta-oracle-readonly-executor.service';

export type FakeOracleAdapterOptions = {
  sessionUser?: string;
  selectResult?: Stage3fAdapterSelectResult;
  selectFactory?: (
    sql: string,
    binds: unknown[],
    options: Stage3fAdapterSelectOptions,
  ) => Promise<Stage3fAdapterSelectResult> | Stage3fAdapterSelectResult;
  openError?: Error | null;
  preflightError?: Error | null;
  selectError?: Error | null;
  /** Artificial delay for the business SELECT; used with the executor deadline. */
  selectDelayMs?: number;
  /** When true, hanging select never resolves unless broken / timed out. */
  hangSelect?: boolean;
};

export type Stage3fFakeOracleAdapter = Stage3fOracleAdapter & {
  counters: Stage3fAdapterCounters;
  opened: boolean;
  lastSql: string | null;
  lastBinds: unknown[] | null;
  breakCalls: number;
  /** Statements seen, in order (preflight + business). */
  statements: string[];
};

export function createFakeOracleAdapter(
  options: FakeOracleAdapterOptions = {},
): Stage3fFakeOracleAdapter {
  const counters: Stage3fAdapterCounters = {
    connectionsOpened: 0,
    connectionsClosed: 0,
    preflightStatements: 0,
    businessStatements: 0,
    breaks: 0,
  };

  let opened = false;
  let lastSql: string | null = null;
  let lastBinds: unknown[] | null = null;
  let breakCalls = 0;
  const statements: string[] = [];
  let hangingReject: ((error: Error) => void) | null = null;

  const adapter: Stage3fFakeOracleAdapter = {
    counters,
    get opened() {
      return opened;
    },
    get lastSql() {
      return lastSql;
    },
    get lastBinds() {
      return lastBinds;
    },
    get breakCalls() {
      return breakCalls;
    },
    get statements() {
      return statements;
    },

    async openConnection(): Promise<void> {
      if (options.openError) throw options.openError;
      opened = true;
      counters.connectionsOpened += 1;
    },

    async closeConnection(): Promise<void> {
      opened = false;
      counters.connectionsClosed += 1;
      if (hangingReject) {
        hangingReject(new Stage3fTimeoutError(0));
        hangingReject = null;
      }
    },

    async executePreflightSessionUser(): Promise<string> {
      if (!opened) throw new Error('Fake adapter: connection not open');
      if (options.preflightError) throw options.preflightError;
      counters.preflightStatements += 1;
      statements.push('PREFLIGHT_SESSION_USER');
      return options.sessionUser ?? STAGE3F_REQUIRED_SESSION_USER;
    },

    async executeSelect(
      sql: string,
      binds: unknown[],
      selectOptions: Stage3fAdapterSelectOptions,
    ): Promise<Stage3fAdapterSelectResult> {
      if (!opened) throw new Error('Fake adapter: connection not open');
      lastSql = sql;
      lastBinds = binds;
      statements.push(sql);
      counters.businessStatements += 1;

      if (options.selectError) throw options.selectError;

      if (options.hangSelect) {
        return await new Promise<Stage3fAdapterSelectResult>((_resolve, reject) => {
          hangingReject = reject;
        });
      }

      if (options.selectDelayMs && options.selectDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.selectDelayMs));
        if (options.selectDelayMs > selectOptions.timeoutMs) {
          throw new Stage3fTimeoutError(selectOptions.timeoutMs);
        }
      }

      if (options.selectFactory) {
        return await options.selectFactory(sql, binds, selectOptions);
      }

      const base =
        options.selectResult ??
        ({
          columns: [],
          rows: [],
          metaData: [],
        } satisfies Stage3fAdapterSelectResult);

      const cappedRows = base.rows.slice(0, selectOptions.maxRows);
      return { ...base, rows: cappedRows };
    },

    async break(): Promise<void> {
      breakCalls += 1;
      counters.breaks += 1;
      if (hangingReject) {
        hangingReject(new Stage3fTimeoutError(1));
        hangingReject = null;
      }
    },
  };

  return adapter;
}
