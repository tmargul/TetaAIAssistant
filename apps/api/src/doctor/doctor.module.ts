import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OllamaModule } from '../chat/ollama.module';
import { HealthModule } from '../health/health.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { DoctorController } from './doctor.controller';
import { DoctorService } from './doctor.service';

@Module({
  imports: [HealthModule, RagCoreModule, OllamaModule, AuthModule],
  controllers: [DoctorController],
  providers: [DoctorService],
})
export class DoctorModule {}
