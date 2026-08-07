import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type {
  EvidenceOriginClassification,
  SchemaEvidenceGraph,
} from './teta-schema-role-resolution.types';

export type BlindEvidenceInputClassification = {
  file: string;
  symbol: string;
  inputField: string;
  valueKind: string;
  classification: EvidenceOriginClassification;
};

/**
 * Blind-mode evidence for current_position.
 * Uses application/PA anchors + bounded Stage2B gateway discovery only.
 * NEVER loads Stage 3D approved bindings or previous-pilot physical mappings.
 */
export async function buildBlindCurrentPositionEvidenceFromApplicationGraph(
  repoRoot: string,
): Promise<{
  graph: SchemaEvidenceGraph;
  inputClassifications: BlindEvidenceInputClassification[];
  stage3dBindingsFileLoaded: boolean;
  previousPilotPhysicalBindingsLoaded: boolean;
}> {
  const graph: SchemaEvidenceGraph = { objects: [], relations: [], claims: [] };
  const inputClassifications: BlindEvidenceInputClassification[] = [
    {
      file: 'teta-schema-role-evidence-blind-current-position.ts',
      symbol: 'buildBlindCurrentPositionEvidenceFromApplicationGraph',
      inputField: 'targetConcept',
      valueKind: 'logical:current_position',
      classification: 'logical_only',
    },
    {
      file: 'teta-schema-role-evidence-blind-current-position.ts',
      symbol: 'buildBlindCurrentPositionEvidenceFromApplicationGraph',
      inputField: 'subjectRole',
      valueKind: 'logical:employee',
      classification: 'logical_only',
    },
  ];

  const stage3dPath = path.join(
    repoRoot,
    'apps',
    'api',
    'config',
    'teta-business-semantic-bindings-v1.json',
  );
  // Explicit non-load: blind mode must not read this file.
  const stage3dBindingsFileLoaded = false;
  void stage3dPath;

  const paPath = path.join(repoRoot, 'docs', 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  const conceptTokens = [
    'Stanowiska',
    'Positions',
    'grdStanowiska',
    'DicStanowiska',
    'plgStanowiska',
    'StanowiskaWidok',
  ];
  if (fs.existsSync(paPath)) {
    const raw = fs.readFileSync(paPath, 'utf8');
    for (const token of conceptTokens) {
      if (!raw.includes(token)) continue;
      graph.claims.push({
        family: 'application_semantic',
        claimType: 'application_anchor_token',
        weight: 2,
        provenance: [
          'docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
          `token:${token}`,
          'blind_mode:pa_anchor',
        ],
        notes: 'UI/plugin token for current_position concept (blind rediscovery)',
      });
      inputClassifications.push({
        file: 'docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
        symbol: `token:${token}`,
        inputField: 'applicationAnchors',
        valueKind: 'ui_token',
        classification: 'semantic_application_anchor',
      });
    }
  }

  const ndjson = path.join(repoRoot, '.local', 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');
  // Bounded concept-driven Stage2B load — application/code extraction, not Stage 3D.
  const interesting =
    /bosPersonelSlowniki\.(MTG|TG|BO|DF)\.(Positions|Stanowiska)|plgStanowiska|DicStanowiska/;
  if (fs.existsSync(ndjson)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(ndjson, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!interesting.test(line)) continue;
      let obj: {
        fullName?: string;
        gateways?: Array<{ viewName?: string; alias?: string }>;
      };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const fullName = obj.fullName ?? '';
      if (!interesting.test(fullName)) continue;
      for (const g of obj.gateways ?? []) {
        if (!g.viewName) continue;
        const objectRef = `TETA_ADMIN.${g.viewName}`;
        const isDictGateway = /Positions(MTG|TG|BO)|Stanowiska(MTG|TG|DF|BO)|DicStanowiska/i.test(
          fullName,
        );
        // Dictionary-shaped gateways from application code — not Stage 3D seeds.
        if (isDictGateway && /SLO_STANOW|STANOWISKA/i.test(g.viewName) && !/KDR_/i.test(g.viewName)) {
          let o = graph.objects.find((x) => x.objectRef === objectRef);
          if (!o) {
            o = {
              objectRef,
              owner: 'TETA_ADMIN',
              objectType: 'VIEW',
              objectName: g.viewName,
              columns: [
                { name: 'ID', dataType: 'NUMBER', isPk: true },
                { name: 'NAZWA', dataType: 'VARCHAR2' },
              ],
              tags: ['dictionary_candidate'],
            };
            graph.objects.push(o);
          }
          graph.claims.push({
            family: 'application_technical',
            claimType: 'dictionary_gateway',
            object: objectRef,
            roleHint: 'dictionary_identity',
            weight: 3,
            provenance: [
              `stage2b:${fullName}`,
              `view:${g.viewName}`,
              `alias:${g.alias ?? ''}`,
              'blind_mode:stage2b_gateway',
            ],
          });
          inputClassifications.push({
            file: '.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson',
            symbol: fullName,
            inputField: 'evidenceGraph.objects',
            valueKind: `gateway_view:${g.viewName}`,
            classification: 'generic_graph_evidence',
          });
        }
      }
    }
  }

  // Document capability gap: without assignment gateway/joins/temporals from application graph,
  // blind mode cannot complete subject→assignment→dictionary path.
  graph.claims.push({
    family: 'application_semantic',
    claimType: 'capability_gap_note',
    weight: 1,
    provenance: [
      'blind_mode:missing_assignment_gateway_path',
      'blind_mode:missing_join_predicates_from_application_graph',
      'blind_mode:missing_temporal_predicates_from_application_graph',
    ],
    notes:
      'Blind rediscovery currently lacks a complete assignment Oracle path from Stage2A–2E/3A alone; Stage 3D approved bindings are excluded by design.',
  });

  return {
    graph,
    inputClassifications,
    stage3dBindingsFileLoaded,
    previousPilotPhysicalBindingsLoaded: false,
  };
}

/** Ground truth for post-resolution comparison only — never resolver input. */
export const CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION = {
  assignment: 'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
  dictionary: 'TETA_ADMIN.NT_KP_SLO_STANOWISKA',
  subjectReference: 'PRAC_ID',
  dictionaryReference: 'SSTN_ID',
  dictionaryIdentity: 'ID',
  dictionaryDisplayName: 'NAZWA',
  validFrom: 'DATA_OD',
  validTo: 'DATA_DO',
  employeeIdentity: 'TETA_ADMIN.NT_KP_PRC_PRACOWNICY.ID',
} as const;

export function compareCurrentPositionGroundTruth(actual: {
  assignment?: string | null;
  subjectReference?: string | null;
  dictionaryReference?: string | null;
  dictionary?: string | null;
  dictionaryDisplayName?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}): { matched: boolean; mismatches: string[]; matches: string[] } {
  const gt = CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION;
  const mismatches: string[] = [];
  const matches: string[] = [];
  const checks: Array<[string, string | null | undefined, string]> = [
    ['assignment', actual.assignment, gt.assignment],
    ['subjectReference', actual.subjectReference, gt.subjectReference],
    ['dictionaryReference', actual.dictionaryReference, gt.dictionaryReference],
    ['dictionary', actual.dictionary, gt.dictionary],
    ['dictionaryDisplayName', actual.dictionaryDisplayName, gt.dictionaryDisplayName],
    ['validFrom', actual.validFrom, gt.validFrom],
    ['validTo', actual.validTo, gt.validTo],
  ];
  for (const [k, a, e] of checks) {
    if (a === e) matches.push(k);
    else mismatches.push(`${k}:actual=${a ?? 'null'};expected=${e}`);
  }
  return { matched: mismatches.length === 0, mismatches, matches };
}
