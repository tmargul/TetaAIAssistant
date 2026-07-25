/**
 * Stage 3E — source alias planning.
 *
 * Every FROM/JOIN entry uses the plan's `accessObject` (never the logical object). Row-producing
 * sources get positional aliases S01, S02, … and filter-only sources get E01, E02, …, both derived
 * from `sources[]` order so the SQL is deterministic. The two alias spaces are kept apart so an
 * existence-only object can never be mistaken for a row source when rendering FROM/JOIN.
 */
import {
  isFilterOnlyQuerySource,
  type QuerySource,
} from '../teta-query-planner/teta-query-plan.types';
import {
  STAGE3E_EXISTENCE_ALIAS_PREFIX,
  STAGE3E_SOURCE_ALIAS_PREFIX,
  type CompilableQueryPlan,
  type CompiledSourceAlias,
} from './teta-oracle-compiler.types';
import {
  buildQualifiedObjectName,
  validateIdentifier,
  type IdentifierIssue,
} from './teta-oracle-identifier-validator';

export type SourceAliasIssue = {
  code: string;
  message: string;
  sourceRole: string;
};

export type SourceAliasPlan = {
  /** Row-producing sources only; this is what the join tree and projections may use. */
  sources: CompiledSourceAlias[];
  /** Filter-only sources, addressable exclusively from inside an EXISTS subquery. */
  filterOnlySources: CompiledSourceAlias[];
  /** Row-producing and filter-only sources together, in plan order. */
  allSources: CompiledSourceAlias[];
  byRole: Map<string, CompiledSourceAlias>;
  byAlias: Map<string, CompiledSourceAlias>;
  issues: SourceAliasIssue[];
  identifierIssues: IdentifierIssue[];
};

export function sourceAliasFor(ordinal: number): string {
  return `${STAGE3E_SOURCE_ALIAS_PREFIX}${String(ordinal).padStart(2, '0')}`;
}

export function existenceAliasFor(ordinal: number): string {
  return `${STAGE3E_EXISTENCE_ALIAS_PREFIX}${String(ordinal).padStart(2, '0')}`;
}

export function planSourceAliases(plan: CompilableQueryPlan): SourceAliasPlan {
  const sources: CompiledSourceAlias[] = [];
  const filterOnlySources: CompiledSourceAlias[] = [];
  const allSources: CompiledSourceAlias[] = [];
  const byRole = new Map<string, CompiledSourceAlias>();
  const byAlias = new Map<string, CompiledSourceAlias>();
  const issues: SourceAliasIssue[] = [];
  const identifierIssues: IdentifierIssue[] = [];
  let rowOrdinal = 0;
  let existenceOrdinal = 0;

  plan.sources.forEach((source: QuerySource) => {
    const filterOnly = isFilterOnlyQuerySource(source);
    const access = source.accessObject;

    if (byRole.has(source.sourceRole)) {
      issues.push({
        code: 'duplicate_source_role',
        sourceRole: source.sourceRole,
        message: `Source role ${source.sourceRole} appears more than once`,
      });
      return;
    }
    if (!access) {
      issues.push({
        code: 'missing_access_object',
        sourceRole: source.sourceRole,
        message: `Source role ${source.sourceRole} has no accessObject`,
      });
      return;
    }

    const ordinal = filterOnly ? existenceOrdinal + 1 : rowOrdinal + 1;
    const alias = filterOnly ? existenceAliasFor(ordinal) : sourceAliasFor(ordinal);

    const aliasIssue = validateIdentifier('alias', alias);
    if (aliasIssue) {
      identifierIssues.push(aliasIssue);
      return;
    }

    const qualified = buildQualifiedObjectName(access.owner, access.objectName);
    if (!qualified.ok) {
      identifierIssues.push(qualified.issue);
      issues.push({
        code: 'invalid_access_object_identifier',
        sourceRole: source.sourceRole,
        message: qualified.issue.message,
      });
      return;
    }

    const compiled: CompiledSourceAlias = {
      alias,
      ordinal,
      usage: filterOnly ? 'filter_only' : 'row_source',
      sourceRole: source.sourceRole,
      accessObjectNodeId: access.nodeId,
      accessOwner: access.owner,
      accessObjectType: access.objectType,
      accessObjectName: access.objectName,
      qualifiedName: qualified.text,
      logicalObjectNodeId: source.logicalObject?.nodeId ?? null,
      logicalOwner: source.logicalObject?.owner ?? null,
      logicalObjectName: source.logicalObject?.objectName ?? null,
      enrichment: !!source.enrichment,
    };

    if (filterOnly) {
      existenceOrdinal = ordinal;
      filterOnlySources.push(compiled);
    } else {
      rowOrdinal = ordinal;
      sources.push(compiled);
    }
    allSources.push(compiled);
    byRole.set(compiled.sourceRole, compiled);
    byAlias.set(compiled.alias, compiled);
  });

  if (!sources.length && allSources.length) {
    issues.push({
      code: 'no_row_producing_sources',
      sourceRole: allSources[0]!.sourceRole,
      message: 'Plan has no row-producing sources; a filter-only source cannot be selected FROM',
    });
  }

  return {
    sources,
    filterOnlySources,
    allSources,
    byRole,
    byAlias,
    issues,
    identifierIssues,
  };
}
