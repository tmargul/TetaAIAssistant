/**
 * Stage 3B — deterministic entity extraction (no LLM, no guessing).
 */
import { stripDiacritics } from '../teta-plugins/teta-stage2c-label';
import type { PlannerConfigs } from './teta-intent-catalog';
import type {
  PlannerEntity,
  PlannerEntityType,
  PlannerIntentType,
  TetaPlanningRequest,
} from './teta-stage3b.types';

function pushEntity(
  out: PlannerEntity[],
  e: PlannerEntity,
): void {
  // de-dupe exact same type+normalized+span
  if (
    out.some(
      (x) =>
        x.type === e.type &&
        x.normalizedValue === e.normalizedValue &&
        x.sourceStart === e.sourceStart &&
        x.sourceEnd === e.sourceEnd,
    )
  ) {
    return;
  }
  out.push(e);
}

function findSpan(question: string, raw: string): { start: number; end: number } {
  const idx = question.indexOf(raw);
  if (idx >= 0) return { start: idx, end: idx + raw.length };
  const lowerQ = question.toLowerCase();
  const lowerR = raw.toLowerCase();
  const i2 = lowerQ.indexOf(lowerR);
  if (i2 >= 0) return { start: i2, end: i2 + raw.length };
  return { start: 0, end: 0 };
}

function monthToPeriod(
  monthName: string,
  year: string,
  language: PlannerConfigs['language'],
): string | null {
  const key = stripDiacritics(monthName).toLowerCase();
  const alt = monthName.toLowerCase();
  const m = language.monthNames[key] ?? language.monthNames[alt];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}`;
}

export function extractEntities(
  request: TetaPlanningRequest,
  configs: PlannerConfigs,
  intent: PlannerIntentType,
): PlannerEntity[] {
  const question = request.question;
  const out: PlannerEntity[] = [];

  // componentCode: składnik 4300
  {
    const re = /sk[łl]adnik(?:u|iem|owi|iem)?\s+(\d{3,5})\b/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      const raw = m[1]!;
      const span = findSpan(question, m[0]!);
      pushEntity(out, {
        type: 'componentCode',
        rawValue: raw,
        normalizedValue: raw,
        source: 'question',
        sourceStart: span.start,
        sourceEnd: span.end,
        confidence: 'exact',
        validationStatus: 'valid',
      });
    }
  }

  // componentValue: na 5200 zł / wyniósł 5200
  {
    const re = /(?:na|wynios[łl]a?|wyniósł|wyniosła)\s+(\d{2,7}(?:[.,]\d{1,2})?)\s*(?:z[łl]|pln)?/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      const raw = m[1]!.replace(',', '.');
      // avoid capturing component code if same number already taken as code nearby
      if (out.some((e) => e.type === 'componentCode' && e.normalizedValue === raw)) continue;
      const span = findSpan(question, m[1]!);
      pushEntity(out, {
        type: 'componentValue',
        rawValue: m[1]!,
        normalizedValue: raw,
        source: 'question',
        sourceStart: span.start,
        sourceEnd: span.end,
        confidence: 'exact',
        validationStatus: 'valid',
      });
    }
  }

  // employeeNumber: pracownika 00034 / nr ewidencyjny 00034
  {
    const re =
      /(?:pracownik(?:a|owi)?|nr\.?\s*ewidencyjn\w*|numerze?\s+ewidencyjn\w*)\s+(\d{3,8})\b/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      const raw = m[1]!;
      const span = findSpan(question, raw);
      pushEntity(out, {
        type: 'employeeNumber',
        rawValue: raw,
        normalizedValue: raw, // preserve leading zeros
        source: 'question',
        sourceStart: span.start,
        sourceEnd: span.end,
        confidence: 'exact',
        validationStatus: 'valid',
      });
    }
  }

  // payrollType: liście UC / lista UC / listy UC
  {
    const re = /\b(?:li[sś]cie|lista|listy)\s+(UC|U|ET|PL)\b/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      const raw = m[1]!;
      const span = findSpan(question, raw);
      pushEntity(out, {
        type: 'payrollType',
        rawValue: raw.toUpperCase(),
        normalizedValue: raw.toUpperCase() === 'UC' ? 'UC' : raw.toUpperCase(),
        source: 'question',
        sourceStart: span.start,
        sourceEnd: span.end,
        confidence: 'exact',
        validationStatus: 'valid',
        attributes: { preservedRaw: raw },
      });
    }
  }

  // payrollPeriod: luty 2026 / 02.2026 / 2026-02
  {
    const reMonth = /\b([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)\s+(20\d{2})\b/giu;
    let m: RegExpExecArray | null;
    while ((m = reMonth.exec(question))) {
      const period = monthToPeriod(m[1]!, m[2]!, configs.language);
      if (!period) continue;
      pushEntity(out, {
        type: 'payrollPeriod',
        rawValue: `${m[1]} ${m[2]}`,
        normalizedValue: period,
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
        attributes: { kind: 'absolute' },
      });
    }
    const reDot = /\b(0?[1-9]|1[0-2])[./](20\d{2})\b/g;
    while ((m = reDot.exec(question))) {
      const period = `${m[2]}-${String(m[1]).padStart(2, '0')}`;
      pushEntity(out, {
        type: 'payrollPeriod',
        rawValue: m[0]!,
        normalizedValue: period,
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
        attributes: { kind: 'absolute' },
      });
    }
    const reIso = /\b(20\d{2})-(0[1-9]|1[0-2])\b/g;
    while ((m = reIso.exec(question))) {
      pushEntity(out, {
        type: 'payrollPeriod',
        rawValue: m[0]!,
        normalizedValue: m[0]!,
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
        attributes: { kind: 'absolute' },
      });
    }
    const reDay = /\bna\s+dzie[nń]\s+(20\d{2}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]20\d{2})\b/giu;
    while ((m = reDay.exec(question))) {
      pushEntity(out, {
        type: 'dateRange',
        rawValue: m[1]!,
        normalizedValue: m[1]!,
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
        attributes: { kind: 'absolute', asOf: true },
      });
    }
  }

  // relative dates — never resolve to calendar date
  for (const rel of configs.language.relativeDateExpressions) {
    for (const pat of rel.patterns) {
      const re = new RegExp(pat, 'iu');
      const m = re.exec(question);
      if (!m) continue;
      pushEntity(out, {
        type: 'relativeDateRange',
        rawValue: m[0]!,
        normalizedValue: rel.expression,
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
        attributes: {
          kind: 'relative',
          expression: rel.expression,
          resolvedAt: null,
        },
      });
    }
  }

  // fileName / fileType
  {
    const re = /\b([\w.\-]+\.(xlsx|xls|csv|txt))\b/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      pushEntity(out, {
        type: 'fileName',
        rawValue: m[1]!,
        normalizedValue: m[1]!.toLowerCase(),
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[1]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
      });
      pushEntity(out, {
        type: 'fileType',
        rawValue: m[2]!,
        normalizedValue: m[2]!.toLowerCase(),
        source: 'question',
        sourceStart: m.index + m[1]!.length - m[2]!.length,
        sourceEnd: m.index + m[1]!.length,
        confidence: 'exact',
        validationStatus: 'valid',
      });
    }
  }

  // target tables: T_PRAC, L_STANOWISKA, L_STAWKI (uppercase identifiers)
  {
    const re = /\b([A-Z][A-Z0-9_]{2,})\b/g;
    let m: RegExpExecArray | null;
    const skip = new Set(['UC', 'U', 'ET', 'PL', 'BHP', 'XLSX', 'SQL', 'PK', 'UK', 'FK']);
    while ((m = re.exec(question))) {
      const raw = m[1]!;
      if (skip.has(raw)) continue;
      if (!/^(T_|L_|NT_|IMP_|KP_)/.test(raw) && !raw.includes('_')) continue;
      // require import/validation context or explicit "do TABLE"
      const before = question.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      if (
        !/import|do\s+$|tabel|constraint|xlsx|plik/.test(before) &&
        intent !== 'validate_import_file'
      ) {
        continue;
      }
      pushEntity(out, {
        type: 'targetTable',
        rawValue: raw,
        normalizedValue: raw.toUpperCase(),
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + raw.length,
        confidence: 'exact',
        validationStatus: 'valid',
      });
    }
  }

  // form: na formularzu X / formularzu X
  {
    const re = /(?:na\s+)?formularzu\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż0-9][A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż0-9\s]{1,60}?)(?:\?|$|\.)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      const raw = m[1]!.trim().replace(/\s+/g, ' ');
      pushEntity(out, {
        type: 'formName',
        rawValue: raw,
        normalizedValue: stripDiacritics(raw).toLowerCase(),
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'not_checked',
      });
    }
  }

  // field label: pole X
  {
    const re = /\bpole\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż0-9\s]{0,40}?)(?:\s+na\s+formularzu|\?|$|\.)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      const raw = m[1]!.trim().replace(/\s+/g, ' ');
      pushEntity(out, {
        type: 'fieldLabel',
        rawValue: raw,
        normalizedValue: stripDiacritics(raw).toLowerCase(),
        source: 'question',
        sourceStart: m.index,
        sourceEnd: m.index + m[0]!.length,
        confidence: 'exact',
        validationStatus: 'not_checked',
      });
    }
  }

  // report subject
  if (intent === 'build_employee_report' || /raport|bhp|um[oó]w/i.test(question)) {
    for (const subj of configs.language.reportSubjects) {
      for (const pat of subj.patterns) {
        const re = new RegExp(pat, 'iu');
        const m = re.exec(question);
        if (!m) continue;
        pushEntity(out, {
          type: 'reportSubject',
          rawValue: m[0]!,
          normalizedValue: subj.id,
          source: 'question',
          sourceStart: m.index,
          sourceEnd: m.index + m[0]!.length,
          confidence: 'exact',
          validationStatus: 'valid',
        });
      }
    }
  }

  // hints
  if (request.hints?.formGuid) {
    pushEntity(out, {
      type: 'formGuid',
      rawValue: request.hints.formGuid,
      normalizedValue: request.hints.formGuid.toLowerCase().replace(/[{}]/g, ''),
      source: 'hint',
      sourceStart: 0,
      sourceEnd: 0,
      confidence: 'contextual',
      validationStatus: 'valid',
    });
  }
  if (request.hints?.formName) {
    // question overrides when explicit formName already present
    if (!out.some((e) => e.type === 'formName' && e.source === 'question')) {
      pushEntity(out, {
        type: 'formName',
        rawValue: request.hints.formName,
        normalizedValue: stripDiacritics(request.hints.formName).toLowerCase(),
        source: 'hint',
        sourceStart: 0,
        sourceEnd: 0,
        confidence: 'contextual',
        validationStatus: 'not_checked',
      });
    }
  }

  // conversation context — only fill if question did not provide
  const ctx = request.conversationContext;
  if (ctx?.employeeIdentifiers?.length) {
    const hasEmployee = out.some(
      (e) => e.type === 'employeeNumber' || e.type === 'employeeId' || e.type === 'employeeName',
    );
    if (!hasEmployee) {
      for (const id of ctx.employeeIdentifiers) {
        const looksNumber = /^\d{3,8}$/.test(id);
        pushEntity(out, {
          type: looksNumber ? 'employeeNumber' : 'employeeId',
          rawValue: id,
          normalizedValue: id,
          source: 'context',
          sourceStart: 0,
          sourceEnd: 0,
          confidence: 'contextual',
          validationStatus: 'valid',
        });
      }
    }
  }
  if (ctx?.formContext?.formGuid && !out.some((e) => e.type === 'formGuid' && e.source === 'question')) {
    if (!out.some((e) => e.type === 'formGuid')) {
      pushEntity(out, {
        type: 'formGuid',
        rawValue: ctx.formContext.formGuid,
        normalizedValue: ctx.formContext.formGuid.toLowerCase().replace(/[{}]/g, ''),
        source: 'context',
        sourceStart: 0,
        sourceEnd: 0,
        confidence: 'contextual',
        validationStatus: 'valid',
      });
    }
  }
  if (ctx?.formContext?.formName && !out.some((e) => e.type === 'formName' && e.source === 'question')) {
    if (!out.some((e) => e.type === 'formName')) {
      pushEntity(out, {
        type: 'formName',
        rawValue: ctx.formContext.formName,
        normalizedValue: stripDiacritics(ctx.formContext.formName).toLowerCase(),
        source: 'context',
        sourceStart: 0,
        sourceEnd: 0,
        confidence: 'contextual',
        validationStatus: 'not_checked',
      });
    }
  }
  if (ctx?.fileContext?.fileName && !out.some((e) => e.type === 'fileName' && e.source === 'question')) {
    pushEntity(out, {
      type: 'fileName',
      rawValue: ctx.fileContext.fileName,
      normalizedValue: ctx.fileContext.fileName.toLowerCase(),
      source: 'context',
      sourceStart: 0,
      sourceEnd: 0,
      confidence: 'contextual',
      validationStatus: 'valid',
    });
  }

  // stable sort: sourceStart, type
  out.sort((a, b) => {
    if (a.sourceStart !== b.sourceStart) return a.sourceStart - b.sourceStart;
    return a.type.localeCompare(b.type);
  });

  return out;
}

export function hasEntity(entities: PlannerEntity[], types: PlannerEntityType[]): boolean {
  return entities.some((e) => types.includes(e.type));
}

export function entitiesOf(entities: PlannerEntity[], type: PlannerEntityType): PlannerEntity[] {
  return entities.filter((e) => e.type === type);
}
