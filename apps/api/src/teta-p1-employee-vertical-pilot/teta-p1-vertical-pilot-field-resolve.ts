import fs from 'fs';
import path from 'path';
import {
  fingerprint,
  P1_VERTICAL_LOGICAL_FIELDS,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  type PilotFieldBinding,
  type P1VerticalLogicalField,
  type P1VerticalSafetyCounters,
} from './teta-p1-vertical-pilot.types';

const DISPLAY: Record<P1VerticalLogicalField, string> = {
  employee_first_name: 'Imię',
  employee_last_name: 'Nazwisko',
  employee_number: 'Numer ewidencyjny',
  employee_birth_date: 'Data urodzenia',
};

/** Candidate physical columns by logical role — confirmed only if present in declaredColumnList. */
const CANDIDATE_COLUMNS: Record<P1VerticalLogicalField, string[]> = {
  employee_first_name: ['IMIE'],
  employee_last_name: ['NAZWISKO'],
  employee_number: ['NR_EWIDENCYJNY'],
  employee_birth_date: ['DATA_URODZENIA'],
};

export function loadAcceptedP1DeclaredColumns(repoRoot: string): {
  columns: string[];
  evidenceRefs: string[];
  available: boolean;
} {
  const envelopePath = path.join(
    repoRoot,
    '.local',
    'stage3k2b2b2b2',
    'ddl-envelope-assessment-v3.json',
  );
  const bindingsPath = path.join(
    repoRoot,
    'apps',
    'api',
    'config',
    'teta-business-semantic-bindings-v1.json',
  );
  const evidenceRefs: string[] = [];
  const columns = new Set<string>();

  if (fs.existsSync(envelopePath)) {
    const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8')) as {
      declaredOwner?: string;
      declaredViewName?: string;
      declaredColumnList?: string[];
      ddlEnvelopeParseStatus?: string;
    };
    if (
      envelope.declaredOwner === P1_VERTICAL_OWNER &&
      envelope.declaredViewName === P1_VERTICAL_OBJECT &&
      envelope.ddlEnvelopeParseStatus === 'parsed' &&
      Array.isArray(envelope.declaredColumnList)
    ) {
      for (const c of envelope.declaredColumnList) columns.add(String(c).toUpperCase());
      evidenceRefs.push('stage3k2b2b2b2:ddl-envelope-assessment-v3');
    }
  }

  if (fs.existsSync(bindingsPath)) {
    evidenceRefs.push('stage3d:teta-business-semantic-bindings-v1');
  }

  return { columns: [...columns].sort(), evidenceRefs, available: columns.size > 0 };
}

export function resolvePilotFields(input: {
  repoRoot: string;
  counters: P1VerticalSafetyCounters;
  /** Test overrides — must still appear in declared set when provided with declaredColumns. */
  declaredColumns?: string[];
  forceAmbiguous?: Partial<Record<P1VerticalLogicalField, string[]>>;
}): {
  bindings: PilotFieldBinding[];
  allResolvedExact: boolean;
  evidenceRefs: string[];
  sourceAvailable: boolean;
} {
  const loaded = loadAcceptedP1DeclaredColumns(input.repoRoot);
  const declared = new Set(
    (input.declaredColumns ?? loaded.columns).map((c) => c.toUpperCase()),
  );
  const evidenceBase = loaded.evidenceRefs;
  const bindings: PilotFieldBinding[] = [];

  for (const logicalField of P1_VERTICAL_LOGICAL_FIELDS) {
    const candidates =
      input.forceAmbiguous?.[logicalField] ?? CANDIDATE_COLUMNS[logicalField];
    const present = candidates.filter((c) => declared.has(c.toUpperCase()));
    let resolutionStatus: PilotFieldBinding['resolutionStatus'] = 'missing';
    let physicalColumn: string | null = null;
    const evidenceRefs = [...evidenceBase];

    if (present.length === 1) {
      physicalColumn = present[0]!;
      resolutionStatus = 'resolved_exact';
      evidenceRefs.push(`declaredColumn:${physicalColumn}`);
      if (
        logicalField !== 'employee_birth_date' &&
        ['employee_first_name', 'employee_last_name', 'employee_number'].includes(logicalField)
      ) {
        evidenceRefs.push(`stage3d_binding_role:${logicalField}`);
      }
      if (logicalField === 'employee_birth_date') {
        evidenceRefs.push('stage3k2b2b2b2:declaredColumnList:DATA_URODZENIA');
      }
    } else if (present.length > 1) {
      resolutionStatus = 'ambiguous';
      input.counters.ambiguousColumnsAutoSelected += 0; // do not auto-select
      evidenceRefs.push(`ambiguousCandidates:${present.join(',')}`);
    } else if (candidates.length && declared.size === 0) {
      resolutionStatus = 'missing';
      evidenceRefs.push('declaredColumnList_unavailable');
    } else {
      resolutionStatus = 'missing';
      evidenceRefs.push(`candidatesNotInView:${candidates.join(',')}`);
    }

    // Never guess a physical column that is not in the declared list
    if (physicalColumn && !declared.has(physicalColumn.toUpperCase())) {
      input.counters.guessedPhysicalColumns += 1;
      physicalColumn = null;
      resolutionStatus = 'missing';
    }

    bindings.push({
      logicalField,
      physicalColumn,
      resolutionStatus,
      evidenceRefs,
      resolutionFingerprint: fingerprint({
        logicalField,
        physicalColumn,
        resolutionStatus,
        present,
      }),
      displayHeader: DISPLAY[logicalField],
    });
  }

  if (bindings.some((b) => b.resolutionStatus === 'missing')) {
    // missingColumnsIgnored stays 0 — we block instead
  }

  return {
    bindings,
    allResolvedExact: bindings.every((b) => b.resolutionStatus === 'resolved_exact'),
    evidenceRefs: evidenceBase,
    sourceAvailable: loaded.available || Boolean(input.declaredColumns?.length),
  };
}
