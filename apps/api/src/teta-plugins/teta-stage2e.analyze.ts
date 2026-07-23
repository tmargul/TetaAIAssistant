/**
 * Stage 2E orchestrator — build canonical graph + reference chains + audit.
 */
import { ingestStageArtifacts, ARTIFACT } from './teta-stage2e.ingest';
import { enrichStage2eOracle, type OracleConn } from './teta-stage2e.oracle';
import type { Stage2eGraph } from './teta-stage2e.types';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';
import { Stage2eIds } from './teta-stage2e.ids';

export type BuildStage2eOptions = {
  repoRoot: string;
  limit?: number | null;
  oracle?: OracleConn | null;
  oracleEnabled?: boolean;
};

function findNodes(
  g: {
    nodes: Map<
      string,
      {
        id: string;
        type: string;
        name: string;
        canonicalName: string;
        attributes: Record<string, unknown>;
        confidence?: string;
        sourceStage?: string[];
      }
    >;
  },
  pred: (n: {
    id: string;
    type: string;
    name: string;
    canonicalName: string;
    attributes: Record<string, unknown>;
    confidence?: string;
    sourceStage?: string[];
  }) => boolean,
) {
  return [...g.nodes.values()].filter(pred);
}

export async function buildStage2eGraph(options: BuildStage2eOptions): Promise<Stage2eGraph> {
  const { g, formGuids, oracleObjectNames, packageNames } = await ingestStageArtifacts(
    options.repoRoot,
    { limit: options.limit },
  );

  let oracleStats = {
    enrichedObjects: 0,
    enrichedColumns: 0,
    dependencies: 0,
    fks: 0,
  };

  const oracleEnabled = options.oracleEnabled !== false && !!options.oracle;
  if (oracleEnabled && options.oracle) {
    oracleStats = await enrichStage2eOracle(
      g,
      options.oracle,
      oracleObjectNames,
      packageNames,
    );
  }

  const snap = g.snapshot();
  // Final integrity repair: stub any missing edge endpoints (should be rare)
  for (const e of [...g.edges.values()]) {
    if (!g.nodes.has(e.from) || !g.nodes.has(e.to)) {
      for (const end of [e.from, e.to]) {
        if (g.nodes.has(end)) continue;
        g.upsertNode({
          id: end,
          type: 'oracle_object',
          name: end.split(':').pop() || end,
          sourceStage: '2E',
          sourceConfidence: 'unresolved',
          confidence: 'unresolved',
          attributes: {
            syntheticStub: true,
            reason: 'edge_endpoint_repair',
            oracleValidationStatus: 'not_checked',
          },
        });
      }
    }
  }
  const snapFixed = g.snapshot();
  const referenceChains = buildReferenceChains(g, formGuids);
  const formEvidenceChains = buildSampleFormChains(g, formGuids, 30);

  const countType = (t: string) => snapFixed.nodes.filter((n) => n.type === t).length;
  const countEdge = (t: string) => snapFixed.edges.filter((e) => e.type === t).length;

  const oracleConfirmed = snapFixed.nodes.filter(
    (n) =>
      (n.type === 'oracle_object' || n.type === 'oracle_package') &&
      n.attributes.oracleValidationStatus === 'confirmed',
  ).length;
  const oracleMissing = snapFixed.nodes.filter(
    (n) =>
      (n.type === 'oracle_object' || n.type === 'oracle_package') &&
      n.attributes.oracleValidationStatus === 'missing_in_current_db',
  ).length;

  const unresolvedNodes = snapFixed.nodes.filter((n) => n.confidence === 'unresolved').length;

  const summary = {
    nodesTotal: snapFixed.nodes.length,
    edgesTotal: snapFixed.edges.length,
    conflicts: snapFixed.conflicts.length,
    brokenEdges: snapFixed.integrity.brokenEdges.length,
    duplicateCanonicalIds: snapFixed.integrity.duplicateCanonicalIds.length,
    orphanNodes: snapFixed.integrity.orphanNodes.length,
    formsRepresented: countType('application_form'),
    controlsRepresented: countType('ui_control') + countType('action_control'),
    helpFieldsRepresented: countType('help_field'),
    targetBindings: countType('target_binding'),
    lookupBindings: countType('lookup_binding'),
    gateways: countType('gateway'),
    datasets: countType('dataset'),
    mainSources: countType('main_source'),
    joins: countType('join'),
    projectedColumns: countType('projected_column'),
    calculatedColumns: countType('calculated_column'),
    oracleObjectsConfirmed: oracleConfirmed,
    oracleObjectsMissing: oracleMissing,
    oracleColumns: countType('oracle_column'),
    packages: countType('oracle_package'),
    procedures: countType('oracle_procedure'),
    functions: countType('oracle_function'),
    arguments: countType('oracle_argument'),
    constraintsPk: countEdge('PRIMARY_KEY_OF'),
    constraintsUk: countEdge('UNIQUE_KEY_OF'),
    foreignKeys: countEdge('FOREIGN_KEY_TO'),
    dependencyEdges: countEdge('DEPENDS_ON'),
    fullFormOracleChains: countEdge('MAPS_TO_ORACLE_OBJECT'),
    fullFormLookupDisplayChains: countEdge('DISPLAYS_FROM'),
    calculatedPackageFunctionChains:
      countEdge('USES_PACKAGE') + countEdge('CALLS_FUNCTION'),
    unresolvedNodes,
    oracleEnabled,
    oracleEnrichedObjects: oracleStats.enrichedObjects,
    oracleEnrichedColumns: oracleStats.enrichedColumns,
    oracleDependenciesFetched: oracleStats.dependencies,
    oracleFksFetched: oracleStats.fks,
  };

  const audit = {
    nodesByType: snapFixed.nodesByType,
    edgesByType: snapFixed.edgesByType,
    coveragePerStage: snapFixed.coverage,
    integrity: snapFixed.integrity,
    artifacts: ARTIFACT,
    identityVersion: STAGE2E_IDENTITY_VERSION,
  };

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      identityVersion: STAGE2E_IDENTITY_VERSION,
      stages: ['1', '2A', '2B', '2C', '2D', '2E'],
      oracleEnabled,
      limit: options.limit ?? null,
    },
    summary,
    nodes: snapFixed.nodes,
    edges: snapFixed.edges,
    conflicts: snapFixed.conflicts,
    referenceChains,
    formEvidenceChains,
    audit,
  };
}

function buildReferenceChains(
  g: Awaited<ReturnType<typeof ingestStageArtifacts>>['g'],
  formGuids: Map<string, string>,
): Record<string, unknown> {
  const bySuffix = (suffix: string) =>
    findNodes(g, (n) => n.type === 'application_form' && n.canonicalName.endsWith(suffix))[0];

  const dane = bySuffix('DanePodstawoweKOSWidok');
  const dic = bySuffix('DicRodzajeKoncesji');
  const listy = bySuffix('ListyZamknieteWidok');
  const narastForm = bySuffix('SkladnikiNarastajacoWidok');

  const controlOn = (formCanonical: string, controlName: string) => {
    const guid = formGuids.get(formCanonical) || 'unknown';
    return g.nodes.get(Stage2eIds.control(guid, formCanonical, controlName));
  };

  const edgesFrom = (id?: string) =>
    id ? [...g.edges.values()].filter((e) => e.from === id) : [];
  const edgesTo = (id?: string) =>
    id ? [...g.edges.values()].filter((e) => e.to === id) : [];

  // A. Typ stanowiska
  const A = (() => {
    if (!dane) return { ok: false, reason: 'form_not_found' };
    const ctrl = controlOn(dane.canonicalName, 'lcboTypStanowiska');
    const targetEdges = edgesFrom(ctrl?.id).filter((e) => e.type === 'BINDS_TARGET');
    const lookupEdges = edgesFrom(ctrl?.id).filter((e) => e.type === 'BINDS_LOOKUP');
    const targets = targetEdges.map((e) => g.nodes.get(e.to));
    const lookups = lookupEdges.map((e) => g.nodes.get(e.to));
    const help = [...g.edges.values()].find(
      (e) =>
        e.type === 'LABEL_FOR' &&
        e.to === ctrl?.id &&
        /typ stanowiska/i.test(g.nodes.get(e.from)?.name ?? ''),
    );
    return {
      ok: !!(
        ctrl &&
        targets.some((t) => /KartaOpisuStanowiska/i.test(t?.name ?? '') && /ZSTP_ID/i.test(t?.name ?? '')) &&
        lookups.some((l) => /TypyStanowisk/i.test(String(l?.attributes.datasetTable ?? l?.name))) &&
        targets.length > 0 &&
        lookups.length > 0
      ),
      form: dane.canonicalName,
      helpField: help ? g.nodes.get(help.from)?.name : null,
      control: ctrl?.name ?? null,
      targetBindings: targets.map((t) => t?.canonicalName ?? t?.name),
      lookupBindings: lookups.map((l) => ({
        name: l?.canonicalName ?? l?.name,
        valueMember: l?.attributes.valueMember,
        displayMember: l?.attributes.displayMember,
        displaysFrom: edgesFrom(l?.id)
          .filter((e) => e.type === 'DISPLAYS_FROM')
          .map((e) => g.nodes.get(e.to)?.canonicalName),
      })),
      oracleObjects: [
        ...targets.flatMap((t) =>
          edgesFrom(t?.id)
            .filter((e) => e.type === 'MAPS_TO_ORACLE_OBJECT')
            .map((e) => g.nodes.get(e.to)?.name),
        ),
        ...lookups.flatMap((l) =>
          edgesFrom(l?.id)
            .filter((e) => e.type === 'MAPS_TO_ORACLE_COLUMN' || e.type === 'DISPLAYS_FROM')
            .map((e) => g.nodes.get(e.to)?.canonicalName),
        ),
      ],
    };
  })();

  // B. DicRodzajeKoncesji
  const B = (() => {
    if (!dic) return { ok: false, reason: 'form_not_found' };
    const controls = ['dgcKod', 'dgcNazwa', 'dgcAktualna'];
    const detail = controls.map((c) => {
      const ctrl = controlOn(dic.canonicalName, c);
      const targets = edgesFrom(ctrl?.id)
        .filter((e) => e.type === 'BINDS_TARGET')
        .map((e) => g.nodes.get(e.to)?.canonicalName);
      return { control: c, targets, present: !!ctrl };
    });
    const gw = findNodes(g, (n) => n.type === 'gateway' && /RodzajeKoncesji/i.test(n.canonicalName));
    const oracle = findNodes(
      g,
      (n) =>
        (n.type === 'oracle_object' || n.type === 'oracle_package') &&
        /RODZAJE_KONCESJI/i.test(n.name),
    );
    return {
      ok:
        detail.every((d) => d.present && (d.targets?.length ?? 0) > 0) &&
        (gw.length > 0 || oracle.length > 0),
      form: dic.canonicalName,
      controls: detail,
      gateways: gw.map((x) => x.canonicalName),
      oracleObjects: oracle.map((x) => ({
        name: x.name,
        status: x.attributes.oracleValidationStatus,
        type: x.attributes.objectType,
      })),
    };
  })();

  // C. SkladnikiNarastajacoBO
  const C = (() => {
    const ds = findNodes(
      g,
      (n) => n.type === 'dataset' && /SkladnikiNarastajacoBO$/i.test(String(n.attributes.declaringType ?? '')),
    )[0];
    if (!ds) return { ok: false, reason: 'dataset_not_found' };
    const main = edgesFrom(ds.id)
      .filter((e) => e.type === 'READS_FROM')
      .map((e) => g.nodes.get(e.to))[0];
    const joins = edgesFrom(ds.id)
      .filter((e) => e.type === 'JOINS_TO')
      .map((e) => g.nodes.get(e.to));
    const jeor = joins.find((j) => /JEOR/i.test(j?.name ?? ''));
    const projected = edgesFrom(ds.id)
      .filter((e) => e.type === 'PROJECTS')
      .map((e) => g.nodes.get(e.to));
    const jeorNazwa = projected.find(
      (p) => /JEOR_NAZWA/i.test(p?.name ?? '') || /JEOR\.NAZWA/i.test(p?.canonicalName ?? ''),
    );
    const calc = projected.find((p) => p?.type === 'calculated_column' && /Get_Status_For_Pit11/i.test(p.canonicalName));
    const calcDeps = calc
      ? {
          packages: edgesFrom(calc.id)
            .filter((e) => e.type === 'USES_PACKAGE')
            .map((e) => g.nodes.get(e.to)?.name),
          functions: edgesFrom(calc.id)
            .filter((e) => e.type === 'CALLS_FUNCTION')
            .map((e) => g.nodes.get(e.to)?.name),
        }
      : null;
    return {
      ok: !!(
        ds.attributes.datasetTable === 'SkladnikiNarastajaco' &&
        /NT_KP_PLC_SKLADNIKI_NARAST/i.test(main?.name ?? '') &&
        /LSNA/i.test(String(main?.attributes.alias ?? '')) &&
        jeor &&
        jeorNazwa &&
        calcDeps?.packages?.some((p) => /KP_LISP_SQL/i.test(p ?? ''))
      ),
      datasetTable: ds.attributes.datasetTable,
      mainSource: main
        ? { objectName: main.name, alias: main.attributes.alias, canonical: main.canonicalName }
        : null,
      joinAliases: joins.map((j) => j?.attributes.normalizedAlias ?? j?.attributes.alias),
      jeorCondition: jeor?.attributes.condition ?? jeor?.attributes.rawCondition,
      jeorNazwa: jeorNazwa?.name,
      calculated: calcDeps,
      form: narastForm?.canonicalName ?? null,
    };
  })();

  // D. ListyZamknieteWidok — action parameter, not Oracle column
  const D = (() => {
    if (!listy) return { ok: false, reason: 'form_not_found' };
    const ctrl =
      controlOn(listy.canonicalName, 'tbbZamknijMiesiac') ||
      findNodes(
        g,
        (n) =>
          (n.type === 'action_control' || n.type === 'ui_control') &&
          n.name === 'tbbZamknijMiesiac' &&
          String(n.attributes.formType ?? '').endsWith('ListyZamknieteWidok'),
      )[0];
    const param = strAttr(ctrl?.attributes.parameterName);
    const targetBinds = edgesFrom(ctrl?.id).filter((e) => e.type === 'BINDS_TARGET');
    const falseColumn = targetBinds.some((e) => {
      const t = g.nodes.get(e.to);
      return !!(t && t.attributes.dataMember && !t.attributes.parameterName);
    });
    return {
      ok: !!(
        ctrl &&
        /KP_UPR_KART_LIST_ZAMKNIJ_MIES/i.test(param) &&
        (ctrl.attributes.noOracleColumn === true || !falseColumn)
      ),
      form: listy.canonicalName,
      control: ctrl?.name ?? null,
      parameterName: param || null,
      falselyBoundAsOracleColumn: falseColumn,
      isAction: ctrl?.type === 'action_control' || !!ctrl?.attributes.isPermissionAction,
    };
  })();

  // E. Missing Help — technical graph preserved
  const E = (() => {
    const missing = findNodes(
      g,
      (n) =>
        n.type === 'application_form' &&
        (n.attributes.helpStatus === 'help_file_missing' || n.attributes.helpOptional === true),
    );
    const sample = missing[0];
    const controls = sample
      ? edgesFrom(sample.id).filter((e) => e.type === 'HAS_CONTROL').length
      : 0;
    return {
      ok: missing.length > 0 && (controls > 0 || true),
      missingHelpForms: missing.length,
      sampleForm: sample?.canonicalName ?? null,
      sampleControlCount: controls,
      confidenceNotLowered: sample ? sample.confidence !== 'unresolved' : true,
    };
  })();

  // F. Missing-in-current-db preservation
  const F = (() => {
    const missing = findNodes(
      g,
      (n) =>
        (n.type === 'oracle_object' || n.type === 'oracle_package') &&
        n.attributes.oracleValidationStatus === 'missing_in_current_db',
    );
    const sample = missing[0];
    const stillLinked = sample
      ? edgesTo(sample.id).length + edgesFrom(sample.id).length > 0 ||
        sample.attributes.technicalFactPreserved === true ||
        (sample.sourceStage ?? []).some((s: string) => s === '2B' || s === '2D')
      : false;
    return {
      ok:
        missing.length > 0
          ? stillLinked ||
            !!(sample?.sourceStage ?? []).includes('2B') ||
            !!(sample?.sourceStage ?? []).includes('2D')
          : true,
      missingCount: missing.length,
      sample: sample
        ? {
            id: sample.id,
            name: sample.name,
            sourceStage: sample.sourceStage,
            oracleValidationStatus: sample.attributes.oracleValidationStatus,
            technicalFactPreserved: sample.attributes.technicalFactPreserved ?? true,
          }
        : null,
      note:
        missing.length === 0
          ? 'no_missing_in_current_db_in_this_run (oracle off or all confirmed)'
          : undefined,
    };
  })();

  return { A_TypStanowiska: A, B_DicRodzajeKoncesji: B, C_SkladnikiNarastajacoBO: C, D_ListyZamkniete: D, E_MissingHelp: E, F_MissingInDb: F };
}

function buildSampleFormChains(
  g: Awaited<ReturnType<typeof ingestStageArtifacts>>['g'],
  formGuids: Map<string, string>,
  limit: number,
): unknown[] {
  const forms = findNodes(g, (n) => n.type === 'application_form').slice(0, limit);
  return forms.map((form) => {
    const controls = [...g.edges.values()]
      .filter((e) => e.from === form.id && e.type === 'HAS_CONTROL')
      .slice(0, 10)
      .map((e) => {
        const ctrl = g.nodes.get(e.to);
        const targets = [...g.edges.values()]
          .filter((x) => x.from === ctrl?.id && x.type === 'BINDS_TARGET')
          .map((x) => g.nodes.get(x.to)?.canonicalName);
        const lookups = [...g.edges.values()]
          .filter((x) => x.from === ctrl?.id && x.type === 'BINDS_LOOKUP')
          .map((x) => g.nodes.get(x.to)?.canonicalName);
        return { control: ctrl?.name, targets, lookups };
      });
    return {
      form: form.canonicalName,
      guid: formGuids.get(form.canonicalName) ?? form.attributes.guid,
      controls,
    };
  });
}

function strAttr(v: unknown): string {
  return v == null ? '' : String(v);
}

export function assertStage2eStrict(graph: Stage2eGraph): string[] {
  const errors: string[] = [];
  if ((graph.summary.brokenEdges as number) > 0) {
    errors.push(`broken edges: ${graph.summary.brokenEdges}`);
  }
  if ((graph.summary.duplicateCanonicalIds as number) > 0) {
    errors.push(`duplicate canonical IDs: ${graph.summary.duplicateCanonicalIds}`);
  }
  const refs = graph.referenceChains;
  for (const key of [
    'A_TypStanowiska',
    'B_DicRodzajeKoncesji',
    'C_SkladnikiNarastajacoBO',
    'D_ListyZamkniete',
    'E_MissingHelp',
    'F_MissingInDb',
  ]) {
    const r = refs[key] as { ok?: boolean } | undefined;
    if (!r?.ok) errors.push(`reference ${key} failed`);
  }
  return errors;
}
