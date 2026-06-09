import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { ClientRagStatusResponse, RagDocumentRecord, RagDocumentUploadResponse } from '@teta/shared';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  listDocuments(): Promise<RagDocumentRecord[]> {
    return this.documents.listDocuments();
  }

  @Get('status')
  getStatus(): Promise<ClientRagStatusResponse> {
    return this.documents.getStatus();
  }

  @Post('upload')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<RagDocumentUploadResponse> {
    const document = await this.documents.uploadDocument(file, req.user.id);
    return { document };
  }

  @Post(':id/reindex')
  @UseGuards(AdminGuard)
  async reindexDocument(@Param('id', ParseIntPipe) id: number): Promise<RagDocumentRecord> {
    return this.documents.reindexDocument(id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async deleteDocument(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.documents.deleteDocument(id);
    return { ok: true };
  }
}
