import { canonicalizeViewDdl } from './teta-view-metadata-transform';
import {
  fingerprint,
  type Stage3k2b2b2b1SafetyCounters,
  type TetaCandidateScopedViewIdentity,
  type TetaOracleViewDdlEnvelopeAssessment,
} from './teta-view-metadata.types';

function tokenAt(text: string, start: number, token: string): boolean {
  const slice = text.slice(start, start + token.length).toUpperCase();
  if (slice !== token) return false;
  const before = text[start - 1] ?? '';
  const after = text[start + token.length] ?? '';
  return !/[\w$#]/.test(before) && !/[\w$#]/.test(after);
}

/** Comment/literal/paren-aware scanner for top-level AS — not regex-only authority. */
export function scanTopLevelAs(text: string, start: number): number {
  let quote = false;
  let line = false;
  let block = false;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const a = text[i];
    const b = text[i + 1];
    if (line) {
      if (a === '\n') line = false;
      continue;
    }
    if (block) {
      if (a === '*' && b === '/') {
        block = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (a === "'" && b === "'") {
        i++;
        continue;
      }
      if (a === "'") quote = false;
      continue;
    }
    if (a === '-' && b === '-') {
      line = true;
      i++;
      continue;
    }
    if (a === '/' && b === '*') {
      block = true;
      i++;
      continue;
    }
    if (a === "'") {
      quote = true;
      continue;
    }
    if (a === '(') depth++;
    else if (a === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && tokenAt(text, i, 'AS')) return i;
  }
  return -1;
}

function unquoteIdent(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t.toUpperCase();
}

function parseColumnList(headerTail: string): string[] {
  const m = /^\s*\(([^)]*)\)/.exec(headerTail);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((c) => unquoteIdent(c))
    .filter(Boolean);
}

export function assessOracleViewDdlEnvelope(
  raw: string,
  expected: TetaCandidateScopedViewIdentity,
  counters?: Stage3k2b2b2b1SafetyCounters,
): TetaOracleViewDdlEnvelopeAssessment {
  const base: TetaOracleViewDdlEnvelopeAssessment = {
    rawDdlFingerprint: fingerprint(raw),
    ddlEnvelopeParseStatus: 'not_parsed',
    createKind: 'unsupported',
    forceStatus: false,
    editionableStatus: 'UNKNOWN',
    declaredOwner: null,
    declaredViewName: null,
    declaredColumnList: [],
    viewHeaderIdentityStatus: 'not_evaluated',
    queryBodyExtractionStatus: 'not_evaluated',
    queryBody: null,
    queryBodyStartOffset: null,
    queryBodyEndOffset: null,
    queryBodyRawFingerprint: null,
    queryBodyCanonicalFingerprint: null,
    wrapperWarnings: [],
    wrapperUnsupportedConstructs: [],
  };

  const prefix =
    /^\s*CREATE\s+(OR\s+REPLACE\s+)?(FORCE\s+)?(EDITIONABLE\s+|NONEDITIONABLE\s+)?VIEW\s+/i.exec(
      raw,
    );
  if (!prefix) {
    return { ...base, ddlEnvelopeParseStatus: 'malformed', queryBodyExtractionStatus: 'missing' };
  }

  let i = prefix[0].length;
  // owner.view or view
  const identMatch = /^((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)/.exec(raw.slice(i));
  if (!identMatch) {
    return { ...base, ddlEnvelopeParseStatus: 'malformed', queryBodyExtractionStatus: 'missing' };
  }
  const identRaw = identMatch[1];
  i += identRaw.length;
  const parts = identRaw.split(/\s*\.\s*/).map(unquoteIdent);
  const declaredOwner = parts.length === 2 ? parts[0] : expected.owner;
  const declaredViewName = parts.at(-1)!;
  const columnList = parseColumnList(raw.slice(i));
  if (columnList.length) {
    const colMatch = /^\s*\([^)]*\)/.exec(raw.slice(i));
    if (colMatch) i += colMatch[0].length;
  }

  const asPos = scanTopLevelAs(raw, i);
  const createKind = prefix[1] ? 'create_or_replace_view' : 'create_view';
  const forceStatus = Boolean(prefix[2]);
  const edRaw = prefix[3]?.trim().toUpperCase();
  const editionableStatus =
    edRaw === 'EDITIONABLE' || edRaw === 'NONEDITIONABLE' ? edRaw : 'UNKNOWN';
  const matched =
    declaredOwner === expected.owner && declaredViewName === expected.objectName;

  if (asPos < 0) {
    return {
      ...base,
      ddlEnvelopeParseStatus: 'parsed',
      createKind,
      forceStatus,
      editionableStatus,
      declaredOwner,
      declaredViewName,
      declaredColumnList: columnList,
      viewHeaderIdentityStatus: matched ? 'matched' : 'mismatched',
      queryBodyExtractionStatus: 'missing',
    };
  }

  const bodyStart = asPos + 2;
  const afterAs = raw.slice(bodyStart).trimStart();
  if (!/^(SELECT|WITH)\b/i.test(afterAs)) {
    if (counters) counters.queryBodyExtractedFromAmbiguousEnvelope++;
    return {
      ...base,
      ddlEnvelopeParseStatus: 'conflicting',
      createKind,
      forceStatus,
      editionableStatus,
      declaredOwner,
      declaredViewName,
      declaredColumnList: columnList,
      viewHeaderIdentityStatus: matched ? 'matched' : 'mismatched',
      queryBodyExtractionStatus: 'ambiguous',
    };
  }

  let query = raw.slice(bodyStart).replace(/;\s*$/, '');
  const lead = query.match(/^\s*/)?.[0].length ?? 0;
  const trail = query.match(/\s*$/)?.[0].length ?? 0;
  query = query.slice(lead, trail ? query.length - trail : undefined);
  const start = bodyStart + lead;
  const end = start + query.length;
  const canon = canonicalizeViewDdl(query);

  if (!matched && counters) {
    // caller must not accept mismatch; we never auto-accept
    counters.ddlHeaderIdentityMismatchAccepted += 0;
  }

  return {
    rawDdlFingerprint: fingerprint(raw),
    ddlEnvelopeParseStatus: 'parsed',
    createKind,
    forceStatus,
    editionableStatus,
    declaredOwner,
    declaredViewName,
    declaredColumnList: columnList,
    viewHeaderIdentityStatus: matched ? 'matched' : 'mismatched',
    queryBodyExtractionStatus: 'extracted',
    queryBody: query,
    queryBodyStartOffset: start,
    queryBodyEndOffset: end,
    queryBodyRawFingerprint: fingerprint(query),
    queryBodyCanonicalFingerprint: canon.canonicalPayloadSha256,
    wrapperWarnings: forceStatus ? ['force_present'] : [],
    wrapperUnsupportedConstructs: [],
  };
}

/** Explicitly reject regex-only as sole authority for production handoff. */
export function regexOnlyEnvelopeProbe(raw: string): { asIndex: number } {
  const m = /\bAS\b/i.exec(raw);
  return { asIndex: m ? m.index : -1 };
}
