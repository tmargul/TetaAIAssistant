import { readDllStrings } from './teta-dll-string-scanner';

export type TetaPackageKind = 'DAC' | 'AGL' | 'LEP';

export type TetaPluginOracleDiscovery = {
  views: string[];
  tables: string[];
  packagesDac: string[];
  packagesAgl: string[];
  packagesLep: string[];
  datasets: string[];
  aliases: string[];
};

export type TetaGatewayRelatedPackages = {
  dac: string | null;
  agl: string | null;
  lep: string | null;
};

const VIEW_PATTERN = /^NT_[A-Z0-9_]+$/;
const PACKAGE_PATTERN = /^(NT_[A-Z0-9_]+|KP_[A-Z0-9_]+)_(DAC|AGL|LEP)$/;
const TABLE_PATTERN = /^(T_[A-Z0-9_]+|KP_[A-Z0-9_]+)$/;
const ALIAS_PATTERN = /^[A-Z][A-Z0-9_]{1,7}$/;

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pl'),
  );
}

export function classifyPackageName(name: string): TetaPackageKind | null {
  const match = name.match(/_(DAC|AGL|LEP)$/);
  return (match?.[1] as TetaPackageKind | undefined) ?? null;
}

export function discoverOracleObjectsFromStrings(strings: string[]): TetaPluginOracleDiscovery {
  const views = new Set<string>();
  const tables = new Set<string>();
  const packagesDac = new Set<string>();
  const packagesAgl = new Set<string>();
  const packagesLep = new Set<string>();
  const datasets = new Set<string>();
  const aliases = new Set<string>();

  for (const raw of strings) {
    const value = raw.trim();
    if (value.length === 0 || value.length > 120) continue;

    const packageMatch = value.match(PACKAGE_PATTERN);
    if (packageMatch) {
      const kind = packageMatch[2] as TetaPackageKind;
      if (kind === 'DAC') packagesDac.add(value);
      if (kind === 'AGL') packagesAgl.add(value);
      if (kind === 'LEP') packagesLep.add(value);
      continue;
    }

    if (VIEW_PATTERN.test(value) && !value.endsWith('_DAC') && !value.endsWith('_AGL') && !value.endsWith('_LEP')) {
      views.add(value);
      continue;
    }

    if (TABLE_PATTERN.test(value)) {
      tables.add(value);
      continue;
    }

    if (ALIAS_PATTERN.test(value) && !value.startsWith('NT_') && !value.startsWith('KP_')) {
      aliases.add(value);
      continue;
    }

    if (/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(value) && !value.includes('.') && !value.includes(' ')) {
      if (/^[A-Z][a-z]/.test(value) && !/(BO|TG|MTG|Widok|Dll|Attribute)$/i.test(value)) {
        datasets.add(value);
      }
    }
  }

  return {
    views: sortUnique(views),
    tables: sortUnique(tables),
    packagesDac: sortUnique(packagesDac),
    packagesAgl: sortUnique(packagesAgl),
    packagesLep: sortUnique(packagesLep),
    datasets: sortUnique(datasets),
    aliases: sortUnique(aliases),
  };
}

export function discoverOracleObjectsFromBoDlls(dllPaths: string[]): TetaPluginOracleDiscovery {
  const merged: TetaPluginOracleDiscovery = {
    views: [],
    tables: [],
    packagesDac: [],
    packagesAgl: [],
    packagesLep: [],
    datasets: [],
    aliases: [],
  };

  const acc = {
    views: new Set<string>(),
    tables: new Set<string>(),
    packagesDac: new Set<string>(),
    packagesAgl: new Set<string>(),
    packagesLep: new Set<string>(),
    datasets: new Set<string>(),
    aliases: new Set<string>(),
  };

  for (const dllPath of dllPaths) {
    const part = discoverOracleObjectsFromStrings(readDllStrings(dllPath));
    for (const value of part.views) acc.views.add(value);
    for (const value of part.tables) acc.tables.add(value);
    for (const value of part.packagesDac) acc.packagesDac.add(value);
    for (const value of part.packagesAgl) acc.packagesAgl.add(value);
    for (const value of part.packagesLep) acc.packagesLep.add(value);
    for (const value of part.datasets) acc.datasets.add(value);
    for (const value of part.aliases) acc.aliases.add(value);
  }

  merged.views = sortUnique(acc.views);
  merged.tables = sortUnique(acc.tables);
  merged.packagesDac = sortUnique(acc.packagesDac);
  merged.packagesAgl = sortUnique(acc.packagesAgl);
  merged.packagesLep = sortUnique(acc.packagesLep);
  merged.datasets = sortUnique(acc.datasets);
  merged.aliases = sortUnique(acc.aliases);
  return merged;
}

function gatewaySearchTokens(className: string): string[] {
  const baseName = className.replace(/(?:MTG|TG)$/i, '');
  const underscored = baseName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  const tokens = new Set<string>([underscored, baseName.toUpperCase()]);
  for (const part of underscored.split('_').filter((part) => part.length >= 4)) {
    tokens.add(part);
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

function scoreByTokens(name: string, tokens: string[]): number {
  const upper = name.toUpperCase();
  let score = 0;
  for (const token of tokens) {
    if (upper.includes(token)) score += token.length;
  }
  return score;
}

function pickBestPackage(candidates: string[], tokens: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreByTokens(candidate, tokens);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function packageStem(name: string): string {
  return name.replace(/_(DAC|AGL|LEP)$/i, '');
}

export function resolveGatewayRelatedPackages(
  className: string,
  viewName: string | null | undefined,
  discovery: TetaPluginOracleDiscovery,
): TetaGatewayRelatedPackages {
  const tokens = gatewaySearchTokens(className);
  const viewStem = viewName ? packageStem(viewName) : null;

  const filterByViewStem = (packages: string[]) =>
    viewStem ? packages.filter((pkg) => packageStem(pkg) === viewStem || pkg.includes(viewStem)) : packages;

  let dac = viewStem
    ? discovery.packagesDac.find((pkg) => packageStem(pkg) === viewStem) ?? null
    : null;
  let agl = viewStem
    ? discovery.packagesAgl.find((pkg) => packageStem(pkg) === viewStem) ?? null
    : null;
  let lep = viewStem
    ? discovery.packagesLep.find((pkg) => packageStem(pkg) === viewStem) ?? null
    : null;

  if (!dac) dac = pickBestPackage(filterByViewStem(discovery.packagesDac), tokens);
  if (!agl) agl = pickBestPackage(filterByViewStem(discovery.packagesAgl), tokens);
  if (!lep) lep = pickBestPackage(filterByViewStem(discovery.packagesLep), tokens);

  if (!dac && viewStem) {
    dac = `${viewStem}_DAC`;
    if (!discovery.packagesDac.includes(dac)) dac = null;
  }
  if (!agl && viewStem) {
    agl = `${viewStem}_AGL`;
    if (!discovery.packagesAgl.includes(agl)) agl = null;
  }
  if (!lep && viewStem) {
    lep = `${viewStem}_LEP`;
    if (!discovery.packagesLep.includes(lep)) lep = null;
  }

  return { dac, agl, lep };
}

export function pickPrimaryPackage(related: TetaGatewayRelatedPackages): string | null {
  return related.lep ?? related.dac ?? related.agl ?? null;
}
