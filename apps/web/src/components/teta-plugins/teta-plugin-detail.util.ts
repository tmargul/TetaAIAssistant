export type PluginSqlCommandSet = {

  Select?: string | null;

  Insert?: string | null;

  Update?: string | null;

  Delete?: string | null;

};



export type PluginRelatedPackages = {

  dac: string | null;

  agl: string | null;

  lep: string | null;

};



export type PluginGatewayDetail = {

  className: string;

  gatewayKind: string;

  viewName: string | null;

  baseTableName: string | null;

  packageName: string | null;

  relatedPackages: PluginRelatedPackages;

  datasetTableName: string | null;

  tableAlias: string | null;

  sqlStatus: string | null;

  flatQuery: string | null;

  lastSqlQuery: string | null;

  labeledSelect: string | null;

  direct: PluginSqlCommandSet;

  builderText: PluginSqlCommandSet;

  builderSumo: PluginSqlCommandSet;

};



export type PluginColumnDetail = {
  gridColumnName: string;
  label: string | null;
  hint: string | null;
};

export type PluginFormDetail = {
  name: string;
  className: string | null;
  guid: string | null;
  businessLocalization: string | null;
  arl: string | null;
  gateways: PluginGatewayDetail[];
  columns: PluginColumnDetail[];
  columnCount: number;
};



export type PluginOracleDiscoveryDetail = {

  views: string[];

  tables: string[];

  packagesDac: string[];

  packagesAgl: string[];

  packagesLep: string[];

  datasets: string[];

  aliases: string[];

};



export type PluginImportDetailView = {

  extractionMode: string;

  chunkCount: number;

  formCount: number;

  gatewayCount: number;

  columnCount: number;

  businessObjectDllCount: number;

  businessObjectDlls: string[];

  forms: PluginFormDetail[];

  columns: PluginColumnDetail[];

  oracleDiscovery: PluginOracleDiscoveryDetail;

  oracleSummary: {

    views: string[];

    tables: string[];

    packages: string[];

    packagesDac: string[];

    packagesAgl: string[];

    packagesLep: string[];

    datasets: string[];

  };

};



function asRecord(value: unknown): Record<string, unknown> | null {

  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

}



function readStringArray(value: unknown): string[] {

  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === 'string').sort((a, b) => a.localeCompare(b, 'pl'));

}



function readSqlCommandSet(value: unknown): PluginSqlCommandSet {

  const record = asRecord(value);

  if (!record) return {};

  return {

    Select: typeof record.Select === 'string' ? record.Select : null,

    Insert: typeof record.Insert === 'string' ? record.Insert : null,

    Update: typeof record.Update === 'string' ? record.Update : null,

    Delete: typeof record.Delete === 'string' ? record.Delete : null,

  };

}



function readRelatedPackages(value: unknown, packageName: string | null): PluginRelatedPackages {

  const record = asRecord(value);

  return {

    dac: typeof record?.dac === 'string' ? record.dac : packageName?.endsWith('_DAC') ? packageName : null,

    agl: typeof record?.agl === 'string' ? record.agl : packageName?.endsWith('_AGL') ? packageName : null,

    lep: typeof record?.lep === 'string' ? record.lep : packageName?.endsWith('_LEP') ? packageName : null,

  };

}



function readGateway(value: unknown): PluginGatewayDetail | null {

  const record = asRecord(value);

  if (!record || typeof record.ClassName !== 'string') return null;



  const sql = asRecord(record.Sql);

  const packageName = typeof record.PackageName === 'string' ? record.PackageName : null;

  return {

    className: record.ClassName,

    gatewayKind: typeof record.GatewayKind === 'string' ? record.GatewayKind : '—',

    viewName: typeof record.ViewName === 'string' ? record.ViewName : null,

    baseTableName: typeof record.BaseTableName === 'string' ? record.BaseTableName : null,

    packageName,

    relatedPackages: readRelatedPackages(record.RelatedPackages, packageName),

    datasetTableName: typeof record.DatasetTableName === 'string' ? record.DatasetTableName : null,

    tableAlias: typeof record.TableAlias === 'string' ? record.TableAlias : null,

    sqlStatus: typeof sql?.SqlStatus === 'string' ? sql.SqlStatus : null,

    flatQuery: typeof sql?.FlatQuery === 'string' ? sql.FlatQuery : null,

    lastSqlQuery: typeof sql?.LastSqlQuery === 'string' ? sql.LastSqlQuery : null,

    labeledSelect: typeof sql?.LabeledSelect === 'string' ? sql.LabeledSelect : null,

    direct: readSqlCommandSet(sql?.Direct),

    builderText: readSqlCommandSet(sql?.BuilderText),

    builderSumo: readSqlCommandSet(sql?.BuilderSumo),

  };

}



function readColumn(value: unknown): PluginColumnDetail | null {
  const record = asRecord(value);
  if (!record || typeof record.GridColumnName !== 'string') return null;

  const labels = asRecord(record.Labels);
  const hints = asRecord(record.Hints);

  return {
    gridColumnName: record.GridColumnName,
    label: typeof labels?.PL === 'string' ? labels.PL : null,
    hint: typeof hints?.PL === 'string' ? hints.PL : null,
  };
}

function readForm(value: unknown): PluginFormDetail | null {

  const record = asRecord(value);

  if (!record) return null;



  const plugin = asRecord(record.Plugin);

  const languages = Array.isArray(plugin?.Languages) ? plugin.Languages : [];

  const firstLang = asRecord(languages[0]);

  const gateways = Array.isArray(record.Gateways)

    ? record.Gateways.map(readGateway).filter((item): item is PluginGatewayDetail => item != null)

    : [];

  const columns = Array.isArray(record.Columns)
    ? record.Columns.map(readColumn).filter((item): item is PluginColumnDetail => item != null)
    : [];

  columns.sort((a, b) => {
    const left = (a.label ?? a.gridColumnName).localeCompare(b.label ?? b.gridColumnName, 'pl');
    if (left !== 0) return left;
    return a.gridColumnName.localeCompare(b.gridColumnName, 'pl');
  });

  const name =

    (typeof firstLang?.Name === 'string' && firstLang.Name) ||

    (typeof plugin?.ClassName === 'string' && plugin.ClassName.split('.').pop()) ||

    'Formularz';



  return {

    name,

    className: typeof plugin?.ClassName === 'string' ? plugin.ClassName : null,

    guid: typeof plugin?.Guid === 'string' ? plugin.Guid : null,

    businessLocalization:

      typeof plugin?.BusinessLocalization === 'string' ? plugin.BusinessLocalization : null,

    arl: typeof firstLang?.Arl === 'string' ? firstLang.Arl : null,

    gateways,

    columns,

    columnCount: columns.length,

  };

}



function readOracleDiscovery(value: unknown): PluginOracleDiscoveryDetail {

  const record = asRecord(value);

  return {

    views: readStringArray(record?.views),

    tables: readStringArray(record?.tables),

    packagesDac: readStringArray(record?.packagesDac),

    packagesAgl: readStringArray(record?.packagesAgl),

    packagesLep: readStringArray(record?.packagesLep),

    datasets: readStringArray(record?.datasets),

    aliases: readStringArray(record?.aliases),

  };

}



function mergeDiscoveryWithGateways(

  discovery: PluginOracleDiscoveryDetail,

  forms: PluginFormDetail[],

): PluginImportDetailView['oracleSummary'] {

  const views = new Set(discovery.views);

  const tables = new Set(discovery.tables);

  const packagesDac = new Set(discovery.packagesDac);

  const packagesAgl = new Set(discovery.packagesAgl);

  const packagesLep = new Set(discovery.packagesLep);

  const datasets = new Set(discovery.datasets);

  const packages = new Set<string>();



  for (const form of forms) {

    for (const gateway of form.gateways) {

      if (gateway.viewName) views.add(gateway.viewName);

      if (gateway.baseTableName) tables.add(gateway.baseTableName);

      if (gateway.datasetTableName) datasets.add(gateway.datasetTableName);

      if (gateway.relatedPackages.dac) {

        packagesDac.add(gateway.relatedPackages.dac);

        packages.add(gateway.relatedPackages.dac);

      }

      if (gateway.relatedPackages.agl) {

        packagesAgl.add(gateway.relatedPackages.agl);

        packages.add(gateway.relatedPackages.agl);

      }

      if (gateway.relatedPackages.lep) {

        packagesLep.add(gateway.relatedPackages.lep);

        packages.add(gateway.relatedPackages.lep);

      }

      if (gateway.packageName) packages.add(gateway.packageName);

    }

  }



  const sort = (items: Set<string>) => [...items].sort((a, b) => a.localeCompare(b, 'pl'));

  return {

    views: sort(views),

    tables: sort(tables),

    packages: sort(packages),

    packagesDac: sort(packagesDac),

    packagesAgl: sort(packagesAgl),

    packagesLep: sort(packagesLep),

    datasets: sort(datasets),

  };

}



export function parsePluginImportMetadata(

  metadata: Record<string, unknown>,

  chunkCount: number,

): PluginImportDetailView | null {

  const forms = Array.isArray(metadata.forms)

    ? metadata.forms.map(readForm).filter((item): item is PluginFormDetail => item != null)

    : [];



  if (forms.length === 0 && !metadata.extractionMode) {

    return null;

  }



  const gatewayCount = forms.reduce((sum, form) => sum + form.gateways.length, 0);

  const columnCount = forms.reduce((sum, form) => sum + form.columnCount, 0);
  const columns = forms.flatMap((form) => form.columns);
  const businessObjectDlls = Array.isArray(metadata.relatedBusinessObjectDlls)

    ? metadata.relatedBusinessObjectDlls.filter((item): item is string => typeof item === 'string')

    : [];

  const oracleDiscovery = readOracleDiscovery(metadata.oracleDiscovery);



  return {

    extractionMode:

      typeof metadata.extractionMode === 'string' ? metadata.extractionMode : 'source-scan',

    chunkCount,

    formCount: forms.length,

    gatewayCount,

    columnCount,

    businessObjectDllCount: businessObjectDlls.length,

    businessObjectDlls,

    forms,

    columns,

    oracleDiscovery,

    oracleSummary: mergeDiscoveryWithGateways(oracleDiscovery, forms),

  };

}



export function gatewayHasSql(gateway: PluginGatewayDetail): boolean {

  const sets = [gateway.direct, gateway.builderText, gateway.builderSumo];

  for (const set of sets) {

    if (set.Select?.trim() || set.Insert?.trim() || set.Update?.trim() || set.Delete?.trim()) {

      return true;

    }

  }

  return !!(gateway.flatQuery?.trim() || gateway.lastSqlQuery?.trim());

}



export function pickPreferredSql(

  gateway: PluginGatewayDetail,

  kind: keyof PluginSqlCommandSet,

): { source: string; sql: string } | null {

  if (kind === 'Select' && gateway.labeledSelect?.trim()) {
    return { source: 'LabeledSelect', sql: gateway.labeledSelect.trim() };
  }

  const candidates: Array<{ source: string; set: PluginSqlCommandSet }> = [

    { source: 'BuilderText', set: gateway.builderText },

    { source: 'BuilderSumo', set: gateway.builderSumo },

    { source: 'Inferred', set: gateway.direct },

  ];



  for (const candidate of candidates) {

    const sql = candidate.set[kind];

    if (sql?.trim()) {

      return { source: candidate.source, sql: sql.trim() };

    }

  }

  return null;

}


