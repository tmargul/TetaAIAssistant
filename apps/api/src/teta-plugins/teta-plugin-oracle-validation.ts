import type { TetaPluginGatewayMeta, TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import type { TetaPluginOracleDiscovery } from './teta-plugin-oracle-discovery';

export type OracleDbObjectKind = 'TABLE' | 'VIEW' | 'PACKAGE';

export type OracleDbObjectClassifier = (
  objectNames: string[],
) => Promise<Map<string, OracleDbObjectKind>>;

const EMPTY_DISCOVERY: TetaPluginOracleDiscovery = {
  views: [],
  tables: [],
  packagesDac: [],
  packagesAgl: [],
  packagesLep: [],
  datasets: [],
  aliases: [],
};

function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

function keepObject(
  name: string | null | undefined,
  expected: OracleDbObjectKind,
  kinds: Map<string, OracleDbObjectKind>,
): string | null {
  if (!name?.trim()) {
    return null;
  }
  const normalized = normalizeName(name);
  return kinds.get(normalized) === expected ? name.trim() : null;
}

export function sanitizeGatewayOracleRefs(
  gateway: TetaPluginGatewayMeta,
  kinds: Map<string, OracleDbObjectKind>,
): TetaPluginGatewayMeta {
  const related = gateway.RelatedPackages ?? {};
  const sanitizedRelated = {
    dac: keepObject(related.dac ?? null, 'PACKAGE', kinds),
    agl: keepObject(related.agl ?? null, 'PACKAGE', kinds),
    lep: keepObject(related.lep ?? null, 'PACKAGE', kinds),
  };

  const packageName = keepObject(gateway.PackageName, 'PACKAGE', kinds);
  const primaryPackage =
    sanitizedRelated.lep ?? packageName ?? sanitizedRelated.dac ?? sanitizedRelated.agl ?? null;

  return {
    ...gateway,
    ViewName: keepObject(gateway.ViewName, 'VIEW', kinds),
    BaseTableName: keepObject(gateway.BaseTableName, 'TABLE', kinds),
    PackageName: primaryPackage,
    RelatedPackages: sanitizedRelated,
  };
}

export function filterDiscoveryByOracleKinds(
  discovery: TetaPluginOracleDiscovery,
  kinds: Map<string, OracleDbObjectKind>,
): TetaPluginOracleDiscovery {
  return {
    ...discovery,
    tables: discovery.tables.filter((name) => kinds.get(normalizeName(name)) === 'TABLE'),
    views: discovery.views.filter((name) => kinds.get(normalizeName(name)) === 'VIEW'),
    packagesDac: discovery.packagesDac.filter((name) => kinds.get(normalizeName(name)) === 'PACKAGE'),
    packagesAgl: discovery.packagesAgl.filter((name) => kinds.get(normalizeName(name)) === 'PACKAGE'),
    packagesLep: discovery.packagesLep.filter((name) => kinds.get(normalizeName(name)) === 'PACKAGE'),
  };
}

export function collectBundleOracleObjectNames(bundle: TetaPluginMetadataBundle): string[] {
  const discovery = bundle.oracleDiscovery ?? EMPTY_DISCOVERY;
  const gatewayNames = bundle.forms.flatMap((form) =>
    (form.Gateways ?? []).flatMap((gateway) => [
      gateway.ViewName,
      gateway.BaseTableName,
      gateway.PackageName,
      gateway.RelatedPackages?.dac,
      gateway.RelatedPackages?.agl,
      gateway.RelatedPackages?.lep,
    ]),
  );

  return [
    ...discovery.tables,
    ...discovery.views,
    ...discovery.packagesDac,
    ...discovery.packagesAgl,
    ...discovery.packagesLep,
    ...gatewayNames,
  ]
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => normalizeName(name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, 'pl'));
}

export function countVerifiedOracleRefs(bundle: TetaPluginMetadataBundle): {
  tables: number;
  views: number;
  packages: number;
  gatewayRefs: number;
} {
  const discovery = bundle.oracleDiscovery ?? EMPTY_DISCOVERY;
  let gatewayRefs = 0;
  for (const form of bundle.forms) {
    for (const gateway of form.Gateways ?? []) {
      if (gateway.ViewName) gatewayRefs += 1;
      if (gateway.BaseTableName) gatewayRefs += 1;
      if (gateway.PackageName) gatewayRefs += 1;
      if (gateway.RelatedPackages?.dac) gatewayRefs += 1;
      if (gateway.RelatedPackages?.agl) gatewayRefs += 1;
      if (gateway.RelatedPackages?.lep) gatewayRefs += 1;
    }
  }

  return {
    tables: discovery.tables.length,
    views: discovery.views.length,
    packages:
      discovery.packagesDac.length + discovery.packagesAgl.length + discovery.packagesLep.length,
    gatewayRefs,
  };
}

export async function validatePluginBundleAgainstOracle(
  bundle: TetaPluginMetadataBundle,
  classify: OracleDbObjectClassifier,
): Promise<TetaPluginMetadataBundle> {
  const objectNames = collectBundleOracleObjectNames(bundle);
  const kinds = objectNames.length > 0 ? await classify(objectNames) : new Map<string, OracleDbObjectKind>();

  const discovery = filterDiscoveryByOracleKinds(bundle.oracleDiscovery ?? EMPTY_DISCOVERY, kinds);
  const forms = bundle.forms.map((form) => ({
    ...form,
    Gateways: (form.Gateways ?? []).map((gateway) => sanitizeGatewayOracleRefs(gateway, kinds)),
  }));

  return {
    ...bundle,
    oracleDiscovery: discovery,
    forms,
  };
}
