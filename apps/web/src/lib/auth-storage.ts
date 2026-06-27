const TOKEN_KEY = 'teta_access_token';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
}

import { buildApiHeaders } from './api-headers';

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = buildApiHeaders(init);
  return fetch(input, { ...init, headers });
}
