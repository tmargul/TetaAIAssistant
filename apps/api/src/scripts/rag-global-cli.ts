import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { assertVendorEnabled } from '../rag/vendor-auth';
import { GlobalRagExportService } from '../rag/global-rag-export.service';
import { GlobalRagIngestService } from '../rag/global-rag-ingest.service';

function printUsage(): void {
  console.log(`
Użycie:
  rag-global ingest --input <katalog>
  rag-global export --version <wersja> --out <plik.zip>

Wymaga TETA_APP_MODE=vendor, TETA_VENDOR_SECRET (min. 32 znaki) oraz uruchomionych Ollama i Qdrant.
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

  assertVendorEnabled();

  const args = parseArgs(rest);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    if (command === 'ingest') {
      const input = args.input;
      if (!input) {
        throw new Error('Podaj --input <katalog> z dokumentami .txt / .md');
      }
      const ingest = app.get(GlobalRagIngestService);
      const result = await ingest.ingestFromDirectory(input);
      console.log(
        `Ingest zakończony: ${result.chunkCount} chunków, źródła: ${result.sources.join(', ')}`,
      );
      return;
    }

    if (command === 'export') {
      const version = args.version;
      const out = args.out;
      if (!version || !out) {
        throw new Error('Podaj --version <wersja> oraz --out <plik.zip>');
      }
      const exporter = app.get(GlobalRagExportService);
      const result = await exporter.exportPackage(version, out);
      console.log(
        `Export zakończony: ${result.outputPath} (${result.chunkCount} chunków, sha256: ${result.checksum})`,
      );
      return;
    }

    printUsage();
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
