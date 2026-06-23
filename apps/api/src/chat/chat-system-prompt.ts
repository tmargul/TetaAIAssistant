import {
  isDefinitionQuery,
  isProcedureQuery,
} from './chat-context.util';

export type ChatQueryKind = 'definition' | 'procedure' | 'general';

export function detectChatQueryKind(userMessage: string): ChatQueryKind {
  if (isDefinitionQuery(userMessage)) {
    return 'definition';
  }
  if (isProcedureQuery(userMessage)) {
    return 'procedure';
  }
  return 'general';
}

function queryKindHint(kind: ChatQueryKind): string {
  switch (kind) {
    case 'definition':
      return (
        'Typ pytania: definicja / klasyfikacja. ' +
        'Podaj wyłącznie to, co wynika z właściwej sekcji w [1]. ' +
        'Gdy jest lista po „następujących cech:” — wymień ją w całości. ' +
        'Nie dodawaj pozycji z innych zakładek wymienionych w tym samym fragmencie.'
      );
    case 'procedure':
      return (
        'Typ pytania: procedura („jak…”). Kolejność odpowiedzi: ' +
        '(1) skąd w systemie Teta — Nawigator / Kartoteka / formularz, ' +
        '(2) jaka akcja lub kreator, ' +
        '(3) najważniejsze kroki lub pola — tylko jeśli są w [1]. ' +
        'Zdanie „tylko i wyłącznie z…” ma pierwszeństwo, jeśli występuje w [1].'
      );
    default:
      return (
        'Odpowiedz konkretnie na pytanie, cytując fakty z [1]. ' +
        'Jeśli [1] nie zawiera odpowiedzi — powiedz, że brak informacji w bazie.'
      );
  }
}

const METHODOLOGY = [
  'Jesteś asystentem Teta AI. Budujesz odpowiedź sam — na podstawie kontekstu RAG, nie z pamięci prawnej.',
  '',
  'Metodyka:',
  '1. Przeczytaj [1] (i ewentualnie [2]). To jedyna dozwolona wiedza.',
  '2. Wybierz zdanie lub sekcję, która BEZPOŚREDNIO odpowiada na pytanie. Pomiń sąsiednie zakładki i spis treści.',
  '3. Ułóż 1–4 krótkie zdania po polsku — własnymi słowami, ale bez nowych faktów.',
  '4. Podaj numer źródła: [1] (lub [2], jeśli z niego korzystasz).',
  '',
  'Zakazy: bez „np.” z własnej wiedzy, bez Kodeksu pracy, bez domysłów. ' +
    'Nie twórz list kroków ze spisu treści ani z nagłówków obok właściwej sekcji.',
];

const STYLE_EXAMPLES = [
  '',
  'Wzorce (ucz się sposobu, nie kopiuj treści):',
  '• Definicja: „W Tecie urlopy dodatkowe to nieobecności ze słownika … z cech: A, B, C. [1]”',
  '• Procedura: „Zwolnienie wykonasz z Kartoteki pracowników (Nawigator | Pracownicy). Akcja: … → kreator …. [1]”',
  '• Brak danych: „Nie mam tej informacji w bazie wiedzy Teta.”',
];

export function buildChatSystemPrompt(options: {
  ragContext: string | null;
  userMessage: string;
}): string {
  const kind = detectChatQueryKind(options.userMessage);
  const parts = [...METHODOLOGY, queryKindHint(kind), ...STYLE_EXAMPLES];

  if (!options.ragContext) {
    return [...parts, '', 'Kontekst RAG: brak.', 'Użyj zdania o braku informacji.'].join('\n');
  }

  return [...parts, '', 'Kontekst RAG:', options.ragContext].join('\n');
}
