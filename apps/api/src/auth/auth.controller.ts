import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import type { AuthSetupStatusResponse, LoginRequest, LoginResponse } from '@teta/shared';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('setup-status')
  getSetupStatus(@Headers('authorization') authorization?: string): AuthSetupStatusResponse {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    return this.auth.getSetupStatus(token);
  }

  @Post('bootstrap-admin')
  bootstrapAdmin(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.auth.bootstrapAdmin(body);
  }

  @Post('login')
  login(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.auth.login(body);
  }
}
