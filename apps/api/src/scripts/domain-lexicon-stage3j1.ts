import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { buildDomainLexiconAudit } from '../teta-domain-lexicon/teta-domain-lexicon-audit';
import { loadDomainLexicon, loadDomainRegistry } from '../teta-domain-lexicon/teta-domain-lexicon-loader';
import { resolveDomainLexicon } from '../teta-domain-lexicon/teta-domain-lexicon-resolver';
import { validateDomainLexicon } from '../teta-domain-lexicon/teta-domain-lexicon-validator';
import { discoverHelpConceptCandidates } from '../teta-domain-lexicon/teta-help-concept-discovery.service';
import { inventoryKnowledgeSources } from '../teta-domain-lexicon/teta-domain-knowledge-source-inventory';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function main(): void {
  const cmd = process.argv[2] ?? 'audit';
  if (cmd === 'resolve' || cmd === 'explain') {
    const query = getArg('--query') ?? '';
    const result = resolveDomainLexicon(query);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (cmd === 'validate') {
    const { catalog } = loadDomainLexicon();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(validateDomainLexicon(catalog), null, 2));
    return;
  }
  if (cmd === 'domains') {
    const registry = loadDomainRegistry();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(registry, null, 2));
    return;
  }
  if (cmd === 'help-coverage') {
    const report = discoverHelpConceptCandidates(resolveRepoRoot()).coverage;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (cmd === 'discover-help') {
    const result = discoverHelpConceptCandidates(resolveRepoRoot());
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          warnings: result.warnings,
          coverage: result.coverage,
          sampleCandidates: result.candidates.slice(0, 20),
          candidateCount: result.candidates.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === 'inventory-knowledge') {
    const scanRoot = getArg('--path');
    if (!scanRoot) throw new Error('inventory-knowledge requires --path');
    const manifest = inventoryKnowledgeSources({
      scanRoot,
      domainId: getArg('--domain') ?? undefined,
      scope: (getArg('--scope') as 'global' | 'version' | 'client' | null) ?? undefined,
      productVersion: getArg('--product-version'),
    });
    const out = getArg('--out');
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ inventoried: manifest.sources.length, out: out ?? null }, null, 2));
    return;
  }
  if (cmd === 'coverage') {
    const fixturesPath = path.resolve(
      __dirname,
      '../../test-fixtures/teta-domain-lexicon/stage3j1-polish-phrases-v1.json',
    );
    const refs = JSON.parse(readFileSync(fixturesPath, 'utf8')) as Array<{ query: string }>;
    const stats = refs.map((r) => resolveDomainLexicon(r.query).status);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          references: refs.length,
          resolved: stats.filter((s) => s === 'resolved' || s === 'resolved_with_warnings').length,
          ambiguous: stats.filter((s) => s === 'ambiguous').length,
          unresolved: stats.filter((s) => s === 'unresolved').length,
        },
        null,
        2,
      ),
    );
    return;
  }
  const strict = process.argv.includes('--strict');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(buildDomainLexiconAudit(strict, resolveRepoRoot()), null, 2));
}

main();
