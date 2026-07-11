import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type {
  TetaAppPathsStatusResponse,
  TetaAppPathsUpdateRequest,
} from '@teta/shared';
import { VendorAccessGuard } from '../rag/vendor-access.guard';
import { TetaAppPathsService } from './teta-app-paths.service';

type AuthedRequest = Request & { user?: { id: number } };

@Controller('vendor/teta-app')
@UseGuards(VendorAccessGuard)
export class VendorTetaAppController {
  constructor(private readonly paths: TetaAppPathsService) {}

  @Get('paths')
  getPaths(): TetaAppPathsStatusResponse {
    return this.paths.getPaths();
  }

  @Put('paths')
  savePaths(
    @Body() body: TetaAppPathsUpdateRequest,
    @Req() req: AuthedRequest,
  ): TetaAppPathsStatusResponse {
    return this.paths.savePaths(body, req.user?.id);
  }
}
