/**
 * Stage 3E — logical column → access column resolution.
 *
 * Stage 3C plans reference logical columns under the canonical owner (`TETA_ADMIN`). SQL must read
 * from the access object instead (for example `TETA_ADMIN_P`), so every logical column is remapped
 * to a column of the same name that the graph proves exists on the access object via `HAS_COLUMN`.
 */
import {
  columnsOfOracleObject,
  type Stage3cGraphClient,
} from '../teta-query-planner/teta-query-graph-client';
import type { GraphNodeView } from '../teta-plugins/teta-stage3a.types';
import type {
  CompiledAccessColumn,
  CompiledSourceAlias,
} from './teta-oracle-compiler.types';
import {
  buildOracleColumnNodeId,
  buildQualifiedColumn,
  parseOracleColumnNodeId,
  validateIdentifier,
  type IdentifierIssue,
} from './teta-oracle-identifier-validator';

export type AccessColumnIssue = {
  code: string;
  message: string;
  logicalColumnNodeId: string;
  sourceRole: string | null;
};

export type AccessColumnResolution =
  | { ok: true; column: CompiledAccessColumn }
  | { ok: false; issue: AccessColumnIssue; identifierIssue?: IdentifierIssue };

export type AccessColumnResolver = {
  resolve(logicalColumnNodeId: string, preferredSourceRole?: string | null): AccessColumnResolution;
  resolved(): CompiledAccessColumn[];
  warnings(): Array<{ code: string; message: string }>;
  remapCount(): number;
};

function columnNameOf(node: GraphNodeView): string {
  const fromAttrs = node.attributes?.columnName;
  if (typeof fromAttrs === 'string' && fromAttrs.length) return fromAttrs.toUpperCase();
  if (node.name) return String(node.name).toUpperCase();
  const parsed = parseOracleColumnNodeId(node.id);
  return parsed ? parsed.columnName.toUpperCase() : '';
}

export function createAccessColumnResolver(input: {
  client: Stage3cGraphClient;
  sources: CompiledSourceAlias[];
}): AccessColumnResolver {
  const { client, sources } = input;

  // Only row-producing sources take part in implicit attribution: a column may be attributed to a
  // filter-only source solely when the caller names that role explicitly.
  const roleByObjectKey = new Map<string, string>();
  for (const source of sources) {
    if (source.usage === 'filter_only') continue;
    if (source.logicalOwner && source.logicalObjectName) {
      const key = `${source.logicalOwner.toUpperCase()}:${source.logicalObjectName.toUpperCase()}`;
      if (!roleByObjectKey.has(key)) roleByObjectKey.set(key, source.sourceRole);
    }
    const accessKey = `${source.accessOwner.toUpperCase()}:${source.accessObjectName.toUpperCase()}`;
    if (!roleByObjectKey.has(accessKey)) roleByObjectKey.set(accessKey, source.sourceRole);
  }
  const byRole = new Map(sources.map((s) => [s.sourceRole, s]));

  const columnCache = new Map<string, { byName: Map<string, GraphNodeView>; edgeIds: string[] }>();
  const resolvedByKey = new Map<string, CompiledAccessColumn>();
  const warnings: Array<{ code: string; message: string }> = [];
  const warned = new Set<string>();
  let remaps = 0;

  function accessColumnsOf(objectNodeId: string) {
    const cached = columnCache.get(objectNodeId);
    if (cached) return cached;
    const traced = columnsOfOracleObject(client, objectNodeId);
    const byName = new Map<string, GraphNodeView>();
    for (const column of traced.columns) {
      const name = columnNameOf(column);
      if (name && !byName.has(name)) byName.set(name, column);
    }
    const entry = { byName, edgeIds: [...traced.edgeIds].sort() };
    columnCache.set(objectNodeId, entry);
    return entry;
  }

  function addWarning(code: string, message: string) {
    const key = `${code}|${message}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push({ code, message });
  }

  function resolve(
    logicalColumnNodeId: string,
    preferredSourceRole?: string | null,
  ): AccessColumnResolution {
    const parsed = parseOracleColumnNodeId(logicalColumnNodeId);
    if (!parsed) {
      return {
        ok: false,
        issue: {
          code: 'unparsable_oracle_column_node_id',
          message: `Cannot parse Oracle column node id "${logicalColumnNodeId}"`,
          logicalColumnNodeId,
          sourceRole: preferredSourceRole ?? null,
        },
      };
    }

    const objectKey = `${parsed.owner.toUpperCase()}:${parsed.objectName.toUpperCase()}`;
    const sourceRole = preferredSourceRole ?? roleByObjectKey.get(objectKey) ?? null;
    if (!sourceRole) {
      return {
        ok: false,
        issue: {
          code: 'column_not_attributable_to_source',
          message: `Column ${logicalColumnNodeId} does not belong to any plan source`,
          logicalColumnNodeId,
          sourceRole: null,
        },
      };
    }

    const source = byRole.get(sourceRole);
    if (!source) {
      return {
        ok: false,
        issue: {
          code: 'unknown_source_role',
          message: `Source role ${sourceRole} is not part of the compiled sources`,
          logicalColumnNodeId,
          sourceRole,
        },
      };
    }

    const expectedKeys = new Set(
      [
        source.logicalOwner && source.logicalObjectName
          ? `${source.logicalOwner.toUpperCase()}:${source.logicalObjectName.toUpperCase()}`
          : null,
        `${source.accessOwner.toUpperCase()}:${source.accessObjectName.toUpperCase()}`,
      ].filter((k): k is string => !!k),
    );
    if (!expectedKeys.has(objectKey)) {
      return {
        ok: false,
        issue: {
          code: 'column_object_mismatch',
          message: `Column ${logicalColumnNodeId} does not belong to source role ${sourceRole}`,
          logicalColumnNodeId,
          sourceRole,
        },
      };
    }

    const cacheKey = `${sourceRole}|${logicalColumnNodeId}`;
    const cachedColumn = resolvedByKey.get(cacheKey);
    if (cachedColumn) return { ok: true, column: cachedColumn };

    const columnName = parsed.columnName.toUpperCase();
    const columnIssue = validateIdentifier('columnName', columnName);
    if (columnIssue) {
      return {
        ok: false,
        issue: {
          code: 'invalid_column_identifier',
          message: columnIssue.message,
          logicalColumnNodeId,
          sourceRole,
        },
        identifierIssue: columnIssue,
      };
    }

    const identical =
      source.accessOwner.toUpperCase() === parsed.owner.toUpperCase() &&
      source.accessObjectName.toUpperCase() === parsed.objectName.toUpperCase();

    const accessColumns = accessColumnsOf(source.accessObjectNodeId);
    const evidenceNode = accessColumns.byName.get(columnName);

    if (!evidenceNode) {
      if (identical && accessColumns.byName.size === 0) {
        addWarning(
          'access_object_columns_unknown',
          `Access object ${source.accessObjectNodeId} has no HAS_COLUMN evidence in the graph; using logical column ids for source role ${sourceRole}`,
        );
      } else {
        return {
          ok: false,
          issue: {
            code: 'missing_access_column_evidence',
            message: `Access object ${source.accessObjectNodeId} has no HAS_COLUMN evidence for column ${columnName} (logical ${logicalColumnNodeId})`,
            logicalColumnNodeId,
            sourceRole,
          },
        };
      }
    }

    const accessColumnNodeId =
      evidenceNode?.id ??
      buildOracleColumnNodeId(source.accessOwner, source.accessObjectName, columnName);

    const qualified = buildQualifiedColumn(source.alias, columnName);
    if (!qualified.ok) {
      return {
        ok: false,
        issue: {
          code: 'invalid_column_identifier',
          message: qualified.issue.message,
          logicalColumnNodeId,
          sourceRole,
        },
        identifierIssue: qualified.issue,
      };
    }

    const mappingKind = identical ? 'identical' : 'access_owner_remap';
    if (mappingKind === 'access_owner_remap') remaps += 1;

    const column: CompiledAccessColumn = {
      logicalColumnNodeId,
      accessColumnNodeId,
      sourceRole,
      alias: source.alias,
      owner: source.accessOwner,
      objectName: source.accessObjectName,
      columnName,
      qualifiedExpression: qualified.text,
      mappingKind,
      evidenceEdgeIds: evidenceNode
        ? accessColumns.edgeIds.filter((id) => id.includes(accessColumnNodeId))
        : [],
    };
    resolvedByKey.set(cacheKey, column);
    return { ok: true, column };
  }

  return {
    resolve,
    resolved: () =>
      [...resolvedByKey.values()].sort((a, b) =>
        `${a.sourceRole}:${a.columnName}`.localeCompare(`${b.sourceRole}:${b.columnName}`),
      ),
    warnings: () => [...warnings],
    remapCount: () => remaps,
  };
}
