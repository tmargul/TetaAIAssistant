import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { STAGE3I_MAX_UPLOAD_BYTES } from './teta-payroll-snapshot.types';
import { TetaPayrollSnapshotImportService } from './teta-payroll-snapshot-import.service';
import { TetaPayrollSnapshotQueryService } from './teta-payroll-snapshot-query.service';

type AuthedRequest = {
  user?: { role?: string; workMode?: string };
};

function isAdminOrVendor(req: AuthedRequest): boolean {
  const role = req.user?.role;
  const workMode = req.user?.workMode;
  return role === 'admin' || workMode === 'vendor';
}

@Controller('payroll-parameter-snapshots')
@UseGuards(JwtAuthGuard)
export class TetaPayrollSnapshotController {
  constructor(
    private readonly imports: TetaPayrollSnapshotImportService,
    private readonly queries: TetaPayrollSnapshotQueryService,
  ) {}

  @Get('active')
  getActive() {
    const active = this.queries.getActiveSummary();
    return { active };
  }

  @Get('history')
  getHistory(@Req() req: AuthedRequest) {
    if (!isAdminOrVendor(req)) {
      throw new ForbiddenException('Historia snapshotów wymaga uprawnień admin/vendor');
    }
    return { history: this.queries.getHistory() };
  }

  @Get('active/components/:code')
  inspect(@Param('code') code: string, @Req() req: AuthedRequest) {
    if (!isAdminOrVendor(req)) {
      throw new ForbiddenException('Inspekcja składnika wymaga uprawnień admin/vendor');
    }
    return this.queries.inspectComponent(code);
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: STAGE3I_MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.rtf')) {
          cb(new BadRequestException('Only .rtf files are accepted') as never, false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  importRtf(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!isAdminOrVendor(req)) {
      throw new ForbiddenException('Import snapshotu wymaga uprawnień admin/vendor');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing multipart file field "file"');
    }
    const result = this.imports.importBuffer(file.buffer, file.originalname);
    if (result.status === 'rejected') {
      throw new BadRequestException({
        status: result.status,
        detectionStatus: result.detectionStatus,
        errors: result.errors,
      });
    }
    return {
      status: result.status,
      detectionStatus: result.detectionStatus,
      snapshot: {
        snapshotId: result.snapshot.snapshotId,
        status: result.snapshot.status,
        summary: result.snapshot.summary,
        importedAt: result.snapshot.source.importedAt,
        reportGeneratedAt: result.snapshot.source.reportGeneratedAt,
        fileSha256: result.snapshot.source.fileSha256,
        kpVersion: result.snapshot.source.kpVersion,
        paVersion: result.snapshot.source.paVersion,
      },
    };
  }
}
