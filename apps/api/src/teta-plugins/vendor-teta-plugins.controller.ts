import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type {
  TetaPluginImportDetailResponse,
  TetaPluginImportRequest,
  TetaPluginImportResponse,
  TetaPluginsStatusResponse,
} from '@teta/shared';
import { VendorAccessGuard } from '../rag/vendor-access.guard';
import { TetaPluginImportService } from './teta-plugin-import.service';
import { TetaPluginsService } from './teta-plugins.service';

@Controller('vendor/teta-plugins')
@UseGuards(VendorAccessGuard)
export class VendorTetaPluginsController {
  constructor(
    private readonly plugins: TetaPluginsService,
    private readonly importService: TetaPluginImportService,
  ) {}

  @Get('status')
  getStatus(): TetaPluginsStatusResponse {
    return this.plugins.getStatus();
  }

  @Post('import')
  async importPlugin(@Body() body: TetaPluginImportRequest): Promise<TetaPluginImportResponse> {
    return this.importService.importPlugin(body.dllPath);
  }

  @Get('import/detail')
  getImportDetail(@Query('dllPath') dllPath: string): TetaPluginImportDetailResponse {
    return this.importService.getImportDetail(dllPath);
  }
}
