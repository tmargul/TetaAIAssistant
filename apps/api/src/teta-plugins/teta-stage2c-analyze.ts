import { createHash } from 'crypto';
import { existsSync } from 'fs';
import * as path from 'path';
import type { Stage2aFormBinding } from './teta-stage2a-bindings.types';
import type { LookupBindingSplit, Stage2bLinkedChain } from './teta-stage2b.types';
import type { TetaPluginRegistryEntry } from './teta-plugin-form-registry.types';
import { normalizePluginGuid } from './teta-plugin-guid.util';
import { helpHtmlPath, resolveHelpDirectory } from './teta-help-path.util';
import { readStage2cHelpFile } from './teta-stage2c-parser';
import { buildControlCandidates, matchHelpDocumentToForm } from './teta-stage2c-match';
import type {
  Stage2cAuditSummary,
  Stage2cConflict,
  Stage2cHelpDocument,
  Stage2cLinkedMapping,
  Stage2cMatchStatus,
} from './teta-stage2c.types';

export type Stage2cFormResult = {
  guid: string;
  registryId: string | null;
  formType: string | null;
  assembly: string | null;
  classVerificationStatus?: string | null;
  registryStatus?: string | null;
  helpDocument: Stage2cHelpDocument;
  matches: ReturnType<typeof matchHelpDocumentToForm>;
  linkedMappings: Stage2cLinkedMapping[];
  controlsWithoutHelp: string[];
  conflicts: Stage2cConflict[];
};

export type Stage2cBatchResult = {
  forms: Stage2cFormResult[];
  conflicts: Stage2cConflict[];
  duplicates: Array<{
    kind: string;
    guids: string[];
    formTypes: string[];
    message: string;
  }>;
  audit: Stage2cAuditSummary;
  examples: {
    fullChains: Stage2cLinkedMapping[];
    lookupFields: Stage2cLinkedMapping[];
    actionButtons: Stage2cLinkedMapping[];
    ambiguous: Stage2cLinkedMapping[];
    unmatched: Stage2cLinkedMapping[];
    missingHelp: Array<{ guid: string; formType: string | null }>;
    encodingProblems: Array<{
      guid: string;
      formType: string | null;
      status: string;
      encoding?: string | null;
    }>;
  };
  references: Record<string, unknown>;
};

function contentHash(doc: Stage2cHelpDocument): string {
  const payload = JSON.stringify({
    title: doc.title,
    overview: doc.overview,
    fields: doc.fieldEntries.map((f) => f.normalizedLabelAscii),
  });
  return createHash('sha1').update(payload).digest('hex');
}

function indexChains(chains: Stage2bLinkedChain[]): Map<string, Stage2bLinkedChain[]> {
  const map = new Map<string, Stage2bLinkedChain[]>();
  for (const c of chains) {
    const key = `${(c.formType ?? '').toLowerCase()}|${(c.control ?? '').toLowerCase()}`;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return map;
}

function indexLookups(lookups: LookupBindingSplit[]): Map<string, LookupBindingSplit> {
  const map = new Map<string, LookupBindingSplit>();
  for (const l of lookups) {
    const key = `${(l.formType ?? '').toLowerCase()}|${(l.control ?? '').toLowerCase()}`;
    if (!map.has(key)) map.set(key, l);
  }
  return map;
}

function indexFormsByGuid(forms: Stage2aFormBinding[]): Map<string, Stage2aFormBinding[]> {
  const map = new Map<string, Stage2aFormBinding[]>();
  for (const f of forms) {
    const g = normalizePluginGuid(f.guid).normalized;
    if (!g) continue;
    const list = map.get(g) ?? [];
    list.push(f);
    map.set(g, list);
  }
  return map;
}

function confirmedMatch(status: Stage2cMatchStatus): boolean {
  return (
    status === 'confirmed_label_control' ||
    status === 'matched_by_caption' ||
    status === 'matched_by_control_name'
  );
}

function probableMatch(status: Stage2cMatchStatus): boolean {
  return status === 'probable_same_container' || status === 'probable_tab_order';
}

export function analyzeStage2c(options: {
  registry: TetaPluginRegistryEntry[];
  forms2a: Stage2aFormBinding[];
  chains2b: Stage2bLinkedChain[];
  lookups2b: LookupBindingSplit[];
  clientDirectory: string;
  /** Limit processed registry entries (tests). */
  limit?: number;
  /** Prefer these formTypes / guids first (references). */
  prefer?: string[];
}): Stage2cBatchResult {
  const helpDir = resolveHelpDirectory(options.clientDirectory);
  const formsByGuid = indexFormsByGuid(options.forms2a);
  const chainsByKey = indexChains(options.chains2b);
  const lookupsByKey = indexLookups(options.lookups2b);

  let entries = options.registry.filter((e) => e.guid);
  if (options.prefer?.length) {
    const pref = new Set(options.prefer.map((p) => p.toLowerCase()));
    entries = [
      ...entries.filter(
        (e) =>
          pref.has((e.guid ?? '').toLowerCase()) ||
          pref.has((e.className ?? '').toLowerCase()) ||
          pref.has((e.simpleClassName ?? '').toLowerCase()),
      ),
      ...entries.filter(
        (e) =>
          !pref.has((e.guid ?? '').toLowerCase()) &&
          !pref.has((e.className ?? '').toLowerCase()) &&
          !pref.has((e.simpleClassName ?? '').toLowerCase()),
      ),
    ];
  }
  if (options.limit && options.limit > 0) entries = entries.slice(0, options.limit);

  const forms: Stage2cFormResult[] = [];
  const allConflicts: Stage2cConflict[] = [];
  const hashToDocs = new Map<string, Array<{ guid: string; formType: string | null }>>();

  for (const entry of entries) {
    const guid = normalizePluginGuid(entry.guid).normalized;
    if (!guid) continue;

    const form2aList = formsByGuid.get(guid) ?? [];
    // Prefer form matching registry className
    const form2a =
      form2aList.find(
        (f) =>
          (f.formType ?? '').toLowerCase() === (entry.className ?? '').toLowerCase(),
      ) ??
      form2aList[0] ??
      null;

    const formType = form2a?.formType ?? entry.className ?? null;
    const preferredPath =
      entry.helpPath && existsSync(entry.helpPath)
        ? entry.helpPath
        : path.join(helpDir, `${guid}.html`);

    const helpDocument = readStage2cHelpFile({
      helpPath: preferredPath,
      guid,
      formType,
      registryId: entry.registryId,
      assembly: entry.assembly,
    });

    if (!form2a && helpDocument.helpStatus === 'help_found') {
      allConflicts.push({
        conflictType: 'form_help_without_verified_type',
        guid,
        formType,
        message: 'Help found but no Stage 2A form binding for GUID',
      });
    }

    const allHelpEntries = [...helpDocument.fieldEntries, ...helpDocument.actionEntries];
    const matches = form2a
      ? matchHelpDocumentToForm(allHelpEntries, form2a)
      : allHelpEntries.map((f) => ({
          helpField: f.label,
          control: null,
          controlKind: null,
          matchStatus: 'unmatched' as const,
          score: 0,
          evidence: ['no_stage2a_form'],
          helpKind: f.helpKind,
        }));

    const linkedMappings: Stage2cLinkedMapping[] = [];
    const controlToHelp = new Map<string, string[]>();

    for (let i = 0; i < allHelpEntries.length; i++) {
      const field = allHelpEntries[i];
      const match = matches[i];
      const control = match.control;

      let targetBinding: Stage2cLinkedMapping['targetBinding'] = null;
      let lookupBinding: Stage2cLinkedMapping['lookupBinding'] = null;
      let parameterName: string | null = null;
      let oracleMapping: Stage2cLinkedMapping['oracleMapping'] = null;

      if (control && form2a) {
        const binding = (form2a.bindings ?? []).find(
          (b) => (b.control ?? '').toLowerCase() === control.toLowerCase(),
        );
        if (binding) {
          const dm = (binding.dataMember ?? binding.binding?.dataMember) as string | undefined;
          let ds = (binding.datasetTable ?? binding.binding?.datasetTable) as string | undefined;
          parameterName =
            (binding.parameterName as string | undefined) ??
            (binding.propertyBindings?.parameterName as string | undefined) ??
            null;
          const isActionControl =
            Boolean(parameterName) ||
            /^(tbb|btn)/i.test(control) ||
            /button|action/i.test(match.controlKind ?? '');
          // Grid columns often bind ColumnName only; inherit dataset from GridLayout / sibling
          if (!ds && !isActionControl && form2a) {
            const layout = (form2a.bindings ?? []).find(
              (b) =>
                /gridlayout|datasource/i.test(b.control ?? '') &&
                (b.datasetTable || b.binding?.datasetTable),
            );
            ds =
              ((layout?.datasetTable ?? layout?.binding?.datasetTable) as string | undefined) ??
              ((form2a.dataSources ?? []).find((d) => d.name)?.name ?? undefined);
          }
          if (!isActionControl && (ds || dm)) {
            targetBinding = {
              datasetTable: ds ?? null,
              dataMember: dm ?? null,
            };
          }
        }

        const lookup = lookupsByKey.get(`${formType?.toLowerCase()}|${control.toLowerCase()}`);
        if (lookup) {
          targetBinding = lookup.targetBinding ?? targetBinding;
          lookupBinding = lookup.lookupBinding
            ? {
                datasetTable: lookup.lookupBinding.datasetTable ?? null,
                valueMember: lookup.lookupBinding.valueMember ?? null,
                displayMember: lookup.lookupBinding.displayMember ?? null,
              }
            : null;
        }

        const chains = chainsByKey.get(`${formType?.toLowerCase()}|${control.toLowerCase()}`) ?? [];
        const targetObjects: string[] = [];
        const lookupObjects: string[] = [];
        for (const ch of chains) {
          if (ch.viewName) targetObjects.push(ch.viewName);
          if (ch.packageName) targetObjects.push(ch.packageName);
          if (ch.gatewayType) targetObjects.push(ch.gatewayType);
        }
        // Fallback: any chain on same form+dataset (grid columns often lack per-control 2B chain)
        if (targetObjects.length === 0 && targetBinding?.datasetTable) {
          for (const ch of options.chains2b) {
            if (
              (ch.formType ?? '').toLowerCase() === (formType ?? '').toLowerCase() &&
              (ch.formDatasetTable ?? '').toLowerCase() ===
                (targetBinding.datasetTable ?? '').toLowerCase()
            ) {
              if (ch.viewName) targetObjects.push(ch.viewName);
              if (ch.packageName) targetObjects.push(ch.packageName);
              if (ch.gatewayType) targetObjects.push(ch.gatewayType);
            }
          }
        }
        if (targetObjects.length === 0 && targetBinding?.datasetTable) {
          for (const ch of options.chains2b) {
            if (
              (ch.formDatasetTable ?? '').toLowerCase() ===
              (targetBinding.datasetTable ?? '').toLowerCase()
            ) {
              if (ch.viewName) targetObjects.push(ch.viewName);
              if (ch.packageName) targetObjects.push(ch.packageName);
              if (targetObjects.length >= 4) break;
            }
          }
        }
        if (lookupBinding?.datasetTable) {
          // Attach lookup oracle objects from chains of same form with that dataset — if any
          for (const ch of options.chains2b) {
            if (
              (ch.formType ?? '').toLowerCase() === (formType ?? '').toLowerCase() &&
              (ch.formDatasetTable ?? '').toLowerCase() ===
                (lookupBinding.datasetTable ?? '').toLowerCase()
            ) {
              if (ch.viewName) lookupObjects.push(ch.viewName);
              if (ch.packageName) lookupObjects.push(ch.packageName);
            }
          }
          // Also scan gateways via dataset name on any chain with matching table from other controls
          if (lookupObjects.length === 0) {
            for (const ch of options.chains2b) {
              if (
                (ch.formDatasetTable ?? '').toLowerCase() ===
                (lookupBinding.datasetTable ?? '').toLowerCase()
              ) {
                if (ch.viewName) lookupObjects.push(ch.viewName);
                if (ch.packageName) lookupObjects.push(ch.packageName);
                if (lookupObjects.length >= 2) break;
              }
            }
          }
        }
        if (targetObjects.length || lookupObjects.length) {
          oracleMapping = {
            targetObjects: [...new Set(targetObjects)],
            lookupObjects: [...new Set(lookupObjects)],
          };
        }

        const list = controlToHelp.get(control.toLowerCase()) ?? [];
        list.push(field.label);
        controlToHelp.set(control.toLowerCase(), list);
      }

      // Reclassify action when control is button even if help kind was field
      let helpKind = field.helpKind;
      if (
        control &&
        (/^(tbb|btn)/i.test(control) || parameterName) &&
        helpKind === 'fieldHelp'
      ) {
        helpKind = 'actionHelp';
      }

      linkedMappings.push({
        guid,
        formType,
        helpLabel: field.label,
        helpDescription: field.description,
        helpKind,
        section: field.section,
        control,
        controlKind: match.controlKind,
        matchStatus: match.matchStatus,
        score: match.score,
        targetBinding,
        lookupBinding,
        parameterName,
        oracleMapping,
        evidence: [
          ...field.evidence,
          ...match.evidence,
          `extraction=${field.extractionPattern}`,
          `confidence=${field.confidence}`,
        ],
      });
    }

    // Conflicts: many help → one control, duplicates
    for (const [ctrl, labels] of controlToHelp) {
      if (labels.length > 1) {
        allConflicts.push({
          conflictType: 'many_help_fields_one_control',
          guid,
          formType,
          subject: ctrl,
          message: labels.join(' | '),
        });
      }
    }
    for (const m of matches) {
      if (m.matchStatus === 'ambiguous') {
        allConflicts.push({
          conflictType: 'one_help_field_many_controls',
          guid,
          formType,
          subject: m.helpField,
          message: m.evidence.join('; '),
        });
      }
      if (m.matchStatus === 'unmatched') {
        allConflicts.push({
          conflictType: 'label_without_control',
          guid,
          formType,
          subject: m.helpField,
          message: 'Help field unmatched to control',
        });
      }
    }

    const matchedControls = new Set(
      matches.filter((m) => m.control).map((m) => m.control!.toLowerCase()),
    );
    const controlsWithoutHelp: string[] = [];
    if (form2a) {
      for (const c of buildControlCandidates(form2a)) {
        if (matchedControls.has(c.fieldName.toLowerCase())) continue;
        // Only report UI-ish controls / bound controls
        if (
          c.dataMember ||
          c.parameterName ||
          /^(lcbo|dgc|ltxt|ldtp|chk|tbb|btn|lov)/i.test(c.fieldName)
        ) {
          controlsWithoutHelp.push(c.fieldName);
          allConflicts.push({
            conflictType: 'control_without_help',
            guid,
            formType,
            subject: c.fieldName,
            message: 'Control has no Help field (not an error)',
          });
        }
      }
    }

    if (helpDocument.helpStatus === 'help_found') {
      const h = contentHash(helpDocument);
      const list = hashToDocs.get(h) ?? [];
      list.push({ guid, formType });
      hashToDocs.set(h, list);
    }

    // Duplicate labels in same / different sections
    const byLabel = new Map<string, Stage2cHelpDocument['fieldEntries']>();
    for (const f of helpDocument.fieldEntries) {
      const key = f.normalizedLabelAscii;
      const list = byLabel.get(key) ?? [];
      list.push(f);
      byLabel.set(key, list);
    }
    for (const [, list] of byLabel) {
      if (list.length < 2) continue;
      const sections = new Set(list.map((x) => x.section ?? ''));
      allConflicts.push({
        conflictType:
          sections.size <= 1
            ? 'duplicate_label_same_section'
            : 'duplicate_label_different_section',
        guid,
        formType,
        subject: list[0].label,
        message: `count=${list.length}`,
      });
    }

    helpDocument.unmatchedEntries = allHelpEntries.filter(
      (_, i) => matches[i]?.matchStatus === 'unmatched' || matches[i]?.matchStatus === 'ambiguous',
    );

    forms.push({
      guid,
      registryId: entry.registryId,
      formType,
      assembly: entry.assembly,
      classVerificationStatus: entry.classVerificationStatus,
      registryStatus: entry.registryStatus,
      helpDocument,
      matches,
      linkedMappings,
      controlsWithoutHelp,
      conflicts: allConflicts.filter((c) => c.guid === guid),
    });
  }

  // Help GUID without registry — already iterating registry only; flag reverse if needed
  const duplicates: Stage2cBatchResult['duplicates'] = [];
  for (const [, docs] of hashToDocs) {
    if (docs.length < 2) continue;
    const guids = [...new Set(docs.map((d) => d.guid))];
    if (guids.length === 1) {
      duplicates.push({
        kind: 'same_guid_multiple_classes',
        guids,
        formTypes: docs.map((d) => d.formType ?? ''),
        message: 'Same Help GUID mapped to multiple form types',
      });
    } else {
      duplicates.push({
        kind: 'same_content_multiple_guids',
        guids,
        formTypes: docs.map((d) => d.formType ?? ''),
        message: 'Identical Help content hash across GUIDs (not auto-merged)',
      });
    }
  }

  // exact duplicate: same guid+formType appearing twice in forms
  const idSeen = new Map<string, number>();
  for (const f of forms) {
    const id = `${f.guid}|${(f.formType ?? '').toLowerCase()}`;
    idSeen.set(id, (idSeen.get(id) ?? 0) + 1);
  }
  for (const [id, n] of idSeen) {
    if (n < 2) continue;
    const [guid, formType] = id.split('|');
    duplicates.push({
      kind: 'exact_duplicate',
      guids: [guid],
      formTypes: [formType],
      message: `duplicate identity count=${n}`,
    });
  }

  const audit = summarizeStage2c(forms, duplicates);
  const examples = collectExamples(forms);
  const references = buildReferences(forms, options.lookups2b, options.chains2b);

  return {
    forms,
    conflicts: allConflicts,
    duplicates,
    audit,
    examples,
    references,
  };
}

export function summarizeStage2c(
  forms: Stage2cFormResult[],
  duplicates: Stage2cBatchResult['duplicates'],
): Stage2cAuditSummary {
  let helpFilesFound = 0;
  let helpMissing = 0;
  let helpUnreadable = 0;
  let encodingFailures = 0;
  let parsedDocuments = 0;
  let sections = 0;
  let extractedFieldEntries = 0;
  let actionEntries = 0;
  let fieldEntriesMatchedToControls = 0;
  let confirmedMatches = 0;
  let probableMatches = 0;
  let ambiguous = 0;
  let unmatchedHelpFields = 0;
  let controlsWithoutHelp = 0;
  let helpMappingsWithOracleChain = 0;
  let lookupFieldsCorrectlySplit = 0;
  let parseWarnings = 0;

  for (const f of forms) {
    const st = f.helpDocument.helpStatus;
    if (st === 'help_found') {
      helpFilesFound += 1;
      parsedDocuments += 1;
    } else if (st === 'help_file_missing') helpMissing += 1;
    else if (st === 'help_file_unreadable') helpUnreadable += 1;
    else if (st === 'help_encoding_failed') encodingFailures += 1;

    sections += f.helpDocument.sections.length;
    extractedFieldEntries += f.helpDocument.fieldEntries.length;
    actionEntries += f.helpDocument.actionEntries.length;
    parseWarnings += f.helpDocument.parseWarnings.length;
    controlsWithoutHelp += f.controlsWithoutHelp.length;

    for (const m of f.matches) {
      if (m.control && confirmedMatch(m.matchStatus)) {
        fieldEntriesMatchedToControls += 1;
        confirmedMatches += 1;
      } else if (probableMatch(m.matchStatus)) {
        fieldEntriesMatchedToControls += 1;
        probableMatches += 1;
      } else if (m.matchStatus === 'ambiguous') ambiguous += 1;
      else if (m.matchStatus === 'unmatched') unmatchedHelpFields += 1;
    }

    for (const link of f.linkedMappings) {
      if (link.oracleMapping && (link.oracleMapping.targetObjects.length > 0 || link.control)) {
        if (link.oracleMapping.targetObjects.length > 0) helpMappingsWithOracleChain += 1;
      }
      if (link.lookupBinding?.datasetTable && link.targetBinding?.dataMember && link.control) {
        lookupFieldsCorrectlySplit += 1;
      }
    }
  }

  return {
    registryEntriesChecked: forms.length,
    helpFilesFound,
    helpMissing,
    helpUnreadable,
    encodingFailures,
    parsedDocuments,
    sections,
    extractedFieldEntries,
    actionEntries,
    fieldEntriesMatchedToControls,
    confirmedMatches,
    probableMatches,
    ambiguous,
    unmatchedHelpFields,
    controlsWithoutHelp,
    helpMappingsWithOracleChain,
    lookupFieldsCorrectlySplit,
    duplicateHelpDocuments: duplicates.length,
    parseWarnings,
  };
}

function collectExamples(forms: Stage2cFormResult[]): Stage2cBatchResult['examples'] {
  const fullChains: Stage2cLinkedMapping[] = [];
  const lookupFields: Stage2cLinkedMapping[] = [];
  const actionButtons: Stage2cLinkedMapping[] = [];
  const ambiguous: Stage2cLinkedMapping[] = [];
  const unmatched: Stage2cLinkedMapping[] = [];
  const missingHelp: Stage2cBatchResult['examples']['missingHelp'] = [];
  const encodingProblems: Stage2cBatchResult['examples']['encodingProblems'] = [];

  for (const f of forms) {
    if (f.helpDocument.helpStatus === 'help_file_missing') {
      if (missingHelp.length < 20) {
        missingHelp.push({ guid: f.guid, formType: f.formType });
      }
    }
    if (
      f.helpDocument.helpStatus === 'help_encoding_failed' ||
      f.helpDocument.decodingStatus === 'high_replacement'
    ) {
      if (encodingProblems.length < 20) {
        encodingProblems.push({
          guid: f.guid,
          formType: f.formType,
          status: f.helpDocument.helpStatus,
          encoding: f.helpDocument.detectedEncoding,
        });
      }
    }

    for (const link of f.linkedMappings) {
      if (
        fullChains.length < 20 &&
        link.control &&
        link.targetBinding?.dataMember &&
        link.oracleMapping &&
        link.oracleMapping.targetObjects.length > 0
      ) {
        fullChains.push(link);
      }
      if (lookupFields.length < 20 && link.lookupBinding?.datasetTable && link.control) {
        lookupFields.push(link);
      }
      if (
        actionButtons.length < 20 &&
        (link.helpKind === 'actionHelp' || link.parameterName || /^(tbb|btn)/i.test(link.control ?? ''))
      ) {
        actionButtons.push(link);
      }
      if (ambiguous.length < 20 && link.matchStatus === 'ambiguous') ambiguous.push(link);
      if (unmatched.length < 20 && link.matchStatus === 'unmatched') unmatched.push(link);
    }
  }

  return {
    fullChains,
    lookupFields,
    actionButtons,
    ambiguous,
    unmatched,
    missingHelp,
    encodingProblems,
  };
}

function buildReferences(
  forms: Stage2cFormResult[],
  lookups: LookupBindingSplit[],
  chains: Stage2bLinkedChain[],
): Record<string, unknown> {
  const byForm = (needle: RegExp) =>
    forms.find((f) => needle.test(f.formType ?? '') || needle.test(f.guid));

  const typ = byForm(/DanePodstawoweKOSWidok/i);
  const typLink = typ?.linkedMappings.find((l) => /typ stanowiska/i.test(l.helpLabel));
  const typLookup = lookups.find((l) => /lcboTypStanowiska/i.test(l.control ?? ''));

  const dic = byForm(/DicRodzajeKoncesji/i);
  const listy = byForm(/ListyZamknieteWidok/i);
  const zamknij = listy?.linkedMappings.find(
    (l) =>
      /tbbZamknijMiesiac/i.test(l.control ?? '') ||
      /^zamkni/i.test(l.helpLabel) ||
      /ZAMKNIJ_MIES/i.test(l.parameterName ?? ''),
  );

  const missing = forms.find(
    (f) =>
      f.helpDocument.helpStatus === 'help_file_missing' &&
      f.classVerificationStatus === 'verified_exact' &&
      f.controlsWithoutHelp.length + f.matches.filter((m) => m.control).length > 0,
  );

  const dicChains = chains.filter((c) => /DicRodzajeKoncesji/i.test(c.formType ?? ''));

  return {
    A_lookup_typStanowiska: {
      formType: typ?.formType ?? null,
      guid: typ?.guid ?? null,
      helpStatus: typ?.helpDocument.helpStatus ?? null,
      helpField: typLink
        ? {
            label: typLink.helpLabel,
            control: typLink.control,
            targetBinding: typLink.targetBinding,
            lookupBinding: typLink.lookupBinding,
            oracleMapping: typLink.oracleMapping,
            matchStatus: typLink.matchStatus,
          }
        : null,
      stage2bLookup: typLookup ?? null,
    },
    B_DicRodzajeKoncesji: {
      formType: dic?.formType ?? null,
      guid: dic?.guid ?? null,
      helpStatus: dic?.helpDocument.helpStatus ?? null,
      overview: dic?.helpDocument.overview?.slice(0, 240) ?? null,
      fields: dic?.linkedMappings.map((l) => ({
        helpLabel: l.helpLabel,
        control: l.control,
        targetBinding: l.targetBinding,
        matchStatus: l.matchStatus,
      })),
      oracleChains: dicChains.slice(0, 6),
    },
    C_ListyZamkniete: {
      formType: listy?.formType ?? null,
      guid: listy?.guid ?? null,
      helpStatus: listy?.helpDocument.helpStatus ?? null,
      zamknijMiesiac: zamknij
        ? {
            helpLabel: zamknij.helpLabel,
            control: zamknij.control,
            parameterName: zamknij.parameterName,
            targetBinding: zamknij.targetBinding,
            helpKind: zamknij.helpKind,
            matchStatus: zamknij.matchStatus,
          }
        : null,
      dataFieldsSample: listy?.linkedMappings
        .filter((l) => l.helpKind === 'fieldHelp' && l.targetBinding?.dataMember)
        .slice(0, 8),
    },
    D_missingHelp: {
      formType: missing?.formType ?? null,
      guid: missing?.guid ?? null,
      helpStatus: missing?.helpDocument.helpStatus ?? null,
      classVerificationStatus: missing?.classVerificationStatus ?? null,
      note: 'Technical graph preserved; help does not lower confidence',
    },
  };
}

/** Resolve Help path for a GUID under client Help directory (test helper). */
export function stage2cHelpPathForGuid(clientDirectory: string, guid: string): string {
  return helpHtmlPath(resolveHelpDirectory(clientDirectory), guid);
}
