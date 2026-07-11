import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, statSync } from 'fs';
import type {
  TetaAppPathsStatusResponse,
  TetaAppPathsUpdateRequest,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';

const KEY_CLIENT = 'teta_app.client_directory';
const KEY_SERVER = 'teta_app.server_directory';

@Injectable()
export class TetaAppPathsService {
  constructor(private readonly db: DatabaseService) {}

  getPaths(): TetaAppPathsStatusResponse {
    const client = this.getSetting(KEY_CLIENT);
    const server = this.getSetting(KEY_SERVER);
    const updatedAt = this.getLatestUpdatedAt([KEY_CLIENT, KEY_SERVER]);

    return {
      clientDirectory: client?.value ?? '',
      serverDirectory: server?.value ?? '',
      updatedAt,
    };
  }

  savePaths(input: TetaAppPathsUpdateRequest, updatedBy?: number): TetaAppPathsStatusResponse {
    const clientDirectory = input.clientDirectory.trim();
    const serverDirectory = input.serverDirectory.trim();

    this.assertDirectory('Katalog Teta Aplikacja Klienta', clientDirectory);
    this.assertDirectory('Katalog Teta Serwer Aplikacyjny', serverDirectory);

    const now = new Date().toISOString();
    this.setSetting(KEY_CLIENT, clientDirectory, now, updatedBy);
    this.setSetting(KEY_SERVER, serverDirectory, now, updatedBy);

    return this.getPaths();
  }

  private assertDirectory(label: string, directoryPath: string) {
    if (!directoryPath) {
      throw new BadRequestException(`${label}: podaj ścieżkę katalogu.`);
    }
    if (!existsSync(directoryPath)) {
      throw new BadRequestException(`${label}: katalog nie istnieje — ${directoryPath}`);
    }
    let stat;
    try {
      stat = statSync(directoryPath);
    } catch {
      throw new BadRequestException(`${label}: nie można odczytać katalogu — ${directoryPath}`);
    }
    if (!stat.isDirectory()) {
      throw new BadRequestException(`${label}: ścieżka nie wskazuje na katalog — ${directoryPath}`);
    }
  }

  private getSetting(key: string): { value: string; updated_at: string } | undefined {
    return this.db.connection
      .prepare('SELECT value, updated_at FROM app_settings WHERE key = ?')
      .get(key) as { value: string; updated_at: string } | undefined;
  }

  private setSetting(key: string, value: string, updatedAt: string, updatedBy?: number) {
    this.db.connection
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at, updated_by)
         VALUES (@key, @value, @updated_at, @updated_by)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run({
        key,
        value,
        updated_at: updatedAt,
        updated_by: updatedBy ?? null,
      });
  }

  private getLatestUpdatedAt(keys: string[]): string | null {
    const placeholders = keys.map(() => '?').join(', ');
    const row = this.db.connection
      .prepare(`SELECT MAX(updated_at) AS latest FROM app_settings WHERE key IN (${placeholders})`)
      .get(...keys) as { latest: string | null } | undefined;
    return row?.latest ?? null;
  }
}
