import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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
import { isOracleVendorDebug, sanitizeOracleStepForClient, sanitizeOracleStreamEventForClient } from '@teta/shared';
import { OllamaChatService } from '../chat/ollama-chat.service';
import type { OllamaChatOverrides } from '../chat/ollama-chat-overrides';
import { ChatQueryTimeoutService } from '../chat/chat-query-timeout.service';
import { resolveChatQualityProfile } from '../chat/chat-quality.profile';
import { ConfigService } from '@nestjs/config';
import { SchemaExplorerService } from './schema-explorer.service';
import { OracleQueryService } from './oracle-query.service';
import { userAsksForDateTime } from './oracle-result-format.util';
import { SchemaProcedureService } from './schema-procedure.service';
import { SchemaCrawlService } from './schema-crawl.service';
import {
  buildOracleThreadContext,
  buildOracleThreadContextFromTable,
  resolveDefaultOracleOwner,
} from '../oracle/oracle-schema.util';
import { getBuildAppMode } from '../rag/app-mode';

import { SchemaEntityLearningService } from './schema-entity-learning.service';
import { TetaPluginHintsService } from '../teta-plugins/teta-plugin-hints.service';
import { isDataQueryIntent } from '../teta-plugins/teta-plugin-query-resolver';
import {
  buildDirectPluginSelect,
  buildPluginClarificationMessage,
} from '../teta-plugins/teta-plugin-column-resolver';
import { resolveOutputMappingsFromQuery } from '../teta-plugins/teta-plugin-column-mapping';
import type { TetaPluginColumnMapping } from '../teta-plugins/teta-plugin-column-mapping';
import {
  buildSqlForCandidate,
  collectPluginPackageCandidates,
  collectPluginSqlCandidates,
  formatPackageHintsForAgent,
  isMalformedSelectSql,
  isStanowiskoQuery,
  isStanowiskoRelatedObject,
} from '../teta-plugins/teta-plugin-candidate-probe';
import {
  formatUserFacingSqlColumnError,
  rewriteSqlLabelsUsingPluginMappings,
} from '../teta-plugins/teta-plugin-sql-label-rewrite.util';
import { hasResolvableFilterForQuery } from '../teta-plugins/teta-plugin-filter-clause.util';
import { isBroadListQuery } from '../teta-plugins/teta-plugin-list-query.util';
import { classifyAgentQueryRoute } from '../agent/agent-query-router';
import type { AgentQueryRoute } from '../agent/agent-query-route.types';
import { buildAgentLlmSystemPrompt } from '../agent/agent-llm-prompts';
import { SchemaGraphService } from './schema-graph.service';
import {
  assertWithinDeadline,
  createRequestDeadline,
  isAbortTimeoutError,
  remainingMs,
  RequestDeadlineExceededError,
  type RequestDeadline,
} from '../common/request-deadline.util';
import {
  buildAgentJsonFailureMessage,
  buildAgentJsonRetryHint,
  looksLikeAgentJson,
  parseAgentAction,
} from './oracle-agent-parse.util';

const DOMAIN_PROMPTS: Record<OracleAgentDomain, string> = {
  general: 'Jesteś asystentem bazy Teta — ogólny kontekst schematu.',
  payroll: 'Jesteś agentem domeny Płace — skupiasz się na tabelach wynagrodzeń, pracowników, list płac.',
  hr: 'Jesteś agentem domeny Kadry — etaty, umowy, dane osobowe pracowników.',
  attendance: 'Jesteś agentem domeny Czasy pracy — absencje, obecności, grafiki.',
  config: 'Jesteś agentem konfiguracji — słowniki SL_, parametry systemowe.',
};

@Injectable()
export class OracleAgentService {
  private readonly logger = new Logger(OracleAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaChatService,
    private readonly explorer: SchemaExplorerService,
    private readonly query: OracleQueryService,
    private readonly procedures: SchemaProcedureService,
    private readonly crawl: SchemaCrawlService,
    private readonly schemaLearning: SchemaEntityLearningService,
    private readonly pluginHints: TetaPluginHintsService,
    private readonly graph: SchemaGraphService,
    private readonly queryTimeout: ChatQueryTimeoutService,
  ) {}

  async streamComplete(
    input: ChatCompletionRequest,
    res: Response,
    userId?: number,
    workMode = getBuildAppMode(),
    parentDeadline?: RequestDeadline,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event: ChatStreamEvent) => {
      let payload: ChatStreamEvent | null = event;
      if (event.type === 'oracle_step') {
        payload = {
          type: 'oracle_step',
          step: sanitizeOracleStepForClient(event.step),
        };
      } else if (!showOracleDebug) {
        payload = sanitizeOracleStreamEventForClient(event);
      }
      if (!payload) return;
      res.write(`${JSON.stringify(payload)}\n`);
    };

    const startedAt = Date.now();
    let ragMs = 0;
    const showOracleDebug = isOracleVendorDebug(workMode);
    const domain = input.oracleDomain ?? 'general';
    const steps: ChatOracleStep[] = [];
    const sqlSteps: OracleAgentSqlStep[] = [];
    const reports: OracleReport[] = [];
    let includeTimeInDates = false;

    try {
      const message = input.message.trim();
      if (!message) {
        throw new BadRequestException('Wiadomość nie może być pusta.');
      }
      includeTimeInDates = userAsksForDateTime(message);

      const profile = resolveChatQualityProfile(input.quality, this.config);
      const history = this.normalizeHistory(
        input.history,
        Math.max(
          profile.maxHistory,
          Number(this.config.get('TETA_ORACLE_AGENT_MAX_HISTORY', 8)),
        ),
        Math.max(
          profile.maxHistoryChars,
          Number(this.config.get('TETA_ORACLE_AGENT_MAX_HISTORY_CHARS', 800)),
        ),
      );
      const maxIterations = Number(this.config.get('TETA_ORACLE_AGENT_MAX_STEPS', 5));
      const agentDeadline = parentDeadline ?? this.createAgentDeadline(startedAt);

      const routeDecision = classifyAgentQueryRoute({ message, history });
      this.logger.log(
        `Oracle agent — routing: ${routeDecision.route} (${routeDecision.confidence}): ${routeDecision.reason}`,
      );

      if (routeDecision.route === 'llm_only' || routeDecision.route === 'clarify') {
        await this.streamLlmOnlyAnswer({
          input,
          history,
          route: routeDecision.route,
          writeEvent,
          startedAt,
          res,
          agentDeadline: parentDeadline ?? this.createAgentDeadline(startedAt),
        });
        return;
      }

      if (routeDecision.route === 'application_help') {
        await this.streamApplicationHelpAnswer({
          input,
          history,
          writeEvent,
          startedAt,
          res,
          agentDeadline: parentDeadline ?? this.createAgentDeadline(startedAt),
        });
        return;
      }

      const stats = this.crawl.getStats();
      if (stats.nodeCount === 0) {
        throw new BadRequestException(
          'Graf schematu jest pusty — uruchom „Analizuj bazę” w ustawieniach Oracle.',
        );
      }

      const entityLinks = this.schemaLearning.isLearningEnabled()
        ? await this.schemaLearning.findRelevantForQuery(message, domain)
        : [];
      const entityContext = this.schemaLearning.formatHintsForPrompt(entityLinks);

      const ragStartedAt = Date.now();
      const pluginHints = await this.pluginHints.findHintsForQuery(message);
      ragMs = Date.now() - ragStartedAt;
      const pluginContext = pluginHints.promptSection;
      if (pluginHints.hasPluginMetadata) {
        const step: ChatOracleStep = {
          tool: 'plugin_rag',
          summary: `${pluginHints.gateways.length} wskazówek z metadanych wtyczek`,
        };
        steps.push(step);
        writeEvent({ type: 'oracle_step', step });
      }

      const toolContext: string[] = [];
      let finalAnswer = '';
      let lastDescribeTable: SchemaTableInfo | null = null;
      let oracleThreadContext: string | undefined;

      const defaultOwner = resolveDefaultOracleOwner(this.config);
      const columnMappings = pluginHints.columnMappings;
      const filterCheckBase = {
        message,
        history,
        columnMappings,
        intentPhrases: pluginHints.computedIntents.flatMap((item) => item.phrases),
      };

      const pluginClarification = buildPluginClarificationMessage(
        message,
        history,
        columnMappings,
        pluginHints.computedIntents,
      );
      if (pluginClarification) {
        finalAnswer = pluginClarification;
      } else if (
        hasResolvableFilterForQuery(filterCheckBase) ||
        isBroadListQuery(message)
      ) {
        const candidates = collectPluginSqlCandidates({
          message,
          columnMappings,
          gateways: pluginHints.gateways,
          applicationObjects: pluginHints.applicationObjects,
          lookupNodeType: (objectName) => this.graph.getObjectNodeType(objectName),
        });

        // Fallback: pojedynczy preferredTable jak wcześniej, gdy brak kandydatów z mapowań.
        if (candidates.length === 0) {
          const outputForTable = resolveOutputMappingsFromQuery(message, columnMappings, null);
          const preferredTable =
            outputForTable.find((mapping) => mapping.targetObject)?.targetObject ??
            pluginHints.columnHints.find((hint) => hint.targetObject)?.targetObject ??
            pluginHints.gateways.find((gateway) => gateway.viewName)?.viewName ??
            null;
          if (preferredTable) {
            candidates.push({
              kind: this.graph.getObjectNodeType(preferredTable) ?? 'unknown',
              objectName: preferredTable.toUpperCase(),
              source: 'mapping',
              packageNames: [],
            });
          }
        }

        const pathLabel = isBroadListQuery(message) ? 'listy' : 'SQL';
        let probedEmpty = false;
        const triedSql: string[] = [];

        for (const candidate of candidates) {
          try {
            assertWithinDeadline(agentDeadline, 'agent Oracle');
          } catch (deadlineError) {
            finalAnswer = this.buildAgentTimeoutAnswer(deadlineError, agentDeadline);
            break;
          }

          const schemaColumns = this.graph.getColumnDetailsForTable(candidate.objectName);
          const directSql = buildSqlForCandidate({
            candidate,
            message,
            history,
            defaultOwner,
            columnMappings,
            computedIntents: pluginHints.computedIntents,
            gateways: pluginHints.gateways,
            schemaColumns,
          });
          if (!directSql || isMalformedSelectSql(directSql)) {
            continue;
          }
          if (triedSql.includes(directSql)) {
            continue;
          }
          triedSql.push(directSql);

          this.logger.log(
            `Oracle agent — szybka ścieżka ${pathLabel} [${candidate.kind}/${candidate.objectName}]: ${directSql}`,
          );
          try {
            const report = await this.runSql(
              directSql,
              userId,
              domain,
              writeEvent,
              steps,
              sqlSteps,
              reports,
              columnMappings,
              { emitReport: false, includeTime: includeTimeInDates },
            );
            if (report.rowCount > 0) {
              // Dopiero wynik z wierszami trafia do UI (bez pustych raportów z wcześniejszych prób).
              const step: ChatOracleStep = {
                tool: 'execute_sql',
                summary: `${report.rowCount} wierszy`,
              };
              steps.push(step);
              writeEvent({ type: 'oracle_step', step });
              writeEvent({ type: 'oracle_report', report });
              writeEvent({
                type: 'oracle_sql',
                sql: report.sql,
                rowCount: report.rowCount,
                preview: report.rows.slice(0, 5).map((row) => row.join(' | ')),
              });
              reports.push(report);
              finalAnswer = this.buildSqlResultSummary(report);
              oracleThreadContext = buildOracleThreadContext(report);
              break;
            }
            probedEmpty = true;
            this.logger.log(
              `Oracle agent — kandydat ${candidate.objectName}: 0 wierszy, próbuję następny`,
            );
          } catch (error) {
            const sqlError = error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Oracle agent — kandydat ${candidate.objectName} nieudany: ${sqlError}`,
            );
            toolContext.push(
              `direct_sql (${candidate.objectName}) ERROR:\n${sqlError}\nSpróbuj poprawić SELECT w kolejnym kroku agenta.`,
            );
          }
        }

        // Lista bez filtra — jeden stary buildDirectPluginSelect gdy brak kandydatów z filtrem.
        if (!finalAnswer && isBroadListQuery(message) && triedSql.length === 0) {
          const preferredTable = candidates[0]?.objectName ?? null;
          const schemaColumns = preferredTable
            ? this.graph.getColumnDetailsForTable(preferredTable)
            : [];
          const directSql = buildDirectPluginSelect({
            message,
            history,
            defaultOwner,
            columnMappings,
            computedIntents: pluginHints.computedIntents,
            gateways: pluginHints.gateways,
            preferredTable,
            schemaColumns,
          });
          if (directSql) {
            try {
              const report = await this.runSql(
                directSql,
                userId,
                domain,
                writeEvent,
                steps,
                sqlSteps,
                reports,
                columnMappings,
                { includeTime: includeTimeInDates },
              );
              if (report.rowCount > 0) {
                finalAnswer = this.buildSqlResultSummary(report);
                oracleThreadContext = buildOracleThreadContext(report);
              } else {
                probedEmpty = true;
              }
            } catch (error) {
              const sqlError = error instanceof Error ? error.message : String(error);
              toolContext.push(`direct_sql ERROR:\n${sqlError}`);
            }
          }
        }

        if (!finalAnswer) {
          const packageCandidates = collectPluginPackageCandidates(
            pluginHints.gateways,
            candidates,
          );
          const packageHint = formatPackageHintsForAgent(packageCandidates);
          if (packageHint) {
            toolContext.push(packageHint);
            const step: ChatOracleStep = {
              tool: 'plugin_packages',
              summary: `${packageCandidates.length} powiązanych pakietów do sprawdzenia`,
            };
            steps.push(step);
            writeEvent({ type: 'oracle_step', step });
          }

          // Spróbuj gotowych SELECT z gateway (LabeledSelect) jako dodatkowy kandydat.
          const stanowiskoOnly = isStanowiskoQuery(message);
          for (const pkg of packageCandidates) {
            const selectSql = pkg.selectSql?.trim();
            if (!selectSql || !/^SELECT\s/i.test(selectSql) || isMalformedSelectSql(selectSql)) {
              continue;
            }
            if (
              stanowiskoOnly &&
              pkg.sourceObject &&
              !isStanowiskoRelatedObject(pkg.sourceObject)
            ) {
              continue;
            }
            if (triedSql.includes(selectSql)) {
              continue;
            }
            triedSql.push(selectSql);
            this.logger.log(
              `Oracle agent — próbuję SELECT z metadanych pakietu/gateway ${pkg.packageName}: ${selectSql.slice(0, 120)}`,
            );
            try {
              const report = await this.runSql(
                selectSql,
                userId,
                domain,
                writeEvent,
                steps,
                sqlSteps,
                reports,
                columnMappings,
                { includeTime: includeTimeInDates },
              );
              if (report.rowCount > 0) {
                finalAnswer = this.buildSqlResultSummary(report);
                oracleThreadContext = buildOracleThreadContext(report);
                break;
              }
              probedEmpty = true;
            } catch (error) {
              const sqlError = error instanceof Error ? error.message : String(error);
              toolContext.push(`gateway_select (${pkg.packageName}) ERROR:\n${sqlError}`);
            }
          }
        }

        if (!finalAnswer && probedEmpty && triedSql.length > 0) {
          toolContext.push(
            `Szybka ścieżka: ${triedSql.length} SELECT(ów) zwróciło 0 wierszy. ` +
              `Spróbuj innego widoku/tabeli/pakietu albo RAG. Ostatnie SQL:\n${triedSql.slice(-3).join('\n')}`,
          );
        }
      }

      if (!finalAnswer) {
      for (let i = 0; i < maxIterations; i += 1) {
        try {
          assertWithinDeadline(agentDeadline, 'agent Oracle');
        } catch (deadlineError) {
          finalAnswer = this.buildAgentTimeoutAnswer(deadlineError, agentDeadline);
          break;
        }

        const systemPrompt = this.buildSystemPrompt(domain, toolContext, entityContext, pluginContext);
        const agentPrompt = this.buildAgentPrompt(message, i, pluginHints.hasPluginMetadata);
        const llmStartedAt = Date.now();

        let response: string;
        try {
          response = await this.ollama.complete(
            [
              { role: 'system', content: systemPrompt },
              ...history.map((item) => ({ role: item.role, content: item.content })),
              { role: 'user', content: agentPrompt },
            ],
            input.model,
            input.quality,
            this.getOracleLlmOverrides(message, agentDeadline),
          );
        } catch (error) {
          if (this.isAgentTimeoutError(error)) {
            finalAnswer = this.buildAgentTimeoutAnswer(error, agentDeadline);
            break;
          }
          throw error;
        }

        const llmMs = Date.now() - llmStartedAt;
        this.logger.log(
          `Oracle agent krok ${i + 1}/${maxIterations}: LLM ${llmMs} ms, prompt≈${systemPrompt.length + agentPrompt.length} znaków`,
        );

        const action = parseAgentAction(response);
        if (!action) {
          if (looksLikeAgentJson(response) && i < maxIterations - 1) {
            toolContext.push(buildAgentJsonRetryHint());
            continue;
          }
          finalAnswer = looksLikeAgentJson(response)
            ? buildAgentJsonFailureMessage()
            : response.trim();
          break;
        }

        if (action.action === 'clarify') {
          finalAnswer = action.text.trim();
          break;
        }

        if (action.action === 'answer') {
          if (action.sql?.trim()) {
            try {
              const report = await this.runSql(
                action.sql,
                userId,
                domain,
                writeEvent,
                steps,
                sqlSteps,
                reports,
                columnMappings,
                { includeTime: includeTimeInDates },
              );
              finalAnswer = this.buildSqlResultSummary(report);
              oracleThreadContext = buildOracleThreadContext(report);
            } catch (error) {
              const sqlError = error instanceof Error ? error.message : String(error);
              const step: ChatOracleStep = {
                tool: 'execute_sql',
                summary: 'Błąd SQL — poprawiam zapytanie',
              };
              steps.push(step);
              writeEvent({ type: 'oracle_step', step });
              toolContext.push(
                `execute_sql ERROR:\n${sqlError}\n` +
                  'Nie używaj etykiet UI (np. STAŻ) jako nazw kolumn. ' +
                  'Użyj nazw Oracle z metadanych wtyczki (np. LATA_STAZU) albo clarify.',
              );

              if (i >= maxIterations - 1) {
                finalAnswer = this.buildSqlFailureAnswer(sqlError);
                break;
              }
              continue;
            }
          } else if (this.isRequiredColumnsQuestion(message) && lastDescribeTable) {
            finalAnswer = this.buildRequiredColumnsAnswer(lastDescribeTable);
            oracleThreadContext = buildOracleThreadContextFromTable(
              lastDescribeTable.owner,
              lastDescribeTable.name,
            );
          } else {
            finalAnswer = action.text.trim();
            if (lastDescribeTable) {
              oracleThreadContext = buildOracleThreadContextFromTable(
                lastDescribeTable.owner,
                lastDescribeTable.name,
              );
            }
          }
          break;
        }

        const toolResult = await this.runTool(action.name, action.args, domain, userId);
        if (toolResult.describeTable) {
          lastDescribeTable = toolResult.describeTable;
          oracleThreadContext = buildOracleThreadContextFromTable(
            toolResult.describeTable.owner,
            toolResult.describeTable.name,
          );
        }
        const step: ChatOracleStep = {
          tool: action.name,
          summary: toolResult.summary,
        };
        steps.push(step);
        writeEvent({ type: 'oracle_step', step });
        this.appendToolContext(toolContext, action.name, action.args, toolResult);
      }
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
        timing: { totalMs, ragMs, llmMs: Math.max(0, totalMs - ragMs) },
        oracleSql: showOracleDebug ? sqlSteps : undefined,
        oracleReports: reports,
        oracleThreadContext,
      });
      res.end();
    } catch (error) {
      const message =
        error instanceof RequestDeadlineExceededError
          ? this.buildAgentTimeoutAnswer(error, this.createAgentDeadline(startedAt))
          : this.isAgentTimeoutError(error)
            ? this.buildAgentTimeoutAnswer(
                error,
                this.createAgentDeadline(startedAt),
              )
          : error instanceof BadRequestException || error instanceof ServiceUnavailableException
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      writeEvent({ type: 'error', message });
      res.end();
    }
  }

  private createAgentDeadline(startedAt: number): RequestDeadline {
    return createRequestDeadline(this.queryTimeout.getQueryTimeoutMs(), startedAt);
  }

  private isAgentTimeoutError(error: unknown): boolean {
    return error instanceof RequestDeadlineExceededError || isAbortTimeoutError(error);
  }

  private buildAgentTimeoutAnswer(error: unknown, deadline: RequestDeadline): string {
    const totalSec = Math.round(deadline.limitMs / 1000);
    const elapsedSec = Math.round((Date.now() - deadline.startedAt) / 1000);
    const configHint =
      'Doprecyzuj pytanie (np. numer ewidencyjny, nazwisko) lub zwiększ limit w Ustawienia → Asystent AI.';
    if (error instanceof RequestDeadlineExceededError) {
      return (
        `Przekroczono limit czasu odpowiedzi (${totalSec} s, upłynęło ${elapsedSec} s). ${configHint}`
      );
    }
    return (
      `Asystent nie zdążył odpowiedzieć w limicie czasu (${totalSec} s, upłynęło ${elapsedSec} s). ${configHint}`
    );
  }

  private async streamLlmOnlyAnswer(input: {
    input: ChatCompletionRequest;
    history: ChatHistoryMessage[];
    route: Extract<AgentQueryRoute, 'llm_only' | 'clarify'>;
    writeEvent: (event: ChatStreamEvent) => void;
    startedAt: number;
    res: Response;
    agentDeadline: RequestDeadline;
  }): Promise<void> {
    const llmStartedAt = Date.now();
    let content = '';
    const message = input.input.message.trim();

    try {
      for await (const delta of this.ollama.streamTokens(
        [
          { role: 'system', content: buildAgentLlmSystemPrompt(input.route) },
          ...input.history.map((item) => ({ role: item.role, content: item.content })),
          { role: 'user', content: message },
        ],
        input.input.model,
        input.input.quality,
        this.getOracleLlmOverrides(undefined, input.agentDeadline),
      )) {
        content += delta;
        input.writeEvent({ type: 'token', delta });
      }
    } catch (error) {
      if (this.isAgentTimeoutError(error)) {
        input.writeEvent({
          type: 'error',
          message: this.buildAgentTimeoutAnswer(error, input.agentDeadline),
        });
        input.res.end();
        return;
      }
      throw error;
    }

    const llmMs = Date.now() - llmStartedAt;
    const totalMs = Date.now() - input.startedAt;
    input.writeEvent({
      type: 'done',
      content: content.trim(),
      model: input.input.model,
      createdAt: new Date().toISOString(),
      timing: { totalMs, ragMs: 0, llmMs },
    });
    input.res.end();
  }

  private async streamApplicationHelpAnswer(input: {
    input: ChatCompletionRequest;
    history: ChatHistoryMessage[];
    writeEvent: (event: ChatStreamEvent) => void;
    startedAt: number;
    res: Response;
    agentDeadline: RequestDeadline;
  }): Promise<void> {
    const message = input.input.message.trim();
    const ragStartedAt = Date.now();
    const pluginHints = await this.pluginHints.findHintsForQuery(message);
    const ragMs = Date.now() - ragStartedAt;

    const step: ChatOracleStep = {
      tool: 'application_help',
      summary: `${pluginHints.applicationObjects?.length ?? 0} obiektów aplikacyjnych z helpu Teta`,
    };
    input.writeEvent({ type: 'oracle_step', step });

    let content = this.pluginHints.tryResolveHelpAnswer(message, pluginHints);

    if (!content) {
      input.writeEvent({
        type: 'status',
        phase: 'clarify',
        message: 'Szukam w helpie Teta i metadanych wtyczek…',
      });
      const llmStartedAt = Date.now();
      let streamed = '';
      for await (const delta of this.ollama.streamTokens(
        [
          {
            role: 'system',
            content:
              buildAgentLlmSystemPrompt('llm_only') +
              '\n\nOdpowiadaj na podstawie pomocy kontekstowej Teta i metadanych formularza. ' +
              'Wyjaśnij znaczenie biznesowe pola. Nie zgaduj wpływu na obliczenia bez potwierdzenia w helpie.',
          },
          ...input.history.map((item) => ({ role: item.role, content: item.content })),
          {
            role: 'user',
            content: [pluginHints.helpPromptSection ?? pluginHints.promptSection, message]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        input.input.model,
        input.input.quality,
        this.getOracleLlmOverrides(undefined, input.agentDeadline),
      )) {
        streamed += delta;
        input.writeEvent({ type: 'token', delta });
      }
      content = streamed.trim();
      const llmMs = Date.now() - llmStartedAt;
      const totalMs = Date.now() - input.startedAt;
      input.writeEvent({
        type: 'done',
        content,
        model: input.input.model,
        createdAt: new Date().toISOString(),
        timing: { totalMs, ragMs, llmMs },
      });
      input.res.end();
      return;
    }

    for (const char of content) {
      input.writeEvent({ type: 'token', delta: char });
    }

    const totalMs = Date.now() - input.startedAt;
    input.writeEvent({
      type: 'done',
      content,
      model: input.input.model,
      createdAt: new Date().toISOString(),
      timing: { totalMs, ragMs, llmMs: Math.max(0, totalMs - ragMs) },
    });
    input.res.end();
  }

  private getOracleLlmOverrides(
    message?: string,
    agentDeadline?: RequestDeadline,
  ): OllamaChatOverrides {
    const thinkDefault = this.config.get<string>('TETA_ORACLE_AGENT_THINK', 'true') !== 'false';
    const shortFollowUp = Boolean(message && message.trim().length <= 96);
    const think =
      message && (isBroadListQuery(message) || shortFollowUp) ? false : thinkDefault;
    const maxPredict = this.config.get('TETA_ORACLE_AGENT_NUM_PREDICT');
    const overrides: OllamaChatOverrides = {
      think,
      maxNumPredict: Number(
        maxPredict ?? (think ? 4096 : message && isBroadListQuery(message) ? 1536 : 768),
      ),
      temperature: Number(this.config.get('TETA_ORACLE_AGENT_TEMPERATURE', 0.05)),
      numCtx: Number(this.config.get('TETA_ORACLE_AGENT_NUM_CTX', 4096)),
    };
    if (agentDeadline) {
      overrides.timeoutMs = remainingMs(agentDeadline);
    }
    return overrides;
  }

  private appendToolContext(
    toolContext: string[],
    name: string,
    args: Record<string, string>,
    toolResult: { summary: string; detail: string; describeTable?: SchemaTableInfo },
  ): void {
    const detail = this.compactToolDetail(name, toolResult);
    toolContext.push(`Tool ${name}(${JSON.stringify(args)}):\n${detail}`);
  }

  private compactToolDetail(
    name: string,
    toolResult: { summary: string; detail: string; describeTable?: SchemaTableInfo },
  ): string {
    const maxChars = Number(this.config.get('TETA_ORACLE_AGENT_TOOL_CONTEXT_CHARS', 2500));

    if (name === 'describe_table' && toolResult.describeTable) {
      const table = toolResult.describeTable;
      return JSON.stringify(
        {
          owner: table.owner,
          name: table.name,
          columnNames: table.columns.map((column) => column.name),
          insertRequiredColumns: table.columns
            .filter((column) => column.insertRequired)
            .map((column) => column.name),
        },
        null,
        2,
      );
    }

    if (toolResult.detail.length <= maxChars) {
      return toolResult.detail;
    }
    return `${toolResult.detail.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n… [skrócono wynik narzędzia]`;
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
    columnMappings: TetaPluginColumnMapping[] = [],
    options?: { emitReport?: boolean; includeTime?: boolean },
  ): Promise<OracleReport> {
    const emitReport = options?.emitReport !== false;
    const rewrittenSql = rewriteSqlLabelsUsingPluginMappings(sql, columnMappings);
    if (rewrittenSql !== sql) {
      this.logger.log(`Oracle agent — przepisano etykiety UI w SQL: ${rewrittenSql}`);
    }
    if (isMalformedSelectSql(rewrittenSql)) {
      throw new Error(
        `Nieprawidłowy SELECT (pusta lista kolumn): ${rewrittenSql.slice(0, 120)}`,
      );
    }

    const result = await this.query.executeSelect(rewrittenSql, {
      userId,
      domain,
      includeTime: options?.includeTime,
    });
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

    if (emitReport) {
      const step: ChatOracleStep = { tool: 'execute_sql', summary: `${result.rowCount} wierszy` };
      steps.push(step);
      writeEvent({ type: 'oracle_step', step });
      writeEvent({ type: 'oracle_report', report });
      writeEvent({ type: 'oracle_sql', sql: result.sql, rowCount: result.rowCount, preview });
      reports.push(report);
    }

    const sqlStep: OracleAgentSqlStep = {
      sql: result.sql,
      rowCount: result.rowCount,
      columns: result.columns,
      rows: result.rows,
      truncated,
      preview,
    };
    sqlSteps.push(sqlStep);
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

    const computedAlias = report.columns.find((column) =>
      /^[A-Z_]+$/.test(column) && report.rowCount === 1,
    );
    if (report.rowCount === 1 && computedAlias) {
      const value = report.rows[0]?.[report.columns.indexOf(computedAlias)];
      if (value != null && String(value).trim() !== '') {
        return `Wynik: ${computedAlias} = ${value} (zapytanie wyliczone z metadanych).`;
      }
    }

    let msg = `Znaleziono ${this.formatRowCountPl(n)} — szczegóły w tabeli poniżej.`;
    if (report.truncated) {
      msg += ` Pokazano pierwsze ${n} rekordów (limit zapytania); w bazie może być więcej.`;
    }
    return msg;
  }

  private buildSqlFailureAnswer(message: string): string {
    return formatUserFacingSqlColumnError(message);
  }

  private buildSystemPrompt(
    domain: OracleAgentDomain,
    toolContext: string[],
    entityContext = '',
    pluginContext = '',
  ): string {
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    const pluginSection = pluginContext
      ? `Metadane wtyczek Teta (RAG — **preferuj** te widoki i SELECT nad zgadywaniem tabel):
${pluginContext}

Gdy powyżej jest widok i sugerowany SELECT:
- użyj tego widoku jako źródła danych dla raportu
- dołącz JOIN/WHERE zgodnie z pytaniem — pole tuż przed wartością filtra (po «o», «z», «ze») idzie do WHERE; pole z części «podaj/pokaż …» idzie do SELECT
- **NIGDY nie wstawiaj etykiet UI jako nazw kolumn** (np. STAŻ) — używaj wyłącznie nazw Oracle z mapowań powyżej (np. LATA_STAZU)
- **describe_table obowiązkowo** gdy filtrujesz po polu biznesowym i **brak** mapowania etykieta→kolumna w metadanych wtyczki poniżej
- jeśli użytkownik prosi o dane — zakończ {"action":"answer","text":"—","sql":"SELECT …"}`
      : '';

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

Format odpowiedzi (jeden obiekt JSON, bez markdown, bez komentarzy):
{"action":"tool","name":"describe_table","args":{"table":"NAZWA"}}
lub gdy brakuje informacji (nie zgaduj tabeli):
{"action":"clarify","text":"Dopytaj użytkownika po polsku, np. o nazwę tabeli lub moduł."}
lub po zebraniu faktów — dane zwraca system w tabeli, użytkownik NIGDY nie widzi surowego JSON ani sql:
{"action":"answer","text":"—","sql":"SELECT IMIE, NAZWISKO FROM ... WHERE ..."}

Kompaktowy JSON:
- pole sql: tylko 2–8 kolumn potrzebnych do pytania — NIE kopiuj całej listy z describe_table
- pole text przy sql: zawsze "—" — podsumowanie i tabelę generuje system po wykonaniu zapytania

- Gdy w metadanych są **pola wyliczane** (sekcja w kontekście) — użyj podanej formuły SQL i kolumny źródłowej z konfiguracji, nie wymyślaj własnej.
- Gdy nie wiesz, którego rekordu dotyczy pytanie uzupełniające — użyj {"action":"clarify","text":"…"} zamiast SELECT bez WHERE.

Dopytywanie użytkownika:
- Gdy nie wiesz, która tabela/widok/pakiet odpowiada pytaniu i brak pewnego powiązania w kontekście — użyj {"action":"clarify","text":"…"} zamiast zgadywać.
- Pytaj konkretnie: „Która tabela przechowuje pracowników?” albo „Czy chodzi o T_PRAC?”.
- Po odpowiedzi użytkownika z nazwą obiektu kontynuuj z narzędziami.

Powiązania tag → obiekt (z doświadczenia):
${entityContext || 'Brak zapisanych powiązań — użyj search_tables lub dopytaj użytkownika.'}

${pluginSection ? `${pluginSection}\n\nMapowanie etykiet: kolumna tuż przed wartością w części po «o/z/ze» → WHERE; kolumna z części «podaj/pokaż/wyświetl …» → SELECT. Przykład: «podaj nazwisko o nr ewidencyjnym 00122» → SELECT NAZWISKO WHERE NR_EWID…='00122', nie WHERE NAZWISKO='00122'.\n\n` : ''}Raporty danych (wiersze z bazy):
- Gdy użytkownik prosi o listę rekordów, zestawienie, raport lub konkretne DANE — zakończ odpowiedzią z polem sql (SELECT).
- Pole text przy sql: krótki placeholder (np. "—") — liczbę wierszy system ustawi z wyniku zapytania.

Struktura tabeli (metadane — kolumny, typy, NOT NULL, PK):
- Użyj describe_table — NIE używaj SELECT do listowania kolumn.
- Odpowiedź {"action":"answer","text":"…"} BEZ pola sql — tekst zostanie uzupełniony przez system z metadanych.
- Gdy pytanie o kolumny wymagane / obowiązkowe / NOT NULL — użyj describe_table; system wypisze insertRequiredColumns (NOT NULL bez DEFAULT, bez PK).
- NOT NULL z wartością domyślną (C_01, GUID itd.) to pola uzupełniane przez system — NIE są „obowiązkowe” dla użytkownika.
- „Pola obowiązkowe w formularzu Teta” mogą się różnić od metadanych Oracle — nie zgaduj reguł biznesowych.

Kontekst wątku:
- W historii mogą być linie [Kontekst wątku Oracle: …] lub [SQL: … FROM ${defaultOwner}.TABELA …] — kontynuuj tę samą tabelę.
- Gdy użytkownik pyta o „pracowników”, „tej tabeli”, „na literę Z” bez nazwy tabeli — użyj ostatniego kontekstu; nie zaczynaj od search_tables od zera.
- Jeśli znasz tabelę z wątku, możesz od razu zbudować SELECT **tylko z kolumn znanych z describe_table** (przy filtrze WHERE — describe_table najpierw).

Zasady SQL:
- tylko SELECT
- używaj wyłącznie tabel i kolumn z wyników narzędzi (describe_table / describe_column)
- **NIGDY nie wymyślaj ani nie skracaj nazw kolumn** (np. NR_EWD zamiast NR_EWIDENCYJNY) — jeśli nie znasz kolumny, wywołaj describe_table
- gdy użytkownik podaje pojęcie biznesowe — mapowanie etykiet z wtyczki; część przed «o/z/ze» to kolumny wyniku (SELECT), część po separatorze to filtr (WHERE)
- JOIN zgodnie ze ścieżką find_path
- prefiks schematu ${defaultOwner}. przy każdej tabeli
- bez średnika na końcu SQL
- NIGDY nie pisz użytkownikowi „wykonaj zapytanie SQL” — sam zwróć {"action":"answer","text":"…","sql":"SELECT …"}

${toolContext.length > 0 ? `Wyniki narzędzi:\n${toolContext.join('\n\n')}` : pluginContext ? 'Masz wskazówki z metadanych wtyczki — możesz od razu zbudować SELECT lub użyć describe_table na widoku.' : 'Zacznij od search_tables lub describe_table jeśli nie znasz tabel.'}`;
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

  private buildAgentPrompt(message: string, iteration: number, hasPluginHints: boolean): string {
    if (iteration === 0) {
      const dataIntent = isDataQueryIntent(message);
      const pluginNote =
        hasPluginHints && dataIntent
          ? '\nUżytkownik prosi o dane — jeśli masz widok/SELECT z metadanych wtyczki, zbuduj zapytanie i zwróć answer z sql.'
          : '';
      const confirmNote =
        /\btak\b|potwierdzam|zgadza\s+się|to\s+ta\s+tabela|wystarczy\s+select/i.test(message)
          ? '\nUżytkownik potwierdził tabelę/kontekst — nie pytaj ponownie; jeśli znasz tabelę i kolumny (IMIE, NAZWISKO, NR_EWIDENCYJNY), od razu zwróć answer z krótkim SELECT bez zbędnego describe_table.'
          : '';
      return `Pytanie użytkownika: ${message}

Uwzględnij historię rozmowy powyżej (szczególnie [Kontekst wątku Oracle] / [SQL]). Pytania uzupełniające bez nazwy tabeli odnoszą się do ostatniego kontekstu.${pluginNote}${confirmNote}

Zdecyduj jakie narzędzie wywołać (JSON).`;
    }
    return `Kontynuuj analizę pytania: ${message}

Masz wyniki poprzednich narzędzi w kontekście systemowym. Jeśli masz już tabelę i kolumny — zwróć {"action":"answer","text":"—","sql":"SELECT …"} z krótką listą kolumn.`;
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
