import { buildChatSystemPrompt, detectChatQueryKind } from './chat-system-prompt';

describe('chat-system-prompt', () => {
  it('rozpoznaje typ pytania', () => {
    expect(detectChatQueryKind('który urlop jest dodatkowy')).toBe('definition');
    expect(detectChatQueryKind('Jak zwolnić pracownika?')).toBe('procedure');
    expect(detectChatQueryKind('Opisz moduł kadry')).toBe('general');
  });

  it('zawiera metodologię i wskazówkę dla procedury', () => {
    const prompt = buildChatSystemPrompt({
      userMessage: 'Jak zwolnić pracownika?',
      ragContext: '[1] Ewidencja kadrowa.docx\nPracownika możemy zwolnić…',
    });

    expect(prompt).toContain('Metodyka');
    expect(prompt).toContain('Typ pytania: procedura');
    expect(prompt).toContain('Kartoteki');
    expect(prompt).toContain('Kontekst RAG');
  });
});
