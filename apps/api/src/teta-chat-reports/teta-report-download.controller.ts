import {
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { TetaReportDownloadRegistryService } from './teta-report-download-registry.service';
import { handleReportDownload } from './teta-report-download-handler';
import { STAGE3G_XLSX_MIME } from './teta-chat-report.types';

const GENERIC_UNAVAILABLE = 'Plik jest niedostępny albo wygasł.';

@Controller('chat/reports')
@UseGuards(JwtAuthGuard)
export class TetaReportDownloadController {
  private readonly logger = new Logger(TetaReportDownloadController.name);

  constructor(private readonly registry: TetaReportDownloadRegistryService) {}

  @Get('download/:token')
  download(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: false }) res: Response,
  ): void {
    // Never log the raw token — redact path for audit.
    this.logger.log(
      `report download request userId=${req.user.id} path=/api/chat/reports/download/[redacted]`,
    );

    const result = handleReportDownload(this.registry, {
      token,
      userId: String(req.user.id),
      sessionId: typeof req.headers['x-teta-session-id'] === 'string'
        ? req.headers['x-teta-session-id']
        : null,
      conversationId:
        typeof req.headers['x-teta-conversation-id'] === 'string'
          ? req.headers['x-teta-conversation-id']
          : null,
    });

    if (!result.ok) {
      if (result.code === 'report_download_owner_mismatch') {
        throw new ForbiddenException({
          message: GENERIC_UNAVAILABLE,
          code: result.code,
        });
      }
      if (
        result.code === 'report_download_expired' ||
        result.code === 'report_download_limit_reached'
      ) {
        throw new GoneException({
          message: GENERIC_UNAVAILABLE,
          code: result.code,
        });
      }
      throw new NotFoundException({
        message: GENERIC_UNAVAILABLE,
        code: result.code,
      });
    }

    const { entry, safeFileName } = result;

    res.setHeader('Content-Type', entry.mimeType || STAGE3G_XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(entry.buffer.byteLength));
    res.setHeader('X-Report-File-Sha256', entry.fileSha256);
    res.status(200).send(entry.buffer);
  }
}
