import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OracleConnectionInput, OracleTestConnectionResponse, TnsListResponse } from '@teta/shared';
import type { OracleClient } from './oracle-client.interface';

const FAKE_TNS: TnsListResponse = {
  source: 'fake:tnsnames.ora',
  entries: [
    { alias: 'TETA_DEV', host: '192.168.1.10', port: 1521, sid: 'TETA' },
    { alias: 'TETA_TEST', host: '192.168.1.11', port: 1521, serviceName: 'TETATEST' },
  ],
};

@Injectable()
export class FakeOracleClient implements OracleClient {
  constructor(private readonly config: ConfigService) {}

  async testConnection(
    _input: OracleConnectionInput,
    connectString: string,
  ): Promise<OracleTestConnectionResponse> {
    await this.simulateLatency();
    return {
      success: true,
      message: 'Połączenie z symulatorem Oracle Teta udane (tryb fake).',
      databaseVersion:
        `Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Production (FAKE)\n` +
        `Connect: ${connectString}`,
    };
  }

  async verifyUserConnection(username: string, password: string, _connectString: string): Promise<void> {
    await this.simulateLatency();
    if (!this.isKnownUser(username, password)) {
      const adminUser = this.config.get<string>('TETA_FAKE_ADMIN_USER', 'teta_admin');
      const regularUser = this.config.get<string>('TETA_FAKE_USER', 'teta_user');
      throw new BadRequestException(
        `Nieprawidłowy login lub hasło Oracle (tryb fake). Dozwolone loginy: ${adminUser} (admin), ${regularUser} (użytkownik). Hasła: TETA_FAKE_* w apps/api/.env.`,
      );
    }
  }

  async verifyAdministrator(username: string, password: string, _connectString: string): Promise<void> {
    await this.simulateLatency();
    const adminUser = this.config.get<string>('TETA_FAKE_ADMIN_USER', 'teta_admin');
    const adminPassword = this.config.get<string>('TETA_FAKE_ADMIN_PASSWORD', 'admin');

    if (username.trim().toLowerCase() !== adminUser.toLowerCase() || password !== adminPassword) {
      throw new BadRequestException(
        `W trybie fake administrator to: ${adminUser} / ${adminPassword}`,
      );
    }
  }

  listTnsEntries(): TnsListResponse {
    return FAKE_TNS;
  }

  private isKnownUser(username: string, password: string): boolean {
    const users = [
      {
        user: this.config.get<string>('TETA_FAKE_ADMIN_USER', 'teta_admin'),
        pass: this.config.get<string>('TETA_FAKE_ADMIN_PASSWORD', 'admin'),
      },
      {
        user: this.config.get<string>('TETA_FAKE_USER', 'teta_user'),
        pass: this.config.get<string>('TETA_FAKE_USER_PASSWORD', 'user'),
      },
    ];

    const login = username.trim().toLowerCase();
    return users.some((u) => login === u.user.toLowerCase() && password === u.pass);
  }

  private simulateLatency() {
    return new Promise((resolve) => setTimeout(resolve, 250));
  }
}
