/**
 * Stage 3I — TOC vs body section inventory + reconciliation.
 */
import { STAGE3I_MAX_SECTIONS } from './teta-payroll-snapshot.types';
import type { PayrollSectionKind, TetaPayrollSectionSummary } from './teta-payroll-snapshot.types';
import {
  compactSectionHeading,
  loadPayrollSectionCatalog,
  normalizeSectionHeading,
  resolveSectionHeading,
  type PayrollSectionCatalog,
  type PayrollSectionCatalogEntry,
} from './teta-payroll-section-catalog';

export type InventoredSection = {
  sourceLabel: string;
  canonicalId: string | null;
  canonicalLabel: string | null;
  kind: PayrollSectionKind;
  core: boolean;
  ordinal: number;
  index: number;
  origin: 'toc' | 'body';
};

export type SectionReconciliation = {
  tocSectionCount: number;
  bodySectionCount: number;
  matchedSectionCount: number;
  missingBodySections: string[];
  bodySectionsMissingFromToc: string[];
  unknownSections: string[];
  duplicateBodySections: string[];
  totalSectionsDetected: number;
  coreSectionsNormalized: number;
  genericSectionsPreserved: number;
  unknownSectionsPreserved: number;
  missingCoreBodySections: string[];
  tocAndBodySectionCountsMatch: boolean;
};

export type ParsedSectionBody = {
  summary: TetaPayrollSectionSummary & {
    canonicalId: string | null;
    canonicalLabel: string | null;
    sourceLabel: string;
  };
  bodyText: string;
  lines: string[];
};

export type SectionInventoryResult = {
  toc: InventoredSection[];
  body: InventoredSection[];
  sections: ParsedSectionBody[];
  reconciliation: SectionReconciliation;
  truncated: boolean;
  bodyStartIndex: number;
};

const CONTENTS = 'ZAWARTOŚĆ RAPORTU';

function findBodyStart(text: string): number {
  // First real components table after TOC: heading + ID/KOD columns
  const re = /SKŁADNIKI PŁACOWE\s+ID\t/i;
  const m = re.exec(text);
  if (m && m.index != null) return m.index;
  const alt = text.indexOf('SKŁADNIKI PŁACOWE');
  return alt >= 0 ? alt : 0;
}

function extractTocRawLabels(text: string, bodyStart: number): string[] {
  const tocIdx = text.indexOf(CONTENTS);
  if (tocIdx < 0) return [];
  const region = text.slice(tocIdx, bodyStart > tocIdx ? bodyStart : Math.min(text.length, tocIdx + 8000));
  const labels: string[] = [];
  const re = /HYPERLINK\s+_Toc\d+"?\s*/gi;
  const parts = region.split(re).slice(1);
  for (const part of parts) {
    const end = part.search(/\s*HYPERLINK\s+_Toc/i);
    const raw = (end >= 0 ? part.slice(0, end) : part).trim();
    if (!raw) continue;
    // Stop if we accidentally captured table header leftovers
    if (/^ID\t/i.test(raw) || /\tKOD\t/i.test(raw)) continue;
    labels.push(raw.replace(/\s+/g, ' ').trim());
  }
  // Fallback: if hyperlink split failed, try line-ish tokens after CONTENTS
  if (labels.length === 0) {
    const after = region.slice(CONTENTS.length).replace(/^[:\s]+/, '');
    for (const line of after.split(/\n+/)) {
      const t = line.trim();
      if (!t || t.length > 160) continue;
      if (/HYPERLINK|_Toc/i.test(t)) continue;
      labels.push(t);
    }
  }
  return labels;
}

function findAliasHitsInBody(
  bodyText: string,
  bodyOffset: number,
  catalog: PayrollSectionCatalog,
): InventoredSection[] {
  type Hit = {
    index: number;
    length: number;
    sourceLabel: string;
    entry: PayrollSectionCatalogEntry;
  };
  const hits: Hit[] = [];

  // Longer labels first to avoid partial SKŁADNIKI PŁACOWE matching context title
  const searchEntries = [...catalog.sections].sort(
    (a, b) =>
      Math.max(...b.aliases.map((x) => x.length), b.canonicalLabel.length) -
      Math.max(...a.aliases.map((x) => x.length), a.canonicalLabel.length),
  );

  for (const entry of searchEntries) {
    const aliases = [...new Set([entry.canonicalLabel, ...entry.aliases])];
    for (const alias of aliases) {
      const needle = alias;
      let from = 0;
      while (from < bodyText.length) {
        const idx = bodyText.indexOf(needle, from);
        if (idx < 0) {
          // Soft-wrap recovery: scan with compact equality on windows is expensive;
          // try normalized spaced variants already covered by aliases list.
          break;
        }
        const before = bodyText.slice(Math.max(0, idx - 40), idx);
        if (/HYPERLINK|_Toc\d+/i.test(before)) {
          from = idx + needle.length;
          continue;
        }
        const prev = idx > 0 ? bodyText[idx - 1]! : '\n';
        // Reject mid-word / mid-cell-text matches; allow whitespace/tabs from prior cells.
        if (/[0-9A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż"]/.test(prev)) {
          from = idx + needle.length;
          continue;
        }
        // Avoid matching plain SKŁADNIKI PŁACOWE inside the context section title
        if (entry.canonicalId === 'components') {
          const afterTitle = bodyText.slice(idx + needle.length, idx + needle.length + 24);
          if (/^\s*OBLICZANE/i.test(afterTitle)) {
            from = idx + needle.length;
            continue;
          }
        }
        // Table cell values often end with the section word then \t (e.g. "DNI ROB. ZAWIESZENIA\tP")
        const after = bodyText.slice(idx + needle.length, idx + needle.length + 24);
        if (/^\s*\t/.test(after)) {
          from = idx + needle.length;
          continue;
        }
        hits.push({
          index: bodyOffset + idx,
          length: needle.length,
          sourceLabel: bodyText.slice(idx, idx + needle.length),
          entry,
        });
        from = idx + needle.length;
      }
    }
  }

  // Compact-scan for soft-wrapped headings (e.g. "DS LIMITY", "SKŁADNIKI PŁ ACOWE…")
  // only for entries not yet found.
  const foundIds = new Set(hits.map((h) => h.entry.canonicalId));
  for (const entry of catalog.sections) {
    if (foundIds.has(entry.canonicalId)) continue;
    const target = compactSectionHeading(entry.canonicalLabel);
    // Sliding window over lines
    const lines = bodyText.split('\n');
    let offset = bodyOffset;
    for (const line of lines) {
      const compactLine = compactSectionHeading(line);
      if (compactLine.startsWith(target) || compactLine.includes(target)) {
        // Extract approximate source label from line start
        const trimmed = line.trim();
        if (trimmed && !trimmed.includes('\t') && compactSectionHeading(trimmed).startsWith(target.slice(0, Math.min(12, target.length)))) {
          const resolved = resolveSectionHeading(trimmed, catalog);
          if (resolved.matched && resolved.entry.canonicalId === entry.canonicalId) {
            hits.push({
              index: offset + line.indexOf(trimmed),
              length: trimmed.length,
              sourceLabel: trimmed.split(/\s{2,}|\t/)[0]!.slice(0, 160),
              entry,
            });
            foundIds.add(entry.canonicalId);
            break;
          }
        }
      }
      offset += line.length + 1;
    }
  }

  hits.sort((a, b) => a.index - b.index || b.length - a.length);

  // Keep first hit per canonicalId (document order); detect duplicates
  const chosen: InventoredSection[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  let ordinal = 0;
  for (const hit of hits) {
    const prev = seen.get(hit.entry.canonicalId);
    if (prev != null) {
      duplicates.push(hit.entry.canonicalId);
      continue;
    }
    // Skip overlapping starts
    const last = chosen[chosen.length - 1];
    if (last && hit.index < last.index + 2) continue;
    ordinal += 1;
    seen.set(hit.entry.canonicalId, hit.index);
    chosen.push({
      sourceLabel: hit.sourceLabel,
      canonicalId: hit.entry.canonicalId,
      canonicalLabel: hit.entry.canonicalLabel,
      kind: hit.entry.kind,
      core: hit.entry.core,
      ordinal,
      index: hit.index,
      origin: 'body',
    });
  }

  // Attach duplicates list via side channel on function return through reconciliation later
  (chosen as InventoredSection[] & { _duplicates?: string[] })._duplicates = [
    ...new Set(duplicates),
  ];
  return chosen;
}

export function inventoryReportSections(text: string): SectionInventoryResult {
  const catalog = loadPayrollSectionCatalog();
  const bodyStart = findBodyStart(text);
  const tocRaw = extractTocRawLabels(text, bodyStart);

  const toc: InventoredSection[] = [];
  const unknownToc: string[] = [];
  tocRaw.forEach((raw, i) => {
    const resolved = resolveSectionHeading(raw, catalog);
    if (resolved.matched) {
      toc.push({
        sourceLabel: resolved.sourceLabel,
        canonicalId: resolved.entry.canonicalId,
        canonicalLabel: resolved.entry.canonicalLabel,
        kind: resolved.entry.kind,
        core: resolved.entry.core,
        ordinal: i + 1,
        index: i,
        origin: 'toc',
      });
    } else {
      unknownToc.push(raw);
      toc.push({
        sourceLabel: raw,
        canonicalId: null,
        canonicalLabel: null,
        kind: 'unknown_section',
        core: false,
        ordinal: i + 1,
        index: i,
        origin: 'toc',
      });
    }
  });

  const bodyRegion = text.slice(bodyStart);
  const body = findAliasHitsInBody(bodyRegion, bodyStart, catalog);
  const duplicateBodySections =
    ((body as InventoredSection[] & { _duplicates?: string[] })._duplicates ?? []);

  if (toc.length + body.length > STAGE3I_MAX_SECTIONS) {
    return {
      toc,
      body,
      sections: [],
      reconciliation: emptyReconciliation(),
      truncated: true,
      bodyStartIndex: bodyStart,
    };
  }

  // Build section bodies from body inventory order
  const sections: ParsedSectionBody[] = [];
  for (let i = 0; i < body.length; i++) {
    const cur = body[i]!;
    const end = i + 1 < body.length ? body[i + 1]!.index : text.length;
    const titleLen = cur.sourceLabel.length;
    const bodyText = text.slice(cur.index + titleLen, end).trim();
    const lines = bodyText
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    sections.push({
      summary: {
        sectionId: `sec_${String(i + 1).padStart(3, '0')}`,
        title: cur.canonicalLabel ?? cur.sourceLabel,
        sourceLabel: cur.sourceLabel,
        canonicalId: cur.canonicalId,
        canonicalLabel: cur.canonicalLabel,
        kind: cur.kind,
        ordinal: i + 1,
        recordCount: 0,
      },
      bodyText,
      lines,
    });
  }

  const tocIds = toc.map((t) => t.canonicalId).filter(Boolean) as string[];
  const bodyIds = body.map((b) => b.canonicalId).filter(Boolean) as string[];
  const tocSet = new Set(tocIds);
  const bodySet = new Set(bodyIds);

  const missingBodySections = toc
    .filter((t) => t.canonicalId && !bodySet.has(t.canonicalId))
    .map((t) => t.canonicalLabel ?? t.sourceLabel);
  const bodySectionsMissingFromToc = body
    .filter((b) => b.canonicalId && !tocSet.has(b.canonicalId))
    .map((b) => b.canonicalLabel ?? b.sourceLabel);
  const missingCoreBodySections = toc
    .filter((t) => t.core && t.canonicalId && !bodySet.has(t.canonicalId))
    .map((t) => t.canonicalLabel ?? t.sourceLabel);

  const matchedSectionCount = toc.filter(
    (t) => t.canonicalId && bodySet.has(t.canonicalId),
  ).length;

  const coreSectionsNormalized = body.filter((b) => b.core).length;
  const genericSectionsPreserved = body.filter(
    (b) => !b.core && b.kind === 'recognized_generic',
  ).length;
  const unknownSectionsPreserved =
    body.filter((b) => b.kind === 'unknown_section').length + unknownToc.length;

  const reconciliation: SectionReconciliation = {
    tocSectionCount: toc.length,
    bodySectionCount: body.length,
    matchedSectionCount,
    missingBodySections,
    bodySectionsMissingFromToc,
    unknownSections: [
      ...unknownToc,
      ...body.filter((b) => !b.canonicalId).map((b) => b.sourceLabel),
    ],
    duplicateBodySections,
    totalSectionsDetected: body.length,
    coreSectionsNormalized,
    genericSectionsPreserved,
    unknownSectionsPreserved,
    missingCoreBodySections,
    tocAndBodySectionCountsMatch: toc.length === body.length && missingBodySections.length === 0,
  };

  return {
    toc,
    body,
    sections,
    reconciliation,
    truncated: false,
    bodyStartIndex: bodyStart,
  };
}

function emptyReconciliation(): SectionReconciliation {
  return {
    tocSectionCount: 0,
    bodySectionCount: 0,
    matchedSectionCount: 0,
    missingBodySections: [],
    bodySectionsMissingFromToc: [],
    unknownSections: [],
    duplicateBodySections: [],
    totalSectionsDetected: 0,
    coreSectionsNormalized: 0,
    genericSectionsPreserved: 0,
    unknownSectionsPreserved: 0,
    missingCoreBodySections: [],
    tocAndBodySectionCountsMatch: false,
  };
}

/** Back-compat wrapper used by existing tests/import paths. */
export function parseReportSections(text: string): {
  sections: ParsedSectionBody[];
  truncated: boolean;
  inventory: SectionInventoryResult;
} {
  const inventory = inventoryReportSections(text);
  return {
    sections: inventory.sections,
    truncated: inventory.truncated,
    inventory,
  };
}

export { normalizeSectionHeading, compactSectionHeading, resolveSectionHeading };
