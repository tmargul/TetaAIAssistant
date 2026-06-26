import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLIENT_RAG_COLLECTION,
  type DoctorCheck,
  type DoctorOverallStatus,
  type DoctorRepairResult,
  type DoctorReport,
} from '@teta/shared';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { OllamaChatService } from '../chat/ollama-chat.service';
import { getRepoRoot } from '../config/repo-root';
import { HealthService } from '../health/health.service';
import { getAppMode } from '../rag/app-mode';
import { EmbeddingService } from '../rag/embedding.service';
import { GlobalRagService } from '../rag/global-rag.service';
import { QdrantService } from '../rag/qdrant.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class DoctorService {
  private readonly logger = new Logger(DoctorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthService,
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
    private readonly globalRag: GlobalRagService,
    private readonly ollama: OllamaChatService,
  ) {}

  async runDiagnostics(): Promise<DoctorReport> {
    const checks = await Promise.all([
      this.checkHttpServer(),
      this.checkOllama(),
      this.checkQdrant(),
      this.checkEmbeddings(),
      this.checkKnowledgeBase(),
      this.checkLicense(),
    ]);

    return {
      checkedAt: new Date().toISOString(),
      overall: this.resolveOverall(checks),
      checks,
      repairAvailable: process.platform === 'win32',
    };
  }

  async repairEnvironment(): Promise<DoctorRepairResult> {
    const actions: string[] = [];

    if (process.platform !== 'win32') {
      return {
        success: false,
        actions,
        message: 'Automatyczna naprawa usługi Qdrant jest dostępna tylko na Windows.',
      };
    }

    const scriptPath = join(getRepoRoot(), 'scripts', 'setup', 'Repair-TetaEnvironment.ps1');
    if (!existsSync(scriptPath)) {
      return {
        success: false,
        actions,
        message: `Brak skryptu naprawy: ${scriptPath}`,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        'powershell.exe',
        [
          '-ExecutionPolicy',
          'Bypass',
          '-NoProfile',
          '-File',
          scriptPath,
          '-RestartQdrant',
          '-InstallRoot',
          getRepoRoot(),
        ],
        { timeout: 120_000, windowsHide: true },
      );

      if (stdout.trim()) {
        actions.push(
          ...stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        );
      }
      if (stderr.trim()) {
        this.logger.warn(`Repair-TetaEnvironment stderr: ${stderr.trim()}`);
      }

      const report = await this.runDiagnostics();
      const qdrantOk = report.checks.find((item) => item.id === 'qdrant')?.status === 'ok';

      return {
        success: qdrantOk,
        actions,
        message: qdrantOk
          ? 'Środowisko naprawione — Qdrant odpowiada poprawnie.'
          : 'Wykonano restart usługi, ale Qdrant nadal zgłasza problem. Sprawdź logi w katalogu qdrant.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Naprawa środowiska nie powiodła się: ${message}`);
      return {
        success: false,
        actions,
        message: `Naprawa nie powiodła się: ${message}`,
      };
    }
  }

  private resolveOverall(checks: DoctorCheck[]): DoctorOverallStatus {
    if (checks.some((item) => item.status === 'error')) return 'error';
    if (checks.some((item) => item.status === 'warning')) return 'warning';
    return 'ok';
  }

  private async checkHttpServer(): Promise<DoctorCheck> {
    return {
      id: 'http',
      label: 'Serwer HTTP',
      status: 'ok',
      message: 'API Teta AI Assistant odpowiada.',
    };
  }

  private async checkOllama(): Promise<DoctorCheck> {
    const system = await this.health.getSystemHealth();
    if (system.ollama.status !== 'ok') {
      return {
        id: 'ollama',
        label: 'Ollama',
        status: 'error',
        message: 'Ollama nie odpowiada na porcie 11434.',
      };
    }

    const installed = await this.ollama.listAllInstalledModels(true).catch(() => [] as string[]);
    const chatModels = await this.ollama.getAvailableChatModels();
    const embeddingModel =
      this.config.get<string>('OLLAMA_EMBEDDING_MODEL') ?? this.embedding.model;
    const hasEmbedding = installed.some((name) => this.modelNameMatches(name, embeddingModel));

    if (chatModels.length === 0) {
      return {
        id: 'ollama',
        label: 'Ollama',
        status: 'warning',
        message: `Ollama działa, ale brak modelu czatu (np. qwen3). Zainstalowane modele: ${installed.length}.`,
      };
    }

    if (!hasEmbedding) {
      return {
        id: 'ollama',
        label: 'Ollama',
        status: 'warning',
        message: `Ollama działa, ale brak modelu embeddingów (${embeddingModel}).`,
      };
    }

    return {
      id: 'ollama',
      label: 'Ollama',
      status: 'ok',
      message: `Ollama online — modele czatu: ${chatModels.join(', ')}.`,
    };
  }

  private async checkQdrant(): Promise<DoctorCheck> {
    const system = await this.health.getSystemHealth();
    if (system.qdrant.status !== 'ok') {
      return {
        id: 'qdrant',
        label: 'Qdrant',
        status: 'error',
        message: 'Qdrant nie odpowiada na porcie 6333 (usługa TetaAI-Qdrant może być zatrzymana).',
      };
    }

    return {
      id: 'qdrant',
      label: 'Qdrant',
      status: 'ok',
      message: `Qdrant online — kolekcja ${system.qdrant.collection}, wektorów: ${system.qdrant.pointsCount ?? 0}.`,
    };
  }

  private async checkEmbeddings(): Promise<DoctorCheck> {
    const system = await this.health.getSystemHealth();
    if (system.ollama.status !== 'ok') {
      return {
        id: 'embeddings',
        label: 'Embeddings',
        status: 'skipped',
        message: 'Pominięto — Ollama jest offline.',
      };
    }

    try {
      const vector = await this.embedding.embed('teta doctor probe');
      const expected = this.embedding.dimensions;
      if (vector.length !== expected) {
        return {
          id: 'embeddings',
          label: 'Embeddings',
          status: 'warning',
          message: `Embedding działa, ale wymiar ${vector.length} ≠ oczekiwany ${expected}.`,
        };
      }
      return {
        id: 'embeddings',
        label: 'Embeddings',
        status: 'ok',
        message: `Model ${this.embedding.model} — wektor ${vector.length}D.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: 'embeddings',
        label: 'Embeddings',
        status: 'error',
        message: `Błąd embeddingu: ${message}`,
      };
    }
  }

  private async checkKnowledgeBase(): Promise<DoctorCheck> {
    const mode = getAppMode();
    try {
      if (mode === 'vendor') {
        const status = await this.globalRag.getStatus();
        if (status.chunkCount <= 0) {
          return {
            id: 'knowledge',
            label: 'Baza wiedzy',
            status: 'warning',
            message: 'Globalny RAG jest pusty — zbuduj indeks w kreatorze wiedzy.',
          };
        }
        return {
          id: 'knowledge',
          label: 'Baza wiedzy',
          status: 'ok',
          message: `Globalny RAG: ${status.chunkCount} wektorów w ${status.collection}.`,
        };
      }

      const globalCount = await this.qdrant.getPointsCount(this.qdrant.globalCollection).catch(() => 0);
      const clientCount = await this.qdrant
        .getPointsCount(CLIENT_RAG_COLLECTION)
        .catch(() => 0);
      const total = globalCount + clientCount;

      if (total <= 0) {
        return {
          id: 'knowledge',
          label: 'Baza wiedzy',
          status: 'warning',
          message: 'Brak wektorów RAG — zaimportuj paczkę globalną lub dodaj dokumenty klienta.',
        };
      }

      return {
        id: 'knowledge',
        label: 'Baza wiedzy',
        status: 'ok',
        message: `RAG: global ${globalCount}, klient ${clientCount} wektorów.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: 'knowledge',
        label: 'Baza wiedzy',
        status: 'error',
        message: `Nie udało się odczytać stanu RAG: ${message}`,
      };
    }
  }

  private async checkLicense(): Promise<DoctorCheck> {
    const licenseKey = this.config.get<string>('TETA_LICENSE_KEY')?.trim();
    if (!licenseKey) {
      return {
        id: 'license',
        label: 'Licencja',
        status: 'ok',
        message: 'Instalacja wewnętrzna — brak weryfikacji licencji (TETA_LICENSE_KEY nie ustawiony).',
      };
    }

    return {
      id: 'license',
      label: 'Licencja',
      status: 'ok',
      message: 'Klucz licencyjny jest skonfigurowany.',
    };
  }

  private modelNameMatches(installedName: string, preferred: string): boolean {
    const installedBase = installedName.split(':')[0]?.toLowerCase() ?? '';
    const preferredBase = preferred.split(':')[0]?.toLowerCase() ?? '';
    return (
      installedName === preferred ||
      installedName.startsWith(`${preferred}:`) ||
      installedBase === preferredBase
    );
  }
}
