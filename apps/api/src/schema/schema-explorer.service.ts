import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OracleAgentDomain,
  SchemaColumnInfo,
  SchemaDescribeColumnResponse,
  SchemaDescribeTableResponse,
  SchemaFindPathResponse,
  SchemaPathStep,
  SchemaSearchTablesResponse,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import { SchemaGraphService } from './schema-graph.service';

type AdjacencyEdge = {
  toNodeId: number;
  fromColumn: string;
  toColumn: string;
  edgeType: 'fk' | 'inferred' | 'learned';
  confidence: number;
  owner: string;
  name: string;
};

const DOMAIN_TABLE_HINTS: Record<OracleAgentDomain, string[]> = {
  general: [],
  payroll: ['T_PRAC', 'L_', 'PL_', 'SL_', 'WYNAGROD', 'PLACA', 'PŁAC'],
  hr: ['PRAC', 'KADRY', 'ETAT', 'UMOW', 'HR'],
  attendance: ['ABSENC', 'CZAS', 'GODZ', 'RCP', 'OBECN'],
  config: ['CFG', 'CONFIG', 'PARAM', 'SLOW', 'SL_'],
};

@Injectable()
export class SchemaExplorerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly graph: SchemaGraphService,
    private readonly config: ConfigService,
  ) {}

  findPath(from: string, to: string, createdBy?: string): SchemaFindPathResponse {
    const fromRef = this.graph.parseTableRef(from);
    const toRef = this.graph.parseTableRef(to);
    if (!fromRef || !toRef) {
      return {
        from,
        to,
        found: false,
        cached: false,
        steps: [],
        message: 'Podaj nazwy tabel (np. SL_BADANIA_BHP lub OWNER.TABELA).',
      };
    }

    const fromKey = this.normalizeTableKey(fromRef);
    const toKey = this.normalizeTableKey(toRef);

    const cached = this.loadExperiencePath(fromKey, toKey);
    if (cached) {
      this.touchExperiencePath(fromKey, toKey, cached.pathJson);
      return {
        from: fromKey,
        to: toKey,
        found: true,
        cached: true,
        steps: cached.steps,
      };
    }

    const fromId = this.graph.resolveNodeId(from);
    const toId = this.graph.resolveNodeId(to);
    if (!fromId || !toId) {
      return {
        from: fromKey,
        to: toKey,
        found: false,
        cached: false,
        steps: [],
        message: 'Nie znaleziono tabel w grafie — uruchom analizę bazy.',
      };
    }

    if (fromId === toId) {
      return {
        from: fromKey,
        to: toKey,
        found: true,
        cached: false,
        steps: [],
      };
    }

    const adjacency = this.loadAdjacency();
    const path = this.bfs(fromId, toId, adjacency);
    if (!path) {
      return {
        from: fromKey,
        to: toKey,
        found: false,
        cached: false,
        steps: [],
        message: 'Brak ścieżki relacji między tabelami w grafie.',
      };
    }

    const steps = this.pathToSteps(path);
    this.saveExperiencePath(fromKey, toKey, steps, createdBy);

    return {
      from: fromKey,
      to: toKey,
      found: true,
      cached: false,
      steps,
    };
  }

  describeTable(tableRef: string): SchemaDescribeTableResponse {
    const parsed = this.graph.parseTableRef(tableRef);
    if (!parsed) {
      return { found: false, table: null, message: 'Podaj nazwę tabeli.' };
    }

    const preferredOwner = resolveDefaultOracleOwner(this.config);
    const row = this.db.connection
      .prepare(
        `SELECT id, owner, name, node_type, comment
         FROM schema_nodes
         WHERE UPPER(name) = UPPER(?)
           AND (? IS NULL OR UPPER(owner) = UPPER(?))
         ORDER BY CASE WHEN UPPER(owner) = UPPER(?) THEN 0 ELSE 1 END,
                  CASE node_type WHEN 'table' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(parsed.name, parsed.owner, parsed.owner, preferredOwner) as
      | {
          id: number;
          owner: string;
          name: string;
          node_type: 'table' | 'view';
          comment: string | null;
        }
      | undefined;

    if (!row) {
      return {
        found: false,
        table: null,
        message: `Tabela ${tableRef} nie występuje w grafie.`,
      };
    }

    const columns = this.db.connection
      .prepare(
        `SELECT name, data_type, nullable, is_pk, comment
         FROM schema_columns
         WHERE node_id = ?
         ORDER BY name`,
      )
      .all(row.id) as Array<{
      name: string;
      data_type: string;
      nullable: number;
      is_pk: number;
      comment: string | null;
    }>;

    return {
      found: true,
      table: {
        owner: row.owner,
        name: row.name,
        nodeType: row.node_type,
        comment: row.comment,
        columns: columns.map((col) => this.mapColumn(col)),
      },
    };
  }

  describeColumn(tableRef: string, columnName: string): SchemaDescribeColumnResponse {
    const table = this.describeTable(tableRef);
    if (!table.found || !table.table) {
      return {
        found: false,
        owner: null,
        table: null,
        column: null,
        message: table.message,
      };
    }

    const column = table.table.columns.find(
      (item) => item.name.toUpperCase() === columnName.trim().toUpperCase(),
    );
    if (!column) {
      return {
        found: false,
        owner: table.table.owner,
        table: table.table.name,
        column: null,
        message: `Kolumna ${columnName} nie występuje w ${table.table.name}.`,
      };
    }

    return {
      found: true,
      owner: table.table.owner,
      table: table.table.name,
      column,
    };
  }

  searchTables(query: string, domain: OracleAgentDomain = 'general', limit = 30): SchemaSearchTablesResponse {
    const trimmed = query.trim();
    const hints = DOMAIN_TABLE_HINTS[domain];
    const preferredOwner = resolveDefaultOracleOwner(this.config);
    const params: string[] = [];
    let sql = `SELECT owner || '.' || name AS full_name, name
               FROM schema_nodes
               WHERE node_type = 'table'`;

    if (trimmed) {
      sql += ` AND (UPPER(name) LIKE UPPER(?) OR UPPER(owner || '.' || name) LIKE UPPER(?))`;
      params.push(`%${trimmed}%`, `%${trimmed}%`);
    }

    if (hints.length > 0) {
      const hintClauses = hints.map(() => `UPPER(name) LIKE UPPER(?)`).join(' OR ');
      sql += ` AND (${hintClauses})`;
      for (const hint of hints) {
        params.push(`%${hint}%`);
      }
    }

    sql += ` ORDER BY CASE WHEN UPPER(owner) = UPPER(?) THEN 0 ELSE 1 END, name LIMIT ?`;
    params.push(preferredOwner, String(limit));

    const rows = this.db.connection.prepare(sql).all(...params) as Array<{
      full_name: string;
      name: string;
    }>;

    const items = rows.map((row) => row.full_name);
    return { query: trimmed, items, total: items.length };
  }

  getPackageSource(owner: string, name: string, maxLines = 80): string[] {
    const rows = this.db.connection
      .prepare(
        `SELECT text FROM schema_sources
         WHERE UPPER(owner) = UPPER(?) AND UPPER(name) = UPPER(?)
         ORDER BY line
         LIMIT ?`,
      )
      .all(owner, name, maxLines) as Array<{ text: string }>;
    return rows.map((row) => row.text);
  }

  private mapColumn(col: {
    name: string;
    data_type: string;
    nullable: number;
    is_pk: number;
    comment: string | null;
  }): SchemaColumnInfo {
    return {
      name: col.name,
      dataType: col.data_type,
      nullable: col.nullable !== 0,
      isPk: col.is_pk !== 0,
      comment: col.comment,
    };
  }

  private loadAdjacency(): Map<number, AdjacencyEdge[]> {
    const rows = this.db.connection
      .prepare(
        `SELECT e.from_node_id, e.to_node_id, e.from_column, e.to_column,
                e.edge_type, e.confidence, n.owner, n.name
         FROM schema_edges e
         JOIN schema_nodes n ON n.id = e.to_node_id`,
      )
      .all() as Array<{
      from_node_id: number;
      to_node_id: number;
      from_column: string;
      to_column: string;
      edge_type: 'fk' | 'inferred' | 'learned';
      confidence: number;
      owner: string;
      name: string;
    }>;

    const adjacency = new Map<number, AdjacencyEdge[]>();
    for (const row of rows) {
      const list = adjacency.get(row.from_node_id) ?? [];
      list.push({
        toNodeId: row.to_node_id,
        fromColumn: row.from_column,
        toColumn: row.to_column,
        edgeType: row.edge_type,
        confidence: row.confidence,
        owner: row.owner,
        name: row.name,
      });
      adjacency.set(row.from_node_id, list);

      const reverse = adjacency.get(row.to_node_id) ?? [];
      reverse.push({
        toNodeId: row.from_node_id,
        fromColumn: row.to_column,
        toColumn: row.from_column,
        edgeType: row.edge_type,
        confidence: row.confidence,
        owner: '',
        name: '',
      });
      adjacency.set(row.to_node_id, reverse);
    }
    return adjacency;
  }

  private bfs(
    fromId: number,
    toId: number,
    adjacency: Map<number, AdjacencyEdge[]>,
  ): Array<{ nodeId: number; edge?: AdjacencyEdge }> | null {
    const queue: number[] = [fromId];
    const visited = new Set<number>([fromId]);
    const parent = new Map<number, { prev: number; edge: AdjacencyEdge }>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) break;
      for (const edge of adjacency.get(current) ?? []) {
        if (visited.has(edge.toNodeId)) continue;
        visited.add(edge.toNodeId);
        parent.set(edge.toNodeId, { prev: current, edge });
        queue.push(edge.toNodeId);
      }
    }

    if (!visited.has(toId)) return null;

    const path: Array<{ nodeId: number; edge?: AdjacencyEdge }> = [{ nodeId: toId }];
    let cursor = toId;
    while (cursor !== fromId) {
      const entry = parent.get(cursor);
      if (!entry) break;
      path.push({ nodeId: entry.prev, edge: entry.edge });
      cursor = entry.prev;
    }
    path.reverse();
    return path;
  }

  private pathToSteps(path: Array<{ nodeId: number; edge?: AdjacencyEdge }>): SchemaPathStep[] {
    const steps: SchemaPathStep[] = [];
    for (let i = 1; i < path.length; i += 1) {
      const edge = path[i].edge;
      if (!edge) continue;
      const node = this.getNode(path[i].nodeId);
      if (!node) continue;
      steps.push({
        owner: node.owner,
        table: node.name,
        column: edge.fromColumn,
        edgeType: edge.edgeType,
        confidence: edge.confidence,
      });
    }
    return steps;
  }

  private getNode(id: number): { owner: string; name: string } | null {
    const row = this.db.connection
      .prepare(`SELECT owner, name FROM schema_nodes WHERE id = ?`)
      .get(id) as { owner: string; name: string } | undefined;
    return row ?? null;
  }

  private normalizeTableKey(ref: { owner: string | null; name: string }): string {
    return ref.owner ? `${ref.owner}.${ref.name}`.toUpperCase() : ref.name.toUpperCase();
  }

  private loadExperiencePath(
    from: string,
    to: string,
  ): { pathJson: string; steps: SchemaPathStep[] } | null {
    const row = this.db.connection
      .prepare(
        `SELECT path_json FROM experience_paths
         WHERE UPPER(from_table) = UPPER(?) AND UPPER(to_table) = UPPER(?)
         ORDER BY use_count DESC, last_used_at DESC
         LIMIT 1`,
      )
      .get(from, to) as { path_json: string } | undefined;
    if (!row) return null;
    try {
      return { pathJson: row.path_json, steps: JSON.parse(row.path_json) as SchemaPathStep[] };
    } catch {
      return null;
    }
  }

  private touchExperiencePath(from: string, to: string, pathJson: string): void {
    this.db.connection
      .prepare(
        `UPDATE experience_paths
         SET use_count = use_count + 1, last_used_at = ?
         WHERE UPPER(from_table) = UPPER(?) AND UPPER(to_table) = UPPER(?) AND path_json = ?`,
      )
      .run(new Date().toISOString(), from, to, pathJson);
  }

  private saveExperiencePath(
    from: string,
    to: string,
    steps: SchemaPathStep[],
    createdBy?: string,
  ): void {
    const pathJson = JSON.stringify(steps);
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO experience_paths (from_table, to_table, path_json, use_count, last_used_at, created_by)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(from_table, to_table, path_json) DO UPDATE SET
           use_count = experience_paths.use_count + 1,
           last_used_at = excluded.last_used_at`,
      )
      .run(from, to, pathJson, now, createdBy ?? null);
  }
}
