import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import {
  getVendorDisabledReason,
  getVendorSecretHeaderName,
  isVendorEnabled,
  validateVendorRequestHeader,
} from './vendor-auth';
import { getRequestWorkMode } from './work-mode.util';

type VendorRequest = Request & {
  user?: NonNullable<ReturnType<AuthService['verifyToken']>>;
};

@Injectable()
export class VendorAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!isVendorEnabled()) {
      throw new ForbiddenException(getVendorDisabledReason());
    }

    const request = context.switchToHttp().getRequest<VendorRequest>();
    if (getRequestWorkMode(request) !== 'vendor') {
      throw new ForbiddenException(
        'Operacje vendor są dostępne tylko w trybie pracy Vendor (wybierz przy logowaniu).',
      );
    }

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      const user = this.auth.verifyToken(token);
      if (!user) {
        throw new UnauthorizedException('Sesja wygasła — zaloguj się ponownie.');
      }
      if (user.role !== 'admin') {
        throw new ForbiddenException('Wymagane uprawnienia administratora.');
      }
      request.user = user;
      return true;
    }

    const vendorHeader = request.headers[getVendorSecretHeaderName()] as string | undefined;
    if (validateVendorRequestHeader(vendorHeader)) {
      return true;
    }

    throw new ForbiddenException(
      'Wymagane logowanie administratora lub nagłówek vendor (narzędzia CLI).',
    );
  }
}
