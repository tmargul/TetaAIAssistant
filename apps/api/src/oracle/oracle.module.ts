import { Module } from '@nestjs/common';
import { OracleController } from './oracle.controller';
import { OracleConnectionService } from './oracle-connection.service';

@Module({
  controllers: [OracleController],
  providers: [OracleConnectionService],
  exports: [OracleConnectionService],
})
export class OracleModule {}
