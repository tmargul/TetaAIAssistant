import { normalizeSearchText } from './teta-plugin-grid-column-mapper';
import type { TetaApplicationObject } from './teta-application-object.types';

const FIELD_HELP_PATTERNS = [
  /\bdo\s+czego\s+sluzy\b/,
  /\bco\s+oznacza\b/,
  /\bco\s+to\s+jest\s+pole\b/,
  /\bna\s+czym\s+polega\b/,
  /\bjak\s+wypelnic\b/,
  /\bjak\s+wypelniac\b/,
  /\bznaczenie\s+pola\b/,
  /\bopisz\s+pole\b/,
  /\bwyjasnij\s+pole\b/,
];

const FORM_HELP_PATTERNS = [
  /\bdo\s+czego\s+sluzy\s+formularz\b/,
  /\bco\s+to\s+jest\s+formularz\b/,
  /\bna\s+czym\s+polega\s+formularz\b/,
];

const FIELD_NOISE = new Set([
  'pole',
  'formularz',
  'formularzu',
  'zakladka',
  'zakladce',
  'teta',
  'systemie',
  'systemu',
  'aplikacji',
  'pracownik',
  'pracownika',
  'pracownicy',
  'czym',
  'jest',
  'sluzy',
  'oznacza',
  'wyjasnij',
  'opisz',
  'na',
  'czym',
  'polega',
]);

export function isFieldHelpQuestion(message: string): boolean {
  const normalized = normalizeSearchText(message);
  if (FORM_HELP_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return FIELD_HELP_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function extractHelpQueryTokens(message: string): string[] {
  return normalizeSearchText(message)
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !FIELD_NOISE.has(token));
}

function scoreObjectForQuery(object: TetaApplicationObject, tokens: string[]): number {
  if (tokens.length === 0) return 0;

  const haystack = normalizeSearchText(
    [
      object.formName,
      object.fieldLabel,
      object.helpTitle,
      object.helpSection,
      ...object.keywords,
      object.binding?.oracleColumnName,
    ]
      .filter(Boolean)
      .join(' '),
  );

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += object.fieldLabel ? 2 : 1;
    }
  }

  if (object.fieldLabel) {
    const fieldNorm = normalizeSearchText(object.fieldLabel);
    for (const token of tokens) {
      if (fieldNorm.includes(token) || token.includes(fieldNorm)) {
        score += 4;
      }
    }
  }

  const formNorm = normalizeSearchText(object.formName);
  for (const token of tokens) {
    if (formNorm.includes(token)) {
      score += 2;
    }
  }

  return score;
}

export function rankApplicationObjectsForQuery(
  objects: TetaApplicationObject[],
  message: string,
): TetaApplicationObject[] {
  const tokens = extractHelpQueryTokens(message);
  return [...objects]
    .map((object) => ({ object, score: scoreObjectForQuery(object, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.object);
}

export function formatApplicationObjectHelpAnswer(object: TetaApplicationObject): string {
  const lines: string[] = [];

  if (object.fieldLabel && object.helpFieldText) {
    lines.push(`**${object.fieldLabel}** (formularz: ${object.formName})`);
    if (object.helpSection) {
      lines.push(`Sekcja helpu: ${object.helpSection}.`);
    }
    lines.push(object.helpFieldText);
  } else if (!object.fieldLabel && object.helpSummary) {
    lines.push(`**${object.formName}**`);
    lines.push(object.helpSummary);
  } else if (object.fieldLabel) {
    lines.push(`**${object.fieldLabel}** (formularz: ${object.formName})`);
    lines.push('Brak opisu w helpie kontekstowym Teta dla tego pola.');
  } else {
    lines.push(`Formularz **${object.formName}** — brak szczegółowego opisu w helpie.`);
  }

  if (object.binding?.oracleColumnName) {
    const target = object.binding.targetObject ? `${object.binding.targetObject}.` : '';
    lines.push(
      `Powiązanie techniczne: kolumna ${target}${object.binding.oracleColumnName}` +
        (object.binding.gatewayClassName ? ` (gateway ${object.binding.gatewayClassName})` : '') +
        '.',
    );
  }

  lines.push('Źródło: pomoc kontekstowa Teta + metadane wtyczki.');
  return lines.join('\n\n');
}

export function resolveHelpAnswerFromObjects(
  message: string,
  objects: TetaApplicationObject[],
): string | null {
  if (objects.length === 0) return null;

  const ranked = rankApplicationObjectsForQuery(objects, message);
  const fieldCandidates = ranked.filter((object) => object.fieldLabel && object.helpFieldText);
  const bestField = fieldCandidates[0];
  if (bestField) {
    return formatApplicationObjectHelpAnswer(bestField);
  }

  const formCandidates = ranked.filter((object) => !object.fieldLabel && object.helpSummary);
  if (formCandidates[0]) {
    return formatApplicationObjectHelpAnswer(formCandidates[0]);
  }

  if (ranked[0]?.helpFieldText || ranked[0]?.helpSummary) {
    return formatApplicationObjectHelpAnswer(ranked[0]);
  }

  return null;
}
