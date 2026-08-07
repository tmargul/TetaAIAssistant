import type {
  Stage1ConfidenceClass,
  Stage1Edge,
  Stage1EdgeKind,
  Stage1NodeRef,
  Stage1Provenance,
} from './teta-stage1.types';
import { stage1CanonicalEdgeId } from './teta-stage1-integrity';

/** @deprecated use stage1CanonicalEdgeId — kept for test name stability */
export function stage1EdgeId(
  edgeKind: Stage1EdgeKind,
  fromName: string,
  toName: string,
  _raw?: string,
): string {
  return stage1CanonicalEdgeId(
    edgeKind,
    { kind: 'gateway', name: fromName },
    { kind: 'oracle_object', name: toName },
  );
}

export function mapStage2eEdge(edgeKind: Stage1EdgeKind): string | null {
  switch (edgeKind) {
    case 'FORM_HAS_CONTROL':
      return 'HAS_CONTROL';
    case 'CONTROL_BINDS_DATASET':
    case 'CONTROL_BINDS_COLUMN':
      return 'BINDS_TARGET';
    case 'FORM_USES_BUSINESS_OBJECT':
      return 'USES_BO';
    case 'FORM_USES_DATA_FACTORY':
      return 'USES_DF';
    case 'BUSINESS_OBJECT_USES_GATEWAY':
      return 'RESOLVES_TO_GATEWAY';
    case 'GATEWAY_READS_FROM_ORACLE_OBJECT':
    case 'GATEWAY_JOINS_ORACLE_OBJECT':
      return 'MAPS_TO_ORACLE_OBJECT';
    case 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE':
      return 'USES_PACKAGE';
    case 'GATEWAY_PROJECTS_COLUMN':
      return 'PROJECTS';
    case 'LOOKUP_USES_OBJECT':
      return 'BINDS_LOOKUP';
    case 'INHERITS_CONFIGURATION':
      return 'INHERITS_FROM';
    case 'APPLICATION_JOIN':
      return 'JOINS_TO';
    default:
      return null;
  }
}

export function makeEdge(input: {
  edgeKind: Stage1EdgeKind;
  from: Stage1NodeRef;
  to: Stage1NodeRef;
  confidenceClass: Stage1ConfidenceClass;
  provenance: Stage1Provenance[];
  attributes?: Record<string, unknown>;
}): Stage1Edge {
  return {
    id: stage1CanonicalEdgeId(input.edgeKind, input.from, input.to),
    edgeKind: input.edgeKind,
    stage2eEdgeType: mapStage2eEdge(input.edgeKind),
    from: input.from,
    to: input.to,
    confidenceClass: input.confidenceClass,
    provenance: input.provenance,
    attributes: input.attributes,
  };
}

/** Parse Stage2B gateway evidence assignment strings. */
export function parseGatewayCtorDataset(assignment: string): string | null {
  const m = /::\.ctor\([^)]*"([^"]+)"\s*\)/.exec(assignment);
  return m?.[1] ?? null;
}

export function parseSetTableName(assignment: string): string | null {
  const m = /set_TableName\("([^"]+)"\)/.exec(assignment);
  return m?.[1] ?? null;
}

export function parseSetTableAlias(assignment: string): string | null {
  const m = /set_TableAlias\("([^"]+)"\)/.exec(assignment);
  return m?.[1] ?? null;
}

export function parseSetViewName(assignment: string): string | null {
  const m = /set_ViewName\("([^"]+)"\)/.exec(assignment);
  return m?.[1] ?? null;
}

export function parseSetBaseTableName(assignment: string): string | null {
  const m = /set_BaseTableName\("([^"]+)"\)/.exec(assignment);
  return m?.[1] ?? null;
}

export function parseDictionaryTableName(assignment: string): string | null {
  const m = /set_DictionaryTableName\("([^"]+)"\)|DictionaryTableName\s*=\s*"([^"]+)"/.exec(
    assignment,
  );
  return m?.[1] ?? m?.[2] ?? null;
}

export function parseDictionaryTableAlias(assignment: string): string | null {
  const m = /set_DictionaryTableAlias\("([^"]+)"\)|DictionaryTableAlias\s*=\s*"([^"]+)"/.exec(
    assignment,
  );
  return m?.[1] ?? m?.[2] ?? null;
}

export function parseSumoCommandBuilderPackage(assignment: string): string | null {
  const m = /SumoCommandBuilder::\.ctor\([^)]*"([^"]+_DAC)"/.exec(assignment);
  return m?.[1] ?? null;
}

/**
 * AddJoin("object", "alias", onClause|null, joinType|null)
 */
export function parseAddJoin(assignment: string): {
  objectName: string;
  alias: string;
  joinType: string | null;
  onClause: string | null;
} | null {
  const m =
    /AddJoin\("([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(null|"([^"]*)")\s*,\s*(null|"([^"]*)")\)/.exec(
      assignment,
    );
  if (!m) return null;
  return {
    objectName: m[1]!,
    alias: m[2]!,
    onClause: m[3] === 'null' ? null : m[4] ?? null,
    joinType: m[5] === 'null' ? null : m[6] ?? null,
  };
}

export function parseAddColumn(assignment: string): {
  expression: string;
  alias: string | null;
} | null {
  const m2 = /AddColumn\("([^"]+)"\s*,\s*"([^"]+)"\)/.exec(assignment);
  if (m2) return { expression: m2[1]!, alias: m2[2]! };
  const m1 = /AddColumn\("([^"]+)"\)/.exec(assignment);
  if (m1) return { expression: m1[1]!, alias: null };
  return null;
}

/**
 * Framework IL pattern (TableGatewayBase):
 *   AddRelation("PARENT_COL", null, null, 0, "CHILD_COL", 1)
 * Parent/child dataset objects are not in the call — only key columns.
 * Dataset arrays pattern (rare): AddRelation(..., new[]{"A"}, new[]{"B"})
 */
export function parseAddRelation(assignment: string): {
  mechanism: 'relation' | 'add_relation' | 'add_default_relation';
  parentObject: string | null;
  childObject: string | null;
  parentColumns: string[];
  childColumns: string[];
  optionalFlag: boolean | null;
  keyResolutionStatus: 'resolved' | 'unresolved';
} | null {
  if (/AddDefaultRelation\(/.test(assignment)) {
    const objs = [...assignment.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    return {
      mechanism: 'add_default_relation',
      parentObject: objs[0] ?? null,
      childObject: objs[1] ?? null,
      parentColumns: [],
      childColumns: [],
      optionalFlag: null,
      keyResolutionStatus: 'unresolved',
    };
  }
  if (!/AddRelation\(|\.Relation\(/.test(assignment)) return null;

  // Primary Teta IL shape
  const m =
    /AddRelation\("([^"]+)"\s*,\s*null\s*,\s*null\s*,\s*(\d+)\s*,\s*"([^"]+)"(?:\s*,\s*(\d+))?\)/.exec(
      assignment,
    );
  if (m) {
    return {
      mechanism: 'add_relation',
      parentObject: null,
      childObject: null,
      parentColumns: [m[1]!],
      childColumns: [m[3]!],
      optionalFlag: m[4] != null ? m[4] === '1' : null,
      keyResolutionStatus: 'resolved',
    };
  }

  const arrayBlocks = [...assignment.matchAll(/new\s*(?:string\s*)?\[\s*\]\s*\{([^}]*)\}/gi)];
  const parentColumns =
    arrayBlocks[0]?.[1]
      ?.match(/"([^"]+)"/g)
      ?.map((s) => s.slice(1, -1)) ?? [];
  const childColumns =
    arrayBlocks[1]?.[1]
      ?.match(/"([^"]+)"/g)
      ?.map((s) => s.slice(1, -1)) ?? [];
  const objs = [...assignment.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  const mechanism = /AddRelation\(/.test(assignment) ? 'add_relation' : 'relation';
  return {
    mechanism,
    parentObject: parentColumns.length ? null : objs[0] ?? null,
    childObject: parentColumns.length ? null : objs[1] ?? null,
    parentColumns,
    childColumns,
    optionalFlag: null,
    keyResolutionStatus:
      parentColumns.length > 0 &&
      childColumns.length > 0 &&
      parentColumns.length === childColumns.length
        ? 'resolved'
        : 'unresolved',
  };
}

export function parseSimpleJoinOn(onClause: string | null | undefined): Array<{
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
}> {
  if (!onClause) return [];
  const out: Array<{
    leftAlias: string;
    leftColumn: string;
    rightAlias: string;
    rightColumn: string;
  }> = [];
  const parts = onClause.split(/\s+AND\s+/i);
  for (const p of parts) {
    const m =
      /^\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*$/.exec(
        p.trim(),
      );
    if (!m) continue;
    out.push({
      leftAlias: m[1]!,
      leftColumn: m[2]!,
      rightAlias: m[3]!,
      rightColumn: m[4]!,
    });
  }
  return out;
}

export function isLateBindingAssignment(assignment: string): boolean {
  return /CreateTableGatewayByLateBinding|ProxyHelper\.Get|GetBusinessObject\(|FillCommandPrepared|job_action|ExecuteNonQuery\s*\(\s*"/.test(
    assignment,
  );
}

/** BusinessObjectReference("dll","Type") is exact literal BO binding, not a runtime factory. */
export function parseBusinessObjectReference(assignment: string): {
  assembly: string;
  typeName: string;
} | null {
  const m =
    /BusinessObjectReference\("([^"]+)"\s*,\s*"([^"]+)"\)/.exec(assignment);
  if (!m) return null;
  return { assembly: m[1]!, typeName: m[2]! };
}

export function classifyRuntimeBoundary(assignment: string): {
  boundaryType:
    | 'late_binding_gateway'
    | 'proxy_factory'
    | 'dynamic_procedure'
    | 'dynamic_sql'
    | 'scheduler_job_action'
    | 'fill_command_prepared_mutation'
    | 'unknown_runtime';
  missingRuntimeValue: string;
} {
  if (/CreateTableGatewayByLateBinding/.test(assignment)) {
    return {
      boundaryType: 'late_binding_gateway',
      missingRuntimeValue: 'runtime_gateway_type_or_table',
    };
  }
  if (/ProxyHelper\.Get|GetBusinessObject\(/.test(assignment)) {
    return {
      boundaryType: 'proxy_factory',
      missingRuntimeValue: 'runtime_business_object_type',
    };
  }
  if (/FillCommandPrepared/.test(assignment)) {
    return {
      boundaryType: 'fill_command_prepared_mutation',
      missingRuntimeValue: 'runtime_mutated_sql_text',
    };
  }
  if (/job_action/.test(assignment)) {
    return {
      boundaryType: 'scheduler_job_action',
      missingRuntimeValue: 'runtime_job_action_text',
    };
  }
  if (/ExecuteNonQuery|dynamic/.test(assignment)) {
    return {
      boundaryType: 'dynamic_sql',
      missingRuntimeValue: 'runtime_sql_or_procedure_name',
    };
  }
  return { boundaryType: 'unknown_runtime', missingRuntimeValue: 'runtime_value' };
}

export function controlAssignedProperty(
  control: Record<string, unknown>,
  property: string,
): string | null {
  const props = (control.assignedProperties as Array<Record<string, unknown>>) ?? [];
  for (const p of props) {
    if (String(p.property ?? '') === property && p.value != null) {
      return String(p.value);
    }
  }
  return null;
}
