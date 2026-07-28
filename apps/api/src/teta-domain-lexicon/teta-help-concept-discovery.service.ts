/**
 * Stage 3J.1 — read-only Help concept discovery from Stage 3A canonical graph.
 * No Oracle, LLM, Qdrant, raw HTML storage, or auto-approval.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { defaultStage3aPaths } from '../teta-plugins/teta-stage3a.index';
import { sha256, stableStringify } from './teta-domain-lexicon-contract';
import { classifyDomainFromHelpSignals, isGenericHelpLabel } from './teta-domain-lexicon-help-classifier';
import { normalizePolishText } from './teta-polish-text-normalizer';
import type {
  DomainClassificationConfidence,
  HelpConceptCandidate,
  HelpCoverageReport,
  TetaDomainRegistry,
} from './teta-domain-lexicon.types';

type FormRow = {
  form_id: string;
  form_name: string | null;
  form_type: string | null;
  owner: string | null;
  has_help: number;
};

type HelpFieldRow = {
  field_id: string;
  field_name: string | null;
  form_id: string | null;
  form_name: string | null;
  form_type: string | null;
  owner: string | null;
};

export type HelpCoverageReconciliation = {
  registeredForms: number;
  helpDocumentsInGraph: number;
  formsWithValidHelpEdge: number;
  helpDocumentsWithoutRegisteredForm: number;
  registeredFormsWithMultipleHelpDocuments: number;
  invalidOrExcludedHelpDocuments: number;
  finalFormsWithHelp: number;
  differenceHelpDocumentsVsFinalFormsWithHelp: number;
  differenceReason: string;
};

export type CandidateDerivation = {
  rawHelpCandidateLabels: number;
  candidatesAfterGenericFiltering: number;
  candidatesAfterDeduplication: number;
  candidateConcepts: number;
  duplicateCandidatesMerged: number;
  genericLabelsPreventedFromGlobalApproval: number;
};

export type TimeAttendanceDiagnostic = {
  contractVersion: 'teta-aia-help-time-attendance-classification-v1';
  phrasesExamined: string[];
  examinedForms: Array<{
    formNodeId: string;
    helpDocumentNodeId: string | null;
    formName: string | null;
    formTypeName: string | null;
    matchedPhrase: string;
    classifierDecision: Array<{ domainId: string; confidence: string; reason?: string }>;
    classifiedAsTimeAndAttendance: boolean;
    reasonIfNot: string | null;
  }>;
  metrics: {
    timeAttendanceCandidateFormsExamined: number;
    timeAttendanceFormsClassified: number;
    timeAttendanceFormsRemainingUnclassified: number;
    timeAttendanceClassificationEvidenceMissing: number;
  };
  moduleMappingsApplied: string[];
  notes: string[];
};

export type HelpDiscoveryResult = {
  candidates: HelpConceptCandidate[];
  coverage: HelpCoverageReport;
  reconciliation: HelpCoverageReconciliation;
  candidateDerivation: CandidateDerivation;
  timeAttendanceDiagnostic: TimeAttendanceDiagnostic;
  warnings: string[];
};

const TIME_ATTENDANCE_PHRASES = [
  'ewidencja czasu pracy',
  'harmonogram',
  'absencje',
  'czas pracy',
  'rcp',
  'rejestracja czasu',
  'odbicie',
];

function resolveRepoRoot(cwd: string): string {
  const candidates = [cwd, path.resolve(cwd, '../..'), path.resolve(cwd, '../../..')];
  for (const root of candidates) {
    if (existsSync(path.join(root, 'apps', 'api')) && existsSync(path.join(root, '.local'))) return root;
  }
  return path.resolve(cwd, '../..');
}

function openStage3aReadonly(repoRoot: string): Database.Database | null {
  const { indexPath } = defaultStage3aPaths(repoRoot);
  if (!existsSync(indexPath)) return null;
  const db = new Database(indexPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

function emptyCoverage(): HelpCoverageReport {
  return {
    contractVersion: 'teta-aia-help-domain-coverage-v1',
    formsTotal: 0,
    formsWithHelp: 0,
    helpCoveragePercent: 0,
    helpFieldCount: 0,
    candidateConcepts: 0,
    genericLabelsPreventedFromGlobalApproval: 0,
    rawHelpCandidateLabels: 0,
    candidatesAfterGenericFiltering: 0,
    candidatesAfterDeduplication: 0,
    duplicateCandidatesMerged: 0,
    helpAutoApprovedConcepts: 0,
    reconciliation: {
      registeredForms: 0,
      helpDocumentsInGraph: 0,
      formsWithValidHelpEdge: 0,
      helpDocumentsWithoutRegisteredForm: 0,
      registeredFormsWithMultipleHelpDocuments: 0,
      invalidOrExcludedHelpDocuments: 0,
      finalFormsWithHelp: 0,
      differenceHelpDocumentsVsFinalFormsWithHelp: 0,
      differenceReason: 'stage3a_index_missing',
    },
    perDomain: [],
    helpActionCount: null,
    helpDocumentsWithActions: null,
    helpDocumentsWithActionsUnavailable: true,
    helpDocumentsWithActionsUnavailableReason: 'stage3a_index_missing',
    helpActionsUsedAsCandidates: null,
    helpActionsUnavailableFromGraph: 1,
    helpActionsUnavailableReason: 'stage3a_index_missing',
    orphanHelpActions: null,
    actionsWithoutHelpEvidence: null,
    fingerprintSha256: sha256('empty'),
  };
}

function loadRegistryDomainIds(repoRoot: string): string[] {
  const registryPath = path.join(
    repoRoot,
    'apps/api/config/teta-domain-lexicon/teta-domain-registry-v1.json',
  );
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TetaDomainRegistry;
  return registry.domains.filter((d) => d.status === 'approved').map((d) => d.domainId).sort();
}

function emptyTimeAttendance(): TimeAttendanceDiagnostic {
  return {
    contractVersion: 'teta-aia-help-time-attendance-classification-v1',
    phrasesExamined: TIME_ATTENDANCE_PHRASES,
    examinedForms: [],
    metrics: {
      timeAttendanceCandidateFormsExamined: 0,
      timeAttendanceFormsClassified: 0,
      timeAttendanceFormsRemainingUnclassified: 0,
      timeAttendanceClassificationEvidenceMissing: 0,
    },
    moduleMappingsApplied: [],
    notes: ['stage3a_index_missing'],
  };
}

export function buildTimeAttendanceDiagnostic(db: Database.Database): TimeAttendanceDiagnostic {
  const examinedForms: TimeAttendanceDiagnostic['examinedForms'] = [];
  const seen = new Set<string>();
  const moduleMappingsApplied = new Set<string>();

  for (const phrase of TIME_ATTENDANCE_PHRASES) {
    const rows = db
      .prepare(
        `select f.id as form_id, f.name as form_name, f.canonical_name as form_type,
                (select e.to_id from kg_edges e where e.from_id = f.id and e.type = 'HAS_HELP' limit 1) as help_id
         from kg_nodes f
         where f.type = 'application_form'
           and (
             lower(coalesce(f.name,'')) like ?
             or lower(coalesce(f.canonical_name,'')) like ?
             or lower(coalesce(f.normalized_name,'')) like ?
           )
         limit 200`,
      )
      .all(`%${phrase}%`, `%${phrase}%`, `%${phrase}%`) as Array<{
      form_id: string;
      form_name: string | null;
      form_type: string | null;
      help_id: string | null;
    }>;

    for (const row of rows) {
      if (seen.has(row.form_id)) continue;
      seen.add(row.form_id);
      const decision = classifyDomainFromHelpSignals({
        formName: row.form_name,
        formTypeName: row.form_type,
      });
      const classifiedAsTimeAndAttendance = decision.some(
        (d) => d.domainId === 'time_and_attendance' && d.confidence !== 'unclassified' && d.confidence !== 'ambiguous',
      );
      for (const d of decision) {
        if (d.reason?.startsWith('approved_module')) moduleMappingsApplied.add(d.reason);
      }
      let reasonIfNot: string | null = null;
      if (!classifiedAsTimeAndAttendance) {
        if (decision.every((d) => d.confidence === 'ambiguous')) {
          reasonIfNot = `ambiguous_domains:${decision.map((d) => d.domainId).join(',')}`;
        } else if (decision.some((d) => d.domainId === 'hr')) {
          reasonIfNot = `classified_as_hr_due_to:${decision.find((d) => d.domainId === 'hr')?.reason ?? 'hr_signal'}`;
        } else if (decision.every((d) => d.confidence === 'unclassified')) {
          reasonIfNot = 'classification_evidence_missing';
        } else {
          reasonIfNot = `classified_as:${decision.map((d) => `${d.domainId}:${d.confidence}`).join(',')}`;
        }
      }
      examinedForms.push({
        formNodeId: row.form_id,
        helpDocumentNodeId: row.help_id,
        formName: row.form_name,
        formTypeName: row.form_type,
        matchedPhrase: phrase,
        classifierDecision: decision,
        classifiedAsTimeAndAttendance,
        reasonIfNot,
      });
    }
  }

  const classified = examinedForms.filter((f) => f.classifiedAsTimeAndAttendance).length;
  const evidenceMissing = examinedForms.filter((f) => f.reasonIfNot === 'classification_evidence_missing').length;
  return {
    contractVersion: 'teta-aia-help-time-attendance-classification-v1',
    phrasesExamined: TIME_ATTENDANCE_PHRASES,
    examinedForms: examinedForms.sort((a, b) => a.formNodeId.localeCompare(b.formNodeId)),
    metrics: {
      timeAttendanceCandidateFormsExamined: examinedForms.length,
      timeAttendanceFormsClassified: classified,
      timeAttendanceFormsRemainingUnclassified: examinedForms.length - classified,
      timeAttendanceClassificationEvidenceMissing: evidenceMissing,
    },
    moduleMappingsApplied: [...moduleMappingsApplied].sort(),
    notes: [
      'Diagnostic is read-only against Stage 3A graph.',
      'Approved module mapping plgRCP → time_and_attendance applied when namespace evidence is present.',
      'No business concepts for time_and_attendance were auto-approved.',
    ],
  };
}

export function writeTimeAttendanceDiagnosticArtifact(
  diagnostic: TimeAttendanceDiagnostic,
  repoRoot: string,
): string {
  const out = path.join(repoRoot, '.local', 'AIA_TETA_HELP_TIME_ATTENDANCE_CLASSIFICATION_STAGE3J1.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  return out;
}

export function discoverHelpConceptCandidates(repoRoot?: string): HelpDiscoveryResult {
  const root = repoRoot ?? resolveRepoRoot(process.cwd());
  const db = openStage3aReadonly(root);
  const warnings: string[] = [];
  if (!db) {
    warnings.push('stage3a_index_missing');
    return {
      candidates: [],
      coverage: emptyCoverage(),
      reconciliation: emptyCoverage().reconciliation!,
      candidateDerivation: {
        rawHelpCandidateLabels: 0,
        candidatesAfterGenericFiltering: 0,
        candidatesAfterDeduplication: 0,
        candidateConcepts: 0,
        duplicateCandidatesMerged: 0,
        genericLabelsPreventedFromGlobalApproval: 0,
      },
      timeAttendanceDiagnostic: emptyTimeAttendance(),
      warnings,
    };
  }

  try {
    const registeredForms = (
      db.prepare("select count(*) as c from kg_nodes where type='application_form'").get() as { c: number }
    ).c;
    const helpDocumentsInGraph = (
      db.prepare("select count(*) as c from kg_nodes where type='help_document'").get() as { c: number }
    ).c;
    const formsWithValidHelpEdge = (
      db
        .prepare(
          `select count(distinct e.from_id) as c
           from kg_edges e
           join kg_nodes n on n.id = e.from_id
           join kg_nodes h on h.id = e.to_id
           where e.type = 'HAS_HELP' and n.type = 'application_form' and h.type = 'help_document'`,
        )
        .get() as { c: number }
    ).c;
    const helpDocumentsWithoutRegisteredForm = (
      db
        .prepare(
          `select count(*) as c from kg_nodes hd
           where hd.type='help_document'
             and not exists (
               select 1 from kg_edges e
               join kg_nodes f on f.id=e.from_id and f.type='application_form'
               where e.to_id=hd.id and e.type='HAS_HELP'
             )`,
        )
        .get() as { c: number }
    ).c;
    const registeredFormsWithMultipleHelpDocuments = (
      db
        .prepare(
          `select count(*) as c from (
             select e.from_id from kg_edges e
             join kg_nodes n on n.id=e.from_id and n.type='application_form'
             where e.type='HAS_HELP'
             group by e.from_id having count(*)>1
           )`,
        )
        .get() as { c: number }
    ).c;
    const invalidOrExcludedHelpDocuments = Math.max(0, helpDocumentsInGraph - formsWithValidHelpEdge - helpDocumentsWithoutRegisteredForm);
    const finalFormsWithHelp = formsWithValidHelpEdge;
    const reconciliation: HelpCoverageReconciliation = {
      registeredForms,
      helpDocumentsInGraph,
      formsWithValidHelpEdge,
      helpDocumentsWithoutRegisteredForm,
      registeredFormsWithMultipleHelpDocuments,
      invalidOrExcludedHelpDocuments,
      finalFormsWithHelp,
      differenceHelpDocumentsVsFinalFormsWithHelp: helpDocumentsInGraph - finalFormsWithHelp,
      differenceReason:
        helpDocumentsInGraph === finalFormsWithHelp
          ? 'help_documents_equal_forms_with_valid_help_edge'
          : helpDocumentsWithoutRegisteredForm > 0
            ? 'orphan_help_documents_without_registered_form'
            : 'graph_help_document_count_differs_from_forms_with_valid_help_edge',
    };

    const helpFieldCount = (db.prepare("select count(*) as c from kg_nodes where type='help_field'").get() as { c: number }).c;

    const formRows = db
      .prepare(
        `select f.id as form_id, f.name as form_name, f.canonical_name as form_type, f.owner as owner,
                case when exists(select 1 from kg_edges e where e.from_id = f.id and e.type='HAS_HELP') then 1 else 0 end as has_help
         from kg_nodes f
         where f.type = 'application_form'`,
      )
      .all() as FormRow[];

    const fieldRows = db
      .prepare(
        `select hf.id as field_id, hf.name as field_name,
                f.id as form_id, f.name as form_name, f.canonical_name as form_type, f.owner as owner
         from kg_nodes hf
         join kg_edges d on d.to_id = hf.id and d.type = 'DESCRIBES'
         join kg_nodes hd on hd.id = d.from_id and hd.type = 'help_document'
         join kg_edges hh on hh.to_id = hd.id and hh.type = 'HAS_HELP'
         join kg_nodes f on f.id = hh.from_id and f.type = 'application_form'
         where hf.type = 'help_field' and hf.name is not null`,
      )
      .all() as HelpFieldRow[];

    const labelMap = new Map<string, HelpConceptCandidate>();
    let rawHelpCandidateLabels = 0;
    let genericLabelsPreventedFromGlobalApproval = 0;
    let duplicateCandidatesMerged = 0;

    for (const row of fieldRows) {
      const label = String(row.field_name ?? '').trim();
      if (!label || label.length < 2) continue;
      rawHelpCandidateLabels += 1;
      const normalizedLabel = normalizePolishText(label).normalizedExact;
      if (isGenericHelpLabel(normalizedLabel)) {
        genericLabelsPreventedFromGlobalApproval += 1;
        continue;
      }
      const domainCandidates = classifyDomainFromHelpSignals({
        formName: row.form_name,
        formTypeName: row.form_type,
        owner: row.owner,
      });
      const candidateId = sha256(`${normalizedLabel}:${row.field_id}`).slice(0, 16);
      const existing = labelMap.get(normalizedLabel);
      const evidence = {
        nodeId: row.field_id,
        nodeType: 'help_field',
        evidencePath: `form:${row.form_id}/help-field:${row.field_id}`,
      };
      if (existing) {
        duplicateCandidatesMerged += 1;
        existing.applicationEvidence.push(evidence);
        for (const dc of domainCandidates) {
          if (!existing.domainCandidates.some((x) => x.domainId === dc.domainId)) {
            existing.domainCandidates.push(dc);
          }
        }
        if (existing.domainCandidates.filter((d) => d.confidence !== 'unclassified').length > 1) {
          existing.status = 'ambiguous';
        }
        continue;
      }
      labelMap.set(normalizedLabel, {
        candidateId,
        candidateLabel: label,
        normalizedLabel,
        domainCandidates,
        conceptKindCandidates: ['attribute'],
        status: domainCandidates.some((d) => d.confidence === 'ambiguous') ? 'ambiguous' : 'discovered_from_help',
        aliases: [label],
        definitions: [],
        applicationEvidence: [evidence],
        technicalEvidence: [{ nodeId: row.field_id, nodeType: 'help_field' }],
        sourceScope: 'global',
        productVersion: null,
      });
    }

    const candidates = [...labelMap.values()].sort((a, b) => a.normalizedLabel.localeCompare(b.normalizedLabel));
    const candidatesAfterGenericFiltering = rawHelpCandidateLabels - genericLabelsPreventedFromGlobalApproval;
    const candidatesAfterDeduplication = candidates.length;
    const candidateDerivation: CandidateDerivation = {
      rawHelpCandidateLabels,
      candidatesAfterGenericFiltering,
      candidatesAfterDeduplication,
      candidateConcepts: candidatesAfterDeduplication,
      duplicateCandidatesMerged,
      genericLabelsPreventedFromGlobalApproval,
    };

    const perDomainMap = new Map<
      string,
      {
        formsWithHelp: number;
        helpDiscoveredCandidates: number;
        helpAutoApprovedConcepts: number;
        confidence: DomainClassificationConfidence;
      }
    >();

    for (const form of formRows) {
      const domains = classifyDomainFromHelpSignals({
        formName: form.form_name,
        formTypeName: form.form_type,
        owner: form.owner,
      });
      for (const d of domains) {
        if (d.confidence === 'unclassified' || d.confidence === 'ambiguous') continue;
        const bucket = perDomainMap.get(d.domainId) ?? {
          formsWithHelp: 0,
          helpDiscoveredCandidates: 0,
          helpAutoApprovedConcepts: 0,
          confidence: 'unclassified' as DomainClassificationConfidence,
        };
        if (form.has_help) bucket.formsWithHelp += 1;
        if (bucket.confidence === 'unclassified') bucket.confidence = d.confidence;
        perDomainMap.set(d.domainId, bucket);
      }
    }

    for (const c of candidates) {
      for (const d of c.domainCandidates) {
        if (d.confidence === 'unclassified' || d.confidence === 'ambiguous') continue;
        const bucket = perDomainMap.get(d.domainId) ?? {
          formsWithHelp: 0,
          helpDiscoveredCandidates: 0,
          helpAutoApprovedConcepts: 0,
          confidence: 'candidate' as DomainClassificationConfidence,
        };
        bucket.helpDiscoveredCandidates += 1;
        bucket.confidence = 'candidate';
        perDomainMap.set(d.domainId, bucket);
      }
    }

    const timeAttendanceDiagnostic = buildTimeAttendanceDiagnostic(db);
    writeTimeAttendanceDiagnosticArtifact(timeAttendanceDiagnostic, root);

    const helpActionCount = (
      db
        .prepare(
          `select count(distinct e.to_id) as c from kg_edges e
           join kg_nodes a on a.id = e.to_id and a.type = 'action_control'
           join kg_nodes h on h.id = e.from_id and h.type = 'help_field'
           where e.type = 'DESCRIBES'`,
        )
        .get() as { c: number }
    ).c;

    const helpDocumentsWithActionsDirect = (
      db
        .prepare(
          `select count(distinct hd.id) as c
           from kg_nodes hd
           join kg_edges d on d.from_id = hd.id and d.type = 'DESCRIBES'
           join kg_nodes a on a.id = d.to_id and a.type = 'action_control'
           where hd.type = 'help_document'`,
        )
        .get() as { c: number }
    ).c;

    const helpDocumentsWithActionsViaField = (
      db
        .prepare(
          `select count(distinct hd.id) as c
           from kg_nodes hd
           join kg_edges d1 on d1.from_id = hd.id and d1.type = 'DESCRIBES'
           join kg_nodes hf on hf.id = d1.to_id and hf.type = 'help_field'
           join kg_edges d2 on d2.from_id = hf.id and d2.type = 'DESCRIBES'
           join kg_nodes a on a.id = d2.to_id and a.type = 'action_control'
           where hd.type = 'help_document'`,
        )
        .get() as { c: number }
    ).c;

    const documentActionLinks = db
      .prepare(
        `select distinct hd.id as helpDocumentId, a.id as actionControlId
         from kg_nodes hd
         join kg_edges d1 on d1.from_id = hd.id and d1.type = 'DESCRIBES'
         join kg_nodes hf on hf.id = d1.to_id and hf.type = 'help_field'
         join kg_edges d2 on d2.from_id = hf.id and d2.type = 'DESCRIBES'
         join kg_nodes a on a.id = d2.to_id and a.type = 'action_control'
         where hd.type = 'help_document'
         union
         select distinct hd.id as helpDocumentId, a.id as actionControlId
         from kg_nodes hd
         join kg_edges d on d.from_id = hd.id and d.type = 'DESCRIBES'
         join kg_nodes a on a.id = d.to_id and a.type = 'action_control'
         where hd.type = 'help_document'`,
      )
      .all() as Array<{ helpDocumentId: string; actionControlId: string }>;

    const reconciledDocs = reconcileHelpDocumentsWithActions({
      helpActionCount,
      linkedDocumentCount: Math.max(helpDocumentsWithActionsDirect, helpDocumentsWithActionsViaField),
      uniqueDocumentsFromLinks: countUniqueHelpDocumentsWithActions(documentActionLinks),
    });

    const registeredDomainIds = loadRegistryDomainIds(root);
    const perDomain = registeredDomainIds.map((domainId) => {
      if (domainId === 'core') {
        return {
          domainId,
          formsWithHelp: 0,
          helpDiscoveredCandidates: 0,
          helpAutoApprovedConcepts: 0,
          classificationConfidence: 'not_applicable' as const,
        };
      }
      const stats = perDomainMap.get(domainId);
      return {
        domainId,
        formsWithHelp: stats?.formsWithHelp ?? 0,
        helpDiscoveredCandidates: stats?.helpDiscoveredCandidates ?? 0,
        helpAutoApprovedConcepts: 0,
        classificationConfidence:
          stats && (stats.helpDiscoveredCandidates > 0 || stats.formsWithHelp > 0)
            ? ((stats.confidence === 'unclassified' ? 'candidate' : stats.confidence) as DomainClassificationConfidence)
            : ('unclassified' as const),
      };
    });

    const coverageBase = {
      contractVersion: 'teta-aia-help-domain-coverage-v1' as const,
      formsTotal: registeredForms,
      formsWithHelp: finalFormsWithHelp,
      helpCoveragePercent: registeredForms
        ? Math.round((finalFormsWithHelp / registeredForms) * 10000) / 100
        : 0,
      helpFieldCount,
      candidateConcepts: candidateDerivation.candidateConcepts,
      genericLabelsPreventedFromGlobalApproval,
      rawHelpCandidateLabels: candidateDerivation.rawHelpCandidateLabels,
      candidatesAfterGenericFiltering: candidateDerivation.candidatesAfterGenericFiltering,
      candidatesAfterDeduplication: candidateDerivation.candidatesAfterDeduplication,
      duplicateCandidatesMerged: candidateDerivation.duplicateCandidatesMerged,
      helpAutoApprovedConcepts: 0,
      reconciliation,
      perDomain,
      helpActionCount,
      helpDocumentsWithActions: reconciledDocs.helpDocumentsWithActions,
      helpDocumentsWithActionsUnavailable: reconciledDocs.helpDocumentsWithActionsUnavailable,
      helpDocumentsWithActionsUnavailableReason: reconciledDocs.helpDocumentsWithActionsUnavailableReason,
      helpActionsUsedAsCandidates: helpActionCount,
      helpActionsUnavailableFromGraph: 0,
      helpActionsUnavailableReason: null as string | null,
      orphanHelpActions: reconciledDocs.orphanHelpActions,
      actionsWithoutHelpEvidence: reconciledDocs.actionsWithoutHelpEvidence,
    };
    const coverage: HelpCoverageReport = {
      ...coverageBase,
      fingerprintSha256: sha256(stableStringify(coverageBase)),
    };

    return {
      candidates,
      coverage,
      reconciliation,
      candidateDerivation,
      timeAttendanceDiagnostic,
      warnings,
    };
  } finally {
    db.close();
  }
}

export function buildHelpCoverageReport(repoRoot?: string): HelpCoverageReport {
  return discoverHelpConceptCandidates(repoRoot).coverage;
}

export type HelpActionDocumentLink = {
  helpDocumentId: string;
  actionControlId: string;
};

/** Count unique help documents that have at least one linked action. */
export function countUniqueHelpDocumentsWithActions(links: HelpActionDocumentLink[]): number {
  return new Set(links.map((l) => l.helpDocumentId).filter(Boolean)).size;
}

export function reconcileHelpDocumentsWithActions(input: {
  helpActionCount: number;
  linkedDocumentCount: number;
  uniqueDocumentsFromLinks: number;
}): {
  helpDocumentsWithActions: number | null;
  helpDocumentsWithActionsUnavailable: boolean;
  helpDocumentsWithActionsUnavailableReason: string | null;
  orphanHelpActions: number | null;
  actionsWithoutHelpEvidence: number | null;
} {
  const docs = Math.max(input.linkedDocumentCount, input.uniqueDocumentsFromLinks);
  if (input.helpActionCount > 0 && docs === 0) {
    return {
      helpDocumentsWithActions: null,
      helpDocumentsWithActionsUnavailable: true,
      helpDocumentsWithActionsUnavailableReason:
        'Stage 3A links action_control via help_field DESCRIBES, but those help_field nodes have no DESCRIBES path from help_document; document assignment is unavailable without rebuilding Stage 3A',
      orphanHelpActions: input.helpActionCount,
      actionsWithoutHelpEvidence: input.helpActionCount,
    };
  }
  return {
    helpDocumentsWithActions: docs,
    helpDocumentsWithActionsUnavailable: false,
    helpDocumentsWithActionsUnavailableReason: null,
    orphanHelpActions: Math.max(0, input.helpActionCount - docs),
    actionsWithoutHelpEvidence: 0,
  };
}

/** Test helper: derive candidate counts from synthetic labels (no Stage 3A). */
export function deriveCandidateCountsFromLabels(labels: string[]): CandidateDerivation {
  let rawHelpCandidateLabels = 0;
  let genericLabelsPreventedFromGlobalApproval = 0;
  let duplicateCandidatesMerged = 0;
  const uniq = new Set<string>();
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length < 2) continue;
    rawHelpCandidateLabels += 1;
    const normalized = normalizePolishText(trimmed).normalizedExact;
    if (isGenericHelpLabel(normalized)) {
      genericLabelsPreventedFromGlobalApproval += 1;
      continue;
    }
    if (uniq.has(normalized)) {
      duplicateCandidatesMerged += 1;
      continue;
    }
    uniq.add(normalized);
  }
  return {
    rawHelpCandidateLabels,
    candidatesAfterGenericFiltering: rawHelpCandidateLabels - genericLabelsPreventedFromGlobalApproval,
    candidatesAfterDeduplication: uniq.size,
    candidateConcepts: uniq.size,
    duplicateCandidatesMerged,
    genericLabelsPreventedFromGlobalApproval,
  };
}
