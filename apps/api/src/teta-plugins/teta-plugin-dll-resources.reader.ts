import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import type { TetaPluginColumnMeta } from './teta-plugin-metadata.types';

const logger = new Logger('TetaPluginDllResourcesReader');

type ResourceEntry = {
  GridColumnName?: string;
  Kind?: string;
  Value?: string;
};

const POWERSHELL_SCRIPT = `
param([string]$DllPath, [string]$OutFile)
$ErrorActionPreference = 'Stop'
$result = @()
try {
  Unblock-File -Path $DllPath -ErrorAction SilentlyContinue
  $asm = [Reflection.Assembly]::LoadFile($DllPath)
} catch {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($DllPath)
    $asm = [Reflection.Assembly]::Load($bytes)
  } catch {
    [System.IO.File]::WriteAllText($OutFile, '[]', [System.Text.UTF8Encoding]::new($false))
    exit 0
  }
}
foreach ($resourceName in $asm.GetManifestResourceNames()) {
  if ($resourceName -notmatch '\\.resources$') { continue }
  if ($resourceName -match '\\.(en|hu)(\\.|\\b)') { continue }
  $stream = $asm.GetManifestResourceStream($resourceName)
  if ($null -eq $stream) { continue }
  try {
    $reader = New-Object System.Resources.ResourceReader $stream
    foreach ($entry in $reader) {
      $key = [string]$entry.Key
      $value = [string]$entry.Value
      if ($key -match '^(.+)\\.(DisplayedName|HintText)$') {
        $result += [pscustomobject]@{
          GridColumnName = $matches[1]
          Kind = $matches[2]
          Value = $value
        }
      }
    }
    $reader.Close()
  } catch {
  } finally {
    $stream.Dispose()
  }
}
$json = $result | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
`.trim();

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function parseResourceEntries(raw: string, dllPath: string): ResourceEntry[] {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as ResourceEntry | ResourceEntry[] | null;
    if (!parsed) return [];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    logger.warn(`Nie udało się sparsować zasobów DLL ${dllPath}: ${String(err)}`);
    return [];
  }
}

function mapResourceEntries(entries: ResourceEntry[]): TetaPluginColumnMeta[] {
  const map = new Map<string, TetaPluginColumnMeta>();
  for (const entry of entries) {
    const columnName = entry.GridColumnName?.trim();
    const value = entry.Value?.trim();
    if (!columnName || !value) continue;

    const key = columnName.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { GridColumnName: columnName, Labels: {}, Hints: {} });
    }
    const meta = map.get(key)!;
    if (entry.Kind?.toLowerCase() === 'hinttext') {
      meta.Hints = { ...meta.Hints, PL: value };
    } else {
      meta.Labels = { ...meta.Labels, PL: value };
    }
  }

  return [...map.values()].sort((a, b) => a.GridColumnName.localeCompare(b.GridColumnName, 'pl'));
}

export function readColumnsFromPluginDll(dllPath: string): TetaPluginColumnMeta[] {
  if (process.platform !== 'win32') {
    logger.debug(`Pomijam odczyt zasobów DLL poza Windows: ${dllPath}`);
    return [];
  }

  const outFile = path.join(tmpdir(), `teta-dll-cols-${randomUUID()}.json`);
  const escapedDllPath = escapePowerShellSingleQuoted(dllPath);
  const escapedOutFile = escapePowerShellSingleQuoted(outFile);

  try {
    const command = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `& { ${POWERSHELL_SCRIPT} } -DllPath '${escapedDllPath}' -OutFile '${escapedOutFile}'`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );

    if (command.status !== 0) {
      logger.warn(
        `Nie udało się odczytać zasobów z ${dllPath}: ${command.stderr || command.stdout || command.status}`,
      );
      return [];
    }

    if (!existsSync(outFile)) {
      logger.warn(`Brak pliku wynikowego z zasobów DLL: ${dllPath}`);
      return [];
    }

    const entries = parseResourceEntries(readFileSync(outFile, 'utf8'), dllPath);
    const columns = mapResourceEntries(entries);
    if (columns.length > 0) {
      logger.log(`Odczytano ${columns.length} etykiet kolumn UI z ${path.basename(dllPath)}.`);
    }
    return columns;
  } finally {
    try {
      rmSync(outFile, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
