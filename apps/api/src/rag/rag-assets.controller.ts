import {
  Controller,
  Get,
  NotFoundException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { access } from 'fs/promises';
import { join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { getRepoRoot } from '../config/repo-root';

@Controller('rag/assets')
@UseGuards(JwtAuthGuard)
export class RagAssetsController {
  private get assetsRoot(): string {
    return join(getRepoRoot(), 'sources', 'global', 'assets');
  }

  @Get('*')
  async serveAsset(@Req() req: Request, @Res() res: Response) {
    const prefix = '/api/rag/assets/';
    const urlPath = req.path;
    if (!urlPath.startsWith(prefix)) {
      throw new NotFoundException('Nie znaleziono zasobu.');
    }

    const relativePath = decodeURIComponent(urlPath.slice(prefix.length));
    const safeSegments = relativePath
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (safeSegments.length === 0 || safeSegments.some((segment) => segment === '..' || segment === '.')) {
      throw new NotFoundException('Nie znaleziono zasobu.');
    }

    const filePath = join(this.assetsRoot, ...safeSegments);
    const normalizedRoot = join(this.assetsRoot);
    if (!filePath.startsWith(normalizedRoot)) {
      throw new NotFoundException('Nie znaleziono zasobu.');
    }

    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('Nie znaleziono zasobu.');
    }

    res.sendFile(filePath);
  }
}
