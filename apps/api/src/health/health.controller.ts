import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, SystemHealthResponse } from '@teta/shared';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthResponse {
    return this.health.getBasicHealth();
  }

  @Get('system')
  async system(): Promise<SystemHealthResponse> {
    return this.health.getSystemHealth();
  }
}
