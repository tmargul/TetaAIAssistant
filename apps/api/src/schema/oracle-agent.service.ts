import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import type {
  ChatCompletionRequest,
  ChatHistoryMessage,
  ChatOracleStep,
  ChatStreamEvent,
  OracleAgentDomain,
  OracleAgentSqlStep,
  OracleReport,
  SchemaTableInfo,
} from '@teta/shared';
import { isOracleVendorDebug, sanitizeOracleStreamEventForClient } from '@teta/shared';
import { OllamaChatService } from '../chat/ollama-chat.service';
import { resolveChatQualityProfile } from '../chat/chat-quality.profile';
import { ConfigService } from '@nestjs/config';
import { SchemaExplorerService } from './schema-explorer.service';
import { OracleQueryService } from './oracle-query.service';
import { SchemaProcedureService } from './schema-procedure.service';
import { SchemaCrawlService } from './schema-crawl.service';
import { resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import { getBuildAppMode } from '../rag/app-mode';

type AgentAction =
  | { action: 'tool'; name: string; args: Record<string, string> }
  | { action: 'answer'; text: string; sql?: string };

const DOMAIN_PROMPTS: Record<OracleAgentDomain, string> = {
  general: 'Jesteś asystentem bazy Teta — ogólny kontekst schematu.',
  payroll: 'Jesteś agentem domeny Płace — skupiasz się na tabelach wynagrodzeń, pracowników, list płac.',
  hr: 'Jesteś agentem domeny Kadry — etaty, umowy, dane osobowe pracowników.',
  attendance: 'Jesteś agentem domeny Czasy pracy — absencje, obecności, grafiki.',
  config: 'Jesteś agentem konfiguracji — słowniki SL_, parametry systemowe.',
};

@Injectable()
export class OracleAgentService {
  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaChatService,
    private readonly explorer: SchemaExplorerService,
    private readonly query: OracleQueryService,
    private readonly procedures: SchemaProcedureService,
    private readonly crawl: SchemaCrawlService,
  ) {}

  async streamComplete(
    input: ChatCompletionRequest,
    res: Response,
    userId?: number,
    workMode = getBuildAppMode(),
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event: ChatStreamEvent) => {
      const payload = showOracleDebug ? event : sanitizeOracleStreamEventForClient(event);
      if (!payload) return;
      res.write(`${JSON.stringify(payload)}\n`);
    };

    const startedAt = Date.now();
    const showOracleDebug = isOracleVendorDebug(workMode);
    const domain = input.oracleDomain ?? 'general';
    const steps: ChatOracleStep[] = [];
    const sqlSteps: OracleAgentSqlStep[] = [];
    const reports: OracleReport[] = [];

    try {
      const stats = this.crawl.getStats();
      if (stats.nodeCount === 0) {
        throw new BadRequestException(
          'Graf schematu jest pusty — uruchom „Analizuj bazę” w ustawieniach Oracle.',
        );
      }

      const message = input.message.trim();
      if (!message) {
        throw new BadRequestException('Wiadomość nie może być pusta.');
      }

      const profile = resolveChatQualityProfile(input.quality, this.config);
      const history = this.normalizeHistory(input.history, profile.maxHistory, profile.maxHistoryChars);
      const maxIterations = Number(this.config.get('TETA_ORACLE_AGENT_MAX_STEPS', 8));

      const toolContext: string[] = [];
      let finalAnswer = '';
      let lastDescribeTable: SchemaTableInfo | null = null;

      for (let i = 0; i < maxIterations; i += 1) {
        const systemPrompt = this.buildSystemPrompt(domain, toolContext);
        const agentPrompt = this.buildAgentPrompt(message, i);

        const response = await this.ollama.complete(
          [
            { role: 'system', content: systemPrompt },
            ...history.map((item) => ({ role: item.role, content: item.content })),
            { role: 'user', content: agentPrompt },
          ],
          input.model,
          input.quality,
        );

        const action = this.parseAction(response);
        if (!action) {
          finalAnswer = response.trim();
          break;
        }

        if (action.action === 'answer') {
          if (action.sql?.trim()) {
            const report = await this.runSql(
              action.sql,
              userId,
              domain,
              writeEvent,
              steps,
              sqlSteps,
              reports,
            );
            finalAnswer = this.buildSqlResultSummary(report);
          } else if (this.isRequiredColumnsQuestion(message) && lastDescribeTable) {
            finalAnswer = this.buildRequiredColumnsAnswer(lastDescribeTable);
          } else {
            finalAnswer = action.text.trim();
          }
          break;
        }

        const toolResult = await this.runTool(action.name, action.args, domain, userId);
        if (toolResult.describeTable) {
          lastDescribeTable = toolResult.describeTable;
        }
        const step: ChatOracleStep = {
          tool: action.name,
          summary: toolResult.summary,
        };
        steps.push(step);
        writeEvent({ type: 'oracle_step', step });
        toolContext.push(`Tool ${action.name}(${JSON.stringify(action.args)}):\n${toolResult.detail}`);
      }

      if (!finalAnswer) {
        finalAnswer =
          'Nie udało się ustalić odpowiedzi w limicie kroków agenta. Spróbuj doprecyzować pytanie.';
      }

      for (const char of finalAnswer) {
        writeEvent({ type: 'token', delta: char });
      }

      const totalMs = Date.now() - startedAt;
      writeEvent({
        type: 'done',
        content: finalAnswer,
        model: input.model,
        createdAt: new Date().toISOString(),
        timing: { totalMs, ragMs: 0, llmMs: totalMs },
        oracleSteps: steps,
        oracleSql: sqlSteps,
        oracleReports: reports,
      });
      res.end();
    } catch (error) {
      const message =
        error instanceof BadRequestException || error instanceof ServiceUnavailableException
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      writeEvent({ type: 'error', message });
      res.end();
    }
  }

  private async runTool(
    name: string,
    args: Record<string, string>,
    domain: OracleAgentDomain,
    userId?: string | number,
  ): Promise<{ summary: string; detail: string; describeTable?: SchemaTableInfo }> {
    switch (name) {
      case 'find_path': {
        const result = this.explorer.findPath(
          args.from ?? args.from_table ?? '',
          args.to ?? args.to_table ?? '',
          userId ? String(userId) : undefined,
        );
        const pathText = result.steps
          .map((step) => `${step.table} (${step.column}, ${step.edgeType})`)
          .join(' → ');
        return {
          summary: result.found
            ? `Ścieżka: ${pathText || 'ta sama tabela'}${result.cached ? ' [cache]' : ''}`
            : result.message ?? 'Brak ścieżki',
          detail: JSON.stringify(result, null, 2),
        };
      }
      case 'describe_table': {
        const result = this.explorer.describeTable(args.table ?? args.name ?? '');
        const table = result.table;
        const insertRequiredColumns =
          table?.columns.filter((c) => c.insertRequired).map((c) => c.name) ?? [];
        const notNullWithDefaultColumns =
          table?.columns
            .filter((c) => !c.nullable && !c.insertRequired && !c.isPk)
            .map((c) => c.name) ?? [];
        const cols =
          table?.columns
            .map((c) => {
              const flags = [
                c.isPk ? 'PK' : null,
                c.insertRequired ? 'wymagane przy INSERT' : null,
                !c.nullable && !c.insertRequired && !c.isPk ? 'NOT NULL z DEFAULT' : null,
              ].filter(Boolean);
              const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
              return `${c.name} ${c.dataType}${suffix}`;
            })
            .join(', ') ?? '';
        return {
          summary: result.found
            ? `${table?.owner}.${table?.name}: wymagane przy INSERT → ${insertRequiredColumns.join(', ') || 'brak'}`
            : 'Nie znaleziono',
          detail: JSON.stringify(
            {
              ...result,
              insertRequiredColumns,
              notNullWithDefaultColumns,
              requiredColumns: insertRequiredColumns,
            },
            null,
            2,
          ),
          describeTable: table ?? undefined,
        };
      }
      case 'describe_column': {
        const result = this.explorer.describeColumn(args.table ?? '', args.column ?? '');
        return {
          summary: result.found
            ? `${result.column?.name} ${result.column?.dataType} — ${result.column?.comment ?? 'brak komentarza'}`
            : 'Nie znaleziono kolumny',
          detail: JSON.stringify(result, null, 2),
        };
      }
      case 'search_tables': {
        const result = this.explorer.searchTables(args.query ?? args.pattern ?? '', domain);
        return {
          summary: result.items.slice(0, 5).join(', ') || 'Brak wyników',
          detail: JSON.stringify(result, null, 2),
        };
      }
      case 'get_package_source': {
        const lines = this.explorer.getPackageSource(args.owner ?? '', args.name ?? args.package ?? '');
        return {
          summary: `${lines.length} linii źródła`,
          detail: lines.join('\n'),
        };
      }
      case 'call_procedure': {
        const params: Record<string, string | number | null> = {};
        if (args.params) {
          try {
            Object.assign(params, JSON.parse(args.params) as Record<string, string | number | null>);
          } catch {
            // ignore malformed params
          }
        }
        const result = await this.procedures.callProcedure(
          args.package ?? args.package_name ?? '',
          args.procedure ?? args.procedure_name ?? '',
          params,
          { userId: typeof userId === 'number' ? userId : undefined, domain },
        );
        return { summary: result.message, detail: result.message };
      }
      default:
        return { summary: `Nieznane narzędzie: ${name}`, detail: '' };
    }
  }

  private async runSql(
    sql: string,
    userId: number | undefined,
    domain: OracleAgentDomain,
    writeEvent: (event: ChatStreamEvent) => void,
    steps: ChatOracleStep[],
    sqlSteps: OracleAgentSqlStep[],
    reports: OracleReport[],
  ): Promise<OracleReport> {
    const result = await this.query.executeSelect(sql, { userId, domain });
    const maxRows = Number(this.config.get('TETA_ORACLE_AGENT_MAX_ROWS', 200));
    const truncated = result.rowCount >= maxRows;
    const preview = result.rows.slice(0, 5).map((row) => row.join(' | '));

    const report: OracleReport = {
      sql: result.sql,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated,
    };

    const step: ChatOracleStep = { tool: 'execute_sql', summary: `${result.rowCount} wierszy` };
    steps.push(step);
    writeEvent({ type: 'oracle_step', step });
    writeEvent({ type: 'oracle_report', report });
    writeEvent({ type: 'oracle_sql', sql: result.sql, rowCount: result.rowCount, preview });

    const sqlStep: OracleAgentSqlStep = {
      sql: result.sql,
      rowCount: result.rowCount,
      columns: result.columns,
      rows: result.rows,
      truncated,
      preview,
    };
    sqlSteps.push(sqlStep);
    reports.push(report);
    return report;
  }

  private formatRowCountPl(count: number): string {
    if (count === 1) return '1 wiersz';
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${count} wiersze`;
    }
    return `${count} wierszy`;
  }

  /** Podsumowanie nad tabelą — zawsze z faktycznego rowCount, nie z tekstu LLM. */
  private buildSqlResultSummary(report: OracleReport): string {
    const n = report.rowCount;
    if (n === 0) {
      return 'Zapytanie nie zwróciło żadnych wierszy spełniających kryteria.';
    }
    let msg = `Znaleziono ${this.formatRowCountPl(n)} — szczegóły w tabeli poniżej.`;
    if (report.truncated) {
      msg += ` Pokazano pierwsze ${n} rekordów (limit zapytania); w bazie może być więcej.`;
    }
    return msg;
  }

  private buildSystemPrompt(domain: OracleAgentDomain, toolContext: string[]): string {
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    return `${DOMAIN_PROMPTS[domain]}

Odpowiadasz WYŁĄCZNIE na podstawie narzędzi schematu i wyników SQL — nie zgaduj struktury bazy.

Domyślny schemat Oracle: **${defaultOwner}**. W każdym SELECT używaj pełnej nazwy: ${defaultOwner}.NAZWA_TABELI (np. ${defaultOwner}.T_PRAC).

Dostępne narzędzia (zwróć JSON):
- find_path(from, to)
- describe_table(table)
- describe_column(table, column)
- search_tables(query)
- get_package_source(owner, name)
- call_procedure(package, procedure, params) — tylko gdy konieczne

Format odpowiedzi (jeden obiekt JSON, bez markdown):
{"action":"tool","name":"describe_table","args":{"table":"NAZWA"}}
lub po zebraniu faktów:
{"action":"answer","text":"krótkie podsumowanie po polsku","sql":"SELECT ..."}

Raporty danych (wiersze z bazy):
- Gdy użytkownik prosi o listę rekordów, zestawienie, raport lub konkretne DANE — zakończ odpowiedzią z polem sql (SELECT).
- Pole text przy sql: krótki placeholder (np. "—") — liczbę wierszy system ustawi z wyniku zapytania.

Struktura tabeli (metadane — kolumny, typy, NOT NULL, PK):
- Użyj describe_table — NIE używaj SELECT do listowania kolumn.
- Odpowiedź {"action":"answer","text":"…"} BEZ pola sql — tekst zostanie uzupełniony przez system z metadanych.
- Gdy pytanie o kolumny wymagane / obowiązkowe / NOT NULL — użyj describe_table; system wypisze insertRequiredColumns (NOT NULL bez DEFAULT, bez PK).
- NOT NULL z wartością domyślną (C_01, GUID itd.) to pola uzupełniane przez system — NIE są „obowiązkowe” dla użytkownika.
- „Pola obowiązkowe w formularzu Teta” mogą się różnić od metadanych Oracle — nie zgaduj reguł biznesowych.

Kontekst wątku:
- Jeśli w historii jest [SQL: … FROM ${defaultOwner}.TABELA …] — kontynuuj odniesienie do tej samej tabeli, dopóki użytkownik nie wskaże innej.

Zasady SQL:
- tylko SELECT
- używaj wyłącznie tabel i kolumn z wyników narzędzi
- JOIN zgodnie ze ścieżką find_path
- prefiks schematu ${defaultOwner}. przy każdej tabeli
- bez średnika na końcu SQL
- NIGDY nie pisz użytkownikowi „wykonaj zapytanie SQL” — sam zwróć {"action":"answer","text":"…","sql":"SELECT …"}

${toolContext.length > 0 ? `Wyniki narzędzi:\n${toolContext.join('\n\n')}` : 'Zacznij od search_tables lub describe_table jeśli nie znasz tabel.'}`;
  }

  private isRequiredColumnsQuestion(message: string): boolean {
    const normalized = message.toLowerCase();
    return /obowiązkow|wymagane|not\s*null|nullable|wymaga.*kolumn|które\s+kolumny/i.test(
      normalized,
    );
  }

  private buildRequiredColumnsAnswer(table: SchemaTableInfo): string {
    const insertRequired = table.columns.filter((c) => c.insertRequired);
    const notNullWithDefault = table.columns.filter(
      (c) => !c.nullable && !c.insertRequired && !c.isPk,
    );
    const pkColumns = table.columns.filter((c) => c.isPk);

    const lines = [
      `Tabela ${table.owner}.${table.name} — na podstawie metadanych Oracle (ostatnia analiza bazy):`,
      '',
    ];

    if (insertRequired.length > 0) {
      lines.push(
        `Kolumny wymagane przy INSERT (NOT NULL bez wartości domyślnej, bez klucza głównego): ${insertRequired.map((c) => c.name).join(', ')}.`,
      );
    } else {
      lines.push(
        'Brak kolumn wymaganych przy INSERT — wszystkie pola NOT NULL mają wartość domyślną lub są kluczem głównym uzupełnianym przez system.',
      );
    }

    if (pkColumns.length > 0) {
      lines.push(`Klucz główny (zwykle nadawany automatycznie): ${pkColumns.map((c) => c.name).join(', ')}.`);
    }

    if (notNullWithDefault.length > 0) {
      lines.push(
        `Pola NOT NULL z DEFAULT (system/trigger — zwykle nie wypełnia użytkownik): ${notNullWithDefault.map((c) => c.name).join(', ')}.`,
      );
    }

    lines.push(
      '',
      'Uwaga: reguły obowiązkowości w formularzu Teta (np. które z pól C_01–C_10 są widoczne) zależą od konfiguracji modułu i nie wynikają wprost z NOT NULL w bazie.',
    );

    return lines.join('\n');
  }

  private buildAgentPrompt(message: string, iteration: number): string {
    if (iteration === 0) {
      return `Pytanie użytkownika: ${message}\n\nZdecyduj jakie narzędzie wywołać (JSON).`;
    }
    return `Kontynuuj analizę pytania: ${message}\n\nMasz wyniki poprzednich narzędzi w kontekście. Zwróć kolejne narzędzie lub finalną odpowiedź (JSON).`;
  }

  private parseAction(raw: string): AgentAction | null {
    const trimmed = raw.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]) as AgentAction;
      if (parsed.action === 'tool' && parsed.name) {
        return { action: 'tool', name: parsed.name, args: parsed.args ?? {} };
      }
      if (parsed.action === 'answer' && parsed.text) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private normalizeHistory(
    history: ChatHistoryMessage[] | undefined,
    maxHistory: number,
    maxHistoryChars: number,
  ): ChatHistoryMessage[] {
    if (!history?.length) return [];
    return history
      .filter((item) => item.content.trim())
      .slice(-maxHistory)
      .map((item) => {
        const content = item.content.trim();
        const trimmed =
          content.length > maxHistoryChars ? `${content.slice(0, maxHistoryChars - 1)}…` : content;
        return { role: item.role, content: trimmed };
      });
  }
}
