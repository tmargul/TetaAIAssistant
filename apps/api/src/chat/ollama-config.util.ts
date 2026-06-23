import { ConfigService } from '@nestjs/config';

export function getOllamaBaseUrl(config: ConfigService): string {
  return config.get<string>('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/$/, '');
}

/** -1 = trzymaj model w RAM do restartu Ollamy. */
export function getOllamaKeepAlive(config: ConfigService): string | number {
  const raw = config.get<string>('OLLAMA_KEEP_ALIVE', '-1').trim();
  if (raw === '-1') return -1;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
