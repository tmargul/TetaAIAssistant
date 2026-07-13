import { isFailedChatAttempt } from './chat-orchestrator-result.util';

describe('chat-orchestrator-result.util', () => {
  it('treats empty oracle answer as failure', () => {
    expect(
      isFailedChatAttempt(
        [
          {
            type: 'done',
            content: 'Zapytanie nie zwróciło żadnych wierszy spełniających kryteria.',
            model: 'qwen3',
            createdAt: new Date().toISOString(),
            timing: { totalMs: 1, ragMs: 0, llmMs: 1 },
          },
        ],
        null,
      ),
    ).toBe(true);
  });

  it('accepts useful docs answer', () => {
    expect(
      isFailedChatAttempt(
        [
          {
            type: 'done',
            content: 'Dataset w Teta to zestaw danych używany w raportach.',
            model: 'qwen3',
            createdAt: new Date().toISOString(),
            timing: { totalMs: 1, ragMs: 1, llmMs: 1 },
          },
        ],
        null,
      ),
    ).toBe(false);
  });
});
