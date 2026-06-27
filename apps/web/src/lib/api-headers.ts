import { getAccessToken } from './auth-storage';
import { applyWorkModeHeader } from './work-mode-storage';

export function buildApiHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  applyWorkModeHeader(headers);
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}
