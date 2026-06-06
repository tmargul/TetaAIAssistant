import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AppUserRecord,
  CreateTetaServerRequest,
  GrantUserAccessRequest,
  TetaServer,
  UpdateTetaServerRequest,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';

interface TetaServerRow {
  id: number;
  name: string;
  description: string | null;
  is_enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersService,
  ) {}

  listUsers(): AppUserRecord[] {
    return this.users.listUsers();
  }

  grantUserAccess(adminId: number, input: GrantUserAccessRequest): AppUserRecord {
    return this.users.grantAccess(input.oracleUsername, adminId, input.displayName);
  }

  revokeUserAccess(userId: number): AppUserRecord {
    return this.users.revokeAccess(userId);
  }

  listTetaServers(): TetaServer[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM teta_servers ORDER BY sort_order ASC, name ASC')
      .all() as TetaServerRow[];
    return rows.map((row) => this.toTetaServer(row));
  }

  createTetaServer(input: CreateTetaServerRequest): TetaServer {
    const now = new Date().toISOString();
    const result = this.db.connection
      .prepare(
        `INSERT INTO teta_servers (name, description, is_enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name.trim(),
        input.description?.trim() ?? null,
        input.isEnabled === false ? 0 : 1,
        input.sortOrder ?? 0,
        now,
        now,
      );

    const row = this.db.connection
      .prepare('SELECT * FROM teta_servers WHERE id = ?')
      .get(result.lastInsertRowid) as TetaServerRow;

    return this.toTetaServer(row);
  }

  updateTetaServer(id: number, input: UpdateTetaServerRequest): TetaServer {
    const row = this.db.connection
      .prepare('SELECT * FROM teta_servers WHERE id = ?')
      .get(id) as TetaServerRow | undefined;

    if (!row) {
      throw new NotFoundException('Nie znaleziono serwera Teta.');
    }

    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE teta_servers SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          is_enabled = COALESCE(?, is_enabled),
          sort_order = COALESCE(?, sort_order),
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name?.trim() ?? null,
        input.description !== undefined ? input.description.trim() || null : null,
        input.isEnabled === undefined ? null : input.isEnabled ? 1 : 0,
        input.sortOrder ?? null,
        now,
        id,
      );

    return this.toTetaServer(
      this.db.connection.prepare('SELECT * FROM teta_servers WHERE id = ?').get(id) as TetaServerRow,
    );
  }

  deleteTetaServer(id: number): void {
    const result = this.db.connection.prepare('DELETE FROM teta_servers WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundException('Nie znaleziono serwera Teta.');
    }
  }

  private toTetaServer(row: TetaServerRow): TetaServer {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isEnabled: row.is_enabled === 1,
      sortOrder: row.sort_order,
    };
  }
}
