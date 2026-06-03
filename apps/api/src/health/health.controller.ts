import { Controller, Get } from '@nestjs/common';
import { APP_NAME, type HealthResponse } from '@teta/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      app: APP_NAME,
      version: process.env.npm_package_version ?? '0.0.1',
      timestamp: new Date().toISOString(),
    };
  }
}
