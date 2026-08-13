/**
 * ApplicationAnchorResolver — semantic anchors only (no Oracle physical mappings).
 */
import fs from 'fs';
import path from 'path';
import { recognizeConceptLexicon } from './teta-stage4-lexicon';

export type SemanticApplicationAnchor = {
  anchorId: string;
  anchorType: 'pa_plugin' | 'pa_form_token' | 'concept_token' | 'module_hint';
  label: string;
  formRef?: string | null;
  controlName?: string | null;
  datasetName?: string | null;
  moduleHint?: string | null;
  recognitionSource: string;
  recognitionConfidence: 'exact' | 'strong' | 'weak';
  semanticEvidence: string[];
  /** Tokens used to seed ACE name matching — not physical Oracle IDs */
  matchTokens: string[];
};

export type ApplicationAnchorResolveResult = {
  anchors: SemanticApplicationAnchor[];
  semanticAnchorsFound: number;
  lexiconEntryIds: string[];
  tokensUsed: string[];
};

const MAX_SEMANTIC_ANCHORS = 24;

function tokenHits(haystack: string, tokens: string[]): string[] {
  const lower = haystack.toLowerCase();
  return tokens.filter((t) => lower.includes(t.toLowerCase()));
}

/**
 * Resolve application semantic anchors from PA registry + concept lexicon.
 * Does NOT create Oracle physical mappings and does NOT scan Stage2B gateways.
 */
export function resolveApplicationAnchors(input: {
  repoRoot: string;
  businessConcept: string;
  applicationContext?: string | null;
  moduleHint?: string | null;
}): ApplicationAnchorResolveResult {
  const lex = recognizeConceptLexicon(input.businessConcept);
  const tokens = [...lex.semanticTokens];
  if (input.moduleHint) tokens.push(input.moduleHint);
  if (input.applicationContext) {
    for (const w of input.applicationContext.split(/\W+/)) {
      if (w.length >= 4) tokens.push(w);
    }
  }

  const anchors: SemanticApplicationAnchor[] = [];
  let i = 0;

  // Concept tokens themselves as weak semantic anchors
  for (const t of lex.semanticTokens.slice(0, 8)) {
    anchors.push({
      anchorId: `sem-${i++}`,
      anchorType: 'concept_token',
      label: t,
      recognitionSource: 'concept_lexicon',
      recognitionConfidence: 'strong',
      semanticEvidence: [`lexicon_token:${t}`, `concept:${input.businessConcept}`],
      matchTokens: [t],
    });
  }

  const paPath = path.join(input.repoRoot, 'docs', 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  if (fs.existsSync(paPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(paPath, 'utf8')) as {
        examples?: Record<string, Array<Record<string, unknown>>>;
      };
      const buckets = Object.values(raw.examples ?? {});
      for (const list of buckets) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (anchors.length >= MAX_SEMANTIC_ANCHORS) break;
          const className = String(entry.className ?? '');
          const simple = String(entry.simpleClassName ?? '');
          const pluginName = String(entry.pluginName ?? '');
          const assembly = String(entry.assembly ?? '');
          const formIdentity = String(entry.formIdentity ?? '');
          const blob = `${className}|${simple}|${pluginName}|${assembly}|${formIdentity}`;
          const hits = tokenHits(blob, tokens);
          if (hits.length === 0) continue;
          anchors.push({
            anchorId: `sem-${i++}`,
            anchorType: formIdentity || className ? 'pa_plugin' : 'pa_form_token',
            label: pluginName || simple || className || hits[0]!,
            formRef: formIdentity || className || null,
            moduleHint: assembly.replace(/\.dll$/i, '') || null,
            recognitionSource: 'docs:AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
            recognitionConfidence: hits.length >= 2 ? 'exact' : 'strong',
            semanticEvidence: [
              `pa_registry:${entry.registryId ?? 'unknown'}`,
              ...hits.map((h) => `token:${h}`),
            ],
            matchTokens: hits,
          });
        }
      }
    } catch {
      // ignore malformed PA summary
    }
  }

  for (const m of lex.moduleHints) {
    if (anchors.length >= MAX_SEMANTIC_ANCHORS) break;
    anchors.push({
      anchorId: `sem-${i++}`,
      anchorType: 'module_hint',
      label: m,
      moduleHint: m,
      recognitionSource: 'concept_lexicon_module',
      recognitionConfidence: 'weak',
      semanticEvidence: [`module_hint:${m}`],
      matchTokens: [m],
    });
  }

  return {
    anchors: anchors.slice(0, MAX_SEMANTIC_ANCHORS),
    semanticAnchorsFound: Math.min(anchors.length, MAX_SEMANTIC_ANCHORS),
    lexiconEntryIds: lex.matchedEntries.map((e) => e.id),
    tokensUsed: [...new Set(tokens)],
  };
}
