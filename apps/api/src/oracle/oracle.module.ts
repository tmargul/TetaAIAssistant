import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { FakeOracleClient } from './fake-oracle.client';
import { ORACLE_CLIENT } from './oracle-client.interface';
import { OracleConfigGuard } from './oracle-config.guard';
import { OracleConnectionService } from './oracle-connection.service';
import { OracleController } from './oracle.controller';
import { getOracleBackendMode } from './oracle-mode';
import { RealOracleClient } from './real-oracle.client';

@Module({
  imports: [forwardRef(() => AuthModule)],
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
  ],
  exports: [OracleConnectionService],
})
export class OracleModule {}
