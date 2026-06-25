import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { SchemaModule } from '../schema/schema.module';
import { FakeOracleClient } from './fake-oracle.client';
import { ORACLE_CLIENT } from './oracle-client.interface';
import { OracleConfigGuard } from './oracle-config.guard';
import { OracleConnectionService } from './oracle-connection.service';
import { OracleController } from './oracle.controller';
import { getOracleBackendMode } from './oracle-mode';
import { RealOracleClient } from './real-oracle.client';
import { OracleMetadataCatalogService } from './metadata/oracle-metadata-catalog.service';
import { OracleMetadataImportPipelineService } from './metadata/oracle-metadata-import.pipeline.service';
import { OracleMetadataImportService } from './metadata/oracle-metadata-import.service';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => RagCoreModule), forwardRef(() => SchemaModule)],
  controllers: [OracleController],
  providers: [
    OracleConfigGuard,
    FakeOracleClient,
    RealOracleClient,
    {
      provide: ORACLE_CLIENT,
      useFactory: (
        config: ConfigService,
        real: RealOracleClient,
        fake: FakeOracleClient,
      ) => (getOracleBackendMode(config) === 'real' ? real : fake),
      inject: [ConfigService, RealOracleClient, FakeOracleClient],
    },
    OracleConnectionService,
    OracleMetadataCatalogService,
    OracleMetadataImportPipelineService,
    OracleMetadataImportService,
  ],
  exports: [OracleConnectionService, OracleMetadataCatalogService, OracleMetadataImportService],
})
export class OracleModule {}
