import {
  controlNameTokens,
  normalizeHelpLabel,
  stripDiacritics,
  tokenOverlapScore,
} from './teta-stage2c-label';
import type { Stage2aFormBinding } from './teta-stage2a-bindings.types';
import type {
  Stage2cControlMatch,
  Stage2cFieldEntry,
  Stage2cMatchStatus,
} from './teta-stage2c.types';

export type Stage2cControlCandidate = {
  fieldName: string;
  controlKind: string | null;
  captions: string[];
  captionAscii: string[];
  nameTokens: string[];
  dataMember: string | null;
  parameterName: string | null;
  datasetTable: string | null;
  labelRelation: 'confirmed_label_control' | 'matched_by_caption' | 'none';
};

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function collectCaptions(form: Stage2aFormBinding, fieldName: string): string[] {
  const captions = new Set<string>();
  const nameLower = fieldName.toLowerCase();

  for (const a of form.propertyAssignments ?? []) {
    if ((a.control ?? '').toLowerCase() !== nameLower) continue;
    const prop = (a.property ?? '').toLowerCase();
    if (
      !/^(text|headertext|label|caption|displayname|columnname|name)$/i.test(prop) &&
      !/label|caption|header|text|displayname/i.test(prop)
    ) {
      continue;
    }
    const v = asString(a.value);
    if (v && v.trim() && !/^[\d.]+$/.test(v.trim())) captions.add(v.trim());
  }

  for (const c of [...(form.uiControls ?? []), ...(form.controls ?? [])]) {
    if ((c.fieldName ?? '').toLowerCase() !== nameLower) continue;
    for (const ap of c.assignedProperties ?? []) {
      const prop = (ap.property ?? '').toLowerCase();
      if (!/text|header|label|caption|displayname|columnname/i.test(prop)) continue;
      const v = asString(ap.value);
      if (v && v.trim()) captions.add(v.trim());
    }
  }

  // Associated label controls: lblX next to control X, or LabelFor patterns in relations
  for (const rel of form.relations ?? []) {
    const from = rel.from ?? '';
    const to = rel.to ?? '';
    if (from.toLowerCase() === nameLower && /label|lbl/i.test(to)) {
      // reverse: label points to control — captions may be on label control
      for (const a of form.propertyAssignments ?? []) {
        if ((a.control ?? '').toLowerCase() !== to.toLowerCase()) continue;
        const v = asString(a.value);
        if (v && /text|caption|label/i.test(a.property ?? '')) captions.add(v.trim());
      }
    }
    if (to.toLowerCase() === nameLower && /label|lbl/i.test(from)) {
      for (const a of form.propertyAssignments ?? []) {
        if ((a.control ?? '').toLowerCase() !== from.toLowerCase()) continue;
        const v = asString(a.value);
        if (v && /text|caption|label/i.test(a.property ?? '')) captions.add(v.trim());
      }
    }
  }

  return [...captions];
}

export function buildControlCandidates(form: Stage2aFormBinding): Stage2cControlCandidate[] {
  const byName = new Map<string, Stage2cControlCandidate>();

  const ensure = (fieldName: string, controlKind: string | null): Stage2cControlCandidate => {
    const key = fieldName.toLowerCase();
    let c = byName.get(key);
    if (!c) {
      const captions = collectCaptions(form, fieldName);
      c = {
        fieldName,
        controlKind,
        captions,
        captionAscii: captions.map((x) => normalizeHelpLabel(x).normalizedLabelAscii),
        nameTokens: controlNameTokens(fieldName),
        dataMember: null,
        parameterName: null,
        datasetTable: null,
        labelRelation: captions.length ? 'matched_by_caption' : 'none',
      };
      byName.set(key, c);
    } else if (controlKind && (!c.controlKind || c.controlKind === 'other')) {
      c.controlKind = controlKind;
    }
    return c;
  };

  for (const c of form.uiControls ?? form.controls ?? []) {
    if (!c.fieldName) continue;
    if (/^(m_|components|components?$)/i.test(c.fieldName)) continue;
    ensure(c.fieldName, c.controlKind ?? null);
  }

  for (const b of form.bindings ?? []) {
    if (!b.control) continue;
    const cand = ensure(b.control, null);
    cand.dataMember = asString(b.dataMember ?? b.binding?.dataMember) ?? cand.dataMember;
    cand.datasetTable = asString(b.datasetTable ?? b.binding?.datasetTable) ?? cand.datasetTable;
    cand.parameterName =
      asString(b.parameterName ?? b.propertyBindings?.parameterName ?? b.binding?.parameterName) ??
      cand.parameterName;
    if (cand.parameterName && !cand.controlKind) cand.controlKind = 'button';
  }

  return [...byName.values()];
}

function captionExactScore(helpAscii: string, cand: Stage2cControlCandidate): number {
  if (cand.captionAscii.includes(helpAscii)) return 1.0;
  for (const cap of cand.captionAscii) {
    if (cap === helpAscii) return 1.0;
    if (cap.includes(helpAscii) || helpAscii.includes(cap)) {
      if (Math.min(cap.length, helpAscii.length) >= 4) return 0.85;
    }
  }
  return 0;
}

function nameTokenScore(helpAscii: string, cand: Stage2cControlCandidate): number {
  if (cand.nameTokens.length === 0) return 0;
  const helpTokens = helpAscii.split(/\s+/).filter((t) => t.length > 1);
  if (helpTokens.length === 0) return 0;
  const nameSet = new Set(cand.nameTokens);
  let inter = 0;
  for (const t of helpTokens) if (nameSet.has(t)) inter += 1;
  // Stem / prefix: stanowiska↔stanowisko, zamkniecie↔zamknij, miesiaca↔miesiac
  for (const t of helpTokens) {
    for (const n of cand.nameTokens) {
      if (t === n) continue;
      if (t.startsWith(n) || n.startsWith(t)) {
        if (Math.min(t.length, n.length) >= 4) inter += 0.5;
        continue;
      }
      const prefixLen = commonPrefixLength(t, n);
      if (prefixLen >= 5) inter += 0.5;
    }
  }
  return Math.min(1, inter / Math.max(helpTokens.length, cand.nameTokens.length));
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function dataMemberDiagnosticScore(helpAscii: string, cand: Stage2cControlCandidate): number {
  if (!cand.dataMember) return 0;
  const dm = stripDiacritics(cand.dataMember).toLowerCase().replace(/_/g, ' ');
  // Only weak diagnostic — never sole basis for confirmed
  return tokenOverlapScore(helpAscii, dm) * 0.35;
}

export type ScoredControl = {
  candidate: Stage2cControlCandidate;
  score: number;
  matchStatus: Stage2cMatchStatus;
  evidence: string[];
};

export function scoreHelpAgainstControls(
  field: Stage2cFieldEntry,
  candidates: Stage2cControlCandidate[],
): ScoredControl[] {
  const helpAscii = field.normalizedLabelAscii;
  const scored: ScoredControl[] = [];

  for (const cand of candidates) {
    const evidence: string[] = [];
    let score = 0;
    let status: Stage2cMatchStatus = 'unmatched';

    const exactCap = captionExactScore(helpAscii, cand);
    if (exactCap >= 1) {
      score = Math.max(score, 1.0);
      status =
        cand.labelRelation === 'confirmed_label_control'
          ? 'confirmed_label_control'
          : 'matched_by_caption';
      evidence.push(`exact_caption=${cand.captions[0] ?? cand.fieldName}`);
    } else if (exactCap >= 0.85) {
      score = Math.max(score, 0.85);
      status = 'matched_by_caption';
      evidence.push(`partial_caption`);
    }

    const nameScore = nameTokenScore(helpAscii, cand);
    if (nameScore >= 0.99) {
      score = Math.max(score, 0.95);
      if (status === 'unmatched') status = 'matched_by_control_name';
      evidence.push(`exact_name_tokens=${cand.nameTokens.join(',')}`);
    } else if (nameScore >= 0.66) {
      score = Math.max(score, 0.72 + nameScore * 0.1);
      if (status === 'unmatched') status = 'matched_by_control_name';
      evidence.push(`name_token_overlap=${nameScore.toFixed(2)}`);
    } else if (nameScore >= 0.4) {
      score = Math.max(score, 0.55);
      if (status === 'unmatched') status = 'probable_same_container';
      evidence.push(`weak_name_token_overlap=${nameScore.toFixed(2)}`);
    }

    // Action/button: boost when help is action and control is button/tbb
    if (field.helpKind === 'actionHelp') {
      const isButton =
        /button|action/i.test(cand.controlKind ?? '') ||
        /^(tbb|btn|gti)/i.test(cand.fieldName) ||
        Boolean(cand.parameterName);
      if (isButton && nameScore >= 0.4) {
        score = Math.max(score, 0.9);
        status = 'matched_by_control_name';
        evidence.push(`action_to_button parameterName=${cand.parameterName ?? '-'}`);
      }
    }

    const dmScore = dataMemberDiagnosticScore(helpAscii, cand);
    if (dmScore > 0.2 && score < 0.5) {
      score = Math.max(score, dmScore);
      if (status === 'unmatched') status = 'probable_same_container';
      evidence.push(`diagnostic_dataMember=${cand.dataMember}`);
    }

    if (score < 0.45) continue;
    scored.push({ candidate: cand, score, matchStatus: status, evidence });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function pickBestMatch(
  field: Stage2cFieldEntry,
  candidates: Stage2cControlCandidate[],
): Stage2cControlMatch {
  const scored = scoreHelpAgainstControls(field, candidates);
  if (scored.length === 0) {
    return {
      helpField: field.label,
      control: null,
      controlKind: null,
      matchStatus: 'unmatched',
      score: 0,
      evidence: ['no_candidate_above_threshold'],
      helpKind: field.helpKind,
    };
  }

  const best = scored[0];
  const second = scored[1];
  if (second && best.score - second.score < 0.08 && second.score >= 0.6) {
    return {
      helpField: field.label,
      control: null,
      controlKind: null,
      matchStatus: 'ambiguous',
      score: best.score,
      evidence: [
        `ambiguous_top=${best.candidate.fieldName}(${best.score.toFixed(2)})`,
        `ambiguous_second=${second.candidate.fieldName}(${second.score.toFixed(2)})`,
        ...best.evidence,
      ],
      helpKind: field.helpKind,
    };
  }

  return {
    helpField: field.label,
    control: best.candidate.fieldName,
    controlKind: best.candidate.controlKind,
    matchStatus: best.matchStatus,
    score: best.score,
    evidence: best.evidence,
    helpKind: field.helpKind,
  };
}

export function matchHelpDocumentToForm(
  fields: Stage2cFieldEntry[],
  form: Stage2aFormBinding,
): Stage2cControlMatch[] {
  const candidates = buildControlCandidates(form);
  return fields.map((f) => pickBestMatch(f, candidates));
}
