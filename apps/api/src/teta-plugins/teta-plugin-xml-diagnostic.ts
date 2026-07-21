/**
 * Read-only diagnostic: plugins.xml ↔ scanned DLLs ↔ Help/{GUID}.html
 * Does not write SQLite / Qdrant / mutate import pipeline.
 */
import { existsSync, statSync } from 'fs';
import * as path from 'path';
import {
  dllStem,
  findDuplicateAssemblies,
  matchPluginsByAssemblyExact,
  matchPluginsByAssemblyRelaxed,
  matchPluginsByClassNameHint,
  normalizeAssemblyKey,
  uniqueAssemblies,
} from './teta-plugin-assembly-match.util';
import { scanPluginDlls } from './teta-plugin-scan.util';
import {
  normalizeAssemblyName,
  readPluginsXml,
  resolvePluginsXmlPath,
} from './teta-plugin-xml.reader';
import { helpHtmlPath, normalizeHelpGuid, resolveHelpDirectory } from './teta-help-path.util';
import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';

export type PluginXmlDiagnosticRootCause = 'A' | 'B' | 'C' | 'D' | 'E';

export type PluginXmlDllDiagnostic = {
  dllPath: string;
  dllName: string;
  relativePath: string;
  normalizedAssemblyName: string;
  assemblyKeyRelaxed: string;
  exactXmlMatchCount: number;
  relaxedXmlMatchCount: number;
  classNameHintMatchCount: number;
  exactMatches: Array<{ Guid: string | null; ClassName: string | null; Assembly: string | null }>;
  relaxedMatches: Array<{ Guid: string | null; ClassName: string | null; Assembly: string | null }>;
  classNameHintMatches: Array<{ Guid: string | null; ClassName: string | null; Assembly: string | null }>;
  /** What production resolvePluginDescriptors would choose today. */
  productionSource: 'xml' | 'infer';
  /** Diagnostic: xml | infer | both (exact XML + would also infer path exists) */
  diagnosticSource: 'xml' | 'infer' | 'both_relaxed_only';
};

export type PluginXmlHelpDiagnostic = {
  guid: string;
  helpPath: string;
  exists: boolean;
  sizeBytes: number | null;
};

export type PluginXmlDiagnosticReport = {
  generatedAt: string;
  clientDirectory: string;
  clientDirectoryExists: boolean;
  pluginsXmlPath: string;
  pluginsXmlExists: boolean;
  helpDirectory: string;
  helpDirectoryExists: boolean;
  xmlPluginEntryCount: number;
  xmlAssemblyValues: string[];
  xmlDuplicateAssemblies: ReturnType<typeof findDuplicateAssemblies>;
  scannedDllCount: number;
  dlls: PluginXmlDllDiagnostic[];
  dllsMissingXmlExact: string[];
  dllsWithMultipleExactMatches: string[];
  dllsExactFailButRelaxedOk: string[];
  dllsExactFailButClassNameHint: string[];
  helpByGuid: PluginXmlHelpDiagnostic[];
  summary: {
    dllCount: number;
    xmlFormEntries: number;
    xmlEntriesWithGuid: number;
    dllsUsingXmlProduction: number;
    dllsUsingInferProduction: number;
    uniqueGuidsFromExactMatches: number;
    helpFilesExisting: number;
    helpFilesMissing: number;
  };
  rootCause: PluginXmlDiagnosticRootCause;
  rootCauseDetail: string;
};

function mapDescriptor(plugin: TetaPluginDescriptorMeta) {
  return {
    Guid: plugin.Guid ?? null,
    ClassName: plugin.ClassName ?? null,
    Assembly: plugin.Assembly ?? null,
  };
}

function collectGuidsFromDlls(dlls: PluginXmlDllDiagnostic[]): string[] {
  const guids = new Set<string>();
  for (const dll of dlls) {
    for (const match of dll.exactMatches) {
      const guid = normalizeHelpGuid(match.Guid);
      if (guid) guids.add(guid);
    }
  }
  return [...guids].sort();
}

export function chooseRootCause(input: {
  clientDirectory: string;
  clientDirectoryExists: boolean;
  pluginsXmlExists: boolean;
  xmlPluginEntryCount: number;
  scannedDllCount: number;
  dllsUsingXmlProduction: number;
  dllsUsingInferProduction: number;
  dllsExactFailButRelaxedOk: number;
}): { rootCause: PluginXmlDiagnosticRootCause; rootCauseDetail: string } {
  if (!input.clientDirectory.trim()) {
    return {
      rootCause: 'B',
      rootCauseDetail: 'Brak clientDirectory w konfiguracji (pusty ciąg).',
    };
  }
  if (!input.clientDirectoryExists) {
    return {
      rootCause: 'B',
      rootCauseDetail: `clientDirectory nie istnieje na dysku: ${input.clientDirectory}`,
    };
  }
  if (!input.pluginsXmlExists) {
    return {
      rootCause: 'A',
      rootCauseDetail: 'plugins.xml nie istnieje pod wyliczoną ścieżką.',
    };
  }
  if (input.xmlPluginEntryCount === 0) {
    return {
      rootCause: 'E',
      rootCauseDetail: 'plugins.xml istnieje, ale parser zwrócił 0 wpisów Plugin.',
    };
  }
  if (input.scannedDllCount === 0) {
    return {
      rootCause: 'B',
      rootCauseDetail: 'Brak przeskanowanych DLL w Plugins/ (katalog pusty, niedostępny lub zły clientDirectory).',
    };
  }
  if (input.dllsUsingXmlProduction === 0 && input.dllsUsingInferProduction > 0) {
    if (input.dllsExactFailButRelaxedOk > 0) {
      return {
        rootCause: 'C',
        rootCauseDetail:
          'XML jest odczytywany, ale exact match Assembly↔dllName nie działa dla żadnej DLL; relaxed (basename/path) znalazł dopasowania — typowy mismatch formatu Assembly.',
      };
    }
    return {
      rootCause: 'C',
      rootCauseDetail:
        'XML jest odczytywany, ale żadna skanowana DLL nie ma exact match po Assembly — produkcja zawsze wybiera infer (bez GUID).',
    };
  }
  if (
    input.dllsUsingXmlProduction > 0 &&
    input.dllsUsingInferProduction > 0 &&
    input.dllsUsingXmlProduction < input.scannedDllCount
  ) {
    return {
      rootCause: 'D',
      rootCauseDetail: `XML pokrywa tylko część DLL (${input.dllsUsingXmlProduction}/${input.scannedDllCount}); pozostałe idą przez infer.`,
    };
  }
  if (input.dllsUsingXmlProduction === input.scannedDllCount && input.scannedDllCount > 0) {
    return {
      rootCause: 'E',
      rootCauseDetail:
        'Wszystkie DLL mają exact match w XML — brak GUID w bazie wynika z innego problemu (poza samym matchingiem Assembly), np. stary import sprzed XML / inna maszyna.',
    };
  }
  return {
    rootCause: 'E',
    rootCauseDetail: 'Nietypowy układ wyników — wymaga ręcznej analizy raportu JSON.',
  };
}

export function runPluginsXmlDiagnostic(clientDirectory: string): PluginXmlDiagnosticReport {
  const client = clientDirectory.trim();
  const clientDirectoryExists = Boolean(client) && existsSync(client);
  const pluginsXmlPath = resolvePluginsXmlPath(client || '.');
  const pluginsXmlExists = existsSync(pluginsXmlPath);
  const helpDirectory = resolveHelpDirectory(client || '.');
  const helpDirectoryExists = existsSync(helpDirectory);

  const xmlPlugins = pluginsXmlExists ? readPluginsXml(pluginsXmlPath) : [];
  const { plugins: scanned } = clientDirectoryExists
    ? scanPluginDlls(client)
    : { plugins: [] as ReturnType<typeof scanPluginDlls>['plugins'] };

  const dlls: PluginXmlDllDiagnostic[] = scanned.map((plugin) => {
    const exact = matchPluginsByAssemblyExact(xmlPlugins, plugin.dllName);
    const relaxed = matchPluginsByAssemblyRelaxed(xmlPlugins, plugin.dllName);
    const byClass = matchPluginsByClassNameHint(xmlPlugins, plugin.dllName);
    const productionSource: 'xml' | 'infer' = exact.length > 0 ? 'xml' : 'infer';
    let diagnosticSource: PluginXmlDllDiagnostic['diagnosticSource'] = productionSource;
    if (productionSource === 'infer' && relaxed.length > 0) {
      diagnosticSource = 'both_relaxed_only';
    }

    return {
      dllPath: plugin.dllPath,
      dllName: plugin.dllName,
      relativePath: plugin.relativePath,
      normalizedAssemblyName: normalizeAssemblyName(plugin.dllName),
      assemblyKeyRelaxed: normalizeAssemblyKey(plugin.dllName),
      exactXmlMatchCount: exact.length,
      relaxedXmlMatchCount: relaxed.length,
      classNameHintMatchCount: byClass.length,
      exactMatches: exact.map(mapDescriptor),
      relaxedMatches: relaxed.map(mapDescriptor),
      classNameHintMatches: byClass.map(mapDescriptor),
      productionSource,
      diagnosticSource,
    };
  });

  const dllsMissingXmlExact = dlls
    .filter((item) => item.exactXmlMatchCount === 0)
    .map((item) => item.dllName);
  const dllsWithMultipleExactMatches = dlls
    .filter((item) => item.exactXmlMatchCount > 1)
    .map((item) => item.dllName);
  const dllsExactFailButRelaxedOk = dlls
    .filter((item) => item.exactXmlMatchCount === 0 && item.relaxedXmlMatchCount > 0)
    .map((item) => item.dllName);
  const dllsExactFailButClassNameHint = dlls
    .filter((item) => item.exactXmlMatchCount === 0 && item.classNameHintMatchCount > 0)
    .map((item) => item.dllName);

  const guids = collectGuidsFromDlls(dlls);
  // Also include all GUIDs from XML for help coverage overview
  const allXmlGuids = new Set(guids);
  for (const plugin of xmlPlugins) {
    const guid = normalizeHelpGuid(plugin.Guid);
    if (guid) allXmlGuids.add(guid);
  }

  const helpByGuid: PluginXmlHelpDiagnostic[] = [...allXmlGuids].sort().map((guid) => {
    const helpPath = helpDirectoryExists || client
      ? helpHtmlPath(helpDirectory, guid)
      : path.join('Help', `${guid}.html`);
    const exists = existsSync(helpPath);
    let sizeBytes: number | null = null;
    if (exists) {
      try {
        sizeBytes = statSync(helpPath).size;
      } catch {
        sizeBytes = null;
      }
    }
    return { guid, helpPath, exists, sizeBytes };
  });

  const dllsUsingXmlProduction = dlls.filter((item) => item.productionSource === 'xml').length;
  const dllsUsingInferProduction = dlls.filter((item) => item.productionSource === 'infer').length;
  const xmlEntriesWithGuid = xmlPlugins.filter((item) => Boolean(normalizeHelpGuid(item.Guid))).length;
  const uniqueGuidsFromExactMatches = guids.length;
  const helpFilesExisting = helpByGuid.filter((item) => item.exists).length;
  const helpFilesMissing = helpByGuid.filter((item) => !item.exists).length;

  const { rootCause, rootCauseDetail } = chooseRootCause({
    clientDirectory: client,
    clientDirectoryExists,
    pluginsXmlExists,
    xmlPluginEntryCount: xmlPlugins.length,
    scannedDllCount: dlls.length,
    dllsUsingXmlProduction,
    dllsUsingInferProduction,
    dllsExactFailButRelaxedOk: dllsExactFailButRelaxedOk.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    clientDirectory: client,
    clientDirectoryExists,
    pluginsXmlPath,
    pluginsXmlExists,
    helpDirectory,
    helpDirectoryExists,
    xmlPluginEntryCount: xmlPlugins.length,
    xmlAssemblyValues: uniqueAssemblies(xmlPlugins),
    xmlDuplicateAssemblies: findDuplicateAssemblies(xmlPlugins),
    scannedDllCount: dlls.length,
    dlls,
    dllsMissingXmlExact,
    dllsWithMultipleExactMatches,
    dllsExactFailButRelaxedOk,
    dllsExactFailButClassNameHint,
    helpByGuid,
    summary: {
      dllCount: dlls.length,
      xmlFormEntries: xmlPlugins.length,
      xmlEntriesWithGuid,
      dllsUsingXmlProduction,
      dllsUsingInferProduction,
      uniqueGuidsFromExactMatches,
      helpFilesExisting,
      helpFilesMissing,
    },
    rootCause,
    rootCauseDetail,
  };
}

export function formatPluginsXmlDiagnosticText(report: PluginXmlDiagnosticReport): string {
  const lines: string[] = [];
  lines.push('# AIA plugins.xml diagnostic');
  lines.push('');
  lines.push(`Wygenerowano: ${report.generatedAt}`);
  lines.push(`clientDirectory: ${report.clientDirectory || '(pusty)'}`);
  lines.push(`clientDirectory istnieje: ${report.clientDirectoryExists}`);
  lines.push(`plugins.xml: ${report.pluginsXmlPath}`);
  lines.push(`plugins.xml istnieje: ${report.pluginsXmlExists}`);
  lines.push(`Help/: ${report.helpDirectory} (istnieje: ${report.helpDirectoryExists})`);
  lines.push('');
  lines.push('## Podsumowanie');
  lines.push(`- DLL zeskanowane: ${report.summary.dllCount}`);
  lines.push(`- Wpisy Plugin w XML: ${report.summary.xmlFormEntries}`);
  lines.push(`- Wpisy XML z GUID: ${report.summary.xmlEntriesWithGuid}`);
  lines.push(`- Produkcja użyłaby XML: ${report.summary.dllsUsingXmlProduction}`);
  lines.push(`- Produkcja użyłaby infer: ${report.summary.dllsUsingInferProduction}`);
  lines.push(`- Unikalne GUID z exact match DLL: ${report.summary.uniqueGuidsFromExactMatches}`);
  lines.push(`- Pliki Help istniejące: ${report.summary.helpFilesExisting}`);
  lines.push(`- Pliki Help brakujące: ${report.summary.helpFilesMissing}`);
  lines.push(`- DLL bez exact XML: ${report.dllsMissingXmlExact.length}`);
  lines.push(`- DLL z >1 exact match: ${report.dllsWithMultipleExactMatches.length}`);
  lines.push(`- Exact fail, relaxed OK: ${report.dllsExactFailButRelaxedOk.length}`);
  lines.push(`- Exact fail, ClassName hint: ${report.dllsExactFailButClassNameHint.length}`);
  lines.push('');
  lines.push(`## Root cause: ${report.rootCause}`);
  lines.push(report.rootCauseDetail);
  lines.push('');
  lines.push('## Znaczenie liter');
  lines.push('- A — plugins.xml nie istnieje pod wyliczoną ścieżką');
  lines.push('- B — zły / pusty / nieistniejący clientDirectory');
  lines.push('- C — XML OK, ale Assembly nie pasuje do nazw DLL (exact)');
  lines.push('- D — XML pokrywa tylko część DLL');
  lines.push('- E — inny problem');
  lines.push('');

  if (report.xmlAssemblyValues.length > 0) {
    lines.push('## Przykładowe wartości Assembly w XML (max 30)');
    for (const value of report.xmlAssemblyValues.slice(0, 30)) {
      lines.push(`- ${value}`);
    }
    if (report.xmlAssemblyValues.length > 30) {
      lines.push(`- … (+${report.xmlAssemblyValues.length - 30})`);
    }
    lines.push('');
  }

  if (report.dllsExactFailButRelaxedOk.length > 0) {
    lines.push('## Exact fail, ale relaxed basename/path OK');
    for (const name of report.dllsExactFailButRelaxedOk.slice(0, 40)) {
      const row = report.dlls.find((item) => item.dllName === name);
      lines.push(
        `- ${name}: relaxed=${row?.relaxedXmlMatchCount}, GUID=${row?.relaxedMatches.map((m) => m.Guid).join(',')}`,
      );
    }
    lines.push('');
  }

  lines.push('## DLL → źródło produkcji');
  for (const dll of report.dlls.slice(0, 80)) {
    lines.push(
      `- ${dll.relativePath}: production=${dll.productionSource}, exact=${dll.exactXmlMatchCount}, relaxed=${dll.relaxedXmlMatchCount}, classHint=${dll.classNameHintMatchCount}`,
    );
  }
  if (report.dlls.length > 80) {
    lines.push(`- … (+${report.dlls.length - 80} DLL)`);
  }

  return lines.join('\n');
}

export { dllStem, normalizeAssemblyKey };
