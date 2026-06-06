import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

export type AuthenticatedRequest = Request & {
  user: NonNullable<ReturnType<AuthService['verifyToken']>>;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('Wymagane logowanie.');
    }

    const user = this.auth.verifyToken(token);
    if (!user) {
      throw new UnauthorizedException('Sesja wygasła — zaloguj się ponownie.');
    }

    request.user = user;
    return true;
  }
}
