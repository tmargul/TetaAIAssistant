import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthSetupStatusResponse, AuthUser, LoginRequest, LoginResponse } from '@teta/shared';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  sub: number;
  username: string;
  role: AuthUser['role'];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly oracle: OracleConnectionService,
    private readonly jwt: JwtService,
  ) {}

  getSetupStatus(token?: string): AuthSetupStatusResponse {
    const oracleConfigured = this.oracle.getStatus().configured;
    const adminBootstrapped = this.users.hasAdmin();

    if (!token) {
      return { oracleConfigured, adminBootstrapped, authenticated: false };
    }

    const user = this.verifyToken(token);
    if (!user) {
      return { oracleConfigured, adminBootstrapped, authenticated: false };
    }

    return { oracleConfigured, adminBootstrapped, authenticated: true, user };
  }

  async bootstrapAdmin(input: LoginRequest): Promise<LoginResponse> {
    if (!this.oracle.getStatus().configured) {
      throw new BadRequestException('Najpierw skonfiguruj połączenie Oracle.');
    }
    if (this.users.hasAdmin()) {
      throw new BadRequestException('Administrator aplikacji został już zarejestrowany.');
    }

    this.validateCredentials(input);
    await this.oracle.verifyUserCredentials(input.username, input.password);
    await this.oracle.verifyTetaAdministrator(input.username, input.password);

    const user = this.users.createAdmin(input.username);
    return this.issueToken(user);
  }

  async login(input: LoginRequest): Promise<LoginResponse> {
    if (!this.oracle.getStatus().configured) {
      throw new BadRequestException('Połączenie Oracle nie jest skonfigurowane.');
    }
    if (!this.users.hasAdmin()) {
      throw new BadRequestException('Najpierw zarejestruj administratora aplikacji.');
    }

    this.validateCredentials(input);
    await this.oracle.verifyUserCredentials(input.username, input.password);

    const record = this.users.findByOracleUsername(input.username);
    if (!record || !record.is_active) {
      throw new ForbiddenException(
        'Brak dostępu do aplikacji. Skontaktuj się z administratorem Teta.',
      );
    }

    this.users.touchLastLogin(record.id);
    const user: AuthUser = {
      id: record.id,
      oracleUsername: record.oracle_username,
      displayName: record.display_name ?? undefined,
      role: record.role,
    };

    return this.issueToken(user);
  }

  verifyToken(token: string): AuthUser | null {
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      return this.users.findById(payload.sub);
    } catch {
      return null;
    }
  }

  private issueToken(user: AuthUser): LoginResponse {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.oracleUsername,
      role: user.role,
    };

    return {
      accessToken: this.jwt.sign(payload),
      user,
    };
  }

  private validateCredentials(input: LoginRequest) {
    if (!input.username?.trim()) {
      throw new BadRequestException('Podaj login użytkownika Oracle.');
    }
    if (!input.password) {
      throw new BadRequestException('Podaj hasło.');
    }
  }
}
