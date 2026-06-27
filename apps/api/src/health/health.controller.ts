import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { HealthResponse, SystemHealthResponse } from '@teta/shared';
import { readWorkModeHeader } from '../rag/work-mode.util';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthResponse {
    return this.health.getBasicHealth();
  }

  @Get('system')
  async system(@Req() req: Request): Promise<SystemHealthResponse> {
    return this.health.getSystemHealth(readWorkModeHeader(req));
  }
}
