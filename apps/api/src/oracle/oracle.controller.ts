import { Body, Controller, Get, Post } from '@nestjs/common';
import type {
  OracleConnectionInput,
  OracleConnectionStatusResponse,
  OracleTestConnectionResponse,
  TnsListResponse,
} from '@teta/shared';
import { OracleConnectionService } from './oracle-connection.service';

@Controller('oracle')
export class OracleController {
  constructor(private readonly oracle: OracleConnectionService) {}

  @Get('status')
  getStatus(): OracleConnectionStatusResponse {
    return this.oracle.getStatus();
  }

  @Get('tns')
  listTns(): TnsListResponse {
    return this.oracle.listTnsEntries();
  }

  @Post('test')
  testConnection(@Body() body: OracleConnectionInput): Promise<OracleTestConnectionResponse> {
    return this.oracle.testConnection(body);
  }

  @Post('config')
  saveConfig(@Body() body: OracleConnectionInput): Promise<OracleConnectionStatusResponse> {
    return this.oracle.saveConnection(body);
  }
}
