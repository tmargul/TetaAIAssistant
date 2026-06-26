import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { DoctorRepairResult, DoctorReport } from '@teta/shared';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DoctorService } from './doctor.service';

@Controller('doctor')
@UseGuards(JwtAuthGuard)
export class DoctorController {
  constructor(private readonly doctor: DoctorService) {}

  @Get()
  diagnose(): Promise<DoctorReport> {
    return this.doctor.runDiagnostics();
  }

  @Post('repair')
  @UseGuards(AdminGuard)
  repair(): Promise<DoctorRepairResult> {
    return this.doctor.repairEnvironment();
  }
}
