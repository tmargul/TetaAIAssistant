/**
 * Stage 2E.1 — domain assignment + allowed edge domain matrix.
 */
import type { Stage2eDomain } from './teta-stage2e.types';

export function domainForNodeType(type: string): Stage2eDomain {
  switch (type) {
    case 'plugin_registry_entry':
    case 'application_form':
    case 'ui_control':
    case 'action_control':
    case 'target_binding':
    case 'lookup_binding':
    case 'data_source':
      return 'application';
    case 'assembly':
    case 'dotnet_type':
    case 'business_object':
    case 'data_factory':
    case 'gateway':
      return 'dotnet';
    case 'dataset':
    case 'dataset_column':
    case 'main_source':
    case 'join':
    case 'projected_column':
    case 'calculated_column':
      return 'dataset';
    case 'help_document':
    case 'help_section':
    case 'help_field':
      return 'help';
    case 'oracle_object':
    case 'oracle_column':
    case 'oracle_package':
    case 'oracle_procedure':
    case 'oracle_function':
    case 'oracle_argument':
    case 'oracle_dependency':
    case 'oracle_constraint':
      return 'oracle';
    default:
      return 'canonical-graph-technical';
  }
}

/** Allowed (fromDomain, toDomain) pairs for edge types. Empty set = any within documented types. */
export type DomainPair = `${Stage2eDomain}->${Stage2eDomain}`;

/**
 * Edge-type → allowed domain pairs.
 * Technical / inheritance edges may include canonical-graph-technical.
 */
export const allowedEdgeDomainMatrix: Record<string, DomainPair[]> = {
  REGISTERED_AS: ['application->application'],
  IMPLEMENTED_BY: ['application->dotnet'],
  HAS_HELP: ['application->help'],
  HAS_SECTION: ['help->help'],
  DESCRIBES: ['help->help', 'help->application'],
  LABEL_FOR: ['help->application'],
  HAS_CONTROL: ['application->application'],
  BINDS_TARGET: ['application->application'],
  BINDS_LOOKUP: ['application->application'],
  DISPLAYS_FROM: ['application->dataset', 'application->oracle'],
  USES_DATASOURCE: ['application->application'],
  USES_BO: ['application->dotnet'],
  USES_DF: ['application->dotnet'],
  RESOLVES_TO_GATEWAY: ['dotnet->dotnet'],
  PRODUCES_DATASET: ['dotnet->dataset'],
  READS_FROM: ['dataset->dataset'],
  JOINS_TO: ['dataset->dataset'],
  PROJECTS: ['dataset->dataset'],
  DERIVED_FROM: ['dataset->dataset', 'dataset->oracle'],
  MAPS_TO_ORACLE_OBJECT: [
    'dotnet->oracle',
    'dataset->oracle',
    'application->oracle',
  ],
  MAPS_TO_ORACLE_COLUMN: ['application->oracle', 'dataset->oracle'],
  MAPS_TO_DATASET_COLUMN: ['application->dataset'],
  HAS_DATASET_COLUMN: ['dataset->dataset'],
  RESOLVES_TO_ORACLE_COLUMN: ['dataset->oracle'],
  RESOLVES_SYNONYM_TO: ['oracle->oracle'],
  USES_PACKAGE: ['dotnet->oracle', 'dataset->oracle', 'oracle->oracle'],
  CALLS_FUNCTION: ['dataset->oracle', 'oracle->oracle'],
  CALLS_PROCEDURE: ['dataset->oracle', 'oracle->oracle'],
  DEPENDS_ON: ['oracle->oracle'],
  VALIDATED_BY_ORACLE: ['oracle->oracle', 'dotnet->oracle', 'dataset->oracle'],
  INHERITS_FROM: ['dotnet->dotnet'],
  FOREIGN_KEY_TO: ['oracle->oracle'],
  REFERENCES: ['oracle->oracle'],
  PRIMARY_KEY_OF: ['oracle->oracle'],
  UNIQUE_KEY_OF: ['oracle->oracle'],
  HAS_PROCEDURE: ['oracle->oracle'],
  HAS_FUNCTION: ['oracle->oracle'],
  HAS_ARGUMENT: ['oracle->oracle'],
  HAS_COLUMN: ['oracle->oracle'],
};

export function isEdgeDomainAllowed(
  edgeType: string,
  fromDomain: string,
  toDomain: string,
): boolean {
  const allowed = allowedEdgeDomainMatrix[edgeType];
  if (!allowed) {
    // Unknown edge type — allow only same-domain or via technical
    return (
      fromDomain === toDomain ||
      fromDomain === 'canonical-graph-technical' ||
      toDomain === 'canonical-graph-technical'
    );
  }
  const pair = `${fromDomain}->${toDomain}` as DomainPair;
  return allowed.includes(pair);
}
