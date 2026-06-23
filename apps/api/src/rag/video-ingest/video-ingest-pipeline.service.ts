import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { validateKnowledgeChunkLines, type RagImportMode } from '@teta/shared';
import type { VideoIngestJobStatus } from '@teta/shared';
import { GlobalRagChunksImportService } from '../global-rag-chunks-import.service';
import {
  copyIngestAssetsToGlobalSources,
  copyMp4ToGlobalTrainings,
  runVideoIngestPython,
  type VideoIngestPythonResult,
} from './video-ingest-runner';

export interface VideoIngestPipelineProgress {
  status: VideoIngestJobStatus;
  progress: number;
  message: string;
}

export interface VideoIngestPipelineResult {
  pythonResult: VideoIngestPythonResult;
  importMode: RagImportMode;
  chunkCount: number;
  sources: string[];
}

@Injectable()
export class VideoIngestPipelineService {
  private readonly logger = new Logger(VideoIngestPipelineService.name);

  constructor(private readonly chunksImport: GlobalRagChunksImportService) {}

  async runFromMp4File(
    inputPath: string,
    outputDir: string,
    importMode: RagImportMode,
    onProgress?: (update: VideoIngestPipelineProgress) => void,
  ): Promise<VideoIngestPipelineResult> {
    const report = (status: VideoIngestJobStatus, progress: number, message: string) => {
      onProgress?.({ status, progress, message });
    };

    report('extracting', 10, 'Ekstrakcja audio i przygotowanie…');

    const pythonResult = await runVideoIngestPython({
      inputPath,
      outputDir,
      onStderrLine: (line) => {
        if (line.includes('Ekstrakcja audio')) {
          report('extracting', 20, 'Ekstrakcja audio (ffmpeg)…');
        } else if (line.includes('Whisper:')) {
          report('transcribing', 35, 'Transkrypcja Whisper…');
        } else if (line.includes('Gotowe:')) {
          report('transcribing', 60, 'Segmentacja i klatki…');
        }
      },
    });

    report('transcribing', 65, `Walidacja JSONL (${pythonResult.chunkCount} chunków)…`);

    const jsonlContent = await readFile(pythonResult.jsonlPath, 'utf8');
    const validation = validateKnowledgeChunkLines(jsonlContent);
    if (!validation.valid) {
      const first = validation.issues[0];
      const prefix = first && first.line > 0 ? `Linia ${first.line}` : 'Plik';
      throw new Error(
        `Walidacja JSONL nie powiodła się: ${prefix}: ${first?.message ?? 'nieznany błąd'}`,
      );
    }

    report('indexing', 72, 'Kopiowanie klatek i pliku MP4 do sources/global…');
    await copyIngestAssetsToGlobalSources(
      pythonResult.assetsDir,
      pythonResult.assetsRelPrefix,
    );
    await copyMp4ToGlobalTrainings(inputPath, pythonResult.source);

    report('indexing', 80, `Indeksacja Qdrant (${importMode})…`);
    const importResult = await this.chunksImport.importFromJsonlFile(
      pythonResult.jsonlPath,
      importMode,
    );

    this.logger.log(
      `Video ingest: ${importResult.chunkCount} chunków, źródła: ${importResult.sources.join(', ')}`,
    );

    report('indexing', 95, 'Finalizacja…');

    return {
      pythonResult,
      importMode,
      chunkCount: importResult.chunkCount,
      sources: importResult.sources,
    };
  }
}
