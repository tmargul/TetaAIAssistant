/** GUID normalization for PA_WTYCZKI / Help file lookup. */

const STANDARD_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type NormalizedPluginGuid = {
  raw: string;
  /** Trimmed, without `{}`/spaces, lowercase — or null if empty after normalize. */
  normalized: string | null;
  /** True only when `normalized` matches standard UUID layout. */
  isStandardUuid: boolean;
};

/**
 * Normalize plugin GUID: trim, strip `{}` and spaces, lowercase.
 * UUID format is validated when the value looks like a UUID; non-UUID GUIDs are kept.
 */
export function normalizePluginGuid(raw: string | null | undefined): NormalizedPluginGuid {
  const original = raw ?? '';
  if (!original.trim()) {
    return { raw: original, normalized: null, isStandardUuid: false };
  }

  const normalized = original
    .trim()
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  if (!normalized) {
    return { raw: original, normalized: null, isStandardUuid: false };
  }

  return {
    raw: original,
    normalized,
    isStandardUuid: STANDARD_UUID_RE.test(normalized),
  };
}

export function normalizeClassNameKey(className: string | null | undefined): string | null {
  const trimmed = className?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export function normalizeControlNameKey(controlName: string | null | undefined): string | null {
  const trimmed = controlName?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, '_').toLowerCase();
}

/** Form identity: `normalizedGuid:normalizedClassName` */
export function buildFormIdentity(
  guid: string | null | undefined,
  className: string | null | undefined,
): string | null {
  const g = normalizePluginGuid(guid).normalized;
  const c = normalizeClassNameKey(className);
  if (!g || !c) return null;
  return `${g}:${c}`;
}

/** Field identity: `normalizedGuid:normalizedClassName:normalizedControlName` */
export function buildFieldIdentity(
  guid: string | null | undefined,
  className: string | null | undefined,
  controlName: string | null | undefined,
): string | null {
  const formId = buildFormIdentity(guid, className);
  const control = normalizeControlNameKey(controlName);
  if (!formId || !control) return null;
  return `${formId}:${control}`;
}
