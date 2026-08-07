import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { SchemaEvidenceGraph } from './teta-schema-role-resolution.types';

/**
 * Concept-driven TWG evidence probe.
 * Does not accept human Oracle object/join seeds.
 * Discovers UI anchors by concept tokens and Stage2B gateways by dataset/relation names
 * found in those anchors — still no scenario physical allowlist.
 */
export async function buildTimeWorkGroupEvidenceFromArtifacts(
  repoRoot: string,
): Promise<SchemaEvidenceGraph> {
  const graph: SchemaEvidenceGraph = { objects: [], relations: [], claims: [] };
  const paPath = path.join(repoRoot, 'docs', 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  const conceptTokens = ['GrupaCzasuPracy', 'GrupyCzasuPracy', 'LGRC', 'WorktimeGroup'];

  if (fs.existsSync(paPath)) {
    const raw = fs.readFileSync(paPath, 'utf8');
    for (const token of conceptTokens) {
      if (!raw.includes(token)) continue;
      graph.claims.push({
        family: 'application_semantic',
        claimType: 'application_anchor_token',
        weight: 2,
        provenance: ['docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json', `token:${token}`],
        notes: 'UI/plugin token for time-work group concept',
      });
    }
    if (raw.includes('GrupaCzasuPracy')) {
      graph.claims.push({
        family: 'application_semantic',
        claimType: 'assignment_dataset',
        // Logical dataset name only — not an Oracle object seed
        subject: 'dataset:GrupaCzasuPracy',
        roleHint: 'assignment_source',
        weight: 3,
        provenance: [
          'docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
          'dataset:GrupaCzasuPracy',
          'form:UmowyWidok',
        ],
      });
    }
  }

  // Bounded Stage2B load: only types whose payload mentions discovered dataset/relation tokens
  const ndjson = path.join(repoRoot, '.local', 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');
  const stage2e = path.join(repoRoot, 'docs', 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json');

  if (fs.existsSync(ndjson)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(ndjson, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    const interesting = /GrupyCzasuPracy(MTG|TG|BO)|GrupaCzasuPracy|GrupaCzasuPracyPracownika/;
    for await (const line of rl) {
      if (!interesting.test(line)) continue;
      let obj: {
        fullName?: string;
        gateways?: Array<{ viewName?: string; alias?: string }>;
        constructorFacts?: Array<{
          calledType?: string;
          arguments?: unknown[];
        }>;
      };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const fullName = obj.fullName ?? '';
      // Dictionary gateway — exact technical evidence when dataset GrupyCzasuPracy / GrupyPracy
      for (const g of obj.gateways ?? []) {
        if (!g.viewName) continue;
        const isDict = /GrupyCzasuPracy(MTG|TG|BO)/.test(fullName);
        const isQuestionnaires = /Questionnaires/.test(fullName);
        const isImport = /WorkingTimeGroups|Imp/.test(fullName);
        const objectRef = `TETA_ADMIN.${g.viewName}`;
        if (isDict) {
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
            provenance: [`stage2b:${fullName}`, `view:${g.viewName}`, `alias:${g.alias}`],
          });
        } else if (isQuestionnaires || isImport) {
          // Competing / wrong-domain technical objects — record as candidates with conflict notes
          let o = graph.objects.find((x) => x.objectRef === objectRef);
          if (!o) {
            o = {
              objectRef,
              owner: 'TETA_ADMIN',
              objectType: 'VIEW',
              objectName: g.viewName,
              columns: [],
              tags: ['assignment_candidate'],
            };
            graph.objects.push(o);
          }
          graph.claims.push({
            family: 'application_technical',
            claimType: 'assignment_gateway',
            object: objectRef,
            roleHint: 'assignment_source',
            weight: 2,
            provenance: [`stage2b:${fullName}`, `view:${g.viewName}`],
          });
          graph.claims.push({
            family: 'application_semantic',
            claimType: isQuestionnaires ? 'conflict' : 'assignment_dataset',
            object: objectRef,
            weight: 2,
            provenance: [
              isQuestionnaires
                ? 'domain_mismatch:questionnaires_vs_time_work_group'
                : 'surface:import_not_live_card',
            ],
          });
        }
      }
      for (const f of obj.constructorFacts ?? []) {
        if (f.calledType?.includes('Relation') && f.arguments?.[0] === 'GrupaCzasuPracyPracownika') {
          graph.claims.push({
            family: 'application_technical',
            claimType: 'assignment_relation',
            subject: 'relation:GrupaCzasuPracyPracownika',
            roleHint: 'assignment_source',
            weight: 2,
            provenance: [`stage2b:${fullName}`, 'relation:GrupaCzasuPracyPracownika'],
            notes: 'Late-bound relation without viewName — incomplete technical path',
          });
        }
      }
    }
  }

  if (fs.existsSync(stage2e)) {
    const raw = fs.readFileSync(stage2e, 'utf8');
    // Dependency mention only — not sufficient as assignment proof
    if (raw.includes('L_GR_CZ_PRACY')) {
      graph.claims.push({
        family: 'implementation_usage',
        claimType: 'package_dependency',
        object: 'TETA_ADMIN.L_GR_CZ_PRACY',
        weight: 1,
        provenance: ['stage2e:oracle-dep KP_LGRC_SQL→L_GR_CZ_PRACY'],
        notes: 'Package dependency without columns/joins is insufficient alone',
      });
    }
  }

  return graph;
}
