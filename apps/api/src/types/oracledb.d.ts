declare module 'oracledb' {
  export interface Connection {
    execute<T = unknown>(
      sql: string,
      bindParams?: unknown,
      options?: { outFormat?: number; maxRows?: number; autoCommit?: boolean },
    ): Promise<{ rows?: T[]; metaData?: Array<{ name: string }> }>;
    close(): Promise<void>;
  }

  interface OracleDb {
    OUT_FORMAT_OBJECT: number;
    getConnection(config: {
      user: string;
      password: string;
      connectString: string;
    }): Promise<Connection>;
  }

  const oracledb: OracleDb;
  export default oracledb;
}
