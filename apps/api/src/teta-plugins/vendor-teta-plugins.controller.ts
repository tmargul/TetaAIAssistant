import { BadRequestException, Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM,
  type TetaPluginBulkImportRequest,
  type TetaPluginBulkImportStartResponse,
  type TetaPluginBulkImportStatusResponse,
  type TetaPluginDeleteAllRagRequest,
  type TetaPluginDeleteAllRagResponse,
  type TetaPluginDeleteRagResponse,
  type TetaPluginImportDetailResponse,
  type TetaPluginImportRequest,
  type TetaPluginImportResponse,
  type TetaPluginsStatusResponse,
} from '@teta/shared';
import { VendorAccessGuard } from '../rag/vendor-access.guard';
import { TetaPluginBulkImportService } from './teta-plugin-bulk-import.service';
import { TetaPluginImportService } from './teta-plugin-import.service';
import { TetaPluginsService } from './teta-plugins.service';

@Controller('vendor/teta-plugins')
@UseGuards(VendorAccessGuard)
export class VendorTetaPluginsController {
  constructor(
    private readonly plugins: TetaPluginsService,
    private readonly importService: TetaPluginImportService,
    private readonly bulkImport: TetaPluginBulkImportService,
  ) {}

  @Get('status')
  getStatus(): TetaPluginsStatusResponse {
    return this.plugins.getStatus();
  }

  @Post('import')
  async importPlugin(@Body() body: TetaPluginImportRequest): Promise<TetaPluginImportResponse> {
    return this.importService.importPlugin(body.dllPath);
  }

  @Post('import/bulk')
  startBulkImport(@Body() body: TetaPluginBulkImportRequest): TetaPluginBulkImportStartResponse {
    return this.bulkImport.startBulkImport(body);
  }

  @Get('import/bulk/status')
  getBulkImportStatus(): TetaPluginBulkImportStatusResponse {
    return this.bulkImport.getStatus();
  }

  @Get('import/detail')
  getImportDetail(@Query('dllPath') dllPath: string): TetaPluginImportDetailResponse {
    return this.importService.getImportDetail(dllPath);
  }

  @Delete('rag')
  async deletePluginRag(@Query('dllPath') dllPath: string): Promise<TetaPluginDeleteRagResponse> {
    if (!dllPath?.trim()) {
      throw new BadRequestException('Parametr dllPath jest wymagany.');
    }
    return this.importService.deletePluginRag(dllPath);
  }

  @Delete('rag/all')
  async deleteAllPluginRag(
    @Body() body: TetaPluginDeleteAllRagRequest,
  ): Promise<TetaPluginDeleteAllRagResponse> {
    if (body.confirm?.trim() !== TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM) {
      throw new BadRequestException(
        `Potwierdź operację wpisując dokładnie: ${TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM}`,
      );
    }
    return this.importService.deleteAllPluginRag();
  }
}
