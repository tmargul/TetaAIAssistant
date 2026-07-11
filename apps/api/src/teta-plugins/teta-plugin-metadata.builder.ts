import type {
  TetaPluginColumnMeta,
  TetaPluginDescriptorMeta,
  TetaPluginFormMetadata,
  TetaPluginGatewayMeta,
  TetaPluginGatewaySqlSnapshot,
} from './teta-plugin-metadata.types';
import { normalizeColumns, readColumnsFromResx } from './teta-plugin-resx.reader';
import type { TetaPluginBoCatalog } from './teta-plugin-bo-catalog';
import {
  extractGatewayMetadataFromDllText,
  findBusinessObjectReferences,
  findGatewayClassNames,
  readDllStrings,
} from './teta-dll-string-scanner';
import {
  findSiblingResxFiles,
  TetaPluginSourceLocator,
} from './teta-plugin-source-locator';
import {
  collectBusinessObjectReferencesFromSource,
  collectReferencedGatewayClasses,
  extractGatewayMetadataFromSource,
} from './teta-plugin-source-scanner';

export type PluginMetadataBuildContext = {
  pluginDllPath: string;
  boCatalog: TetaPluginBoCatalog | null;
  dllColumnResources: TetaPluginColumnMeta[];
};

function emptySqlSnapshot(): TetaPluginGatewaySqlSnapshot {
  return {
    SqlStatus: 'metadata_only',
    Direct: {},
    BuilderText: {},
    BuilderSumo: {},
  };
}

function hasBuilderInputs(gateway: TetaPluginGatewayMeta): boolean {
  return !!(
    gateway.ViewName &&
    gateway.TableAlias &&
    gateway.PackageName &&
    gateway.DatasetTableName
  );
}

function finalizeSqlDiagnostics(
  snapshot: TetaPluginGatewaySqlSnapshot,
  gateway: TetaPluginGatewayMeta,
): void {
  const hasBuilderSql =
    commandSetHasValues(snapshot.BuilderText) || commandSetHasValues(snapshot.BuilderSumo);
  const hasDirectSql = commandSetHasValues(snapshot.Direct);
  const hasFlat = !!snapshot.FlatQuery?.trim();
  const hasLast = !!snapshot.LastSqlQuery?.trim();
  const hasAnySql = hasBuilderSql || hasDirectSql || hasFlat || hasLast;

  if (hasLast) {
    snapshot.SqlStatus = 'runtime_captured';
    return;
  }
  if (hasBuilderSql || hasDirectSql || hasFlat) {
    snapshot.SqlStatus = hasBuilderSql ? 'builder_only' : snapshot.SqlStatus === 'inferred_from_package' ? 'inferred_from_package' : 'metadata_only';
    return;
  }
  if (!hasBuilderInputs(gateway)) {
    snapshot.SqlStatus = 'missing_metadata';
    return;
  }
  snapshot.SqlStatus = hasAnySql ? 'metadata_only' : 'no_connection';
}

function commandSetHasValues(
  commandSet:
    | { Select?: string | null; Insert?: string | null; Update?: string | null; Delete?: string | null }
    | undefined,
): boolean {
  if (!commandSet) return false;
  return [commandSet.Select, commandSet.Insert, commandSet.Update, commandSet.Delete].some(
    (value) => !!value?.trim(),
  );
}

function buildTags(
  plugin: TetaPluginDescriptorMeta,
  gateways: TetaPluginGatewayMeta[],
): string[] {
  const tags = new Set<string>();
  if (plugin.Assembly) tags.add(plugin.Assembly.replace(/\.dll$/i, ''));
  if (plugin.BusinessLocalization) tags.add(plugin.BusinessLocalization);
  for (const language of plugin.Languages ?? []) {
    if (language.Name) tags.add(language.Name);
    if (language.Arl) tags.add(language.Arl);
  }
  for (const gateway of gateways) {
    for (const value of [gateway.ViewName, gateway.TableAlias, gateway.PackageName, gateway.BaseTableName]) {
      if (value) tags.add(value);
    }
  }
  return [...tags];
}

function mergeGatewayMetadata(
  className: string,
  sourcePath: string | null,
  fromSource: ReturnType<typeof extractGatewayMetadataFromSource> | null,
  fromServer: ReturnType<TetaPluginBoCatalog['extractGatewayMetadata']> | null,
  fromPluginDll: ReturnType<typeof extractGatewayMetadataFromDllText> | null,
): TetaPluginGatewayMeta {
  const gateway: TetaPluginGatewayMeta = {
    ClassName: className,
    GatewayKind: className.toUpperCase().endsWith('MTG') ? 'MTG' : 'TG',
    SourcePath: sourcePath ?? fromServer?.dllPath ?? null,
    DatasetTableName: fromSource?.DatasetTableName ?? fromServer?.DatasetTableName ?? fromPluginDll?.DatasetTableName ?? null,
    ViewName: fromSource?.ViewName ?? fromServer?.ViewName ?? fromPluginDll?.ViewName ?? null,
    PackageName: fromSource?.PackageName ?? fromServer?.PackageName ?? fromPluginDll?.PackageName ?? null,
    TableAlias: fromSource?.TableAlias ?? fromServer?.TableAlias ?? fromPluginDll?.TableAlias ?? null,
    BaseTableName: fromSource?.BaseTableName ?? fromServer?.BaseTableName ?? fromPluginDll?.BaseTableName ?? null,
    Sql: emptySqlSnapshot(),
  };
  finalizeSqlDiagnostics(gateway.Sql!, gateway);
  return gateway;
}

function resolveGatewayClassNames(
  locator: TetaPluginSourceLocator,
  sourceFile: string | null,
  pluginDllStrings: string[],
  relatedBoDlls: string[],
  boCatalog: TetaPluginBoCatalog | null,
): string[] {
  const result = new Set<string>();

  if (sourceFile) {
    for (const className of collectReferencedGatewayClasses(locator, sourceFile)) {
      result.add(className);
    }
  }

  for (const className of findGatewayClassNames(pluginDllStrings)) {
    result.add(className);
  }

  if (boCatalog) {
    for (const className of [...result]) {
      const dllPath = boCatalog.findGatewayDll(className, relatedBoDlls);
      if (dllPath) {
        boCatalog.ensureGatewayRegistered(className, dllPath);
      }
    }
  }

  if (result.size === 0 && boCatalog && relatedBoDlls.length > 0) {
    for (const className of boCatalog.listGatewayClassNames(relatedBoDlls)) {
      result.add(className);
      boCatalog.ensureGatewayRegistered(className, boCatalog.findGatewayDll(className, relatedBoDlls) ?? relatedBoDlls[0]);
    }
  }

  return [...result].sort((a, b) => a.localeCompare(b, 'pl'));
}

export function enrichGatewaysWithSqlSnapshots(
  gateways: TetaPluginGatewayMeta[],
  snapshotsByClass: Map<string, TetaPluginGatewaySqlSnapshot>,
): number {
  let updated = 0;

  for (const gateway of gateways) {
    const snapshot = snapshotsByClass.get(gateway.ClassName.toLowerCase());
    if (!snapshot) continue;

    gateway.Sql = {
      ...gateway.Sql,
      ...snapshot,
      Direct: snapshot.Direct ?? gateway.Sql?.Direct,
      BuilderText: snapshot.BuilderText ?? gateway.Sql?.BuilderText,
      BuilderSumo: snapshot.BuilderSumo ?? gateway.Sql?.BuilderSumo,
    };
    finalizeSqlDiagnostics(gateway.Sql!, gateway);
    updated += 1;
  }

  return updated;
}

export function buildPluginFormMetadata(
  locator: TetaPluginSourceLocator,
  plugin: TetaPluginDescriptorMeta,
  context: PluginMetadataBuildContext,
): TetaPluginFormMetadata {
  const className = plugin.ClassName?.trim() ?? '';
  const sourceFile = className ? locator.findPluginSourceFile(className) : null;
  const pluginDllStrings = readDllStrings(context.pluginDllPath);
  const pluginDllText = pluginDllStrings.join('\n');
  const referencedBoFromSource = [
    ...(sourceFile ? collectBusinessObjectReferencesFromSource(sourceFile) : []),
    ...findBusinessObjectReferences(pluginDllStrings),
  ];
  const referencedGatewaysFromSource = sourceFile
    ? collectReferencedGatewayClasses(locator, sourceFile)
    : [];

  const relatedBoDlls =
    context.boCatalog?.resolveRelatedBoDlls({
      pluginDllPath: context.pluginDllPath,
      pluginDllName: plugin.Assembly ?? context.pluginDllPath,
      pluginClassName: plugin.ClassName,
      referencedBoFromSource,
      referencedGatewaysFromSource,
    }) ?? [];

  const gatewayClassNames = resolveGatewayClassNames(
    locator,
    sourceFile,
    pluginDllStrings,
    relatedBoDlls,
    context.boCatalog,
  );

  const gateways: TetaPluginGatewayMeta[] = [];
  for (const gatewayClassName of gatewayClassNames) {
    const gatewaySource = locator.findClassSourceFile(gatewayClassName);
    const fromSource = gatewaySource
      ? extractGatewayMetadataFromSource(gatewayClassName, gatewaySource)
      : null;
    const fromServer = context.boCatalog?.extractGatewayMetadata(
      gatewayClassName,
      null,
      relatedBoDlls,
    ) ?? null;
    const fromPluginDll = extractGatewayMetadataFromDllText(gatewayClassName, pluginDllText);

    gateways.push(
      mergeGatewayMetadata(
        gatewayClassName,
        gatewaySource ?? fromServer?.dllPath ?? null,
        fromSource,
        fromServer,
        fromPluginDll,
      ),
    );
  }

  const resxFiles = sourceFile ? findSiblingResxFiles(sourceFile) : [];
  const resxColumns = resxFiles.flatMap((resx) => readColumnsFromResx(resx));
  const columns = normalizeColumns([...context.dllColumnResources, ...resxColumns]);
  const columnResourceSource =
    context.dllColumnResources.length > 0 && resxColumns.length > 0
      ? 'merged'
      : context.dllColumnResources.length > 0
        ? 'dll'
        : resxColumns.length > 0
          ? 'resx'
          : undefined;

  return {
    Metadata: {
      Version: '1.0',
      GeneratedAtUtc: new Date().toISOString(),
    },
    Plugin: plugin,
    Form: {
      SourcePath: sourceFile,
      ResxFiles: resxFiles,
      PluginDllPath: context.pluginDllPath,
      ColumnResourceSource: columnResourceSource,
    },
    BusinessObjectDlls: relatedBoDlls,
    Gateways: gateways,
    Columns: columns,
    Tags: buildTags(plugin, gateways),
  };
}

export function mergeTchelperMetadata(
  sourceForm: TetaPluginFormMetadata,
  tchelperForm: TetaPluginFormMetadata,
): TetaPluginFormMetadata {
  const gatewayByClass = new Map(
    (sourceForm.Gateways ?? []).map((gateway) => [gateway.ClassName.toLowerCase(), gateway]),
  );

  for (const gateway of tchelperForm.Gateways ?? []) {
    const key = gateway.ClassName.toLowerCase();
    const existing = gatewayByClass.get(key);
    if (!existing) {
      gatewayByClass.set(key, gateway);
      continue;
    }
    gatewayByClass.set(key, {
      ...existing,
      ...gateway,
      Sql: gateway.Sql ?? existing.Sql,
      SourcePath: existing.SourcePath ?? gateway.SourcePath,
    });
  }

  const mergedColumns = normalizeColumns([
    ...(sourceForm.Columns ?? []),
    ...(tchelperForm.Columns ?? []),
  ]);

  return {
    Metadata: tchelperForm.Metadata ?? sourceForm.Metadata,
    Plugin: { ...sourceForm.Plugin, ...tchelperForm.Plugin },
    Form: {
      SourcePath: tchelperForm.Form?.SourcePath ?? sourceForm.Form?.SourcePath,
      ResxFiles: tchelperForm.Form?.ResxFiles?.length
        ? tchelperForm.Form.ResxFiles
        : sourceForm.Form?.ResxFiles,
      PluginDllPath: sourceForm.Form?.PluginDllPath ?? tchelperForm.Form?.PluginDllPath,
      ColumnResourceSource: sourceForm.Form?.ColumnResourceSource ?? tchelperForm.Form?.ColumnResourceSource,
    },
    BusinessObjectDlls: sourceForm.BusinessObjectDlls?.length
      ? sourceForm.BusinessObjectDlls
      : tchelperForm.BusinessObjectDlls,
    Gateways: [...gatewayByClass.values()],
    Columns: mergedColumns.length ? mergedColumns : sourceForm.Columns,
    Synonyms: tchelperForm.Synonyms ?? sourceForm.Synonyms,
    Tags: tchelperForm.Tags?.length ? tchelperForm.Tags : sourceForm.Tags,
  };
}

export function inferBundleExtractionMode(bundle: {
  extractionMode: 'source-scan' | 'server-deployment' | 'hybrid';
  forms: TetaPluginFormMetadata[];
  relatedBusinessObjectDlls?: string[];
}): 'source-scan' | 'server-deployment' | 'hybrid' {
  const hasSource = bundle.forms.some((form) => !!form.Form?.SourcePath);
  const hasServer = (bundle.relatedBusinessObjectDlls?.length ?? 0) > 0;
  const hasDllColumns = bundle.forms.some((form) => form.Form?.ColumnResourceSource === 'dll' || form.Form?.ColumnResourceSource === 'merged');

  if (hasSource && (hasServer || hasDllColumns)) return 'hybrid';
  if (hasServer || hasDllColumns) return 'server-deployment';
  return 'source-scan';
}
