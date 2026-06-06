import type { TetaOracleBackendMode } from '@teta/shared';
import { ConfigService } from '@nestjs/config';

export function getOracleBackendMode(config: ConfigService): TetaOracleBackendMode {
  const mode = config.get<string>('TETA_ORACLE_MODE', 'fake').toLowerCase();
  return mode === 'real' ? 'real' : 'fake';
}
