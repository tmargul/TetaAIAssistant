import type {
  OracleMetadataCatalogTotals,
  OracleMetadataCounts,
  OracleMetadataObjects,
  TetaKnowledgeChunkInput,
} from '@teta/shared';

export interface OracleColumnMeta {
  name: string;
  dataType: string;
  nullable?: boolean;
  dataDefault?: string | null;
}

export interface OracleConstraintMeta {
  owner: string;
  tableName: string;
  constraintName: string;
  constraintType: 'P' | 'R' | 'U' | 'C';
  columnName: string;
  position: number;
  refOwner?: string;
  refTableName?: string;
  refColumnName?: string;
}

export interface OracleCommentMeta {
  owner: string;
  tableName: string;
  columnName: string | null;
  comments: string;
}

export interface OracleSourceLineMeta {
  owner: string;
  name: string;
  objectType: string;
  line: number;
  text: string;
}

export interface OracleTableMeta {
  owner: string;
  name: string;
  columns: OracleColumnMeta[];
}

export interface OracleNamedObjectMeta {
  owner: string;
  name: string;
  objectType?: string;
  status?: string;
}

export interface OracleMetadataCatalogSnapshot {
  owners: string[];
  tables: OracleTableMeta[];
  views: OracleNamedObjectMeta[];
  packages: OracleNamedObjectMeta[];
  procedures: OracleNamedObjectMeta[];
  functions: OracleNamedObjectMeta[];
  constraints: OracleConstraintMeta[];
  comments: OracleCommentMeta[];
  sources: OracleSourceLineMeta[];
  tetaVersion: string | null;
  pilotModule: string | null;
  databaseLabel: string;
}

export interface OracleMetadataFetchResult {
  catalog: OracleMetadataCatalogSnapshot;
  catalogTotals: OracleMetadataCatalogTotals;
}

export interface OracleMetadataCatalogCounts extends OracleMetadataCounts {}

export function emptyOracleMetadataObjects(): OracleMetadataObjects {
  return {
    tables: [],
    views: [],
    packages: [],
    procedures: [],
    functions: [],
  };
}

export function emptyOracleMetadataCounts(): OracleMetadataCounts {
  return {
    tables: 0,
    views: 0,
    columns: 0,
    packages: 0,
    procedures: 0,
    functions: 0,
  };
}

export function catalogToCounts(catalog: OracleMetadataCatalogSnapshot): OracleMetadataCounts {
  return {
    tables: catalog.tables.length,
    views: catalog.views.length,
    columns: catalog.tables.reduce((sum, table) => sum + table.columns.length, 0),
    packages: catalog.packages.length,
    procedures: catalog.procedures.length,
    functions: catalog.functions.length,
  };
}

export function catalogToObjects(catalog: OracleMetadataCatalogSnapshot): OracleMetadataObjects {
  const fullName = (owner: string, name: string) => `${owner}.${name}`;
  return {
    tables: catalog.tables.map((item) => fullName(item.owner, item.name)).sort(),
    views: catalog.views.map((item) => fullName(item.owner, item.name)).sort(),
    packages: catalog.packages.map((item) => fullName(item.owner, item.name)).sort(),
    procedures: catalog.procedures.map((item) => fullName(item.owner, item.name)).sort(),
    functions: catalog.functions.map((item) => fullName(item.owner, item.name)).sort(),
  };
}

export interface OracleMetadataBuildResult {
  chunks: TetaKnowledgeChunkInput[];
  catalog: OracleMetadataCatalogSnapshot;
}
