import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type {
  OracleAgentDomain,
  OracleMetadataStatusResponse,
  SchemaDescribeColumnResponse,
  SchemaDescribeTableResponse,
  SchemaFindPathResponse,
  SchemaGraphStatsResponse,
  SchemaSearchTablesResponse,
} from '@teta/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OracleConfigGuard } from '../oracle/oracle-config.guard';
import { OracleMetadataImportService } from '../oracle/metadata/oracle-metadata-import.service';
import { SchemaCrawlService } from './schema-crawl.service';
import { SchemaExplorerService } from './schema-explorer.service';

@Controller('schema')
@UseGuards(JwtAuthGuard)
export class SchemaController {
  constructor(
    private readonly crawl: SchemaCrawlService,
    private readonly explorer: SchemaExplorerService,
    private readonly metadataImport: OracleMetadataImportService,
  ) {}

  @Get('stats')
  getStats(): SchemaGraphStatsResponse {
    return this.crawl.getStats();
  }

  @Post('analyze')
  @UseGuards(OracleConfigGuard)
  async startAnalyze(): Promise<{ graph: SchemaGraphStatsResponse; import: OracleMetadataStatusResponse }> {
    const importStatus = await this.metadataImport.startImport();
    return {
      graph: this.crawl.getStats(),
      import: importStatus,
    };
  }

  @Get('path')
  findPath(
    @Query('from') from: string,
    @Query('to') to: string,
  ): SchemaFindPathResponse {
    return this.explorer.findPath(from, to);
  }

  @Get('table')
  describeTable(@Query('name') name: string): SchemaDescribeTableResponse {
    return this.explorer.describeTable(name);
  }

  @Get('column')
  describeColumn(
    @Query('table') table: string,
    @Query('column') column: string,
  ): SchemaDescribeColumnResponse {
    return this.explorer.describeColumn(table, column);
  }

  @Get('search')
  searchTables(
    @Query('q') query = '',
    @Query('domain') domain: OracleAgentDomain = 'general',
    @Query('limit') limit = '30',
  ): SchemaSearchTablesResponse {
    const parsedLimit = Number(limit);
    return this.explorer.searchTables(
      query,
      domain,
      Number.isFinite(parsedLimit) ? parsedLimit : 30,
    );
  }

  @Post('explorer/find-path')
  findPathPost(@Body() body: { from: string; to: string }): SchemaFindPathResponse {
    return this.explorer.findPath(body.from, body.to);
  }
}
