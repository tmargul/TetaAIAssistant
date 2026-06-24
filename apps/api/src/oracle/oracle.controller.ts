import { Body, Controller, Get, NotImplementedException, Post, UseGuards } from '@nestjs/common';
import type {
  OracleConnectionInput,
  OracleConnectionStatusResponse,
  OracleMetadataStatusResponse,
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

  @Get('metadata/status')
  getMetadataStatus(): OracleMetadataStatusResponse {
    const configured = this.oracle.getStatus().configured;
    return {
      available: false,
      status: 'idle',
      lastImportedAt: null,
      owners: [],
      counts: {
        tables: 0,
        views: 0,
        columns: 0,
        packages: 0,
        procedures: 0,
        functions: 0,
      },
      objects: {
        tables: [],
        views: [],
        packages: [],
        procedures: [],
        functions: [],
      },
      pilotModule: null,
      tetaVersion: null,
      message: configured
        ? 'Połączenie skonfigurowane. Uruchom import w menu Metadane Oracle.'
        : 'Skonfiguruj konto read-only w menu Metadane Oracle, potem uruchom import.',
    };
  }

  @Post('metadata/import')
  @UseGuards(OracleConfigGuard)
  startMetadataImport(): never {
    throw new NotImplementedException(
      'Importer metadanych Oracle jest w przygotowaniu — dostępny w kolejnej wersji aplikacji.',
    );
  }
}
