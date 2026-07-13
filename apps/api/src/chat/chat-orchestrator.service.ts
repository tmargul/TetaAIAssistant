import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { ChatCompletionRequest, ChatHistoryMessage, ChatStreamEvent } from '@teta/shared';
import { isOracleVendorDebug, sanitizeOracleStreamEventForClient } from '@teta/shared';
import { classifyAgentQueryRoute } from '../agent/agent-query-router';
import type { AgentQueryRoute } from '../agent/agent-query-route.types';
import { buildAgentLlmSystemPrompt } from '../agent/agent-llm-prompts';
import { getBuildAppMode } from '../rag/app-mode';
import { OracleAgentService } from '../schema/oracle-agent.service';
import { OllamaChatService } from './ollama-chat.service';
import { ChatService } from './chat.service';
import { createNdjsonResponseTee } from './chat-stream-collector.util';
import { isFailedChatAttempt } from './chat-orchestrator-result.util';

type AttemptMode = 'oracle' | 'docs';

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chat: ChatService,
    private readonly oracleAgent: OracleAgentService,
    private readonly ollama: OllamaChatService,
  ) {}

  async streamComplete(
    input: ChatCompletionRequest,
    res: Response,
    userId?: number,
    workMode = getBuildAppMode(),
  ): Promise<void> {
    if (input.source === 'oracle') {
      return this.oracleAgent.streamComplete(input, res, userId, workMode);
    }
    if (input.source === 'docs') {
      return this.chat.streamComplete(input, res, workMode);
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const showOracleDebug = isOracleVendorDebug(workMode);
    const writeEvent = (event: ChatStreamEvent) => {
      const payload = showOracleDebug ? event : sanitizeOracleStreamEventForClient(event);
      if (!payload) {
        return;
      }
      res.write(`${JSON.stringify(payload)}\n`);
    };

    const message = input.message.trim();
    const history = input.history ?? [];
    const route = classifyAgentQueryRoute({ message, history });
    const attempts = this.resolveAttemptOrder(route.route);

    this.logger.log(
      `Chat orchestrator — route=${route.route} (${route.confidence}): ${route.reason}; attempts=${attempts.join(' → ')}`,
    );

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex]!;
      const hasMoreAttempts = attemptIndex < attempts.length - 1;
      writeEvent({
        type: 'status',
        phase: attempt,
        message: attempt === 'oracle' ? 'Sprawdzam dane w bazie…' : 'Szukam w bazie wiedzy…',
      });

      const collector = createNdjsonResponseTee(writeEvent, {
        shouldForward: (event) => {
          if (
            hasMoreAttempts &&
            event.type === 'oracle_report' &&
            event.report.rowCount === 0
          ) {
            return false;
          }
          return true;
        },
      });
      try {
        if (attempt === 'oracle') {
          await this.oracleAgent.streamComplete(
            {
              ...input,
              source: 'oracle',
              oracleDomain: input.oracleDomain ?? 'general',
            },
            collector.res,
            userId,
            workMode,
          );
        } else {
          await this.chat.streamComplete({ ...input, source: 'docs' }, collector.res, workMode);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Chat orchestrator — ${attempt} rzucił wyjątek: ${detail}`);
        continue;
      }

      const events = collector.getEvents();
      if (!isFailedChatAttempt(events, collector.getError())) {
        res.end();
        return;
      }

      this.logger.warn(`Chat orchestrator — ${attempt} nie dał użytecznej odpowiedzi, próbuję dalej`);
    }

    await this.streamClarification(input, history, writeEvent, res);
  }

  private resolveAttemptOrder(route: AgentQueryRoute): AttemptMode[] {
    if (route === 'database') {
      return ['oracle', 'docs'];
    }
    if (route === 'llm_only') {
      return ['docs'];
    }
    return ['docs', 'oracle'];
  }

  private async streamClarification(
    input: ChatCompletionRequest,
    history: ChatHistoryMessage[],
    writeEvent: (event: ChatStreamEvent) => void,
    res: Response,
  ): Promise<void> {
    writeEvent({
      type: 'status',
      phase: 'clarify',
      message: 'Potrzebuję doprecyzowania…',
    });

    const startedAt = Date.now();
    let content = '';
    for await (const delta of this.ollama.streamTokens(
      [
        { role: 'system', content: buildAgentLlmSystemPrompt('clarify') },
        ...history.map((item) => ({ role: item.role, content: item.content })),
        { role: 'user', content: input.message.trim() },
      ],
      input.model,
      input.quality,
      {
        think: this.config.get<string>('TETA_ORACLE_AGENT_THINK', 'true') !== 'false',
        maxNumPredict: Number(this.config.get('TETA_ORACLE_AGENT_NUM_PREDICT') ?? 4096),
      },
    )) {
      content += delta;
      writeEvent({ type: 'token', delta });
    }

    const totalMs = Date.now() - startedAt;
    writeEvent({
      type: 'done',
      content: content.trim(),
      model: input.model,
      createdAt: new Date().toISOString(),
      timing: { totalMs, ragMs: 0, llmMs: totalMs },
    });
    res.end();
  }
}
