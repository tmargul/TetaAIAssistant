import {
  normalizeHelpLabel,
} from './teta-stage2c-label';
import type {
  Stage2cFieldEntry,
  Stage2cHelpDocument,
  Stage2cHelpKind,
  Stage2cSection,
} from './teta-stage2c.types';
import { decodeHelpBuffer } from './teta-stage2c-encoding';
import { existsSync, readFileSync } from 'fs';

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi, '–')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function stripHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isActionLabel(label: string): boolean {
  return /^(zamkni|otwórz|otworz|zapisz|anuluj|usuń|usun|dodaj|edytuj|drukuj|eksport|import|zatwierd|odtwierdz|wyślij|wyslij|oblicz|przelicz|koryguj|uruchom)/i.test(
    label.trim(),
  );
}

function classifyHelpKind(
  label: string,
  description: string,
  section: string | null,
): Stage2cHelpKind {
  // Action labels win over warning heuristics (surrounding UWAGA paragraphs).
  if (isActionLabel(label)) return 'actionHelp';
  if (/uwaga|ostrzeż|ostrzez|warning/i.test(section ?? '')) return 'warningHelp';
  if (/^(uwaga|ostrzeż)/i.test(description.trim())) return 'warningHelp';
  if (/przycisk|funkcj|akcj/i.test(description.slice(0, 80))) return 'actionHelp';
  if (/workflow|proces|kolejność|kolejnosc/i.test(section ?? '')) return 'workflowHelp';
  return 'fieldHelp';
}

function findSectionAt(html: string, index: number, headings: { label: string; index: number }[]): string | null {
  let current: string | null = null;
  for (const h of headings) {
    if (h.index <= index) current = h.label;
    else break;
  }
  return current;
}

function extractHeadings(html: string): { label: string; level: number; index: number }[] {
  const out: { label: string; level: number; index: number }[] = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = stripHtmlToText(m[2] ?? '');
    if (!label) continue;
    out.push({ label, level: Number(m[1]), index: m.index ?? 0 });
  }
  return out;
}

function extractSections(html: string, headings: { label: string; level: number; index: number }[]): Stage2cSection[] {
  const sections: Stage2cSection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].index : html.length;
    const chunk = html.slice(h.index, end);
    const text = stripHtmlToText(chunk.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i, ''));
    const lists: string[][] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let li: RegExpExecArray | null;
    const items: string[] = [];
    while ((li = liRe.exec(chunk)) !== null) {
      const t = stripHtmlToText(li[1] ?? '');
      if (t) items.push(t);
    }
    if (items.length) lists.push(items);

    const tables: Stage2cSection['tables'] = [];
    const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tbl: RegExpExecArray | null;
    while ((tbl = tableRe.exec(chunk)) !== null) {
      const rows: string[][] = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let tr: RegExpExecArray | null;
      while ((tr = trRe.exec(tbl[1] ?? '')) !== null) {
        const cells: string[] = [];
        const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        let cell: RegExpExecArray | null;
        while ((cell = cellRe.exec(tr[1] ?? '')) !== null) {
          cells.push(stripHtmlToText(cell[1] ?? ''));
        }
        if (cells.some((c) => c)) rows.push(cells);
      }
      if (rows.length) {
        tables.push({ headers: rows[0] ?? [], rows: rows.slice(1) });
      }
    }

    sections.push({
      heading: h.label,
      level: h.level,
      text: text.slice(0, 4000),
      lists,
      tables,
      order: i,
    });
  }
  return sections;
}

function pushField(
  entries: Stage2cFieldEntry[],
  seen: Set<string>,
  opts: {
    label: string;
    description: string;
    section: string | null;
    fragment: string;
    order: number;
    pattern: string;
    confidence: Stage2cFieldEntry['confidence'];
  },
): void {
  const { label, normalizedLabel, normalizedLabelAscii } = normalizeHelpLabel(opts.label);
  if (!label || label.length < 2 || label.length > 100) return;
  if (!opts.description || opts.description.length < 3) return;
  // Skip menu paths as fields
  if (label.includes('|') && label.length > 40) return;
  if (/^spis treści|^spis tresci|^index$/i.test(normalizedLabel)) return;

  const key = `${normalizedLabelAscii}|${opts.section ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);

  entries.push({
    label,
    normalizedLabel,
    normalizedLabelAscii,
    description: opts.description,
    section: opts.section,
    sourceFragment: opts.fragment.slice(0, 240),
    order: opts.order,
    extractionPattern: opts.pattern,
    confidence: opts.confidence,
    evidence: [`pattern=${opts.pattern}`, `section=${opts.section ?? '-'}`],
    helpKind: classifyHelpKind(label, opts.description, opts.section),
  });
}

/** Pattern A: <b>Label – </b>description  (dash inside bold) */
function extractBoldDashInside(html: string, headings: { label: string; index: number }[], out: Stage2cFieldEntry[], seen: Set<string>): void {
  const re =
    /<b>\s*([^<]*?)\s*(?:&#8211;|&#8212;|&ndash;|&mdash;|–|—|-)\s*<\/b>\s*([\s\S]*?)(?=<\/p>|<\/li>|<b>|<h[1-6]|$)/gi;
  let m: RegExpExecArray | null;
  let order = out.length;
  while ((m = re.exec(html)) !== null) {
    const label = stripHtmlToText(m[1] ?? '');
    const description = stripHtmlToText(m[2] ?? '');
    pushField(out, seen, {
      label,
      description,
      section: findSectionAt(html, m.index ?? 0, headings),
      fragment: m[0],
      order: order++,
      pattern: 'bold_dash_inside',
      confidence: 'confirmed_structural',
    });
  }
}

/** Pattern B: <b>Label</b> – description */
function extractBoldDashAfter(html: string, headings: { label: string; index: number }[], out: Stage2cFieldEntry[], seen: Set<string>): void {
  const re =
    /<b>\s*([^<]+?)\s*<\/b>\s*(?:,\s*<b>\s*([^<]+?)\s*<\/b>\s*)?(?:&#8211;|&#8212;|&ndash;|&mdash;|–|—|-)\s*([\s\S]*?)(?=<\/p>|<\/li>|<b>|<h[1-6]|$)/gi;
  let m: RegExpExecArray | null;
  let order = out.length;
  while ((m = re.exec(html)) !== null) {
    const labels = [m[1], m[2]].filter(Boolean).map((x) => stripHtmlToText(x!));
    const description = stripHtmlToText(m[3] ?? '');
    for (const label of labels) {
      pushField(out, seen, {
        label,
        description,
        section: findSectionAt(html, m.index ?? 0, headings),
        fragment: m[0],
        order: order++,
        pattern: 'bold_dash_after',
        confidence: 'confirmed_structural',
      });
    }
  }
}

/** Pattern C: table with Pole/Opis or Nazwa/Opis headers */
function extractFieldTables(html: string, headings: { label: string; index: number }[], out: Stage2cFieldEntry[], seen: Set<string>): void {
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tbl: RegExpExecArray | null;
  let order = out.length;
  while ((tbl = tableRe.exec(html)) !== null) {
    const rows: string[][] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(tbl[1] ?? '')) !== null) {
      const cells: string[] = [];
      const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cell: RegExpExecArray | null;
      while ((cell = cellRe.exec(tr[1] ?? '')) !== null) {
        cells.push(stripHtmlToText(cell[1] ?? ''));
      }
      if (cells.length >= 2) rows.push(cells);
    }
    if (rows.length < 2) continue;
    const header = rows[0].map((c) => c.toLowerCase());
    const looksField =
      header.some((h) => /pole|nazwa|label|field|kolumna/.test(h)) &&
      header.some((h) => /opis|description|znaczenie|help/.test(h));
    if (!looksField) continue;
    const labelIdx = header.findIndex((h) => /pole|nazwa|label|field|kolumna/.test(h));
    const descIdx = header.findIndex((h) => /opis|description|znaczenie|help/.test(h));
    if (labelIdx < 0 || descIdx < 0) continue;
    for (const row of rows.slice(1)) {
      pushField(out, seen, {
        label: row[labelIdx] ?? '',
        description: row[descIdx] ?? '',
        section: findSectionAt(html, tbl.index ?? 0, headings),
        fragment: row.join(' | '),
        order: order++,
        pattern: 'table_pole_opis',
        confidence: 'confirmed_structural',
      });
    }
  }
}

/** Pattern D: definition lists */
function extractDefinitionLists(html: string, headings: { label: string; index: number }[], out: Stage2cFieldEntry[], seen: Set<string>): void {
  const re = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  let order = out.length;
  while ((m = re.exec(html)) !== null) {
    pushField(out, seen, {
      label: stripHtmlToText(m[1] ?? ''),
      description: stripHtmlToText(m[2] ?? ''),
      section: findSectionAt(html, m.index ?? 0, headings),
      fragment: m[0],
      order: order++,
      pattern: 'definition_list',
      confidence: 'confirmed_structural',
    });
  }
}

/** Pattern E: Label: description in plain list text (probable only) */
function extractColonCandidates(html: string, headings: { label: string; index: number }[], out: Stage2cFieldEntry[], seen: Set<string>): void {
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  let order = out.length;
  while ((m = liRe.exec(html)) !== null) {
    const text = stripHtmlToText(m[1] ?? '');
    // Avoid auto-splitting every colon sentence — require short label before colon
    const match = text.match(/^(.{2,60}?)\s*[:：]\s+(.{8,})$/);
    if (!match) continue;
    if (/https?:|www\./i.test(match[1])) continue;
    pushField(out, seen, {
      label: match[1],
      description: match[2],
      section: findSectionAt(html, m.index ?? 0, headings),
      fragment: text.slice(0, 200),
      order: order++,
      pattern: 'list_colon',
      confidence: 'probable_structural',
    });
  }
}

/**
 * Pattern F: bold action/function names without dash (e.g. <b>Zamknięcie miesiąca</b>).
 * Description = surrounding sentence; classified as actionHelp.
 */
function extractBoldActionNames(
  html: string,
  headings: { label: string; index: number }[],
  out: Stage2cFieldEntry[],
  seen: Set<string>,
): void {
  const re = /<b>\s*([^<]{3,80}?)\s*<\/b>/gi;
  let m: RegExpExecArray | null;
  let order = out.length;
  while ((m = re.exec(html)) !== null) {
    const label = stripHtmlToText(m[1] ?? '');
    if (!label || label.includes('|')) continue;
    // Require action-like *start* (not substring in "Listy zamknięte")
    if (!isActionLabel(label) && !/^(funkcj|przycisk)\b/i.test(label)) continue;
    // Skip if already captured by dash patterns
    const keyCheck = normalizeHelpLabel(label).normalizedLabelAscii;
    if ([...seen].some((k) => k.startsWith(`${keyCheck}|`))) continue;

    const aroundStart = Math.max(0, (m.index ?? 0) - 120);
    const aroundEnd = Math.min(html.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 200);
    const description = stripHtmlToText(html.slice(aroundStart, aroundEnd));
    pushField(out, seen, {
      label,
      description: description || label,
      section: findSectionAt(html, m.index ?? 0, headings),
      fragment: m[0],
      order: order++,
      pattern: 'bold_action_name',
      confidence: 'probable_structural',
    });
  }
}

/**
 * Pattern G: dictionary overview mentioning kod/nazwa/aktualność as candidate fields.
 * Does NOT invent fields from arbitrary colon sentences.
 */
function extractOverviewDictionaryFields(
  overview: string | null,
  out: Stage2cFieldEntry[],
  seen: Set<string>,
): void {
  if (!overview) return;
  const ascii = overview.toLowerCase();
  if (!/składa się z|sklada sie z|definiujemy|definicja/i.test(overview)) return;

  const candidates: Array<{ label: string; hint: RegExp }> = [
    { label: 'Kod', hint: /\bkodu?\b/i },
    { label: 'Nazwa', hint: /\bnazw[yae]\b/i },
    { label: 'Aktualna', hint: /\baktualn|\bwykorzystywan|\boznaczenia?\b/i },
  ];
  let order = out.length;
  for (const c of candidates) {
    if (!c.hint.test(ascii) && !c.hint.test(overview)) continue;
    pushField(out, seen, {
      label: c.label,
      description: overview.slice(0, 400),
      section: null,
      fragment: overview.slice(0, 160),
      order: order++,
      pattern: 'overview_dictionary_fields',
      confidence: 'candidate_text',
    });
  }
}

export function parseStage2cHelpHtml(
  html: string,
  options: {
    guid: string;
    helpPath: string;
    formType?: string | null;
    registryId?: string | null;
    assembly?: string | null;
    encoding?: string | null;
    decodingStatus?: string | null;
    replacementCharacterCount?: number;
  },
): Stage2cHelpDocument {
  const warnings: string[] = [];
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const headings = extractHeadings(cleaned);
  const sections = extractSections(cleaned, headings);
  const titleFromH1 = headings.find((h) => h.level === 1)?.label ?? null;
  const titleFromTag = stripHtmlToText(cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const title = titleFromH1 || titleFromTag || null;

  const firstP = cleaned.match(/<p(?![^>]*class=["']UWAGA)[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const overview = firstP ? stripHtmlToText(firstP) : null;

  const fieldEntries: Stage2cFieldEntry[] = [];
  const seen = new Set<string>();
  const headingRefs = headings.map((h) => ({ label: h.label, index: h.index }));

  extractBoldDashInside(cleaned, headingRefs, fieldEntries, seen);
  extractBoldDashAfter(cleaned, headingRefs, fieldEntries, seen);
  extractFieldTables(cleaned, headingRefs, fieldEntries, seen);
  extractDefinitionLists(cleaned, headingRefs, fieldEntries, seen);
  extractColonCandidates(cleaned, headingRefs, fieldEntries, seen);
  extractBoldActionNames(cleaned, headingRefs, fieldEntries, seen);
  extractOverviewDictionaryFields(overview, fieldEntries, seen);

  if (
    fieldEntries.filter((f) => f.helpKind === 'fieldHelp').length === 0 &&
    overview
  ) {
    warnings.push('no_structural_field_entries');
  }

  const actionEntries = fieldEntries.filter((f) => f.helpKind === 'actionHelp');
  const fieldsOnly = fieldEntries.filter(
    (f) => f.helpKind === 'fieldHelp' || f.helpKind === 'warningHelp',
  );

  return {
    guid: options.guid,
    registryId: options.registryId ?? null,
    formType: options.formType ?? null,
    assembly: options.assembly ?? null,
    helpPath: options.helpPath,
    helpStatus: 'help_found',
    detectedEncoding: options.encoding ?? null,
    decodingStatus: options.decodingStatus ?? null,
    replacementCharacterCount: options.replacementCharacterCount ?? 0,
    title,
    overview,
    sections,
    fieldEntries: fieldsOnly,
    actionEntries,
    unmatchedEntries: [],
    parseWarnings: warnings,
  };
}

export function readStage2cHelpFile(options: {
  helpPath: string;
  guid: string;
  formType?: string | null;
  registryId?: string | null;
  assembly?: string | null;
}): Stage2cHelpDocument {
  if (!existsSync(options.helpPath)) {
    return emptyDoc(options, 'help_file_missing');
  }
  let buffer: Buffer;
  try {
    buffer = readFileSync(options.helpPath);
  } catch {
    return emptyDoc(options, 'help_file_unreadable');
  }
  if (buffer.length === 0) return emptyDoc(options, 'help_empty');

  const decoded = decodeHelpBuffer(buffer);
  if (decoded.decodingStatus === 'failed' || decoded.decodingStatus === 'high_replacement') {
    return {
      ...emptyDoc(options, 'help_encoding_failed'),
      detectedEncoding: decoded.detectedEncoding,
      decodingStatus: decoded.decodingStatus,
      replacementCharacterCount: decoded.replacementCharacterCount,
      parseWarnings: ['encoding_failed_or_high_replacement'],
    };
  }
  if (!decoded.text.trim()) return emptyDoc(options, 'help_empty');

  try {
    return parseStage2cHelpHtml(decoded.text, {
      ...options,
      encoding: decoded.detectedEncoding,
      decodingStatus: decoded.decodingStatus,
      replacementCharacterCount: decoded.replacementCharacterCount,
    });
  } catch (error) {
    return {
      ...emptyDoc(options, 'help_parse_failed'),
      parseWarnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function emptyDoc(
  options: {
    helpPath?: string | null;
    guid: string;
    formType?: string | null;
    registryId?: string | null;
    assembly?: string | null;
  },
  status: Stage2cHelpDocument['helpStatus'],
): Stage2cHelpDocument {
  return {
    guid: options.guid,
    registryId: options.registryId ?? null,
    formType: options.formType ?? null,
    assembly: options.assembly ?? null,
    helpPath: options.helpPath ?? null,
    helpStatus: status,
    title: null,
    overview: null,
    sections: [],
    fieldEntries: [],
    actionEntries: [],
    unmatchedEntries: [],
    parseWarnings: [],
  };
}
