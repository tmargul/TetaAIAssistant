import { simpleClassName } from './teta-plugin-assembly-match.util';
import type { DotnetMatchedType } from './teta-dotnet-metadata.reader';

export type ClassVerificationDifferenceHint =
  | 'namespace'
  | 'diacritic'
  | 'typo'
  | 'historical_name'
  | 'moved_assembly';

export type ClassVerificationDiagnostics = {
  reasonCode: string;
  registryClassName: string | null;
  assembly: string | null;
  resolvedDllPath: string | null;
  simpleClassName: string | null;
  dllTypeCount: number | null;
  /** How many TypeDefs share the requested simple name. */
  simpleNameOccurrence: 0 | 1 | 'many';
  nearestMatches: string[];
  potentialDifference: ClassVerificationDifferenceHint[];
  namespaceMismatch?: boolean;
  requestedNamespace?: string | null;
  matchedNamespace?: string | null;
};

export type CompactTypeRef = {
  namespace?: string | null;
  name?: string | null;
  fullName?: string | null;
  normalizedFullName?: string | null;
};

/** Namespace portion of an FQN (everything before the simple type name). */
export function requestedNamespaceFromClassName(
  className: string | null | undefined,
): string | null {
  const trimmed = className?.trim();
  if (!trimmed) return null;
  const simple = simpleClassName(trimmed);
  if (!simple || simple === trimmed) return null;
  if (!trimmed.endsWith(simple)) return null;
  const prefix = trimmed.slice(0, trimmed.length - simple.length).replace(/[.+]$/, '');
  return prefix || null;
}

export function matchedNamespaceFromType(
  type: Pick<DotnetMatchedType, 'namespace' | 'fullName' | 'name' | 'declaringType'> | null | undefined,
): string | null {
  if (!type) return null;
  if (type.fullName && type.name && type.fullName.endsWith(type.name)) {
    const prefix = type.fullName
      .slice(0, type.fullName.length - type.name.length)
      .replace(/[.+]$/, '');
    if (prefix) return prefix;
  }
  if (type.declaringType) {
    return type.namespace
      ? `${type.namespace}.${type.declaringType}`
      : type.declaringType;
  }
  return type.namespace?.trim() || null;
}

export function applyNamespaceMismatch(
  matched: DotnetMatchedType,
  registryClassName: string,
): DotnetMatchedType {
  const requestedNamespace = requestedNamespaceFromClassName(registryClassName);
  const matchedNamespace = matchedNamespaceFromType(matched);
  const mismatch =
    requestedNamespace != null &&
    matchedNamespace != null &&
    requestedNamespace !== matchedNamespace;

  return {
    ...matched,
    namespaceMismatch: mismatch,
    requestedNamespace,
    matchedNamespace,
  };
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dist[i][0] = i;
  for (let j = 0; j < cols; j += 1) dist[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + cost,
      );
    }
  }
  return dist[a.length][b.length];
}

function nearestTypeNames(wanted: string, types: CompactTypeRef[], limit = 8): string[] {
  const normWanted = stripDiacritics(wanted).toLowerCase();
  const simple = simpleClassName(wanted)?.toLowerCase() ?? '';
  const scored = types
    .map((t) => {
      const full = t.fullName ?? '';
      const name = t.name ?? '';
      const normFull = stripDiacritics(full).toLowerCase();
      const distFull = levenshtein(normWanted, normFull);
      const distSimple = simple ? levenshtein(simple, name.toLowerCase()) : 99;
      const score = Math.min(distFull, distSimple + Math.max(0, full.length - name.length) * 0.01);
      return { full, score };
    })
    .filter((x) => x.full)
    .sort((a, b) => a.score - b.score);
  const out: string[] = [];
  for (const item of scored) {
    if (out.includes(item.full)) continue;
    out.push(item.full);
    if (out.length >= limit) break;
  }
  return out;
}

function inferDifferenceHints(
  wanted: string,
  types: CompactTypeRef[],
  nearest: string[],
  simpleHits: number,
): ClassVerificationDifferenceHint[] {
  const hints = new Set<ClassVerificationDifferenceHint>();
  const simple = simpleClassName(wanted) ?? '';
  const wantedNoDia = stripDiacritics(wanted);
  const simpleNoDia = stripDiacritics(simple).toLowerCase();

  if (simpleHits > 0) {
    hints.add('namespace');
  }

  for (const t of types) {
    const full = t.fullName ?? '';
    const name = t.name ?? '';
    if (!full && !name) continue;
    if (stripDiacritics(full) === wantedNoDia && full !== wanted) {
      hints.add('diacritic');
    }
    if (
      stripDiacritics(name).toLowerCase() === simpleNoDia &&
      name !== simple &&
      name.toLowerCase() !== simple.toLowerCase()
    ) {
      hints.add('diacritic');
    }
  }

  for (const candidate of nearest.slice(0, 3)) {
    const d = levenshtein(
      stripDiacritics(wanted).toLowerCase(),
      stripDiacritics(candidate).toLowerCase(),
    );
    const simpleCand = simpleClassName(candidate) ?? '';
    const dSimple = levenshtein(simpleNoDia, stripDiacritics(simpleCand).toLowerCase());
    if (d > 0 && d <= 3) hints.add('typo');
    if (dSimple > 0 && dSimple <= 2 && simpleCand.toLowerCase() !== simple.toLowerCase()) {
      hints.add('typo');
    }
    if (
      simpleCand.toLowerCase() === simple.toLowerCase() &&
      requestedNamespaceFromClassName(wanted) !== requestedNamespaceFromClassName(candidate)
    ) {
      hints.add('namespace');
    }
    // Same trailing type name under a different plugin stem → possible move / rename.
    if (
      simple &&
      simpleCand === simple &&
      /plg[A-Za-z0-9]+/.test(wanted) &&
      /plg[A-Za-z0-9]+/.test(candidate) &&
      wanted.replace(/plg[A-Za-z0-9]+/, 'plgX') !== candidate.replace(/plg[A-Za-z0-9]+/, 'plgX')
    ) {
      hints.add('moved_assembly');
    }
    if (d > 3 && d <= 12 && dSimple <= 1) {
      hints.add('historical_name');
    }
  }

  return [...hints];
}

export function buildTypeNotFoundDiagnostics(input: {
  registryClassName: string;
  assembly: string | null;
  resolvedDllPath: string | null;
  dllTypeCount: number | null;
  types: CompactTypeRef[];
}): ClassVerificationDiagnostics {
  const simple = simpleClassName(input.registryClassName);
  const simpleHits = simple
    ? input.types.filter((t) => t.name === simple).length
    : 0;
  const simpleNameOccurrence: 0 | 1 | 'many' =
    simpleHits === 0 ? 0 : simpleHits === 1 ? 1 : 'many';
  const nearestMatches = nearestTypeNames(input.registryClassName, input.types);
  const potentialDifference = inferDifferenceHints(
    input.registryClassName,
    input.types,
    nearestMatches,
    simpleHits,
  );

  let reasonCode = 'type_not_found';
  if (potentialDifference.includes('diacritic')) reasonCode = 'type_not_found_diacritic';
  else if (potentialDifference.includes('typo')) reasonCode = 'type_not_found_typo';
  else if (potentialDifference.includes('namespace')) reasonCode = 'type_not_found_namespace';
  else if (potentialDifference.includes('moved_assembly')) {
    reasonCode = 'type_not_found_moved_assembly';
  } else if (potentialDifference.includes('historical_name')) {
    reasonCode = 'type_not_found_historical_name';
  }

  return {
    reasonCode,
    registryClassName: input.registryClassName,
    assembly: input.assembly,
    resolvedDllPath: input.resolvedDllPath,
    simpleClassName: simple,
    dllTypeCount: input.dllTypeCount,
    simpleNameOccurrence,
    nearestMatches,
    potentialDifference,
  };
}
