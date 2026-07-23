/**
 * Stage 2E.1 — typed reference chains A–F (nodeIds / edgeIds, domain-safe).
 */
import type { Stage2eEdge, Stage2eNode } from './teta-stage2e.types';
import type { Stage2e1Audit } from './teta-stage2e1.audit';

function find(nodes: Stage2eNode[], pred: (n: Stage2eNode) => boolean): Stage2eNode | undefined {
  return nodes.find(pred);
}

function edgesFrom(edges: Stage2eEdge[], id: string, type?: string): Stage2eEdge[] {
  return edges.filter((e) => e.from === id && (!type || e.type === type));
}

function edgesTo(edges: Stage2eEdge[], id: string, type?: string): Stage2eEdge[] {
  return edges.filter((e) => e.to === id && (!type || e.type === type));
}

function nodeById(nodes: Stage2eNode[], id?: string | null): Stage2eNode | undefined {
  if (!id) return undefined;
  return nodes.find((n) => n.id === id);
}

function isOracleStubId(id?: string | null): boolean {
  if (!id) return true;
  return /oracle-column:UNKNOWN:/i.test(id) || /:TYPYSTANOWISK:/i.test(id);
}

function validateTyped(
  nodes: Stage2eNode[],
  edges: Stage2eEdge[],
  nodeIds: string[],
  edgeIds: string[],
  expectedTypes: Array<{ id: string; types: string[]; domains?: string[] }>,
  audit: Stage2e1Audit,
): { ok: boolean; validation: string[] } {
  const validation: string[] = [];
  let ok = true;
  for (const id of nodeIds) {
    if (!nodes.some((n) => n.id === id)) {
      ok = false;
      validation.push(`missing_node:${id}`);
    }
  }
  for (const id of edgeIds) {
    if (!edges.some((e) => e.id === id)) {
      ok = false;
      validation.push(`missing_edge:${id}`);
    }
  }
  for (const exp of expectedTypes) {
    const n = nodeById(nodes, exp.id);
    if (!n) {
      ok = false;
      validation.push(`expected_missing:${exp.id}`);
      continue;
    }
    if (!exp.types.includes(n.type)) {
      ok = false;
      validation.push(`type_mismatch:${exp.id}:${n.type}`);
    }
    if (exp.domains && n.domain && !exp.domains.includes(String(n.domain))) {
      ok = false;
      validation.push(`domain_mismatch:${exp.id}:${n.domain}`);
      audit.referenceChainsInvalidDomain += 1;
    }
    if (n.attributes.invalidOracleCandidateClass || n.type === 'oracle_object' && isInvalidDomainOracle(n)) {
      ok = false;
      validation.push(`invalid_domain_node:${exp.id}`);
      audit.referenceChainsInvalidDomain += 1;
    }
  }
  if (ok) audit.referenceChainsWithTypedIds += 1;
  return { ok, validation };
}

function isInvalidDomainOracle(n: Stage2eNode): boolean {
  return !!n.semanticNormalization?.invalidOracleCandidateClass;
}

export function buildTypedReferenceChains(
  nodes: Stage2eNode[],
  edges: Stage2eEdge[],
  audit: Stage2e1Audit,
): Record<string, unknown> {
  const A = buildA(nodes, edges, audit);
  const B = buildB(nodes, edges, audit);
  const C = buildC(nodes, edges, audit);
  const D = buildD(nodes, edges, audit);
  const E = buildE(nodes, edges, audit);
  const F = buildF(nodes, edges, audit);
  return {
    A_TypStanowiska: A,
    B_DicRodzajeKoncesji: B,
    C_SkladnikiNarastajacoBO: C,
    D_ListyZamkniete: D,
    E_MissingHelp: E,
    F_MissingInDb: F,
  };
}

function buildA(nodes: Stage2eNode[], edges: Stage2eEdge[], audit: Stage2e1Audit) {
  const form = find(nodes, (n) => n.type === 'application_form' && n.canonicalName.endsWith('DanePodstawoweKOSWidok'));
  const control = find(
    nodes,
    (n) =>
      (n.type === 'ui_control' || n.type === 'action_control') &&
      n.name === 'lcboTypStanowiska' &&
      String(n.attributes.formType ?? '').endsWith('DanePodstawoweKOSWidok'),
  );
  const help = find(
    nodes,
    (n) => n.type === 'help_field' && /typ stanowiska/i.test(n.name) && edges.some((e) => e.from === n.id && e.to === control?.id),
  ) || find(nodes, (n) => n.type === 'help_field' && /typ stanowiska/i.test(n.name));

  const targetEdge = control ? edgesFrom(edges, control.id, 'BINDS_TARGET')[0] : undefined;
  const lookupEdge = control ? edgesFrom(edges, control.id, 'BINDS_LOOKUP')[0] : undefined;
  const target = targetEdge ? nodeById(nodes, targetEdge.to) : undefined;
  const lookup = lookupEdge ? nodeById(nodes, lookupEdge.to) : undefined;

  const targetDcEdge = target ? edgesFrom(edges, target.id, 'MAPS_TO_DATASET_COLUMN')[0] : undefined;
  const targetDc = targetDcEdge ? nodeById(nodes, targetDcEdge.to) : undefined;
  const targetOraEdge = targetDc
    ? edgesFrom(edges, targetDc.id, 'RESOLVES_TO_ORACLE_COLUMN')[0]
    : undefined;
  const targetOra = targetOraEdge ? nodeById(nodes, targetOraEdge.to) : undefined;

  const lookupValueDc = lookup
    ? edgesFrom(edges, lookup.id, 'MAPS_TO_DATASET_COLUMN').map((e) => nodeById(nodes, e.to)).find((n) => n?.attributes.columnName === 'ID' || /\\.ID$/i.test(n?.name ?? ''))
    : undefined;
  const lookupDisplayDc =
    (lookup
      ? edgesFrom(edges, lookup.id, 'DISPLAYS_FROM').map((e) => nodeById(nodes, e.to))[0]
      : undefined) ||
    (lookup
      ? edgesFrom(edges, lookup.id, 'MAPS_TO_DATASET_COLUMN')
          .map((e) => nodeById(nodes, e.to))
          .find((n) => n?.attributes.columnName === 'NAZWA')
      : undefined);

  const lookupValueOra = lookupValueDc
    ? edgesFrom(edges, lookupValueDc.id, 'RESOLVES_TO_ORACLE_COLUMN').map((e) => nodeById(nodes, e.to))[0]
    : undefined;
  const lookupDisplayOra = lookupDisplayDc
    ? edgesFrom(edges, lookupDisplayDc.id, 'RESOLVES_TO_ORACLE_COLUMN').map((e) =>
        nodeById(nodes, e.to),
      )[0]
    : undefined;

  const nodeIds = [
    form?.id,
    help?.id,
    control?.id,
    target?.id,
    lookup?.id,
    targetDc?.id,
    lookupValueDc?.id,
    lookupDisplayDc?.id,
    targetOra?.id,
    lookupValueOra?.id,
    lookupDisplayOra?.id,
  ].filter(Boolean) as string[];

  const edgeIds = [
    help && control ? edgesFrom(edges, help.id).find((e) => e.to === control.id)?.id : undefined,
    targetEdge?.id,
    lookupEdge?.id,
    targetDcEdge?.id,
    targetOraEdge?.id,
    lookup && lookupValueDc
      ? edgesFrom(edges, lookup.id, 'MAPS_TO_DATASET_COLUMN').find((e) => e.to === lookupValueDc.id)?.id
      : undefined,
    lookup && lookupDisplayDc
      ? edgesFrom(edges, lookup.id, 'DISPLAYS_FROM').find(
          (e) => e.to === lookupDisplayDc.id && !e.to.startsWith('oracle-column:'),
        )?.id ||
        edgesFrom(edges, lookup.id, 'MAPS_TO_DATASET_COLUMN').find((e) => e.to === lookupDisplayDc.id)
          ?.id
      : undefined,
    lookupValueDc && lookupValueOra
      ? edgesFrom(edges, lookupValueDc.id, 'RESOLVES_TO_ORACLE_COLUMN').find((e) => e.to === lookupValueOra.id)?.id
      : undefined,
    lookupDisplayDc && lookupDisplayOra
      ? edgesFrom(edges, lookupDisplayDc.id, 'RESOLVES_TO_ORACLE_COLUMN').find((e) => e.to === lookupDisplayOra.id)?.id
      : undefined,
  ].filter(Boolean) as string[];

  const hasStaleDisplay =
    !!lookup &&
    edgesFrom(edges, lookup.id, 'DISPLAYS_FROM').some(
      (e) => e.to.startsWith('oracle-column:') || nodeById(nodes, e.to)?.type === 'oracle_column',
    );

  const structuralOk = !!(
    form &&
    control &&
    target &&
    lookup &&
    targetDc &&
    lookupValueDc &&
    lookupDisplayDc &&
    target?.type === 'target_binding' &&
    lookup?.type === 'lookup_binding' &&
    targetDc.type === 'dataset_column' &&
    lookupValueDc.type === 'dataset_column' &&
    lookupDisplayDc.type === 'dataset_column' &&
    targetOra?.type === 'oracle_column' &&
    lookupValueOra?.type === 'oracle_column' &&
    lookupDisplayOra?.type === 'oracle_column' &&
    !isOracleStubId(targetOra.id) &&
    !isOracleStubId(lookupValueOra.id) &&
    !isOracleStubId(lookupDisplayOra.id) &&
    /NT_KP_KOS_KARTA_OPISU_STAN/i.test(String(targetOra.attributes.objectName ?? '')) &&
    /NT_KP_SLO_TYPY_STANOWISK/i.test(String(lookupValueOra.attributes.objectName ?? '')) &&
    /NT_KP_SLO_TYPY_STANOWISK/i.test(String(lookupDisplayOra.attributes.objectName ?? '')) &&
    !/TypyStanowisk\.(ID|NAZWA)/i.test(targetOra.name + lookupValueOra.name + lookupDisplayOra.name) &&
    !hasStaleDisplay &&
    !edgeIds.some((id) => id.includes('oracle-column:UNKNOWN:TYPYSTANOWISK'))
  );

  const typed = validateTyped(
    nodes,
    edges,
    nodeIds,
    edgeIds,
    [
      { id: form?.id ?? '', types: ['application_form'], domains: ['application'] },
      { id: control?.id ?? '', types: ['ui_control', 'action_control'], domains: ['application'] },
      { id: target?.id ?? '', types: ['target_binding'], domains: ['application'] },
      { id: lookup?.id ?? '', types: ['lookup_binding'], domains: ['application'] },
      { id: targetDc?.id ?? '', types: ['dataset_column'], domains: ['dataset'] },
    ].filter((x) => x.id),
    audit,
  );

  return {
    ok: structuralOk && typed.ok,
    formNodeId: form?.id ?? null,
    controlNodeId: control?.id ?? null,
    helpFieldNodeId: help?.id ?? null,
    targetBindingNodeId: target?.id ?? null,
    lookupBindingNodeId: lookup?.id ?? null,
    targetDatasetColumnId: targetDc?.id ?? null,
    lookupValueDatasetColumnId: lookupValueDc?.id ?? null,
    lookupDisplayDatasetColumnId: lookupDisplayDc?.id ?? null,
    targetOracleColumnId: targetOra?.id ?? null,
    lookupValueOracleColumnId: lookupValueOra?.id ?? null,
    lookupDisplayOracleColumnId: lookupDisplayOra?.id ?? null,
    nodeIds,
    edgeIds,
    validation: typed.validation,
  };
}

function buildB(nodes: Stage2eNode[], edges: Stage2eEdge[], audit: Stage2e1Audit) {
  const form = find(nodes, (n) => n.type === 'application_form' && n.canonicalName.endsWith('DicRodzajeKoncesji'));
  const controls = ['dgcKod', 'dgcNazwa', 'dgcAktualna'].map((c) =>
    find(
      nodes,
      (n) =>
        (n.type === 'ui_control' || n.type === 'action_control') &&
        n.name === c &&
        String(n.attributes.formType ?? '').endsWith('DicRodzajeKoncesji'),
    ),
  );
  const oracleSeen = new Map<string, Stage2eNode>();
  for (const n of nodes) {
    if (n.type !== 'oracle_object' && n.type !== 'oracle_package') continue;
    const name = String(n.attributes.objectName ?? n.name).toUpperCase();
    if (!/RODZAJE_KONCESJI/.test(name)) continue;
    if (n.attributes.invalidOracleCandidateClass) continue;
    if (isInvalidDomainOracle(n)) continue;
    const owner = String(n.attributes.owner ?? '').toUpperCase();
    const status = String(n.attributes.oracleValidationStatus ?? '');
    // Never surface UNKNOWN+confirmed
    if (owner === 'UNKNOWN' && (/^confirmed/i.test(status) || status === 'confirmed_from_all_objects')) {
      continue;
    }
    // _DAC must not appear as confirmed VIEW without real-owner ALL_OBJECTS VIEW
    if (
      /_DAC$/i.test(name) &&
      /VIEW/i.test(String(n.attributes.objectType)) &&
      (owner === 'UNKNOWN' || !/^confirmed/i.test(status))
    ) {
      continue;
    }
    // Prefer real-owner records over UNKNOWN stubs for the same identity
    const key = String(
      n.attributes.canonicalOracleIdentity ??
        `${n.attributes.owner}.${n.attributes.objectType}.${name}`,
    ).toUpperCase();
    const nameTypeKey = `${name}|${String(n.attributes.objectType).toUpperCase()}`;
    const existingByNameType = [...oracleSeen.values()].find((x) => {
      const xn = String(x.attributes.objectName ?? x.name).toUpperCase();
      const xt = String(x.attributes.objectType).toUpperCase();
      return `${xn}|${xt}` === nameTypeKey;
    });
    if (existingByNameType) {
      const exOwner = String(existingByNameType.attributes.owner ?? '').toUpperCase();
      if (exOwner !== 'UNKNOWN' && owner === 'UNKNOWN') continue;
      if (exOwner === 'UNKNOWN' && owner !== 'UNKNOWN') {
        oracleSeen.delete(
          String(
            existingByNameType.attributes.canonicalOracleIdentity ??
              `${existingByNameType.attributes.owner}.${existingByNameType.attributes.objectType}.${String(existingByNameType.attributes.objectName).toUpperCase()}`,
          ).toUpperCase(),
        );
      }
    }
    if (!oracleSeen.has(key)) oracleSeen.set(key, n);
  }
  const oracleObjects = [...oracleSeen.values()].map((n) => ({
    nodeId: n.id,
    owner: n.attributes.owner ?? null,
    objectType: n.attributes.objectType ?? null,
    objectName: n.attributes.objectName ?? n.name,
    validationStatus: n.attributes.oracleValidationStatus ?? null,
  }));

  const nodeIds = [form?.id, ...controls.map((c) => c?.id), ...oracleObjects.map((o) => o.nodeId)].filter(
    Boolean,
  ) as string[];
  const edgeIds: string[] = [];
  for (const c of controls) {
    if (!c || !form) continue;
    const he = edgesFrom(edges, form.id, 'HAS_CONTROL').find((e) => e.to === c.id);
    if (he) edgeIds.push(he.id);
    const tb = edgesFrom(edges, c.id, 'BINDS_TARGET')[0];
    if (tb) edgeIds.push(tb.id);
  }

  const typed = validateTyped(
    nodes,
    edges,
    nodeIds.filter((id) => nodes.some((n) => n.id === id)),
    edgeIds,
    [
      { id: form?.id ?? '', types: ['application_form'], domains: ['application'] },
      ...oracleObjects.map((o) => ({
        id: o.nodeId,
        types: ['oracle_object', 'oracle_package'],
        domains: ['oracle'],
      })),
    ].filter((x) => x.id),
    audit,
  );

  const ok =
    !!form &&
    controls.every((c) => !!c) &&
    oracleObjects.some((o) => /VIEW/i.test(String(o.objectType)) && /NT_LG_SLO_RODZAJE_KONCESJI$/i.test(String(o.objectName))) &&
    oracleObjects.some((o) => /PACKAGE/i.test(String(o.objectType))) &&
    typed.ok;

  return {
    ok,
    formNodeId: form?.id ?? null,
    controlNodeIds: controls.map((c) => c?.id ?? null),
    oracleObjects,
    nodeIds,
    edgeIds,
    validation: typed.validation,
  };
}

function buildC(nodes: Stage2eNode[], edges: Stage2eEdge[], audit: Stage2e1Audit) {
  const ds = find(
    nodes,
    (n) =>
      n.type === 'dataset' &&
      /SkladnikiNarastajacoBO$/i.test(String(n.attributes.declaringType ?? '')),
  );
  const mainEdge = ds ? edgesFrom(edges, ds.id, 'READS_FROM')[0] : undefined;
  const main = mainEdge ? nodeById(nodes, mainEdge.to) : undefined;
  const joinEdges = ds ? edgesFrom(edges, ds.id, 'JOINS_TO') : [];
  const joins = joinEdges.map((e) => nodeById(nodes, e.to)).filter(Boolean) as Stage2eNode[];
  const jeor = joins.find((j) => /JEOR/i.test(String(j.attributes.normalizedAlias ?? j.attributes.alias ?? j.name)));
  const calc = find(
    nodes,
    (n) =>
      n.type === 'calculated_column' &&
      /Get_Status_For_Pit11/i.test(n.canonicalName) &&
      edges.some((e) => e.from === ds?.id && e.to === n.id),
  );
  const pkgEdge = calc ? edgesFrom(edges, calc.id, 'USES_PACKAGE')[0] : undefined;
  const fnEdge = calc ? edgesFrom(edges, calc.id, 'CALLS_FUNCTION')[0] : undefined;
  const pkg = pkgEdge ? nodeById(nodes, pkgEdge.to) : undefined;
  const fn = fnEdge ? nodeById(nodes, fnEdge.to) : undefined;

  const nodeIds = [
    ds?.id,
    main?.id,
    ...joins.map((j) => j.id),
    calc?.id,
    pkg?.id,
    fn?.id,
  ].filter(Boolean) as string[];
  const edgeIds = [
    mainEdge?.id,
    ...joinEdges.map((e) => e.id),
    pkgEdge?.id,
    fnEdge?.id,
  ].filter(Boolean) as string[];

  const typed = validateTyped(
    nodes,
    edges,
    nodeIds,
    edgeIds,
    [
      { id: ds?.id ?? '', types: ['dataset'], domains: ['dataset'] },
      { id: main?.id ?? '', types: ['main_source'], domains: ['dataset'] },
      { id: calc?.id ?? '', types: ['calculated_column'], domains: ['dataset'] },
    ].filter((x) => x.id),
    audit,
  );

  const ok = !!(
    ds?.attributes.datasetTable === 'SkladnikiNarastajaco' &&
    /NT_KP_PLC_SKLADNIKI_NARAST/i.test(main?.name ?? '') &&
    /LSNA/i.test(String(main?.attributes.alias ?? '')) &&
    jeor &&
    pkg &&
    fn &&
    typed.ok
  );

  return {
    ok,
    datasetNodeId: ds?.id ?? null,
    mainSourceNodeId: main?.id ?? null,
    joinNodeIds: joins.map((j) => j.id),
    jeorJoinNodeId: jeor?.id ?? null,
    calculatedColumnNodeId: calc?.id ?? null,
    packageNodeId: pkg?.id ?? null,
    functionNodeId: fn?.id ?? null,
    nodeIds,
    edgeIds,
    validation: typed.validation,
  };
}

function buildD(nodes: Stage2eNode[], edges: Stage2eEdge[], audit: Stage2e1Audit) {
  const form = find(nodes, (n) => n.type === 'application_form' && n.canonicalName.endsWith('ListyZamknieteWidok'));
  const candidates = nodes.filter(
    (n) =>
      (n.type === 'action_control' || n.type === 'ui_control') &&
      n.name === 'tbbZamknijMiesiac' &&
      String(n.attributes.formType ?? '').endsWith('ListyZamknieteWidok'),
  );
  const control =
    candidates.find(
      (n) =>
        n.id.startsWith('action:') &&
        /KP_UPR_KART_LIST_ZAMKNIJ_MIES/i.test(String(n.attributes.parameterName ?? '')),
    ) ||
    candidates.find((n) =>
      /KP_UPR_KART_LIST_ZAMKNIJ_MIES/i.test(String(n.attributes.parameterName ?? '')),
    ) ||
    candidates.find((n) => n.attributes.parameterName) ||
    candidates.find((n) => n.id.startsWith('action:')) ||
    candidates[0];
  const param = String(control?.attributes.parameterName ?? '');
  const hasOracleCol = control
    ? edgesFrom(edges, control.id).some((e) => {
        const t = nodeById(nodes, e.to);
        return t?.type === 'oracle_column';
      }) ||
      edgesFrom(edges, control.id, 'BINDS_TARGET').some((e) => {
        const t = nodeById(nodes, e.to);
        return !!(t && t.attributes.dataMember && !t.attributes.parameterName);
      })
    : false;

  const nodeIds = [form?.id, control?.id].filter(Boolean) as string[];
  const edgeIds = form && control
    ? edgesFrom(edges, form.id, 'HAS_CONTROL').filter((e) => e.to === control.id).map((e) => e.id)
    : [];

  // Prefer an edge that exists; if twin has HAS_CONTROL, allow either
  const linked =
    edgeIds.length > 0 ||
    (form &&
      control &&
      candidates.some((c) => edgesFrom(edges, form.id, 'HAS_CONTROL').some((e) => e.to === c.id)));

  const typed = validateTyped(
    nodes,
    edges,
    nodeIds,
    edgeIds.length
      ? edgeIds
      : form && control
        ? edgesFrom(edges, form.id, 'HAS_CONTROL')
            .filter((e) => candidates.some((c) => c.id === e.to))
            .map((e) => e.id)
        : [],
    [
      { id: form?.id ?? '', types: ['application_form'], domains: ['application'] },
      {
        id: control?.id ?? '',
        types: ['action_control', 'ui_control'],
        domains: ['application'],
      },
    ].filter((x) => x.id),
    audit,
  );

  const ok = !!(
    control &&
    /KP_UPR_KART_LIST_ZAMKNIJ_MIES/i.test(param) &&
    (control.type === 'action_control' ||
      control.attributes.isPermissionAction ||
      control.attributes.noOracleColumn) &&
    !hasOracleCol &&
    linked &&
    typed.ok
  );

  return {
    ok,
    formNodeId: form?.id ?? null,
    controlNodeId: control?.id ?? null,
    parameterName: param || null,
    falselyBoundAsOracleColumn: hasOracleCol,
    nodeIds,
    edgeIds:
      edgeIds.length > 0
        ? edgeIds
        : form && control
          ? edgesFrom(edges, form.id, 'HAS_CONTROL')
              .filter((e) => candidates.some((c) => c.id === e.to))
              .map((e) => e.id)
          : [],
    validation: typed.validation,
  };
}

function buildE(nodes: Stage2eNode[], edges: Stage2eEdge[], audit: Stage2e1Audit) {
  const missing = nodes.filter(
    (n) =>
      n.type === 'application_form' &&
      (n.attributes.helpStatus === 'help_file_missing' || n.attributes.helpOptional === true),
  );
  const sample = missing[0];
  const helpDocs = sample
    ? edgesFrom(edges, sample.id, 'HAS_HELP').length
    : 0;
  const controls = sample ? edgesFrom(edges, sample.id, 'HAS_CONTROL').length : 0;
  const nodeIds = sample ? [sample.id] : [];
  const typed = validateTyped(
    nodes,
    edges,
    nodeIds,
    [],
    sample
      ? [{ id: sample.id, types: ['application_form'], domains: ['application'] }]
      : [],
    audit,
  );
  const ok = missing.length > 0 && helpDocs === 0 && controls >= 0 && typed.ok && sample?.confidence !== 'unresolved';
  return {
    ok,
    missingHelpForms: missing.length,
    sampleFormNodeId: sample?.id ?? null,
    sampleControlCount: controls,
    hasHelpDocument: helpDocs > 0,
    confidenceNotLowered: sample ? sample.confidence !== 'unresolved' : true,
    nodeIds,
    edgeIds: [] as string[],
    validation: typed.validation,
  };
}

function buildF(nodes: Stage2eNode[], edges: Stage2eEdge[], audit: Stage2e1Audit) {
  const missing = nodes.filter(
    (n) =>
      (n.type === 'oracle_object' || n.type === 'oracle_package') &&
      n.attributes.oracleValidationStatus === 'missing_in_current_db' &&
      !n.attributes.invalidOracleCandidateClass &&
      !isInvalidDomainOracle(n),
  );
  const sample = missing[0];
  const nodeIds = sample ? [sample.id] : [];
  const typed = validateTyped(
    nodes,
    edges,
    nodeIds,
    [],
    sample
      ? [{ id: sample.id, types: ['oracle_object', 'oracle_package'], domains: ['oracle'] }]
      : [],
    audit,
  );
  const ok =
    missing.length === 0
      ? true
      : !!(
          sample &&
          (sample.attributes.technicalFactPreserved === true ||
            sample.sourceStage.includes('2B') ||
            sample.sourceStage.includes('2D')) &&
          typed.ok
        );

  return {
    ok,
    missingCount: missing.length,
    sample: sample
      ? {
          nodeId: sample.id,
          owner: sample.attributes.owner,
          objectType: sample.attributes.objectType,
          objectName: sample.attributes.objectName ?? sample.name,
          oracleValidationStatus: sample.attributes.oracleValidationStatus,
          technicalFactPreserved: sample.attributes.technicalFactPreserved ?? true,
          canonicalOracleIdentity: sample.attributes.canonicalOracleIdentity ?? null,
        }
      : null,
    nodeIds,
    edgeIds: [] as string[],
    validation: typed.validation,
  };
}
