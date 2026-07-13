import {
  findEarliestMentionIndex,
  normalizeSearchText,
  phraseMatchesNormalizedQuery,
  queryMentionsLink,
  type GridOracleColumnLink,
} from './teta-plugin-grid-column-mapper';

export function linkMentionedInFilterSection(section: string, link: GridOracleColumnLink): boolean {
  return queryMentionsLink(section, link);
}

function filterMatchScore(filterPart: string, link: GridOracleColumnLink): number {
  const normalizedFilter = normalizeSearchText(filterPart);
  let score = 0;

  for (const phrase of [link.label, ...link.synonyms].map((part) => normalizeSearchText(part))) {
    if (phrase.length < 3) {
      continue;
    }
    if (normalizedFilter.includes(phrase)) {
      score += phrase.length * 3;
      continue;
    }
    for (const token of phrase.split(/\s+/).filter((part) => part.length >= 3)) {
      if (phraseMatchesNormalizedQuery(token, normalizedFilter)) {
        score += token.length * 2;
      }
    }
  }

  return score;
}

function isWeakGenericFilterMatch(filterPart: string, link: GridOracleColumnLink, score: number): boolean {
  const normalizedFilter = normalizeSearchText(filterPart);
  const oracleUpper = link.oracleColumnName.toUpperCase();
  const hasEwid = /ewidencyjn|ewidenc/i.test(normalizedFilter);
  const isPkLike = oracleUpper === 'ID' || oracleUpper.endsWith('_ID');

  if (isPkLike && hasEwid && score < 12) {
    return true;
  }

  const labelNorm = normalizeSearchText(link.label);
  if (hasEwid && labelNorm === 'nr' && score < 10) {
    return true;
  }

  return false;
}

export function resolveFilterMappingFromQuery<T extends {
  oracleColumnName: string;
  label: string;
  gridColumnName: string | null;
  synonyms: string[];
}>(
  query: string,
  mappings: T[],
  filterValue: string | null,
  splitSections: (query: string) => { outputPart: string; filterPart: string },
): T | null {
  if (!filterValue?.trim()) {
    return null;
  }

  const normalizedValue = filterValue.trim();
  const { filterPart } = splitSections(query);
  let best: { mapping: T; distance: number; score: number } | null = null;

  for (const mapping of mappings) {
    const link: GridOracleColumnLink = {
      oracleColumnName: mapping.oracleColumnName,
      label: mapping.label,
      gridColumnName: mapping.gridColumnName,
      synonyms: mapping.synonyms,
    };
    const score = filterMatchScore(filterPart, link);
    if (score < 4 || !linkMentionedInFilterSection(filterPart, link)) {
      continue;
    }
    if (isWeakGenericFilterMatch(filterPart, link, score)) {
      continue;
    }

    const mentionIndex = findEarliestMentionIndex(filterPart, link);
    const valueIndex = normalizeSearchText(filterPart).indexOf(normalizeSearchText(normalizedValue));
    if (mentionIndex < 0 || valueIndex < 0 || valueIndex < mentionIndex) {
      continue;
    }

    const distance = valueIndex - mentionIndex;
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { mapping, distance, score };
    }
  }

  return best?.mapping ?? null;
}
