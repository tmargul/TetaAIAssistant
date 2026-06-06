import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OracleConnectionConfig,
  OracleConnectionInput,
  OracleConnectionStatusResponse,
  OracleTestConnectionResponse,
  TetaOracleBackendMode,
  TnsListResponse,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { decryptSecret, encryptSecret } from './oracle-crypto';
import { ORACLE_CLIENT, type OracleClient } from './oracle-client.interface';
import { getOracleBackendMode } from './oracle-mode';

interface OracleConnectionRow {
  mode: 'basic' | 'tns';
  host: string | null;
  port: number | null;
  identifier_type: 'sid' | 'serviceName' | null;
  identifier: string | null;
  tns_alias: string | null;
  username: string;
  password_encrypted: string;
  updated_at: string;
}

@Injectable()
export class OracleConnectionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(ORACLE_CLIENT) private readonly oracleClient: OracleClient,
  ) {}

  getBackendMode(): TetaOracleBackendMode {
    return getOracleBackendMode(this.config);
  }

  getStatus(): OracleConnectionStatusResponse {
    const backendMode = this.getBackendMode();
    const row = this.getRow();
    if (!row) {
      return { configured: false, backendMode };
    }

    return {
      configured: true,
      backendMode,
      config: {
        ...this.rowToConfig(row),
        updatedAt: row.updated_at,
      },
    };
  }

  listTnsEntries(): TnsListResponse {
    return this.oracleClient.listTnsEntries();
  }

  async testConnection(input: OracleConnectionInput): Promise<OracleTestConnectionResponse> {
    this.validateInput(input);
    const connectString = this.buildConnectString(input);
    return this.oracleClient.testConnection(input, connectString);
  }

  async saveConnection(input: OracleConnectionInput): Promise<OracleConnectionStatusResponse> {
    const test = await this.testConnection(input);
    if (!test.success) {
      throw new BadRequestException(test.message);
    }

    const secret = this.getEncryptionSecret();
    const encrypted = encryptSecret(input.password, secret);
    const now = new Date().toISOString();

    this.db.connection
      .prepare(
        `INSERT INTO oracle_connection (
          id, mode, host, port, identifier_type, identifier, tns_alias,
          username, password_encrypted, updated_at
        ) VALUES (1, @mode, @host, @port, @identifier_type, @identifier, @tns_alias,
          @username, @password_encrypted, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          host = excluded.host,
          port = excluded.port,
          identifier_type = excluded.identifier_type,
          identifier = excluded.identifier,
          tns_alias = excluded.tns_alias,
          username = excluded.username,
          password_encrypted = excluded.password_encrypted,
          updated_at = excluded.updated_at`,
      )
      .run({
        mode: input.mode,
        host: input.host ?? null,
        port: input.port ?? null,
        identifier_type: input.identifierType ?? null,
        identifier: input.identifier ?? null,
        tns_alias: input.tnsAlias ?? null,
        username: input.username,
        password_encrypted: encrypted,
        updated_at: now,
      });

    return this.getStatus();
  }

  getStoredPassword(): string | null {
    const row = this.getRow();
    if (!row) return null;
    return decryptSecret(row.password_encrypted, this.getEncryptionSecret());
  }

  getStoredConfigWithPassword(): OracleConnectionInput | null {
    const row = this.getRow();
    if (!row) return null;
    const password = this.getStoredPassword();
    if (!password) return null;
    return { ...this.rowToConfig(row), password };
  }

  getStoredConnectString(): string {
    const config = this.getStoredConfigWithPassword();
    if (!config) {
      throw new BadRequestException('Połączenie Oracle nie jest skonfigurowane.');
    }
    return this.buildConnectString(config);
  }

  async verifyUserCredentials(username: string, password: string): Promise<void> {
    const connectString = this.getStoredConnectString();
    await this.oracleClient.verifyUserConnection(username, password, connectString);
  }

  async verifyTetaAdministrator(username: string, password: string): Promise<void> {
    const connectString = this.getStoredConnectString();
    await this.oracleClient.verifyAdministrator(username, password, connectString);
  }

  buildConnectString(input: OracleConnectionConfig): string {
    if (input.mode === 'tns') {
      if (!input.tnsAlias?.trim()) {
        throw new BadRequestException('Wybierz alias TNS.');
      }
      return input.tnsAlias.trim();
    }

    const host = input.host?.trim();
    const port = input.port ?? 1521;
    const identifier = input.identifier?.trim();

    if (!host) {
      throw new BadRequestException('Podaj adres IP lub host serwera.');
    }
    if (!identifier) {
      throw new BadRequestException('Podaj SID lub nazwę usługi.');
    }

    if (input.identifierType === 'serviceName') {
      return `${host}:${port}/${identifier}`;
    }

    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${identifier})))`;
  }

  private getRow(): OracleConnectionRow | undefined {
    return this.db.connection
      .prepare('SELECT * FROM oracle_connection WHERE id = 1')
      .get() as OracleConnectionRow | undefined;
  }

  private rowToConfig(row: OracleConnectionRow): OracleConnectionConfig {
    return {
      mode: row.mode,
      host: row.host ?? undefined,
      port: row.port ?? undefined,
      identifierType: row.identifier_type ?? undefined,
      identifier: row.identifier ?? undefined,
      tnsAlias: row.tns_alias ?? undefined,
      username: row.username,
    };
  }

  private validateInput(input: OracleConnectionInput) {
    if (!input.username?.trim()) {
      throw new BadRequestException('Podaj login użytkownika.');
    }
    if (!input.password) {
      throw new BadRequestException('Podaj hasło.');
    }

    if (input.mode === 'tns') {
      if (!input.tnsAlias?.trim()) {
        throw new BadRequestException('Wybierz alias TNS.');
      }
      return;
    }

    if (!input.host?.trim()) {
      throw new BadRequestException('Podaj adres IP lub host serwera.');
    }
    if (!input.port || input.port < 1 || input.port > 65535) {
      throw new BadRequestException('Podaj prawidłowy port (1–65535).');
    }
    if (!input.identifierType) {
      throw new BadRequestException('Wybierz typ identyfikatora: SID lub Service Name.');
    }
    if (!input.identifier?.trim()) {
      throw new BadRequestException('Podaj SID lub nazwę usługi.');
    }
  }

  private getEncryptionSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret || secret === 'change-me-in-production') {
      throw new InternalServerErrorException(
        'Ustaw JWT_SECRET w pliku .env przed zapisem hasła do bazy.',
      );
    }
    return secret;
  }
}
