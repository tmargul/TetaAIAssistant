import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isVendorMode } from './app-mode';

@Injectable()
export class VendorGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (!isVendorMode()) {
      throw new ForbiddenException(
        'Operacje vendor są dostępne tylko przy TETA_APP_MODE=vendor.',
      );
    }
    return true;
  }
}
