import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  P1_TIME_WORK_GROUP_STAGE2B_ALLOWLIST,
  type TimeWorkGroupSafetyCounters,
} from './teta-p1-time-work-group.types';

export type Stage2bGatewayHit = {
  fullName: string;
  viewName: string | null;
  alias: string | null;
  datasetName: string | null;
  evidenceRefs: string[];
};

export type Stage2bTypeHit = {
  fullName: string;
  gateways: Stage2bGatewayHit[];
  relationNames: string[];
  evidenceRefs: string[];
};

export type ApplicationAnchorHit = {
  formRef: string;
  controlName: string;
  datasetName: string | null;
  evidenceRefs: string[];
};

export type TimeWorkGroupDiscoveryBundle = {
  applicationAnchors: ApplicationAnchorHit[];
  stage2bTypes: Stage2bTypeHit[];
  stage2eDependencyObjects: string[];
  artifactAvailability: {
    stage2bFullNdjson: boolean;
    paRegistryJson: boolean;
    stage2eJson: boolean;
  };
  countersNote: {
    boundedExactTypeLoads: number;
    fullNdjsonScans: number;
    broadOracleObjectSearches: number;
  };
};

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function loadPaRegistryAnchors(repoRoot: string): ApplicationAnchorHit[] {
  const paPath = path.join(repoRoot, 'docs', 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  if (!exists(paPath)) return [];
  const raw = fs.readFileSync(paPath, 'utf8');
  // Bounded: only extract known control/dataset tokens around UmowyWidok, no full semantic scan loop
  const anchors: ApplicationAnchorHit[] = [];
  const formRef = 'Teta.Sumo.Personel.plgUmowy.CrdUmowy.UmowyWidok';
  const controls = [
    'grdWorktimeGroup',
    'dgcLGRCDataOd',
    'dgcLGRCDataDo',
    'dgcLGRCSGRCNazwa',
    'dglGrupaCzasuPracy',
    'dgcLGRCNorma',
  ];
  for (const controlName of controls) {
    if (!raw.includes(`"name": "${controlName}"`) && !raw.includes(`"stringValue": "${controlName}"`)) {
      continue;
    }
    let datasetName: string | null = null;
    if (controlName === 'dgcLGRCSGRCNazwa') datasetName = 'GrupyPracy';
    else if (controlName.startsWith('dgcLGRC') || controlName === 'grdWorktimeGroup' || controlName === 'dglGrupaCzasuPracy') {
      datasetName = 'GrupaCzasuPracy';
    }
    anchors.push({
      formRef,
      controlName,
      datasetName,
      evidenceRefs: [
        'docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
        `pa_control:${controlName}`,
        `form:${formRef}`,
      ],
    });
  }
  if (raw.includes('"GrupaCzasuPracy"') && raw.includes('UmowyWidok')) {
    anchors.push({
      formRef,
      controlName: 'PluginGroupArg:GrupaCzasuPracy',
      datasetName: 'GrupaCzasuPracy',
      evidenceRefs: [
        'docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
        'docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md',
        'plugin_group_arg:GrupaCzasuPracy',
      ],
    });
  }
  return anchors;
}

function loadStage2eDeps(repoRoot: string): string[] {
  const p = path.join(repoRoot, 'docs', 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json');
  if (!exists(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  const hits = new Set<string>();
  for (const m of raw.matchAll(
    /oracle-dep:TETA_ADMIN:(?:KP_LGRC_SQL|KAL|OST_DANE):PACKAGE:TETA_ADMIN:(L_GR_CZ_PRACY):TABLE/g,
  )) {
    hits.add(`TETA_ADMIN.${m[1]}`);
  }
  for (const m of raw.matchAll(
    /oracle-dep:TETA_ADMIN:(NT_KP_SLO_GR_CZASU_NOMINAL):VIEW:TETA_ADMIN:SL_GR_CZ:TABLE/g,
  )) {
    hits.add(`TETA_ADMIN.${m[1]}`);
  }
  return [...hits].sort();
}

async function loadStage2bExactTypes(
  repoRoot: string,
  counters: TimeWorkGroupSafetyCounters,
): Promise<Stage2bTypeHit[]> {
  const ndjson = path.join(repoRoot, '.local', 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');
  if (!exists(ndjson)) return [];

  const allow = new Set<string>(P1_TIME_WORK_GROUP_STAGE2B_ALLOWLIST);
  const found = new Map<string, Stage2bTypeHit>();
  const rl = readline.createInterface({
    input: fs.createReadStream(ndjson, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  // Bounded exact-type load: only parse lines containing an allowlisted fullName token.
  // This is not a full NDJSON semantic scan and must not increment fullNdjsonScans.
  let boundedLoads = 0;
  for await (const line of rl) {
    let matchedName: string | null = null;
    for (const name of allow) {
      if (line.includes(`"fullName":"${name}"`) || line.includes(`"fullName": "${name}"`)) {
        matchedName = name;
        break;
      }
    }
    if (!matchedName) continue;
    let obj: {
      fullName?: string;
      gateways?: Array<{
        viewName?: string;
        alias?: string;
        datasetName?: string;
        name?: string;
      }>;
      constructorFacts?: Array<{
        calledType?: string;
        calledMember?: string;
        arguments?: unknown[];
      }>;
    };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.fullName !== matchedName) continue;
    boundedLoads += 1;
    const gateways: Stage2bGatewayHit[] = (obj.gateways || []).map((g) => ({
      fullName: matchedName!,
      viewName: g.viewName ?? null,
      alias: g.alias ?? null,
      datasetName: g.datasetName ?? g.name ?? null,
      evidenceRefs: [
        'stage2b:AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson',
        `stage2b_type:${matchedName}`,
        g.viewName ? `gateway_view:${g.viewName}` : 'gateway_view:missing',
      ],
    }));
    const relationNames = (obj.constructorFacts || [])
      .filter((f) => f.calledType?.includes('Relation'))
      .map((f) => String(f.arguments?.[0] ?? ''))
      .filter(Boolean);
    found.set(matchedName, {
      fullName: matchedName,
      gateways,
      relationNames,
      evidenceRefs: [
        'stage2b:AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson',
        `stage2b_type:${matchedName}`,
      ],
    });
    if (found.size >= allow.size) break;
  }

  void boundedLoads;
  void counters;
  return [...found.values()];
}

export async function discoverTimeWorkGroupEvidence(
  repoRoot: string,
  counters: TimeWorkGroupSafetyCounters,
): Promise<TimeWorkGroupDiscoveryBundle> {
  const stage2bPath = path.join(repoRoot, '.local', 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');
  const paPath = path.join(repoRoot, 'docs', 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  const stage2ePath = path.join(repoRoot, 'docs', 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json');

  const applicationAnchors = loadPaRegistryAnchors(repoRoot);
  const stage2eDependencyObjects = loadStage2eDeps(repoRoot);
  const stage2bTypes = await loadStage2bExactTypes(repoRoot, counters);

  return {
    applicationAnchors,
    stage2bTypes,
    stage2eDependencyObjects,
    artifactAvailability: {
      stage2bFullNdjson: exists(stage2bPath),
      paRegistryJson: exists(paPath),
      stage2eJson: exists(stage2ePath),
    },
    countersNote: {
      boundedExactTypeLoads: stage2bTypes.length,
      fullNdjsonScans: counters.fullNdjsonScans,
      broadOracleObjectSearches: counters.broadOracleObjectSearches,
    },
  };
}
