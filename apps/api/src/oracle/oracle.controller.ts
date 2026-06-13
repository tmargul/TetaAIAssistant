import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type {
  OracleConnectionInput,
  OracleConnectionStatusResponse,
  OracleTestConnectionResponse,
  TnsListResponse,
} from '@teta/shared';
import { OracleConfigGuard } from './oracle-config.guard';
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
  @UseGuards(OracleConfigGuard)
  saveConfig(@Body() body: OracleConnectionInput): Promise<OracleConnectionStatusResponse> {
    return this.oracle.saveConnection(body);
  }
}
