export type AgentAction =
  | { action: 'tool'; name: string; args: Record<string, string> }
  | { action: 'answer'; text: string; sql?: string }
  | { action: 'clarify'; text: string };

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function unescapeJsonString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

export function looksLikeAgentJson(raw: string): boolean {
  const trimmed = stripMarkdownFences(raw.trim());
  return trimmed.startsWith('{') && /"action"\s*:/.test(trimmed);
}

export function parseAgentAction(raw: string): AgentAction | null {
  const cleaned = stripMarkdownFences(raw.trim());
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as AgentAction;
      const normalized = normalizeParsedAction(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      // fall through to partial JSON recovery
    }
  }

  return parseAgentActionFallback(cleaned);
}

function normalizeParsedAction(parsed: AgentAction): AgentAction | null {
  if (parsed.action === 'tool' && parsed.name) {
    return { action: 'tool', name: parsed.name, args: parsed.args ?? {} };
  }
  if (parsed.action === 'answer' && (parsed.text || parsed.sql?.trim())) {
    return {
      action: 'answer',
      text: parsed.text?.trim() || '—',
      sql: parsed.sql?.trim() || undefined,
    };
  }
  if (parsed.action === 'clarify' && parsed.text?.trim()) {
    return { action: 'clarify', text: parsed.text.trim() };
  }
  return null;
}

function parseAgentActionFallback(cleaned: string): AgentAction | null {
  const actionMatch = cleaned.match(/"action"\s*:\s*"(tool|answer|clarify)"/i);
  if (!actionMatch) {
    return null;
  }

  const action = actionMatch[1].toLowerCase();
  if (action === 'answer') {
    const sql = extractPartialSqlField(cleaned);
    if (sql) {
      return { action: 'answer', text: '—', sql };
    }
    return null;
  }

  if (action === 'clarify') {
    const text = extractPartialTextField(cleaned);
    if (text) {
      return { action: 'clarify', text };
    }
    return null;
  }

  if (action === 'tool') {
    const nameMatch = cleaned.match(/"name"\s*:\s*"([^"]+)"/i);
    if (nameMatch?.[1]) {
      return { action: 'tool', name: nameMatch[1], args: {} };
    }
  }

  return null;
}

function extractPartialSqlField(cleaned: string): string | null {
  const sqlStart = cleaned.match(/"sql"\s*:\s*"/i);
  if (!sqlStart || sqlStart.index === undefined) {
    return null;
  }

  const valueStart = sqlStart.index + sqlStart[0].length;
  let sql = '';
  for (let index = valueStart; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (char === '\\' && index + 1 < cleaned.length) {
      sql += cleaned[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') {
      break;
    }
    sql += char;
  }

  sql = unescapeJsonString(sql).trim();
  if (!/^SELECT\s/i.test(sql)) {
    return null;
  }
  if (!/\bFROM\b/i.test(sql)) {
    return null;
  }
  return sql;
}

function extractPartialTextField(cleaned: string): string | null {
  const textMatch = cleaned.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (!textMatch?.[1]) {
    return null;
  }
  return unescapeJsonString(textMatch[1]).trim();
}

export function buildAgentJsonRetryHint(): string {
  return (
    'Poprzednia odpowiedź była ucięta lub niepoprawnym JSON. ' +
    'Zwróć WYŁĄCZNIE jeden obiekt JSON bez markdown. ' +
    'W sql użyj SELECT z 2–8 kolumnami potrzebnymi do pytania — nie kopiuj całej listy z describe_table.'
  );
}

export function buildAgentJsonFailureMessage(): string {
  return (
    'Nie udało się wykonać zapytania — odpowiedź modelu była niepełna. ' +
    'Spróbuj ponownie lub uprość pytanie (np. podaj numer ewidencyjny i oczekiwane pola).'
  );
}
