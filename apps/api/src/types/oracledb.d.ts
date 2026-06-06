declare module 'oracledb' {
  export interface Connection {
    execute<T = unknown>(
      sql: string,
      bindParams?: unknown,
      options?: { outFormat?: number },
    ): Promise<{ rows?: T[] }>;
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
