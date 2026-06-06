import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeOracleClient } from './fake-oracle.client';
import { ORACLE_CLIENT } from './oracle-client.interface';
import { OracleConnectionService } from './oracle-connection.service';
import { OracleController } from './oracle.controller';
import { getOracleBackendMode } from './oracle-mode';
import { RealOracleClient } from './real-oracle.client';

@Module({
  controllers: [OracleController],
  providers: [
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
