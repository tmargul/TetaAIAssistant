import { readFile } from 'fs/promises';
import { validateKnowledgeChunkLines } from '@teta/shared';

function printUsage(): void {
  console.log(`
Użycie:
  rag:validate-chunks -- --input <plik.jsonl>

Waliduje plik knowledge-chunks.jsonl (format teta-knowledge-chunk-v1).
Kod wyjścia: 0 = OK, 1 = błędy walidacji lub brak pliku.
`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Brak wartości dla argumentu ${token}`);
      }
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command !== 'validate') {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);
  const input = args.input;
  if (!input) {
    throw new Error('Podaj --input <plik.jsonl>');
  }

  const content = await readFile(input, 'utf8');
  const result = validateKnowledgeChunkLines(content);

  console.log(`Format: ${result.format}`);
  console.log(`Chunków: ${result.chunkCount}`);
  console.log(`Źródeł: ${result.sources.length}`);

  if (result.issues.length > 0) {
    console.error('\nBłędy walidacji:');
    for (const issue of result.issues) {
      const prefix = issue.line > 0 ? `Linia ${issue.line}` : 'Plik';
      console.error(`  ${prefix}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Walidacja OK.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
