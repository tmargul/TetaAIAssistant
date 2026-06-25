import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OracleConnectionInput, OracleTestConnectionResponse, TnsListResponse } from '@teta/shared';
import type { OracleClient } from './oracle-client.interface';
import oracledb from './oracle-driver';
import { loadTnsEntries } from './tns-parser';

@Injectable()
export class RealOracleClient implements OracleClient {
  constructor(private readonly config: ConfigService) {}

  async testConnection(
    input: OracleConnectionInput,
    connectString: string,
  ): Promise<OracleTestConnectionResponse> {
    try {
      const connection = await oracledb.getConnection({
        user: input.username,
        password: input.password ?? '',
        connectString,
      });

      try {
        const result = await connection.execute<{ BANNER: string }>(
          'SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1',
          {},
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        const version = result.rows?.[0]?.BANNER ?? 'Połączenie udane';
        return {
          success: true,
          message: 'Połączenie z bazą Oracle Teta udane.',
          databaseVersion: version,
        };
      } finally {
        await connection.close();
      }
    } catch (err: unknown) {
      return { success: false, message: this.formatOracleError(err) };
    }
  }

  async verifyUserConnection(
    username: string,
    password: string,
    connectString: string,
  ): Promise<void> {
    await this.withConnection(username, password, connectString, async (connection) => {
      await connection.execute('SELECT 1 FROM DUAL');
    });
  }

  async verifyAdministrator(
    username: string,
    password: string,
    connectString: string,
  ): Promise<void> {
    const sql = this.config.get<string>('TETA_ADMIN_CHECK_SQL')?.trim();
    if (!sql) {
      throw new InternalServerErrorException(
        'Ustaw TETA_ADMIN_CHECK_SQL w pliku .env — zapytanie weryfikujące administratora Teta.',
      );
    }

    await this.withConnection(username, password, connectString, async (connection) => {
      const result = await connection.execute(
        sql,
        { username: username.trim() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      if (!result.rows?.length) {
        throw new BadRequestException(
          'Użytkownik nie ma uprawnień administratora Teta lub zapytanie weryfikacyjne nie zwróciło wyniku.',
        );
      }
    });
  }

  listTnsEntries(): TnsListResponse {
    return loadTnsEntries();
  }

  private async withConnection<T>(
    username: string,
    password: string,
    connectString: string,
    fn: (connection: import('oracledb').Connection) => Promise<T>,
  ): Promise<T> {
    let connection: import('oracledb').Connection | undefined;
    try {
      connection = await oracledb.getConnection({
        user: username.trim(),
        password,
        connectString,
      });
      return await fn(connection);
    } catch (err: unknown) {
      if (err instanceof BadRequestException || err instanceof InternalServerErrorException) {
        throw err;
      }
      throw new BadRequestException(this.formatOracleError(err));
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }

  private formatOracleError(err: unknown): string {
    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('NJS-510') || message.includes('transportConnectTimeout')) {
        return `${message} — host Oracle jest nieosiągalny (sprawdź, czy VM działa, IP i firewall na porcie 1521).`;
      }
      if (message.includes('NJS-')) {
        return message;
      }
      return message;
    }
    return 'Nieznany błąd połączenia z Oracle.';
  }
}
