import type { TetaGatewayRelatedPackages } from './teta-plugin-oracle-discovery';
import type { TetaPluginGatewayMeta, TetaPluginGatewaySqlSnapshot } from './teta-plugin-metadata.types';

export type ColumnLookup = (
  objectName: string,
  kind: 'TABLE' | 'VIEW',
) => Promise<string[] | null> | string[] | null;

function ensureSnapshot(gateway: TetaPluginGatewayMeta): TetaPluginGatewaySqlSnapshot {
  if (!gateway.Sql) {
    gateway.Sql = {
      SqlStatus: 'metadata_only',
      Direct: {},
      BuilderText: {},
      BuilderSumo: {},
    };
  }
  gateway.Sql.Direct ??= {};
  gateway.Sql.BuilderText ??= {};
  return gateway.Sql;
}

function formatSelectList(columns: string[] | null | undefined, alias: string): string {
  if (columns?.length) {
    return columns.map((column) => `${alias}.${column}`).join(', ');
  }
  return `${alias}.*`;
}

function buildSelectFromView(
  viewName: string,
  alias: string,
  columns: string[] | null | undefined,
): string {
  const list = formatSelectList(columns, alias);
  return `SELECT ${list}\nFROM ${viewName} ${alias}`;
}

function buildSelectFromTable(
  tableName: string,
  columns: string[] | null | undefined,
  owner?: string | null,
): string {
  const qualified = owner ? `${owner}.${tableName}` : tableName;
  if (columns?.length) {
    return `SELECT ${columns.join(', ')}\nFROM ${qualified}`;
  }
  return `SELECT *\nFROM ${qualified}`;
}

function buildPackageCall(
  packageName: string,
  procedureName: string,
  datasetTableName?: string | null,
): string {
  const dataset = datasetTableName?.trim();
  if (dataset) {
    return `-- Wywołanie pakietu (wzorzec Teta)\nBEGIN ${packageName}.${procedureName}(/* parametry powiązane z :inout_${dataset} / :original_${dataset} */); END;`;
  }
  return `-- Wywołanie pakietu (wzorzec Teta)\nBEGIN ${packageName}.${procedureName}(/* parametry wejściowe */); END;`;
}

function inferDmlFromPackage(
  packageName: string,
  kind: 'DAC' | 'AGL' | 'LEP',
  datasetTableName?: string | null,
): Pick<Required<TetaPluginGatewaySqlSnapshot>['Direct'], 'Insert' | 'Update' | 'Delete'> {
  if (kind === 'AGL') {
    return {
      Insert: buildPackageCall(packageName, 'INSERT_RECORD', datasetTableName),
      Update: buildPackageCall(packageName, 'UPDATE_RECORD', datasetTableName),
      Delete: buildPackageCall(packageName, 'DELETE_RECORD', datasetTableName),
    };
  }

  if (kind === 'LEP') {
    return {
      Insert: buildPackageCall(packageName, 'INSERT_ROW', datasetTableName),
      Update: buildPackageCall(packageName, 'UPDATE_ROW', datasetTableName),
      Delete: buildPackageCall(packageName, 'DELETE_ROW', datasetTableName),
    };
  }

  return {
    Insert: buildPackageCall(packageName, 'INSERT_ROW', datasetTableName),
    Update: buildPackageCall(packageName, 'UPDATE_ROW', datasetTableName),
    Delete: buildPackageCall(packageName, 'DELETE_ROW', datasetTableName),
  };
}

function pickPackageKind(
  packageName: string,
  related: TetaGatewayRelatedPackages,
): 'DAC' | 'AGL' | 'LEP' {
  if (related.lep && packageName === related.lep) return 'LEP';
  if (related.agl && packageName === related.agl) return 'AGL';
  return 'DAC';
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

export async function inferGatewaySql(
  gateway: TetaPluginGatewayMeta,
  related: TetaGatewayRelatedPackages,
  columnLookup?: ColumnLookup,
): Promise<boolean> {
  const snapshot = ensureSnapshot(gateway);
  if (
    commandSetHasValues(snapshot.Direct) ||
    commandSetHasValues(snapshot.BuilderText) ||
    commandSetHasValues(snapshot.BuilderSumo)
  ) {
    return false;
  }

  const viewName = gateway.ViewName?.trim();
  const alias = gateway.TableAlias?.trim() || 'T';
  const tableName = gateway.BaseTableName?.trim();
  const datasetTableName = gateway.DatasetTableName?.trim();
  const primaryPackage =
    (related.lep ?? related.dac ?? related.agl)?.trim() ??
    gateway.PackageName?.trim() ??
    null;

  let selectSql: string | null = null;
  let columns: string[] | null = null;

  if (columnLookup && viewName) {
    columns = (await columnLookup(viewName, 'VIEW')) ?? null;
  }
  if (viewName) {
    selectSql = buildSelectFromView(viewName, alias, columns);
  } else if (tableName) {
    if (columnLookup) {
      columns = (await columnLookup(tableName, 'TABLE')) ?? null;
    }
    selectSql = buildSelectFromTable(tableName, columns);
  } else if (datasetTableName && columnLookup) {
    columns = (await columnLookup(datasetTableName, 'TABLE')) ?? null;
    if (columns?.length) {
      selectSql = buildSelectFromTable(datasetTableName, columns);
    }
  }

  if (!selectSql && !primaryPackage) {
    return false;
  }

  snapshot.Direct ??= {};
  if (selectSql) {
    snapshot.Direct.Select = selectSql;
  }

  if (primaryPackage) {
    const kind = pickPackageKind(primaryPackage, related);
    const dml = inferDmlFromPackage(primaryPackage, kind, datasetTableName ?? tableName);
    snapshot.Direct.Insert = snapshot.Direct.Insert?.trim() ? snapshot.Direct.Insert : dml.Insert;
    snapshot.Direct.Update = snapshot.Direct.Update?.trim() ? snapshot.Direct.Update : dml.Update;
    snapshot.Direct.Delete = snapshot.Direct.Delete?.trim() ? snapshot.Direct.Delete : dml.Delete;
  }

  snapshot.SqlStatus = 'inferred_from_package';
  return true;
}

export async function inferSqlForGateways(
  gateways: TetaPluginGatewayMeta[],
  relatedByClass: Map<string, TetaGatewayRelatedPackages>,
  columnLookup?: ColumnLookup,
): Promise<number> {
  let updated = 0;
  for (const gateway of gateways) {
    const related =
      relatedByClass.get(gateway.ClassName.toLowerCase()) ?? {
        dac: gateway.PackageName ?? null,
        agl: null,
        lep: null,
      };
    if (await inferGatewaySql(gateway, related, columnLookup)) {
      updated += 1;
    }
  }
  return updated;
}
