import type { Request } from 'express';
import type { AppMode } from '@teta/shared';
import { TETA_WORK_MODE_HEADER } from '@teta/shared';
import { getEffectiveAppMode } from './app-mode';

export function readWorkModeHeader(request: Pick<Request, 'headers'>): string | undefined {
  const raw = request.headers[TETA_WORK_MODE_HEADER];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function getRequestWorkMode(request: Pick<Request, 'headers'>): AppMode {
  return getEffectiveAppMode(readWorkModeHeader(request));
}
