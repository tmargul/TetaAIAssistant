import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  getVendorDisabledReason,
  getVendorSecretHeaderName,
  isVendorEnabled,
  validateVendorRequestHeader,
} from './vendor-auth';

@Injectable()
export class VendorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isVendorEnabled()) {
      throw new ForbiddenException(getVendorDisabledReason());
    }

    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers[getVendorSecretHeaderName()] as string | undefined;

    if (!validateVendorRequestHeader(headerValue)) {
      throw new ForbiddenException('Brak lub nieprawidłowy nagłówek vendor.');
    }

    return true;
  }
}
