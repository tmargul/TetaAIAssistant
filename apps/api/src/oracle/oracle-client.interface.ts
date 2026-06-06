import type { OracleConnectionInput, OracleTestConnectionResponse, TnsListResponse } from '@teta/shared';

export const ORACLE_CLIENT = Symbol('ORACLE_CLIENT');

export interface OracleClient {
  testConnection(
    input: OracleConnectionInput,
    connectString: string,
  ): Promise<OracleTestConnectionResponse>;
  verifyUserConnection(
    username: string,
    password: string,
    connectString: string,
  ): Promise<void>;
  verifyAdministrator(username: string, password: string, connectString: string): Promise<void>;
  listTnsEntries(): TnsListResponse;
}
