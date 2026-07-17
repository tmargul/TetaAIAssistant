/**
 * Usuwa z zapytania tokeny wyglądające na imię/nazwisko, żeby RAG wtyczek
 * trafiał w etykiety pól („stanowisko”, „ile ma lat”) zamiast w embedding nazwiska.
 */
export function stripPersonNameLiteralsForPluginSearch(query: string): string {
  // Nie używamy \b — w JS granica słowa nie obejmuje polskich znaków (ś, ć…),
  // więc „Styś” byłoby cięte do „Sty”.
  const stripped = query
    .replace(
      /(?<!\p{L})\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?(?:\s+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)?(?!\p{L})/gu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 8 ? stripped : query.trim();
}
