import { NestFactory } from '@nestjs/core';
import * as path from 'path';
import { AppModule } from '../app.module';
import { GlobalRagImportService } from '../rag/global-rag-import.service';

function printUsage(): void {
  console.log(`
Użycie:
  rag-import --file <plik.zip>

Importuje paczkę globalnego RAG do Qdrant (tryb client).
Wymaga uruchomionego Qdrant.
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

  if (command !== 'import') {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);
  const file = args.file;
  if (!file) {
    throw new Error('Podaj --file <plik.zip> z paczką globalnego RAG');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const importer = app.get(GlobalRagImportService);
    const result = await importer.importPackage(path.resolve(file));
    console.log(
      `Import zakończony: wersja ${result.version}, ${result.chunkCount} chunków, kolekcja ${result.collection}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
