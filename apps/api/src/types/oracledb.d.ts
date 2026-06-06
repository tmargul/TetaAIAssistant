declare module 'oracledb' {
  export const OUT_FORMAT_OBJECT: number;

  export interface Connection {
    execute<T = unknown>(
      sql: string,
      bindParams?: unknown,
      options?: { outFormat?: number },
    ): Promise<{ rows?: T[] }>;
    close(): Promise<void>;
  }

  export function getConnection(config: {
    user: string;
    password: string;
    connectString: string;
  }): Promise<Connection>;
}
