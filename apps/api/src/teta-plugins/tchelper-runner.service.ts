import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { TetaPluginFormMetadata, TetaPluginGatewayMeta, TetaPluginGatewaySqlSnapshot, TetaPluginMetadataBundle } from './teta-plugin-metadata.types';

@Injectable()
export class TchelperRunnerService {
  private readonly logger = new Logger(TchelperRunnerService.name);

  constructor(private readonly config: ConfigService) {}

  tryExtractMetadata(
    clientDirectory: string,
    dllName: string,
    dbArgs?: { user: string; password: string; connectString: string },
  ): TetaPluginFormMetadata[] | null {
    const exePath = this.resolveExecutablePath();
    if (!exePath) {
      return null;
    }

    const outputDir = mkdtempSync(path.join(tmpdir(), 'teta-tchelper-'));
    try {
      const args = [
        '--root',
        clientDirectory,
        '--output',
        outputDir,
        '--assembly',
        dllName,
        '--short-mode',
        '--no-mtg-probe',
      ];

      if (dbArgs) {
        args.push('--db-user', dbArgs.user, '--db-password', dbArgs.password, '--db-data-source', dbArgs.connectString);
      }

      this.logger.log(`TCHelper: ${exePath} ${args.map((arg) => (arg.includes('password') ? '***' : arg)).join(' ')}`);
      const result = spawnSync(exePath, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10 * 60 * 1000,
      });

      if (result.status !== 0 && result.status !== 2) {
        this.logger.warn(
          `TCHelper zakończył się kodem ${result.status}: ${result.stderr || result.stdout || 'brak outputu'}`,
        );
      }

      const jsonFiles = readdirSync(outputDir).filter((name) => name.toLowerCase().endsWith('.json'));
      if (jsonFiles.length === 0) {
        return null;
      }

      const forms: TetaPluginFormMetadata[] = [];
      for (const fileName of jsonFiles) {
        try {
          const parsed = JSON.parse(readFileSync(path.join(outputDir, fileName), 'utf8')) as TetaPluginFormMetadata;
          forms.push(parsed);
        } catch (err) {
          this.logger.warn(`Nie udało się sparsować ${fileName}: ${String(err)}`);
        }
      }

      return forms.length > 0 ? forms : null;
    } catch (err) {
      this.logger.warn(`TCHelper niedostępny: ${String(err)}`);
      return null;
    } finally {
      try {
        rmSync(outputDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  tryBuildGatewaySql(
    gateways: TetaPluginGatewayMeta[],
    dbArgs: { user: string; password: string; connectString: string },
  ): Map<string, TetaPluginGatewaySqlSnapshot> | null {
    const exePath = this.resolveExecutablePath();
    if (!exePath || gateways.length === 0) {
      return null;
    }

    const eligible = gateways.filter(
      (gateway) =>
        gateway.ViewName?.trim() &&
        gateway.TableAlias?.trim() &&
        gateway.PackageName?.trim() &&
        gateway.DatasetTableName?.trim(),
    );
    if (eligible.length === 0) {
      this.logger.warn(
        'TCHelper --build-sql: brak gatewayów z pełnymi metadanymi buildera (ViewName, TableAlias, PackageName, DatasetTableName).',
      );
      return null;
    }

    const workDir = mkdtempSync(path.join(tmpdir(), 'teta-tchelper-sql-'));
    const inputPath = path.join(workDir, 'gateways-in.json');
    const outputPath = path.join(workDir, 'gateways-out.json');

    try {
      const payload = {
        Gateways: eligible.map((gateway) => ({
          ClassName: gateway.ClassName,
          GatewayKind: gateway.GatewayKind,
          SourcePath: gateway.SourcePath,
          DatasetTableName: gateway.DatasetTableName,
          ViewName: gateway.ViewName,
          PackageName: gateway.PackageName,
          TableAlias: gateway.TableAlias,
          BaseTableName: gateway.BaseTableName,
          Sql: gateway.Sql ?? {},
        })),
      };
      writeFileSync(inputPath, JSON.stringify(payload, null, 2), 'utf8');

      const args = [
        '--build-sql',
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--short-mode',
        '--db-user',
        dbArgs.user,
        '--db-password',
        dbArgs.password,
        '--db-data-source',
        dbArgs.connectString,
      ];

      this.logger.log(`TCHelper SQL: ${exePath} --build-sql (${eligible.length} gatewayów)`);
      const result = spawnSync(exePath, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10 * 60 * 1000,
      });

      if (result.status !== 0) {
        this.logger.warn(
          `TCHelper --build-sql zakończył się kodem ${result.status}: ${result.stderr || result.stdout || 'brak outputu'}`,
        );
        return null;
      }

      if (!existsSync(outputPath)) {
        return null;
      }

      const parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        gateways?: Array<{ className?: string; sql?: TetaPluginGatewaySqlSnapshot }>;
        Gateways?: Array<{ ClassName?: string; Sql?: TetaPluginGatewaySqlSnapshot }>;
      };

      const rows = (parsed.Gateways ?? parsed.gateways ?? []) as Array<Record<string, unknown>>;
      const map = new Map<string, TetaPluginGatewaySqlSnapshot>();
      for (const row of rows) {
        const className =
          (typeof row.ClassName === 'string' ? row.ClassName : null) ??
          (typeof row.className === 'string' ? row.className : null);
        const sql = (row.Sql ?? row.sql) as TetaPluginGatewaySqlSnapshot | undefined;
        if (className && sql) {
          map.set(className.toLowerCase(), sql);
        }
      }

      return map.size > 0 ? map : null;
    } catch (err) {
      this.logger.warn(`TCHelper --build-sql niedostępny: ${String(err)}`);
      return null;
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private resolveExecutablePath(): string | null {
    const candidates = [
      this.config.get<string>('TETA_TCHELPER_EXE'),
      path.resolve('Z:/Projekty/TCHelper/bin/Release/TCHelper.exe'),
      path.resolve('Z:/Projekty/TCHelper/bin/Debug/TCHelper.exe'),
      path.resolve(process.cwd(), '../TCHelper/bin/Release/TCHelper.exe'),
      path.resolve(process.cwd(), '../TCHelper/bin/Debug/TCHelper.exe'),
    ].filter((value): value is string => !!value?.trim());

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    this.logger.warn(
      'TCHelper.exe niedostępny — SQL SumoCommandBuilder nie zostanie wygenerowany. Zbuduj TCHelper lub ustaw TETA_TCHELPER_EXE.',
    );
    return null;
  }
}

export function attachTchelperForms(
  bundle: TetaPluginMetadataBundle,
  tchelperForms: TetaPluginFormMetadata[],
  mergeForm: (source: TetaPluginFormMetadata, tchelper: TetaPluginFormMetadata) => TetaPluginFormMetadata,
): TetaPluginMetadataBundle {
  if (tchelperForms.length === 0) {
    return bundle;
  }

  const byGuid = new Map(
    tchelperForms
      .filter((form) => form.Plugin.Guid)
      .map((form) => [form.Plugin.Guid!.replace(/[{}]/g, '').toLowerCase(), form]),
  );
  const byClass = new Map(
    tchelperForms
      .filter((form) => form.Plugin.ClassName)
      .map((form) => [form.Plugin.ClassName!.toLowerCase(), form]),
  );

  const mergedForms = bundle.forms.map((form) => {
    const guidKey = form.Plugin.Guid?.replace(/[{}]/g, '').toLowerCase();
    const tcForm =
      (guidKey ? byGuid.get(guidKey) : undefined) ??
      (form.Plugin.ClassName ? byClass.get(form.Plugin.ClassName.toLowerCase()) : undefined);
    return tcForm ? mergeForm(form, tcForm) : form;
  });

  for (const tcForm of tchelperForms) {
    const guidKey = tcForm.Plugin.Guid?.replace(/[{}]/g, '').toLowerCase();
    const exists = mergedForms.some((form) => {
      const formGuid = form.Plugin.Guid?.replace(/[{}]/g, '').toLowerCase();
      return (
        (guidKey && formGuid === guidKey) ||
        (form.Plugin.ClassName &&
          tcForm.Plugin.ClassName &&
          form.Plugin.ClassName.toLowerCase() === tcForm.Plugin.ClassName.toLowerCase())
      );
    });
    if (!exists) mergedForms.push(tcForm);
  }

  return {
    ...bundle,
    extractionMode: 'hybrid',
    forms: mergedForms,
  };
}
