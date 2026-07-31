import type { GenericQueryLanguageConfig } from './teta-query-capability-registry';
import type { TemporalScopeKind } from './teta-logical-readonly-request.types';

export type MatchedCanonical = {
  conceptKey: string;
  surfaceText: string;
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved';
  kind: string;
};

export type MatchedSurface = {
  surfaceMeaningKey: string;
  surfaceText: string;
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved';
};

export type LanguageParseResult = {
  normalized: string;
  markers: string[];
  canonicalConcepts: MatchedCanonical[];
  surfaceMeanings: MatchedSurface[];
  identityRawTexts: string[];
  leadingZeroIds: string[];
  temporalKind: TemporalScopeKind;
  temporalSurface: string | null;
  temporalValue: { asOf?: string; from?: string; to?: string } | null;
  wantsCount: boolean;
  wantsGroupBy: boolean;
  topN: number | null;
  wantsNewestOrdering: boolean;
  afterDateIso: string | null;
  hasWithout: boolean;
};

function toIso(
  day: string,
  monthWord: string,
  year: string,
  monthNames: Record<string, number>,
): string | null {
  const m = monthNames[monthWord.toLowerCase()];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function normalizePolishQuery(query: string, language: GenericQueryLanguageConfig): string {
  let s = query.trim();
  if (language.normalization.lowercase) s = s.toLowerCase();
  if (language.normalization.collapseWhitespace) s = s.replace(/\s+/g, ' ');
  return s;
}

export function parseGenericQueryLanguage(
  query: string,
  language: GenericQueryLanguageConfig,
  monthNames: Record<string, number>,
): LanguageParseResult {
  const original = query.trim();
  const normalized = normalizePolishQuery(query, language);
  const markers: string[] = [];
  for (const [name, list] of Object.entries(language.requestShapeMarkers)) {
    if (list.some((m) => normalized.includes(m.toLowerCase()))) markers.push(name);
  }

  const canonicalConcepts: MatchedCanonical[] = [];
  for (const c of language.canonicalConcepts) {
    for (const label of c.labels) {
      if (normalized.includes(label.toLowerCase())) {
        canonicalConcepts.push({
          conceptKey: c.conceptKey,
          surfaceText: label,
          resolutionStatus: c.resolutionStatus,
          kind: c.kind,
        });
        break;
      }
    }
  }

  const surfaceMeanings: MatchedSurface[] = [];
  for (const s of language.surfaceMeanings) {
    for (const label of s.labels) {
      if (normalized.includes(label.toLowerCase())) {
        surfaceMeanings.push({
          surfaceMeaningKey: s.surfaceMeaningKey,
          surfaceText: label,
          resolutionStatus: s.resolutionStatus,
        });
        break;
      }
    }
  }

  const identityRawTexts: string[] = [];
  const leadingZeroIds: string[] = [];
  for (const pat of language.identityPatterns) {
    const r = new RegExp(pat.regex, 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(original)) !== null) {
      if (pat.id === 'employee_number_leading_zero') leadingZeroIds.push(m[1]);
      else if (pat.id === 'person_name_after_pracownik') identityRawTexts.push(m[1].trim());
      else if (pat.id === 'person_name_genitive') {
        if (/^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(m[1]) && /^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(m[2])) {
          identityRawTexts.push(`${m[1]} ${m[2]}`.trim());
        }
      }
    }
  }

  let temporalKind: TemporalScopeKind = 'unspecified';
  let temporalSurface: string | null = null;
  let temporalValue: { asOf?: string; from?: string; to?: string } | null = null;

  for (const tp of language.temporalPatterns) {
    if (tp.markers?.some((m) => normalized.includes(m.toLowerCase()))) {
      if (tp.kind === 'current') {
        temporalKind = 'current';
        temporalSurface = tp.markers.find((m) => normalized.includes(m.toLowerCase())) ?? 'aktualne';
      }
      if (tp.kind === 'history') {
        temporalKind = 'history';
        temporalSurface = 'historia';
      }
    }
    if (tp.regex && tp.kind === 'as_of') {
      const m = original.toLowerCase().match(new RegExp(tp.regex, 'i'));
      if (m) {
        temporalKind = 'as_of';
        temporalSurface = m[0];
        const iso = toIso(m[1], m[2], m[3], monthNames);
        temporalValue = iso ? { asOf: iso } : null;
      }
    }
    if (tp.regex && tp.kind === 'date_range') {
      const m = normalized.match(new RegExp(tp.regex, 'i'));
      if (m && /\bod\b/.test(normalized) && /\bdo\b/.test(normalized)) {
        if (!normalized.includes('do czego') && !normalized.includes('do pola')) {
          temporalKind = 'date_range';
          temporalSurface = m[0];
          temporalValue = { from: m[1], to: m[2] };
        }
      }
    }
  }

  let afterDateIso: string | null = null;
  const afterIso = normalized.match(/po\s+(\d{4}-\d{2}-\d{2})/);
  if (afterIso) afterDateIso = afterIso[1];
  const monthAlt = Object.keys(monthNames).join('|');
  if (monthAlt) {
    const afterPl = original.toLowerCase().match(new RegExp(`po\\s+(\\d{1,2})\\s+(${monthAlt})\\s+(\\d{4})`, 'i'));
    if (afterPl) afterDateIso = toIso(afterPl[1], afterPl[2], afterPl[3], monthNames);
  }

  const wantsCount = language.aggregationPatterns.count.some((x) =>
    new RegExp(`\\b${x}\\b`, 'i').test(normalized),
  );
  const wantsGroupBy = language.aggregationPatterns.groupByEach.some((x) =>
    normalized.includes(x.toLowerCase()),
  );

  let topN: number | null = null;
  let wantsNewestOrdering = false;
  for (const p of language.topNPatterns) {
    const m = normalized.match(new RegExp(p.regex, 'i'));
    if (m) {
      topN = Number(m[1]);
      wantsNewestOrdering = true;
    }
  }
  if (markers.includes('newest')) wantsNewestOrdering = true;

  return {
    normalized,
    markers,
    canonicalConcepts,
    surfaceMeanings,
    identityRawTexts: [...new Set(identityRawTexts)],
    leadingZeroIds: [...new Set(leadingZeroIds)],
    temporalKind,
    temporalSurface,
    temporalValue,
    wantsCount,
    wantsGroupBy,
    topN,
    wantsNewestOrdering,
    afterDateIso,
    hasWithout: markers.includes('without'),
  };
}

export function findCanonical(parsed: LanguageParseResult, key: string): MatchedCanonical | undefined {
  return parsed.canonicalConcepts.find((c) => c.conceptKey === key);
}

export function findSurface(parsed: LanguageParseResult, key: string): MatchedSurface | undefined {
  return parsed.surfaceMeanings.find((c) => c.surfaceMeaningKey === key);
}
