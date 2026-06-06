import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AppUserRecord, AuthUser, UserRole } from '@teta/shared';
import { DatabaseService } from '../database/database.service';

interface UserRow {
  id: number;
  oracle_username: string;
  display_name: string | null;
  role: UserRole;
  is_active: number;
  granted_by: number | null;
  created_at: string;
  last_login_at: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  hasAnyUser(): boolean {
    const row = this.db.connection.prepare('SELECT COUNT(*) AS count FROM users').get() as {
      count: number;
    };
    return row.count > 0;
  }

  hasAdmin(): boolean {
    const row = this.db.connection
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
      .get() as { count: number };
    return row.count > 0;
  }

  findById(id: number): AuthUser | null {
    const row = this.db.connection
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
    return row ? this.toAuthUser(row) : null;
  }

  findByOracleUsername(username: string): UserRow | undefined {
    return this.db.connection
      .prepare('SELECT * FROM users WHERE oracle_username = ? COLLATE NOCASE')
      .get(username.trim()) as UserRow | undefined;
  }

  listUsers(): AppUserRecord[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM users ORDER BY role DESC, oracle_username ASC')
      .all() as UserRow[];
    return rows.map((row) => this.toAppUserRecord(row));
  }

  createAdmin(username: string, displayName?: string): AuthUser {
    const now = new Date().toISOString();
    const result = this.db.connection
      .prepare(
        `INSERT INTO users (oracle_username, display_name, role, is_active, granted_by, created_at)
         VALUES (?, ?, 'admin', 1, NULL, ?)`,
      )
      .run(username.trim(), displayName?.trim() ?? null, now);

    const row = this.db.connection
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(result.lastInsertRowid) as UserRow;

    return this.toAuthUser(row);
  }

  grantAccess(username: string, grantedBy: number, displayName?: string): AppUserRecord {
    const existing = this.findByOracleUsername(username);
    if (existing) {
      if (!existing.is_active) {
        this.db.connection
          .prepare(
            'UPDATE users SET is_active = 1, display_name = COALESCE(?, display_name), granted_by = ? WHERE id = ?',
          )
          .run(displayName?.trim() ?? null, grantedBy, existing.id);
        return this.toAppUserRecord(
          this.db.connection.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as UserRow,
        );
      }
      throw new BadRequestException('Użytkownik ma już dostęp do aplikacji.');
    }

    const now = new Date().toISOString();
    const result = this.db.connection
      .prepare(
        `INSERT INTO users (oracle_username, display_name, role, is_active, granted_by, created_at)
         VALUES (?, ?, 'user', 1, ?, ?)`,
      )
      .run(username.trim(), displayName?.trim() ?? null, grantedBy, now);

    const row = this.db.connection
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(result.lastInsertRowid) as UserRow;

    return this.toAppUserRecord(row);
  }

  revokeAccess(userId: number): AppUserRecord {
    const row = this.db.connection
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as UserRow | undefined;

    if (!row) {
      throw new NotFoundException('Nie znaleziono użytkownika.');
    }
    if (row.role === 'admin') {
      throw new BadRequestException('Nie można odebrać dostępu administratorowi.');
    }

    this.db.connection
      .prepare('UPDATE users SET is_active = 0 WHERE id = ?')
      .run(userId);

    return this.toAppUserRecord({
      ...row,
      is_active: 0,
    });
  }

  touchLastLogin(userId: number) {
    this.db.connection
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(new Date().toISOString(), userId);
  }

  private toAuthUser(row: UserRow): AuthUser {
    return {
      id: row.id,
      oracleUsername: row.oracle_username,
      displayName: row.display_name ?? undefined,
      role: row.role,
    };
  }

  private toAppUserRecord(row: UserRow): AppUserRecord {
    return {
      id: row.id,
      oracleUsername: row.oracle_username,
      displayName: row.display_name ?? undefined,
      role: row.role,
      isActive: row.is_active === 1,
      grantedBy: row.granted_by ?? undefined,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? undefined,
    };
  }
}
