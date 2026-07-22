import { readDllStrings } from './teta-dll-string-scanner';
import { simpleClassName } from './teta-plugin-assembly-match.util';

export type TetaClassResolveStatus = 'found' | 'missing' | 'unverified';

export type TetaClassResolveResult = {
  className: string | null;
  simpleClassName: string | null;
  status: TetaClassResolveStatus;
};

/**
 * Confirm that NAZWA_KLASY exists in the DLL via exact type-name string match.
 * No fuzzy / similarity matching — absence ⇒ missing.
 */
export function resolveClassInDll(options: {
  dllPath: string | null;
  className: string | null | undefined;
  /** Optional preloaded strings (tests / cache). */
  dllStrings?: string[] | null;
}): TetaClassResolveResult {
  const className = options.className?.trim() || null;
  const simple = simpleClassName(className);

  if (!className) {
    return { className: null, simpleClassName: null, status: 'missing' };
  }

  if (!options.dllPath) {
    return { className, simpleClassName: simple, status: 'unverified' };
  }

  const strings = options.dllStrings ?? readDllStrings(options.dllPath);
  if (dllStringsContainExactType(strings, className)) {
    return { className, simpleClassName: simple, status: 'found' };
  }

  return { className, simpleClassName: simple, status: 'missing' };
}

/** Exact equality only (case-sensitive first, then case-insensitive). No substring. */
export function dllStringsContainExactType(strings: string[], className: string): boolean {
  const full = className.trim();
  if (!full) return false;

  if (strings.some((value) => value === full)) {
    return true;
  }

  const lower = full.toLowerCase();
  return strings.some((value) => value.toLowerCase() === lower);
}
