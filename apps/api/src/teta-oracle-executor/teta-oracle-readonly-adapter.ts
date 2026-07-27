/**
 * Stage 3F — oracledb-backed read-only adapter.
 *
 * The only file in the module that knows about a database driver. Credentials and the connect string
 * are injected, so unit tests replace the whole adapter with a fake and never load `oracledb` at all
 * (the driver is required lazily inside `openConnection`).
 *
 * Business SELECTs use an explicit ResultSet so the executor can close the cursor before the
 * connection. autoCommit stays false.
 */
import { STAGE3F_CONNECTION_SETTINGS } from './teta-oracle-execution-policy';
import {
  STAGE3F_PREFLIGHT_RESULT_COLUMN,
  STAGE3F_PREFLIGHT_SESSION_USER_SQL,
  type Stage3fAdapterCounters,
  type Stage3fAdapterSelectOptions,
  type Stage3fAdapterSelectResult,
  type Stage3fOracleAdapter,
} from './teta-oracle-executor.types';

export type Stage3fOracleCredentials = {
  user: string;
  password: string;
  connectString: string;
};

type OracleExecuteOptions = {
  outFormat: number;
  maxRows?: number;
  autoCommit: boolean;
  extendedMetaData?: boolean;
  resultSet?: boolean;
};

type OracleResultSet = {
  getRows(numRows: number): Promise<unknown[][]>;
  close(): Promise<void>;
  metaData?: Array<{ name: string; dbTypeName?: string }>;
};

type OracleConnection = {
  execute(
    sql: string,
    binds: Record<string, unknown>,
    options: OracleExecuteOptions,
  ): Promise<{
    rows?: unknown[][];
    metaData?: Array<{ name: string; dbTypeName?: string }>;
    resultSet?: OracleResultSet;
  }>;
  break(): Promise<void>;
  close(): Promise<void>;
  callTimeout?: number;
};

type OracleDriver = {
  OUT_FORMAT_ARRAY: number;
  getConnection(config: {
    user: string;
    password: string;
    connectString: string;
  }): Promise<OracleConnection>;
};

function loadDriver(): OracleDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('oracledb') as OracleDriver & { default?: OracleDriver };
  return loaded.default ?? loaded;
}

export type Stage3fOracleAdapterOptions = {
  credentials: Stage3fOracleCredentials;
  /**
   * Bind names declared by the compiled select, in ordinal order. Positional values handed to
   * `executeSelect` are zipped back onto these names, because the compiler emits named placeholders.
   */
  bindNames?: string[];
  /** Driver-level call timeout; the executor also enforces its own deadline. */
  callTimeoutMs?: number;
};

export type Stage3fLiveOracleAdapter = Stage3fOracleAdapter & {
  counters: Stage3fAdapterCounters;
};

export function createOracleReadOnlyAdapter(
  options: Stage3fOracleAdapterOptions,
): Stage3fLiveOracleAdapter {
  const counters: Stage3fAdapterCounters = {
    connectionsOpened: 0,
    connectionsClosed: 0,
    preflightStatements: 0,
    businessStatements: 0,
    breaks: 0,
    resultSetsOpened: 0,
    resultSetsClosed: 0,
  };
  const bindNames = options.bindNames ?? [];
  let connection: OracleConnection | null = null;
  let openResultSet: OracleResultSet | null = null;

  const requireConnection = (): OracleConnection => {
    if (!connection) throw new Error('Stage 3F adapter has no open Oracle connection');
    return connection;
  };

  const bindObject = (binds: unknown[]): Record<string, unknown> => {
    if (binds.length === 0) return {};
    if (binds.length !== bindNames.length) {
      throw new Error(
        `Stage 3F adapter received ${binds.length} bind value(s) but knows ${bindNames.length} bind name(s)`,
      );
    }
    const mapped: Record<string, unknown> = {};
    bindNames.forEach((name, index) => {
      mapped[name] = binds[index];
    });
    return mapped;
  };

  return {
    counters,

    isConnectionOpen(): boolean {
      return connection !== null;
    },

    hasOpenResultSet(): boolean {
      return openResultSet !== null;
    },

    async openConnection(): Promise<void> {
      const driver = loadDriver();
      connection = await driver.getConnection({
        user: options.credentials.user,
        password: options.credentials.password,
        connectString: options.credentials.connectString,
      });
      if (options.callTimeoutMs) connection.callTimeout = options.callTimeoutMs;
      counters.connectionsOpened += 1;
    },

    async closeConnection(): Promise<void> {
      if (!connection) return;
      const open = connection;
      connection = null;
      await open.close();
      counters.connectionsClosed += 1;
    },

    async closeResultSet(): Promise<void> {
      if (!openResultSet) return;
      const rs = openResultSet;
      openResultSet = null;
      await rs.close();
      counters.resultSetsClosed += 1;
    },

    async executePreflightSessionUser(): Promise<string> {
      const driver = loadDriver();
      const result = await requireConnection().execute(
        STAGE3F_PREFLIGHT_SESSION_USER_SQL,
        {},
        {
          outFormat: driver.OUT_FORMAT_ARRAY,
          maxRows: 1,
          autoCommit: STAGE3F_CONNECTION_SETTINGS.autoCommit,
        },
      );
      counters.preflightStatements += 1;
      const first = result.rows?.[0]?.[0];
      if (typeof first !== 'string') {
        throw new Error(
          `Preflight did not return a ${STAGE3F_PREFLIGHT_RESULT_COLUMN} string value`,
        );
      }
      return first;
    },

    async executeSelect(
      sql: string,
      binds: unknown[],
      selectOptions: Stage3fAdapterSelectOptions,
    ): Promise<Stage3fAdapterSelectResult> {
      const driver = loadDriver();
      const open = requireConnection();
      open.callTimeout = selectOptions.timeoutMs;
      counters.resultSetsOpened += 1;

      const result = await open.execute(sql, bindObject(binds), {
        outFormat: driver.OUT_FORMAT_ARRAY,
        autoCommit: STAGE3F_CONNECTION_SETTINGS.autoCommit,
        extendedMetaData: true,
        resultSet: true,
      });

      const resultSet = result.resultSet;
      if (!resultSet) {
        throw new Error('Oracle execute did not return a ResultSet');
      }
      openResultSet = resultSet;
      counters.businessStatements += 1;

      try {
        const rows = await resultSet.getRows(selectOptions.maxRows);
        const metaData = resultSet.metaData ?? result.metaData ?? [];
        return {
          columns: metaData.map((meta) => meta.name),
          rows: rows ?? [],
          metaData: metaData.map((meta) => ({ name: meta.name, dbTypeName: meta.dbTypeName })),
        };
      } finally {
        // Prefer closing here so rows are released before the executor continues; the executor
        // still calls closeResultSet() which becomes a no-op when already closed.
        if (openResultSet === resultSet) {
          openResultSet = null;
          await resultSet.close();
          counters.resultSetsClosed += 1;
        }
      }
    },

    async break(): Promise<void> {
      if (!connection) return;
      await connection.break();
      counters.breaks += 1;
    },
  };
}
