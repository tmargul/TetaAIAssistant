/**
 * Stage 3I — detect Teta "Wydruk parametrów płacowych" RTF (content evidence, not filename).
 */
import type {
  PayrollReportValidationStatus,
  ReportDateParseStatus,
} from './teta-payroll-snapshot.types';
import { loadPayrollSectionCatalog } from './teta-payroll-section-catalog';

export type PayrollReportDetection = {
  status: PayrollReportValidationStatus;
  reasons: string[];
  kpVersion: string | null;
  paVersion: string | null;
  reportGeneratedAt: string | null;
  reportDateParseStatus: ReportDateParseStatus;
  reportDateSourceEvidence: string | null;
  companyScope: string[];
  hasContents: boolean;
  hasComponents: boolean;
  hasCoreColumns: boolean;
  optionalSectionsFound: string[];
};

const REQUIRED_PHRASE = 'RAPORT PRZYGOTOWANY DLA FIRM';
const CONTENTS = 'ZAWARTOŚĆ RAPORTU';
const COMPONENTS = 'SKŁADNIKI PŁACOWE';

function hasCoreColumns(text: string): boolean {
  const head = text.slice(0, 80_000).toUpperCase();
  const hasId = /\bID\b/.test(head);
  const hasKod = /\bKOD\b/.test(head);
  const hasTitle = /TYTU[ŁL]/.test(head) || /\bNAZWA\b/.test(head);
  const hasType = /(^|\s)T(\s|$)/m.test(head) || /\bTYP\b/.test(head);
  const hasFormula = /WZ[ÓO]R/.test(head);
  return hasId && hasKod && hasTitle && (hasType || hasFormula);
}

function parseVersions(text: string): { kp: string | null; pa: string | null } {
  const head = text.slice(0, 30_000);
  const kp =
    /kp\s*ver\s*:\s*([\d.]+)/i.exec(head)?.[1] ??
    /\bKP\s*[:=]?\s*(v?\d+(?:\.\d+){1,})/i.exec(head)?.[1] ??
    null;
  const pa =
    /pa\s*ver\s*:\s*([\d.]+)/i.exec(head)?.[1] ??
    /\bPA\s*[:=]?\s*(v?\d+(?:\.\d+){1,})/i.exec(head)?.[1] ??
    null;
  return { kp, pa };
}

function parseGeneratedAt(text: string): {
  reportGeneratedAt: string | null;
  reportDateParseStatus: ReportDateParseStatus;
  reportDateSourceEvidence: string | null;
} {
  const head = text.slice(0, 30_000);
  // Soft-broken ISO date near header: "2020-05-2 2" → 2020-05-22
  const spaced = /(\d{4})[-./](\d{1,2})[-./](\d)\s+(\d)(?=\s)/.exec(head);
  if (spaced) {
    const y = spaced[1]!;
    const m = spaced[2]!.padStart(2, '0');
    const d = `${spaced[3]}${spaced[4]}`;
    const iso = `${y}-${m}-${d.padStart(2, '0')}`;
    return {
      reportGeneratedAt: iso,
      reportDateParseStatus: 'exact',
      reportDateSourceEvidence: spaced[0]!.trim(),
    };
  }
  const iso = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(head);
  if (iso) {
    const value = `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`;
    return {
      reportGeneratedAt: value,
      reportDateParseStatus: 'best_effort',
      reportDateSourceEvidence: iso[0]!,
    };
  }
  const dmy = /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/.exec(head);
  if (dmy) {
    const value = `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
    return {
      reportGeneratedAt: value,
      reportDateParseStatus: 'best_effort',
      reportDateSourceEvidence: dmy[0]!,
    };
  }
  return {
    reportGeneratedAt: null,
    reportDateParseStatus: 'unrecognized',
    reportDateSourceEvidence: null,
  };
}

function parseCompanyScope(text: string): string[] {
  const idx = text.indexOf(REQUIRED_PHRASE);
  if (idx < 0) return [];
  const window = text.slice(idx, idx + 400);
  const lines = window
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const scope: string[] = [];
  for (const line of lines.slice(1, 6)) {
    if (line.includes(CONTENTS) || line.includes(COMPONENTS)) break;
    if (line.length > 2 && line.length < 80 && !/ZAWARTO|SKŁADNIKI|RAPORT/i.test(line)) {
      scope.push(line.replace(/\t/g, ' ').slice(0, 80));
    }
  }
  return scope.slice(0, 5);
}

export function detectPayrollParametersReport(text: string): PayrollReportDetection {
  const reasons: string[] = [];
  const empty = {
    kpVersion: null as string | null,
    paVersion: null as string | null,
    reportGeneratedAt: null as string | null,
    reportDateParseStatus: 'unrecognized' as ReportDateParseStatus,
    reportDateSourceEvidence: null as string | null,
    companyScope: [] as string[],
    hasContents: false,
    hasComponents: false,
    hasCoreColumns: false,
    optionalSectionsFound: [] as string[],
  };

  if (!text || text.trim().length < 32) {
    return {
      status: 'malformed_rtf',
      reasons: ['empty_text'],
      ...empty,
    };
  }

  const hasPhrase = text.includes(REQUIRED_PHRASE);
  const hasContents = text.includes(CONTENTS);
  const hasComponents = text.includes(COMPONENTS);
  const coreColumnsOk = hasCoreColumns(text);
  const catalog = loadPayrollSectionCatalog();
  const optionalSectionsFound = catalog.sections
    .filter((s) => !s.core)
    .map((s) => s.canonicalLabel)
    .filter(
      (label) =>
        text.includes(label) || text.toLocaleUpperCase('pl-PL').includes(label),
    );

  if (/FORMUŁY KLAKULACYJNE/i.test(text) && !optionalSectionsFound.includes('FORMUŁY KALKULACYJNE')) {
    optionalSectionsFound.push('FORMUŁY KALKULACYJNE');
  }

  if (!hasPhrase) reasons.push('missing_report_prepared_for_firms');
  if (!hasContents) reasons.push('missing_contents_section');
  if (!hasComponents) reasons.push('missing_components_section');
  if (!coreColumnsOk) reasons.push('missing_core_columns');

  const { kp, pa } = parseVersions(text);
  const dateInfo = parseGeneratedAt(text);
  const companyScope = parseCompanyScope(text);

  const base = {
    kpVersion: kp,
    paVersion: pa,
    reportGeneratedAt: dateInfo.reportGeneratedAt,
    reportDateParseStatus: dateInfo.reportDateParseStatus,
    reportDateSourceEvidence: dateInfo.reportDateSourceEvidence,
    companyScope,
    hasContents,
    hasComponents,
    hasCoreColumns: coreColumnsOk,
    optionalSectionsFound: [...optionalSectionsFound],
  };

  if (!hasPhrase && !hasComponents) {
    return { status: 'unsupported_rtf_report', reasons, ...base };
  }

  if (!hasPhrase || !hasContents || !hasComponents || !coreColumnsOk) {
    return { status: 'incomplete_payroll_parameters_report', reasons, ...base };
  }

  return {
    status: 'valid_payroll_parameters_report',
    reasons: [],
    ...base,
  };
}
