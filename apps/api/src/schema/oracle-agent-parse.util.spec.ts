import {
  buildAgentJsonFailureMessage,
  looksLikeAgentJson,
  parseAgentAction,
} from './oracle-agent-parse.util';

describe('oracle-agent-parse.util', () => {
  it('parses compact answer JSON with sql', () => {
    const action = parseAgentAction(
      '{"action":"answer","text":"—","sql":"SELECT IMIE, NAZWISKO FROM T_PRAC WHERE NR_EWIDENCYJNY = \'00122\'"}',
    );
    expect(action).toEqual({
      action: 'answer',
      text: '—',
      sql: "SELECT IMIE, NAZWISKO FROM T_PRAC WHERE NR_EWIDENCYJNY = '00122'",
    });
  });

  it('recovers sql from truncated JSON', () => {
    const action = parseAgentAction(
      '{"action":"answer","text":"—","sql":"SELECT IMIE, NAZWISKO FROM T_PRAC WHERE NR_EWIDENCYJNY = \'00122\'',
    );
    expect(action?.action).toBe('answer');
    expect(action && 'sql' in action ? action.sql : '').toContain('FROM T_PRAC');
  });

  it('rejects truncated sql without FROM', () => {
    const action = parseAgentAction('{"action":"answer","text":"—","sql":"SELECT HEAD.ID, HEAD.SL');
    expect(action).toBeNull();
  });

  it('detects leaked agent JSON', () => {
    expect(looksLikeAgentJson('{"action":"answer","text":"—","sql":"SELECT 1 FROM DUAL"}')).toBe(
      true,
    );
    expect(looksLikeAgentJson('To jest zwykła odpowiedź.')).toBe(false);
  });

  it('uses fallback failure message text', () => {
    expect(buildAgentJsonFailureMessage()).toContain('niepełna');
  });
});
