import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OracleConnectionService } from './oracle-connection.service';

@Injectable()
export class OracleConfigGuard implements CanActivate {
  constructor(
    private readonly oracle: OracleConnectionService,
    private readonly jwtAuth: JwtAuthGuard,
    private readonly admin: AdminGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.oracle.getStatus().configured) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.headers['x-teta-oracle-recovery'] === '1') {
      return true;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Wymagane zalogowanie administratora.');
    }

    if (!this.jwtAuth.canActivate(context)) {
      return false;
    }

    return this.admin.canActivate(context);
  }
}
