import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolveEnvFilePaths } from './config/env-files';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OracleModule } from './oracle/oracle.module';
import { SchemaModule } from './schema/schema.module';
import { DocumentsModule } from './documents/documents.module';
import { ChatModule } from './chat/chat.module';
import { DoctorModule } from './doctor/doctor.module';
import { RagModule } from './rag/rag.module';
import { TetaChatReportsModule } from './teta-chat-reports/teta-chat-reports.module';
import { TetaPayrollSnapshotsModule } from './teta-payroll-snapshots/teta-payroll-snapshots.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvFilePaths(),
    }),
    DatabaseModule,
    HealthModule,
    OracleModule,
    SchemaModule,
    AuthModule,
    AdminModule,
    RagModule,
    DocumentsModule,
    ChatModule,
    DoctorModule,
    TetaChatReportsModule,
    TetaPayrollSnapshotsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
