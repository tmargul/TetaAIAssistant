import { readFileSync } from 'fs';
import { join } from 'path';

export type TetaImplicitFilterGroup = {
  id: string;
  labelTokens: string[];
  ambiguousOrder?: boolean;
};

export type TetaQueryLanguageConfig = {
  filterPrepositions: string[];
  grammarParticles: string[];
  queryNoiseTokens?: string[];
  implicitFilterExcludeLabelPatterns?: string[];
  implicitFilterGroups?: TetaImplicitFilterGroup[];
  caseInsensitiveTextFilters?: boolean;
};

let cachedConfig: TetaQueryLanguageConfig | null = null;

function resolveConfigPath(): string {
  return join(__dirname, '..', '..', 'config', 'teta-query-language.json');
}

const DEFAULT_CONFIG: TetaQueryLanguageConfig = {
  filterPrepositions: ['o', 'z', 'ze', 'wg', 'wedlug', 'według', 'where'],
  grammarParticles: ['o', 'z', 'ze', 'wg', 'wedlug', 'według', 'where', 'nr', 'numer', 'numerze'],
  queryNoiseTokens: [
    'pracownik',
    'pracownika',
    'pracownicy',
    'tego',
    'mi',
    'podaj',
    'jaki',
    'jaka',
    'jakie',
    'jak',
    'jest',
    'ma',
    'znajdz',
    'znajdź',
    'wyswietl',
    'wyświetl',
    'pokaz',
    'pokaż',
    'ok',
    'teraz',
    'powiedz',
    'a',
    'dobrze',
    'wiec',
    'więc',
  ],
  implicitFilterExcludeLabelPatterns: [],
  implicitFilterGroups: [
    {
      id: 'person_name',
      labelTokens: ['nazwisko', 'imie'],
      ambiguousOrder: true,
    },
  ],
  caseInsensitiveTextFilters: true,
};

export function loadQueryLanguageConfig(): TetaQueryLanguageConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const raw = readFileSync(resolveConfigPath(), 'utf-8');
    cachedConfig = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<TetaQueryLanguageConfig>) };
  } catch {
    cachedConfig = DEFAULT_CONFIG;
  }

  return cachedConfig;
}

export function resetQueryLanguageConfigCache(): void {
  cachedConfig = null;
}
