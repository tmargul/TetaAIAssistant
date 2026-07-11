import * as path from 'path';
import {
  findPluginViewClassNamesInDllStrings,
  readDllStrings,
} from './teta-dll-string-scanner';
import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';
import type { TetaPluginSourceLocator } from './teta-plugin-source-locator';
import { normalizeAssemblyName } from './teta-plugin-xml.reader';

const FQN_PATTERN = /\b([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*){2,})\b/g;
const PLUGIN_CLASS_SUFFIX =
  /(?:Widok|Form|Plugin|Card|Panel|Module|Control|Editor|Dialog|Window)$/i;
const PREFERRED_PLUGIN_FILE = /(?:Widok|Form|Plugin|Card|Panel|Module|Editor|Dialog)\.cs$/i;

function pluginStemFromDllName(dllName: string): string {
  return dllName.replace(/\.dll$/i, '');
}

function isLikelyPluginFqn(fqName: string, pluginStem: string): boolean {
  const lower = fqName.toLowerCase();
  const stemLower = pluginStem.toLowerCase();
  if (!lower.includes(stemLower)) return false;

  const simpleName = fqName.split('.').pop() ?? '';
  return PLUGIN_CLASS_SUFFIX.test(simpleName);
}

export function pickPrimaryPluginClassName(candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  const widokClasses = candidates.filter((candidate) =>
    /Widok$/i.test(candidate.split('.').pop() ?? ''),
  );
  const pool = widokClasses.length > 0 ? widokClasses : candidates;

  return [...pool].sort((a, b) => {
    const aSimple = a.split('.').pop() ?? '';
    const bSimple = b.split('.').pop() ?? '';
    if (aSimple.length !== bSimple.length) {
      return bSimple.length - aSimple.length;
    }
    return b.localeCompare(a, 'pl');
  })[0];
}

export function findPluginClassNamesInDllStrings(
  strings: string[],
  pluginStem: string,
): string[] {
  const result = new Set<string>();

  for (const text of strings) {
    if (!text.toLowerCase().includes(pluginStem.toLowerCase())) continue;

    if (
      text.includes('.') &&
      text.length <= 220 &&
      isLikelyPluginFqn(text.trim(), pluginStem)
    ) {
      result.add(text.trim());
    }

    FQN_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(FQN_PATTERN)) {
      const fqName = match[1]?.trim();
      if (fqName && isLikelyPluginFqn(fqName, pluginStem)) {
        result.add(fqName);
      }
    }
  }

  return [...result].sort((a, b) => a.localeCompare(b, 'pl'));
}

function filterPluginSourceCandidates(files: string[]): string[] {
  const unique = [...new Set(files)];
  const preferred = unique.filter((file) => PREFERRED_PLUGIN_FILE.test(file));
  const candidates = preferred.length > 0 ? preferred : unique;

  return candidates
    .filter((file) => !/\.designer\.cs$/i.test(file))
    .filter((file) => !/(?:\\|\/)Properties(?:\\|\/)/i.test(file))
    .slice(0, 20);
}

function classNameFromSourceFile(filePath: string): string {
  return path.basename(filePath, '.cs');
}

export function inferPluginDescriptorsFromDll(options: {
  dllPath: string;
  dllName: string;
  locator?: TetaPluginSourceLocator | null;
}): TetaPluginDescriptorMeta[] {
  const assembly = normalizeAssemblyName(options.dllName);
  const pluginStem = pluginStemFromDllName(options.dllName);
  const dllStrings = readDllStrings(options.dllPath);
  const classNames = new Set<string>();

  for (const fqName of findPluginClassNamesInDllStrings(dllStrings, pluginStem)) {
    classNames.add(fqName);
  }

  const sourceFiles =
    options.locator?.findPluginSourceFilesByStem(pluginStem) ?? [];
  for (const sourceFile of filterPluginSourceCandidates(sourceFiles)) {
    classNames.add(classNameFromSourceFile(sourceFile));
  }

  const viewClassNames = findPluginViewClassNamesInDllStrings(dllStrings).filter(
    (className) => className !== 'ContextMultiCardFrameWidok',
  );
  for (const viewClassName of viewClassNames) {
    classNames.add(viewClassName);
  }

  if (classNames.size === 0) {
    return [
      {
        Assembly: assembly,
        ClassName: null,
        Languages: [],
      },
    ];
  }

  const primaryClassName = pickPrimaryPluginClassName([...classNames]);
  const languages =
    viewClassNames.length > 0
      ? viewClassNames.map((viewClassName) => ({
          LanguagePrefix: 'PL',
          Name: viewClassName.replace(/Widok$/, ''),
        }))
      : [];

  return [
    {
      Assembly: assembly,
      ClassName: primaryClassName,
      Languages: languages,
    },
  ];
}
