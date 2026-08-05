import {
  STAGE3K2B2B2A_PARSER_VERSION,
  sha256,
  type DefinitionCompletenessStatus,
  type ParseStatus,
} from './teta-enrichment.types';

export interface ViewParseResult {
  parseStatus: ParseStatus;
  parserVersion: string;
  oracleDialectVersion: string;
  unsupportedConstructs: string[];
  parseWarnings: string[];
  projections: string[];
  baseSources: string[];
  joinTypes: string[];
  hasWhere: boolean;
  distinctUsage: boolean;
  groupingUsage: boolean;
  aggregateFunctions: string[];
  unionUsage: boolean;
  unionAllUsage: boolean;
  subqueryUsage: boolean;
  outerJoinUsage: boolean;
  aliases: string[];
  quotedIdentifiers: string[];
  grainAffectingUnresolved: boolean;
  canonicalContentFingerprint: string;
}

const UNSUPPORTED_PATTERNS: Array<{ name: string; re: RegExp; grainAffecting: boolean }> = [
  { name: 'MODEL_CLAUSE', re: /\bMODEL\b/i, grainAffecting: true },
  { name: 'PIVOT', re: /\bPIVOT\b/i, grainAffecting: true },
  { name: 'UNPIVOT', re: /\bUNPIVOT\b/i, grainAffecting: true },
  { name: 'MATCH_RECOGNIZE', re: /\bMATCH_RECOGNIZE\b/i, grainAffecting: true },
  { name: 'XMLTABLE', re: /\bXMLTABLE\b/i, grainAffecting: true },
  { name: 'JSON_TABLE', re: /\bJSON_TABLE\b/i, grainAffecting: true },
  { name: 'CONNECT_BY', re: /\bCONNECT\s+BY\b/i, grainAffecting: true },
];

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function lexicalPreScan(sql: string): {
  distinctUsage: boolean;
  groupingUsage: boolean;
  unionUsage: boolean;
  unionAllUsage: boolean;
  hasWhere: boolean;
  outerJoinUsage: boolean;
  subqueryUsage: boolean;
  aggregateFunctions: string[];
  joinTypes: string[];
  projections: string[];
  baseSources: string[];
  aliases: string[];
  quotedIdentifiers: string[];
} {
  const text = stripComments(sql);
  const joinTypes: string[] = [];
  if (/\bINNER\s+JOIN\b/i.test(text)) joinTypes.push('INNER');
  if (/\bLEFT\s+(OUTER\s+)?JOIN\b/i.test(text)) joinTypes.push('LEFT');
  if (/\bRIGHT\s+(OUTER\s+)?JOIN\b/i.test(text)) joinTypes.push('RIGHT');
  if (/\bFULL\s+(OUTER\s+)?JOIN\b/i.test(text)) joinTypes.push('FULL');
  if (/\bCROSS\s+JOIN\b/i.test(text)) joinTypes.push('CROSS');
  if (/\bJOIN\b/i.test(text) && joinTypes.length === 0) joinTypes.push('JOIN');

  const aggregates: string[] = [];
  for (const fn of ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'LISTAGG']) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(text)) aggregates.push(fn);
  }

  const quotedIdentifiers = Array.from(text.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  const fromMatch = text.match(/\bFROM\s+([^\s,;(]+)/i);
  const baseSources = fromMatch ? [fromMatch[1].replace(/["']/g, '')] : [];
  const aliasMatches = Array.from(text.matchAll(/\b(?:AS)\s+([A-Za-z_][\w$#]*)/gi)).map(
    (m) => m[1],
  );

  const selectBody = text.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i)?.[1] ?? '';
  const projections = selectBody
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50);

  return {
    distinctUsage: /\bSELECT\s+DISTINCT\b/i.test(text),
    groupingUsage: /\bGROUP\s+BY\b/i.test(text),
    unionUsage: /\bUNION\b/i.test(text),
    unionAllUsage: /\bUNION\s+ALL\b/i.test(text),
    hasWhere: /\bWHERE\b/i.test(text),
    outerJoinUsage:
      /\bLEFT\s+(OUTER\s+)?JOIN\b/i.test(text) ||
      /\bRIGHT\s+(OUTER\s+)?JOIN\b/i.test(text) ||
      /\bFULL\s+(OUTER\s+)?JOIN\b/i.test(text) ||
      /\(\+\)/.test(text),
    subqueryUsage: /\(\s*SELECT\b/i.test(text),
    aggregateFunctions: aggregates,
    joinTypes,
    projections,
    baseSources,
    aliases: aliasMatches,
    quotedIdentifiers,
  };
}

export function assessDefinitionCompleteness(input: {
  content: string | null;
  expectedLength?: number | null;
  fragmentCount?: number;
  fragmentOrderingVerified?: boolean;
  truncatedMarker?: boolean;
}): {
  definitionCompletenessStatus: DefinitionCompletenessStatus;
  sourceLength: number | null;
  expectedLength: number | null;
  fragmentCount: number;
  fragmentOrderingVerified: boolean;
} {
  if (!input.content || !input.content.trim()) {
    return {
      definitionCompletenessStatus: 'missing',
      sourceLength: 0,
      expectedLength: input.expectedLength ?? null,
      fragmentCount: input.fragmentCount ?? 0,
      fragmentOrderingVerified: false,
    };
  }
  const sourceLength = input.content.length;
  const expectedLength = input.expectedLength ?? null;
  const fragmentCount = input.fragmentCount ?? 1;
  const fragmentOrderingVerified = input.fragmentOrderingVerified ?? fragmentCount <= 1;

  if (input.truncatedMarker || /\[truncated\]|\.\.\.\s*$/i.test(input.content)) {
    return {
      definitionCompletenessStatus: 'truncated',
      sourceLength,
      expectedLength,
      fragmentCount,
      fragmentOrderingVerified,
    };
  }
  if (expectedLength != null && sourceLength + 16 < expectedLength) {
    return {
      definitionCompletenessStatus: 'incomplete',
      sourceLength,
      expectedLength,
      fragmentCount,
      fragmentOrderingVerified,
    };
  }
  if (fragmentCount > 1 && !fragmentOrderingVerified) {
    return {
      definitionCompletenessStatus: 'incomplete',
      sourceLength,
      expectedLength,
      fragmentCount,
      fragmentOrderingVerified: false,
    };
  }
  if (fragmentCount > 1 && fragmentOrderingVerified) {
    return {
      definitionCompletenessStatus: 'fragmented_complete',
      sourceLength,
      expectedLength,
      fragmentCount,
      fragmentOrderingVerified: true,
    };
  }
  if (!/\bSELECT\b/i.test(input.content) && !/\bCREATE\s+(OR\s+REPLACE\s+)?VIEW\b/i.test(input.content)) {
    return {
      definitionCompletenessStatus: 'incomplete',
      sourceLength,
      expectedLength,
      fragmentCount,
      fragmentOrderingVerified,
    };
  }
  return {
    definitionCompletenessStatus: 'complete',
    sourceLength,
    expectedLength,
    fragmentCount,
    fragmentOrderingVerified,
  };
}

/**
 * Structured Oracle view-definition parser (metadata-only).
 * Lexical pre-scan is used for construct detection; unsupported constructs fail closed.
 * This is NOT Stage 3E compilation and does NOT execute SQL.
 */
export function parseOracleViewDefinition(content: string | null): ViewParseResult {
  if (!content || !content.trim()) {
    return {
      parseStatus: 'not_parsed',
      parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
      oracleDialectVersion: 'oracle-sql-view-v1',
      unsupportedConstructs: [],
      parseWarnings: ['empty_definition'],
      projections: [],
      baseSources: [],
      joinTypes: [],
      hasWhere: false,
      distinctUsage: false,
      groupingUsage: false,
      aggregateFunctions: [],
      unionUsage: false,
      unionAllUsage: false,
      subqueryUsage: false,
      outerJoinUsage: false,
      aliases: [],
      quotedIdentifiers: [],
      grainAffectingUnresolved: true,
      canonicalContentFingerprint: sha256(''),
    };
  }

  try {
    const lexical = lexicalPreScan(content);
    const unsupported: string[] = [];
    let grainAffectingUnresolved = false;
    for (const u of UNSUPPORTED_PATTERNS) {
      if (u.re.test(content)) {
        unsupported.push(u.name);
        if (u.grainAffecting) grainAffectingUnresolved = true;
      }
    }

    // Structural sanity: SELECT ... FROM required for a successful parse
    const hasSelectFrom =
      /\bSELECT\b/i.test(content) && /\bFROM\b/i.test(content);
    if (!hasSelectFrom) {
      return {
        parseStatus: 'parse_failed',
        parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
        oracleDialectVersion: 'oracle-sql-view-v1',
        unsupportedConstructs: unsupported,
        parseWarnings: ['missing_select_from'],
        ...lexical,
        grainAffectingUnresolved: true,
        canonicalContentFingerprint: sha256(content.trim().toUpperCase().replace(/\s+/g, ' ')),
      };
    }

    const parseStatus: ParseStatus =
      unsupported.length > 0 ? 'parsed_with_unsupported_constructs' : 'parsed';

    return {
      parseStatus,
      parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
      oracleDialectVersion: 'oracle-sql-view-v1',
      unsupportedConstructs: unsupported,
      parseWarnings: [],
      ...lexical,
      grainAffectingUnresolved:
        grainAffectingUnresolved ||
        lexical.unionUsage ||
        lexical.groupingUsage ||
        lexical.aggregateFunctions.length > 0,
      canonicalContentFingerprint: sha256(content.trim().toUpperCase().replace(/\s+/g, ' ')),
    };
  } catch (err) {
    return {
      parseStatus: 'parse_failed',
      parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
      oracleDialectVersion: 'oracle-sql-view-v1',
      unsupportedConstructs: [],
      parseWarnings: [`parse_exception:${err instanceof Error ? err.message : String(err)}`],
      projections: [],
      baseSources: [],
      joinTypes: [],
      hasWhere: false,
      distinctUsage: false,
      groupingUsage: false,
      aggregateFunctions: [],
      unionUsage: false,
      unionAllUsage: false,
      subqueryUsage: false,
      outerJoinUsage: false,
      aliases: [],
      quotedIdentifiers: [],
      grainAffectingUnresolved: true,
      canonicalContentFingerprint: sha256(content),
    };
  }
}
