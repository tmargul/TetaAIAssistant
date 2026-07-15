export type TetaPluginLanguageMeta = {
  LanguageName?: string | null;
  LanguagePrefix?: string | null;
  Name?: string | null;
  Arl?: string | null;
};

export type TetaPluginDescriptorMeta = {
  Guid?: string | null;
  Assembly?: string | null;
  ClassName?: string | null;
  Type?: string | null;
  Profile?: string | null;
  BusinessLocalization?: string | null;
  Languages?: TetaPluginLanguageMeta[];
};

export type TetaPluginSqlCommandSet = {
  Select?: string | null;
  Insert?: string | null;
  Update?: string | null;
  Delete?: string | null;
};

export type TetaPluginGatewaySqlSnapshot = {
  FlatQuery?: string | null;
  LastSqlQuery?: string | null;
  ProvidedRuntimeFilter?: string | null;
  AppliedRuntimeFilter?: string | null;
  RuntimeFilterApplied?: boolean;
  RuntimeFilterApplyMethod?: string | null;
  RuntimeProbeError?: string | null;
  SqlStatus?: string | null;
  /** SELECT z aliasami AS "etykieta grida" — generowany przy imporcie */
  LabeledSelect?: string | null;
  Direct?: TetaPluginSqlCommandSet;
  BuilderText?: TetaPluginSqlCommandSet;
  BuilderSumo?: TetaPluginSqlCommandSet;
};

export type TetaPluginGatewayMeta = {
  ClassName: string;
  GatewayKind: 'MTG' | 'TG' | string;
  SourcePath?: string | null;
  DatasetTableName?: string | null;
  ViewName?: string | null;
  PackageName?: string | null;
  TableAlias?: string | null;
  BaseTableName?: string | null;
  RelatedPackages?: {
    dac?: string | null;
    agl?: string | null;
    lep?: string | null;
  };
  Sql?: TetaPluginGatewaySqlSnapshot;
};

export type TetaPluginColumnMeta = {
  GridColumnName: string;
  Labels?: Record<string, string>;
  Hints?: Record<string, string>;
};

export type TetaPluginFormMetadata = {
  Metadata?: {
    Version?: string;
    GeneratedAtUtc?: string;
  };
  Plugin: TetaPluginDescriptorMeta;
  Form?: {
    SourcePath?: string | null;
    ResxFiles?: string[];
    PluginDllPath?: string | null;
    ColumnResourceSource?: 'dll' | 'resx' | 'merged';
  };
  BusinessObjectDlls?: string[];
  Gateways?: TetaPluginGatewayMeta[];
  Columns?: TetaPluginColumnMeta[];
  Synonyms?: Record<string, string[]>;
  Tags?: string[];
  Help?: TetaFormHelpSnapshot | null;
};

import type { TetaPluginOracleDiscovery } from './teta-plugin-oracle-discovery';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import type { TetaApplicationObject, TetaFormHelpSnapshot } from './teta-application-object.types';

export type TetaPluginMetadataBundle = {
  dllName: string;
  dllPath: string;
  relativePath: string;
  categoryDir: string;
  extractionMode: 'source-scan' | 'server-deployment' | 'hybrid';
  serverDirectory?: string | null;
  relatedBusinessObjectDlls?: string[];
  oracleDiscovery?: TetaPluginOracleDiscovery;
  columnMappings?: TetaPluginColumnMapping[];
  computedIntents?: TetaPluginComputedIntent[];
  helpDirectory?: string | null;
  applicationObjects?: TetaApplicationObject[];
  forms: TetaPluginFormMetadata[];
};
