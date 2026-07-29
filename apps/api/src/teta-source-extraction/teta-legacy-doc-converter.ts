import { execFile } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { sha256 } from './teta-canonical-source-contract';
import type { LegacyDocConverter } from './teta-canonical-source.types';

const execFileAsync = promisify(execFile);

export class LibreOfficeLegacyDocConverter implements LegacyDocConverter {
  constructor(private readonly sofficePath: string) {}

  async convert(inputPath: string, workspaceDir: string) {
    mkdirSync(workspaceDir, { recursive: true });
    const originalSha256 = sha256(readFileSync(inputPath));
    try {
      await execFileAsync(this.sofficePath, [
        '--headless',
        '--convert-to',
        'docx',
        '--outdir',
        workspaceDir,
        inputPath,
      ], { timeout: 120_000 });
      const base = path.basename(inputPath, path.extname(inputPath));
      const convertedPath = path.join(workspaceDir, `${base}.docx`);
      if (!require('fs').existsSync(convertedPath)) {
        return {
          status: 'conversion_failed' as const,
          convertedPath: null,
          converter: 'libreoffice_soffice',
          converterVersion: null,
          warnings: ['converted_docx_missing'],
        };
      }
      const convertedSha256 = sha256(readFileSync(convertedPath));
      let converterVersion: string | null = null;
      try {
        const v = await execFileAsync(this.sofficePath, ['--version']);
        converterVersion = String(v.stdout ?? v.stderr ?? '').trim() || null;
      } catch {
        converterVersion = null;
      }
      return {
        status: 'converted' as const,
        convertedPath,
        converter: 'libreoffice_soffice',
        converterVersion,
        warnings: [],
        originalSha256,
        convertedSha256,
      };
    } catch (err) {
      return {
        status: 'conversion_failed' as const,
        convertedPath: null,
        converter: 'libreoffice_soffice',
        converterVersion: null,
        warnings: [String(err instanceof Error ? err.message : err)],
        originalSha256,
        convertedSha256: '',
      };
    }
  }
}

export class MockLegacyDocConverter implements LegacyDocConverter {
  constructor(private readonly fixtureDocxPath: string) {}

  async convert(inputPath: string, workspaceDir: string) {
    mkdirSync(workspaceDir, { recursive: true });
    const originalSha256 = sha256(readFileSync(inputPath));
    const out = path.join(workspaceDir, `${path.basename(inputPath, '.doc')}.docx`);
    writeFileSync(out, readFileSync(this.fixtureDocxPath));
    return {
      status: 'converted' as const,
      convertedPath: out,
      converter: 'mock_legacy_doc_converter',
      converterVersion: 'fixture',
      warnings: [],
      originalSha256,
      convertedSha256: sha256(readFileSync(out)),
    };
  }
}

export class UnavailableLegacyDocConverter implements LegacyDocConverter {
  async convert(inputPath: string, _workspaceDir: string) {
    return {
      status: 'requires_conversion_tool' as const,
      convertedPath: null,
      converter: 'unavailable',
      converterVersion: null,
      warnings: ['legacy_doc_converter_unavailable'],
      originalSha256: sha256(readFileSync(inputPath)),
      convertedSha256: '',
    };
  }
}

export function resolveLegacyDocConverter(options?: {
  sofficePath?: string | null;
  mockDocxPath?: string | null;
}): LegacyDocConverter {
  if (options?.mockDocxPath) return new MockLegacyDocConverter(options.mockDocxPath);
  if (options?.sofficePath) return new LibreOfficeLegacyDocConverter(options.sofficePath);
  return new UnavailableLegacyDocConverter();
}
