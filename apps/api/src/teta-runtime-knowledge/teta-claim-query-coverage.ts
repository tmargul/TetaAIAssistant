import type { Answerability, GroundedClaimV1 } from './teta-runtime-knowledge.types';

export type QueryIntentKind =
  | 'definition'
  | 'procedure'
  | 'rules_details'
  | 'comparison'
  | 'currentness'
  | 'source_disclosure'
  | 'other';

export type ClaimQueryCoverage =
  | 'answers_question'
  | 'partially_answers_question'
  | 'related_but_not_answering'
  | 'not_related';

export type ClaimShape =
  | 'definitional'
  | 'procedural'
  | 'rules_pointer'
  | 'rules_content'
  | 'comparative'
  | 'currentness_claim'
  | 'other';

export function classifyQueryIntent(query: string): QueryIntentKind {
  const q = query.trim();
  if (/sk[aą]d\s+(to\s+)?wiesz|podaj\s+(dokument|źr[oó]d|zrod|instrukcj)|poka[zż]\s+(dokument|źr[oó]d|evidence)|zignoruj\s+zasady/i.test(q)) {
    return 'source_disclosure';
  }
  if (/czym\s+r[oó][zż]ni|r[oó][zż]nic[ae]|vs\.?|versus|por[oó]wn/i.test(q)) return 'comparison';
  if (/aktualn|czy\s+.+\s+obs[lł]uguje|ksef|zgodno[sś][cć]\s+z\s+aktual/i.test(q)) return 'currentness';
  if (/jak\s+(wykon|przeprowadz|przebiega|zrobic|zrobić|sterowan)|procedur/i.test(q)) return 'procedure';
  if (/jakie\s+s[aą]\s+zasady|zasady\s+\w+|co\s+m[oó]wi\s+.+\s+o\s+|jakie\s+s[aą]\s+regu[lł]/i.test(q)) {
    return 'rules_details';
  }
  if (/czym\s+jest|co\s+to\s+jest|co\s+oznacza/i.test(q)) return 'definition';
  return 'other';
}

export function classifyClaimShape(text: string): ClaimShape {
  const t = text.trim();
  if (/zasady\s+(s[aą]\s+)?okre[sś]lon[ey]|wed[lł]ug\s+zasad\s+okre[sś]lon|okre[sś]lon[eyah]\s+w\s+regulamin/i.test(t)) {
    // Pointer: says rules exist somewhere, does not state the rules.
    if (!/(premia\s+\d|%\s*premii|kwot[ay]|termin\s+wyp[lł]aty|warunkiem\s+jest)/i.test(t)) {
      return 'rules_pointer';
    }
  }
  if (/krok|najpierw|nast[eę]pnie|procedur|rejestracj|akceptacj|uprawnie[nń]/i.test(t)) return 'procedural';
  if (/jest\s+|oznacza\s+|powierzchni[aą]|korzystaj[aą]c/i.test(t) && t.length < 220) return 'definitional';
  if (/r[oó][zż]ni|w\s+odr[oó][zż]nieniu|natomiast/i.test(t)) return 'comparative';
  if (/aktualn|obowi[aą]zuj[aą]c|ksef/i.test(t)) return 'currentness_claim';
  if (/prawo\s+do|przys[lł]uguje|zakaz|obowi[aą]zek|musi\s+|powinien/i.test(t)) return 'rules_content';
  return 'other';
}

function claimMentionsTopic(query: string, claimText: string): boolean {
  const qTokens = tokenizeSignificant(query);
  const cTokens = new Set(tokenizeSignificant(claimText));
  let overlap = 0;
  for (const t of qTokens) {
    if (cTokens.has(t)) overlap += 1;
  }
  return overlap >= Math.min(2, Math.max(1, Math.floor(qTokens.length / 3)));
}

export function tokenizeSignificant(text: string): string[] {
  const stop = new Set([
    'i',
    'w',
    'z',
    'na',
    'do',
    'o',
    'a',
    'to',
    'jest',
    'są',
    'sa',
    'jak',
    'jakie',
    'czym',
    'co',
    'oraz',
    'dla',
    'nie',
    'się',
    'sie',
    'od',
    'po',
    'za',
    'czy',
    'the',
    'of',
    'and',
  ]);
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9ąćęłńóśźż]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

export function evaluateClaimQueryCoverage(opts: {
  query: string;
  claims: Array<Pick<GroundedClaimV1, 'text' | 'knowledgeMode' | 'supportStrength'>>;
}): {
  intent: QueryIntentKind;
  coverage: ClaimQueryCoverage;
  claimShapes: ClaimShape[];
} {
  const intent = classifyQueryIntent(opts.query);
  const shapes = opts.claims.map((c) => classifyClaimShape(c.text));
  if (!opts.claims.length) {
    return { intent, coverage: 'not_related', claimShapes: shapes };
  }

  const related = opts.claims.some((c) => claimMentionsTopic(opts.query, c.text));
  if (!related && intent !== 'source_disclosure') {
    return { intent, coverage: 'not_related', claimShapes: shapes };
  }

  if (intent === 'source_disclosure') {
    return { intent, coverage: 'related_but_not_answering', claimShapes: shapes };
  }

  if (intent === 'rules_details') {
    const hasPointer = shapes.some((s) => s === 'rules_pointer');
    const hasContent = shapes.some((s) => s === 'rules_content' || s === 'procedural' || s === 'definitional');
    if (hasPointer && !hasContent) {
      return { intent, coverage: 'related_but_not_answering', claimShapes: shapes };
    }
    if (hasPointer && hasContent) {
      // Compound query: process + rules pointer — treat as answerable/partial from content side.
      return { intent, coverage: 'answers_question', claimShapes: shapes };
    }
    if (shapes.some((s) => s === 'rules_content' || s === 'definitional' || s === 'other' || s === 'procedural')) {
      return { intent, coverage: 'partially_answers_question', claimShapes: shapes };
    }
    return { intent, coverage: 'related_but_not_answering', claimShapes: shapes };
  }

  if (intent === 'definition') {
    if (shapes.some((s) => s === 'definitional')) {
      return { intent, coverage: 'answers_question', claimShapes: shapes };
    }
    return { intent, coverage: related ? 'partially_answers_question' : 'not_related', claimShapes: shapes };
  }

  if (intent === 'procedure') {
    if (shapes.some((s) => s === 'procedural')) {
      const partial = opts.claims.every(
        (c) => c.knowledgeMode === 'source_backed_partial' || c.supportStrength === 'partial',
      );
      return {
        intent,
        coverage: partial ? 'partially_answers_question' : 'answers_question',
        claimShapes: shapes,
      };
    }
    return { intent, coverage: related ? 'related_but_not_answering' : 'not_related', claimShapes: shapes };
  }

  if (intent === 'comparison') {
    return { intent, coverage: 'related_but_not_answering', claimShapes: shapes };
  }

  if (intent === 'currentness') {
    return { intent, coverage: 'related_but_not_answering', claimShapes: shapes };
  }

  return {
    intent,
    coverage: related
      ? opts.claims.some((c) => c.supportStrength === 'strong' || c.knowledgeMode === 'approved_canonical')
        ? 'answers_question'
        : 'partially_answers_question'
      : 'not_related',
    claimShapes: shapes,
  };
}

export function downgradeAnswerabilityByCoverage(opts: {
  answerability: Answerability;
  coverage: ClaimQueryCoverage;
  hasVisibleCitation: boolean;
}): { answerability: Answerability; downgraded: boolean; reason: string | null } {
  if (opts.answerability === 'blocked' || opts.answerability === 'insufficient') {
    return { answerability: opts.answerability, downgraded: false, reason: null };
  }

  if (opts.coverage === 'answers_question') {
    return { answerability: opts.answerability, downgraded: false, reason: null };
  }

  if (opts.coverage === 'related_but_not_answering') {
    // Prefer partial when a visible client/public citation can still be shown.
    if (opts.hasVisibleCitation && opts.answerability === 'answerable') {
      return {
        answerability: 'partially_answerable',
        downgraded: true,
        reason: 'related_but_not_answering_with_citation',
      };
    }
    if (opts.answerability === 'answerable') {
      return {
        answerability: opts.hasVisibleCitation ? 'partially_answerable' : 'insufficient',
        downgraded: true,
        reason: 'related_but_not_answering',
      };
    }
    if (opts.answerability === 'partially_answerable' && !opts.hasVisibleCitation) {
      return { answerability: 'insufficient', downgraded: true, reason: 'related_but_not_answering' };
    }
    return { answerability: 'partially_answerable', downgraded: false, reason: 'related_but_not_answering' };
  }

  if (opts.coverage === 'partially_answers_question' && opts.answerability === 'answerable') {
    return {
      answerability: 'partially_answerable',
      downgraded: true,
      reason: 'partially_answers_question',
    };
  }

  if (opts.coverage === 'not_related') {
    return { answerability: 'insufficient', downgraded: true, reason: 'not_related' };
  }

  return { answerability: opts.answerability, downgraded: false, reason: null };
}
