import { Body, Controller, Get, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import type {
  OracleConnectionInput,
  OracleConnectionStatusResponse,
  OracleMetadataObjectKind,
  OracleMetadataObjectsPageResponse,
  OracleMetadataStatusResponse,
  OracleTestConnectionResponse,
  TnsListResponse,
} from '@teta/shared';
import { OracleConfigGuard } from './oracle-config.guard';
import { OracleConnectionService } from './oracle-connection.service';
import { OracleMetadataImportService } from './metadata/oracle-metadata-import.service';

@Controller('oracle')
export class OracleController {
  constructor(
    private readonly oracle: OracleConnectionService,
    private readonly metadataImport: OracleMetadataImportService,
  ) {}

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
    return this.metadataImport.getStatus();
  }

  @Get('metadata/objects')
  getMetadataObjects(
    @Query('kind') kind: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): OracleMetadataObjectsPageResponse {
    const allowed: OracleMetadataObjectKind[] = [
      'tables',
      'views',
      'packages',
      'procedures',
      'functions',
    ];
    if (!allowed.includes(kind as OracleMetadataObjectKind)) {
      throw new BadRequestException(
        'Parametr kind musi być jednym z: tables, views, packages, procedures, functions.',
      );
    }

    const parsedOffset = offset ? Number(offset) : 0;
    const parsedLimit = limit ? Number(limit) : 200;

    return this.metadataImport.listObjects(
      kind as OracleMetadataObjectKind,
      Number.isFinite(parsedOffset) ? parsedOffset : 0,
      Number.isFinite(parsedLimit) ? parsedLimit : 200,
    );
  }

  @Post('metadata/import')
  @UseGuards(OracleConfigGuard)
  startMetadataImport(): Promise<OracleMetadataStatusResponse> {
    return this.metadataImport.startImport();
  }
}
