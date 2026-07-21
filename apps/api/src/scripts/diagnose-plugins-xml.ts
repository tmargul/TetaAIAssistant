/**
 * Read-only CLI: diagnose plugins.xml vs scanned DLLs for configured clientDirectory.
 *
 * Usage:
 *   pnpm --filter @teta/api exec ts-node -r tsconfig-paths/register src/scripts/diagnose-plugins-xml.ts
 *   pnpm --filter @teta/api exec ts-node -r tsconfig-paths/register src/scripts/diagnose-plugins-xml.ts --client "A:\\Teta Client"
 *
 * Never writes SQLite / Qdrant.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  formatPluginsXmlDiagnosticText,
  runPluginsXmlDiagnostic,
} from '../teta-plugins/teta-plugin-xml-diagnostic';

function readClientDirectoryFromSqlite(dbPath: string): string {
  if (!existsSync(dbPath)) {
    return '';
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'teta_app.client_directory'`)
      .get() as { value?: string } | undefined;
    return row?.value?.trim() ?? '';
  } finally {
    db.close();
  }
}

function parseArgs(argv: string[]): { clientDirectory: string | null; outDir: string } {
  let clientDirectory: string | null = null;
  let outDir = path.resolve(process.cwd(), '../../docs');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--client' || arg === '--clientDirectory') {
      clientDirectory = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--out') {
      outDir = path.resolve(argv[i + 1] ?? outDir);
      i += 1;
    }
  }
  return { clientDirectory, outDir };
}

function main() {
  const { clientDirectory: argClient, outDir } = parseArgs(process.argv.slice(2));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const fromDb = readClientDirectoryFromSqlite(dbPath);
  const clientDirectory = (argClient ?? fromDb).trim();

  const report = runPluginsXmlDiagnostic(clientDirectory);
  const text = formatPluginsXmlDiagnosticText(report);

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'AIA_PLUGIN_XML_DIAGNOSTIC.json');
  const mdPath = path.join(outDir, 'AIA_PLUGIN_XML_DIAGNOSTIC.md');

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    text,
    '',
    '---',
    '',
    'Pełny wynik JSON: `docs/AIA_PLUGIN_XML_DIAGNOSTIC.json`',
    '',
    '## Konfiguracja odczytu',
    '',
    `- SQLite: \`${dbPath}\` (tylko odczyt)`,
    `- clientDirectory ze SQLite: \`${fromDb || '(brak)'}\``,
    `- clientDirectory użyty: \`${clientDirectory || '(pusty)'}\``,
    argClient ? `- nadpisanie CLI --client: \`${argClient}\`` : '- bez nadpisania CLI',
    '',
  ].join('\n');

  writeFileSync(mdPath, md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(text);
  // eslint-disable-next-line no-console
  console.log(`\nZapisano:\n- ${mdPath}\n- ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`\nROOT CAUSE: ${report.rootCause} — ${report.rootCauseDetail}`);
}

main();
