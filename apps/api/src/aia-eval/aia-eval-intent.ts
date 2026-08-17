import { buildCurrentPositionExactQuestion } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position.types';
import { P1_VERTICAL_QUESTION } from '../teta-p1-employee-vertical-pilot/teta-p1-vertical-pilot.types';
import { P1_SURNAME_POSITION_QUESTION } from '../teta-p1-employee-vertical-pilot/teta-p1-surname-current-position.types';
import type { BusinessSlots, IntentMatch, RecognizedCapabilityId } from './aia-eval.types';

const ACCEPTED_SURNAME_PREFIX = 'A';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function lower(text: string): string {
  return normalize(text).toLowerCase();
}

export function extractEmployeeNumber(text: string): string | null {
  const patterns = [
    /numerze\s+ewidencyjnym\s+([0-9]+)/i,
    /nr\.?\s*ewidencyj(?:ym|nego)\s+([0-9]+)/i,
    /numer\s+ewidencyjny\s+([0-9]+)/i,
    /pracownik(?:a|u|owi)?\s+(?:o\s+)?(?:nr\.?\s*)?([0-9]{3,8})/i,
    /nr\.?\s+([0-9]{3,8})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function extractSurnamePrefix(text: string): string | null {
  const patterns = [
    /na\s+liter[ęe]\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])/i,
    /zaczyna\s+si[ęe]\s+na\s+(?:liter[ęe]\s+)?([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])/i,
    /nazwisko\s+(?:zaczyna\s+si[ęe]\s+na\s+)?([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

export function buildSurnamePrefixQuestion(prefix: string): string {
  const p = prefix.toUpperCase();
  return `Podaj imię, nazwisko, numer ewidencyjny i datę urodzenia pracowników, których nazwisko zaczyna się na literę ${p}.`;
}

export function buildSurnamePositionQuestion(prefix: string): string {
  const p = prefix.toUpperCase();
  return `Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracowników, których nazwisko zaczyna się na literę ${p}.`;
}

function inferBusinessConcept(text: string): string {
  const q = lower(text);
  if (/grup[ęe]\s+czasu\s+pracy|grupy\s+czasu\s+pracy/.test(q)) return 'grupa czasu pracy';
  if (/okres(?:y|ów)?\s+wypowied/i.test(q)) return 'okresy wypowiedzeń';
  if (/aktualne\s+stanowisko|stanowisko\s+pracownik/.test(q)) return 'current employee position';
  if (/nazwisk/.test(q) && /stanowisk/.test(q)) return 'employee surname prefix with current position';
  if (/nazwisk/.test(q)) return 'employee surname prefix';
  if (/słownik\s+personel/.test(q)) return 'personnel dictionary lookup';
  return normalize(text).slice(0, 120);
}

function hasPositionIntent(q: string): boolean {
  return /aktualne\s+stanowisko|stanowisko\s+pracownik|jakie\s+stanowisko/.test(q);
}

function hasSurnamePrefixIntent(q: string): boolean {
  return /nazwisk/.test(q) && (/zaczyna|liter[ęe]|początk/.test(q) || /na\s+[a-ząćęłńóśźż]/i.test(q));
}

function hasBirthDateIntent(q: string): boolean {
  return /dat[ęe]\s+urodzenia/.test(q);
}

export function matchIntent(rawQuestion: string): IntentMatch {
  const text = normalize(rawQuestion);
  const q = lower(text);
  const slots: BusinessSlots = {};

  if (/grup[ęe]\s+czasu\s+pracy|grupy\s+czasu\s+pracy/.test(q)) {
    const employeeNumber = extractEmployeeNumber(text);
    if (employeeNumber) slots.employeeNumber = employeeNumber;
    return {
      capabilityId: null,
      businessSlots: slots,
      canonicalQuestion: text,
      businessConcept: 'grupa czasu pracy',
      confidence: 'high',
    };
  }

  if (/okres(?:y|ów)?\s+wypowied/i.test(q)) {
    return {
      capabilityId: null,
      businessSlots: slots,
      canonicalQuestion: text,
      businessConcept: 'okresy wypowiedzeń',
      confidence: 'high',
    };
  }

  const employeeNumber = extractEmployeeNumber(text);
  const surnamePrefix = extractSurnamePrefix(text);
  if (employeeNumber) slots.employeeNumber = employeeNumber;
  if (surnamePrefix) slots.surnamePrefix = surnamePrefix;

  if (hasSurnamePrefixIntent(q) && hasPositionIntent(q)) {
    const prefix = surnamePrefix ?? ACCEPTED_SURNAME_PREFIX;
    slots.surnamePrefix = prefix;
    const canonical =
      prefix === ACCEPTED_SURNAME_PREFIX
        ? P1_SURNAME_POSITION_QUESTION
        : buildSurnamePositionQuestion(prefix);
    return {
      capabilityId:
        prefix === ACCEPTED_SURNAME_PREFIX
          ? 'employee_surname_prefix_with_position'
          : null,
      businessSlots: slots,
      canonicalQuestion: canonical,
      businessConcept: 'employee surname prefix with current position',
      confidence: prefix === ACCEPTED_SURNAME_PREFIX ? 'high' : 'low',
    };
  }

  if (hasSurnamePrefixIntent(q) && !hasPositionIntent(q)) {
    const prefix = surnamePrefix ?? ACCEPTED_SURNAME_PREFIX;
    slots.surnamePrefix = prefix;
    const canonical =
      prefix === ACCEPTED_SURNAME_PREFIX ? P1_VERTICAL_QUESTION : buildSurnamePrefixQuestion(prefix);
    const capabilityId: RecognizedCapabilityId =
      prefix === ACCEPTED_SURNAME_PREFIX && !hasBirthDateIntent(q)
        ? 'employee_surname_prefix'
        : prefix === ACCEPTED_SURNAME_PREFIX && hasBirthDateIntent(q)
          ? 'employee_surname_prefix'
          : null;
    return {
      capabilityId,
      businessSlots: slots,
      canonicalQuestion: canonical,
      businessConcept: 'employee surname prefix',
      confidence: prefix === ACCEPTED_SURNAME_PREFIX ? 'high' : 'low',
    };
  }

  if (hasPositionIntent(q) && employeeNumber) {
    const canonical = buildCurrentPositionExactQuestion(employeeNumber);
    return {
      capabilityId: 'employee_current_position',
      businessSlots: slots,
      canonicalQuestion: canonical,
      businessConcept: 'current employee position',
      confidence: 'high',
    };
  }

  return {
    capabilityId: null,
    businessSlots: slots,
    canonicalQuestion: text,
    businessConcept: inferBusinessConcept(text),
    confidence: 'low',
  };
}

export const CAPABILITY_USER_LABELS: Record<
  Exclude<RecognizedCapabilityId, null>,
  string
> = {
  employee_surname_prefix: 'wyszukanie pracowników po początku nazwiska',
  employee_current_position: 'aktualne stanowisko pracownika',
  employee_surname_prefix_with_position:
    'pracownicy po początku nazwiska + aktualne stanowisko',
};
