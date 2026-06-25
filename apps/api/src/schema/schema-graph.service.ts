import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { OracleMetadataCatalogSnapshot } from '../oracle/metadata/oracle-metadata.types';
import { inferSchemaEdges } from './schema-inference.util';

export type GraphBuildResult = {
  nodeCount: number;
  columnCount: number;
  edgeCount: number;
  sourceLineCount: number;
};

@Injectable()
export class SchemaGraphService {
  private readonly logger = new Logger(SchemaGraphService.name);

  constructor(private readonly db: DatabaseService) {}

  buildFromCatalog(catalog: OracleMetadataCatalogSnapshot, crawlJobId: number): GraphBuildResult {
    const conn = this.db.connection;
    const clear = conn.transaction(() => {
      conn.prepare('DELETE FROM schema_edges').run();
      conn.prepare('DELETE FROM schema_columns').run();
      conn.prepare('DELETE FROM schema_nodes').run();
      conn.prepare('DELETE FROM schema_sources').run();
    });
    clear();

    const insertNode = conn.prepare(
      `INSERT INTO schema_nodes (owner, name, node_type, comment, crawl_job_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertColumn = conn.prepare(
      `INSERT INTO schema_columns (node_id, name, data_type, nullable, is_pk, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertEdge = conn.prepare(
      `INSERT OR IGNORE INTO schema_edges
         (from_node_id, to_node_id, from_column, to_column, edge_type, confidence, source, crawl_job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSource = conn.prepare(
      `INSERT OR IGNORE INTO schema_sources (owner, name, object_type, line, text)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const tableCommentMap = new Map<string, string>();
    const columnCommentMap = new Map<string, string>();
    for (const item of catalog.comments) {
      const key = `${item.owner}\0${item.tableName}`;
      if (item.columnName) {
        columnCommentMap.set(`${key}\0${item.columnName}`, item.comments);
      } else {
        tableCommentMap.set(key, item.comments);
      }
    }

    const pkColumns = new Map<string, Set<string>>();
    for (const constraint of catalog.constraints) {
      if (constraint.constraintType !== 'P') continue;
      const key = `${constraint.owner}\0${constraint.tableName}`;
      const set = pkColumns.get(key) ?? new Set<string>();
      set.add(constraint.columnName);
      pkColumns.set(key, set);
    }

    const nodeIdByKey = new Map<string, number>();
    const graphNodes: Array<{
      id: number;
      owner: string;
      name: string;
      nodeType: 'table' | 'view';
    }> = [];

    const registerNode = (owner: string, name: string, nodeType: 'table' | 'view', comment: string | null) => {
      const key = `${owner}\0${name}\0${nodeType}`;
      if (nodeIdByKey.has(key)) return nodeIdByKey.get(key)!;
      const result = insertNode.run(owner, name, nodeType, comment, crawlJobId);
      const id = Number(result.lastInsertRowid);
      nodeIdByKey.set(key, id);
      graphNodes.push({ id, owner, name, nodeType });
      return id;
    };

    let columnCount = 0;
    for (const table of catalog.tables) {
      const tableKey = `${table.owner}\0${table.name}`;
      const comment = tableCommentMap.get(tableKey) ?? null;
      const nodeId = registerNode(table.owner, table.name, 'table', comment);
      const pks = pkColumns.get(tableKey) ?? new Set<string>();
      for (const column of table.columns) {
        insertColumn.run(
          nodeId,
          column.name,
          column.dataType,
          column.nullable === false ? 0 : 1,
          pks.has(column.name) ? 1 : 0,
          columnCommentMap.get(`${tableKey}\0${column.name}`) ?? null,
        );
        columnCount += 1;
      }
    }

    for (const view of catalog.views) {
      const tableKey = `${view.owner}\0${view.name}`;
      registerNode(view.owner, view.name, 'view', tableCommentMap.get(tableKey) ?? null);
    }

    const edgeKeys = new Set<string>();
    let edgeCount = 0;
    for (const constraint of catalog.constraints) {
      if (constraint.constraintType !== 'R') continue;
      if (!constraint.refOwner || !constraint.refTableName || !constraint.refColumnName) continue;
      const fromKey = `${constraint.owner}\0${constraint.tableName}\0table`;
      const toKey = `${constraint.refOwner}\0${constraint.refTableName}\0table`;
      const fromId = nodeIdByKey.get(fromKey);
      const toId = nodeIdByKey.get(toKey);
      if (!fromId || !toId) continue;
      const eKey = `${fromId}\0${toId}\0${constraint.columnName}\0${constraint.refColumnName}`;
      if (edgeKeys.has(eKey)) continue;
      edgeKeys.add(eKey);
      insertEdge.run(
        fromId,
        toId,
        constraint.columnName,
        constraint.refColumnName,
        'fk',
        1.0,
        'oracle_fk',
        crawlJobId,
      );
      edgeCount += 1;
    }

    const pkByNode = new Map<number, Set<string>>();
    for (const table of catalog.tables) {
      const nodeId = nodeIdByKey.get(`${table.owner}\0${table.name}\0table`);
      if (!nodeId) continue;
      const pks = pkColumns.get(`${table.owner}\0${table.name}`);
      if (pks?.size) pkByNode.set(nodeId, pks);
    }

    const inferred = inferSchemaEdges(graphNodes, pkByNode, edgeKeys);
    for (const edge of inferred) {
      insertEdge.run(
        edge.fromNodeId,
        edge.toNodeId,
        edge.fromColumn,
        edge.toColumn,
        edge.edgeType,
        edge.confidence,
        edge.source,
        crawlJobId,
      );
      edgeCount += 1;
    }

    let sourceLineCount = 0;
    for (const line of catalog.sources) {
      insertSource.run(line.owner, line.name, line.objectType, line.line, line.text);
      sourceLineCount += 1;
    }

    this.logger.log(
      `Graf schematu: ${graphNodes.length} węzłów, ${columnCount} kolumn, ${edgeCount} krawędzi, ${sourceLineCount} linii źródła.`,
    );

    return {
      nodeCount: graphNodes.length,
      columnCount,
      edgeCount,
      sourceLineCount,
    };
  }

  getCounts(): {
    nodeCount: number;
    columnCount: number;
    edgeCount: number;
    experiencePathCount: number;
    sourceLineCount: number;
  } {
    const conn = this.db.connection;
    const scalar = (sql: string) =>
      Number((conn.prepare(sql).get() as { cnt: number } | undefined)?.cnt ?? 0);
    return {
      nodeCount: scalar('SELECT COUNT(*) AS cnt FROM schema_nodes'),
      columnCount: scalar('SELECT COUNT(*) AS cnt FROM schema_columns'),
      edgeCount: scalar('SELECT COUNT(*) AS cnt FROM schema_edges'),
      experiencePathCount: scalar('SELECT COUNT(*) AS cnt FROM experience_paths'),
      sourceLineCount: scalar('SELECT COUNT(*) AS cnt FROM schema_sources'),
    };
  }

  resolveNodeId(tableRef: string): number | null {
    const parsed = this.parseTableRef(tableRef);
    if (!parsed) return null;
    const row = this.db.connection
      .prepare(
        `SELECT id FROM schema_nodes
         WHERE UPPER(name) = UPPER(?)
           AND (? IS NULL OR UPPER(owner) = UPPER(?))
         ORDER BY CASE node_type WHEN 'table' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(parsed.name, parsed.owner, parsed.owner) as { id: number } | undefined;
    return row?.id ?? null;
  }

  parseTableRef(ref: string): { owner: string | null; name: string } | null {
    const trimmed = ref.trim();
    if (!trimmed) return null;
    const dot = trimmed.indexOf('.');
    if (dot > 0) {
      return {
        owner: trimmed.slice(0, dot).trim(),
        name: trimmed.slice(dot + 1).trim(),
      };
    }
    return { owner: null, name: trimmed };
  }

  getKnownTableNames(): Set<string> {
    const rows = this.db.connection
      .prepare(`SELECT UPPER(owner || '.' || name) AS full_name, UPPER(name) AS name FROM schema_nodes`)
      .all() as { full_name: string; name: string }[];
    const set = new Set<string>();
    for (const row of rows) {
      set.add(row.full_name);
      set.add(row.name);
    }
    return set;
  }
}
