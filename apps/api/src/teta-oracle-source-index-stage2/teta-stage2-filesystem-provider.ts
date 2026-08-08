import fs from 'fs';
import path from 'path';
import type { Stage2NormalizedSource, Stage2ObjectType } from './teta-stage2.types';
import type { OracleSourceProvider, OracleSourceProviderCapabilities } from './teta-stage2-provider';
import { extensionToObjectType, objectNameFromPath, sha256 } from './teta-stage2-parse';
import { defaultUnwrapProvider, isOracleWrappedPlsql, sha256Text } from './teta-stage2-unwrap';

const SOURCE_EXTS = new Set([
  '.VEW',
  '.VW',
  '.VIEW',
  '.PSK',
  '.PKS',
  '.SPC',
  '.PBK',
  '.PKB',
  '.BDY',
  '.TRG',
  '.TRIG',
  '.FNC',
  '.FN',
  '.PRC',
  '.PR',
  '.TYP',
  '.TPS',
  '.TPB',
  '.TAB',
  '.TBL',
  '.SQL',
]);

export function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toUpperCase();
        if (SOURCE_EXTS.has(ext)) out.push(full);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function normalizeFilesystemSource(input: {
  sourcePath: string;
  content: string;
  owner?: string;
}): Stage2NormalizedSource {
  const ext = path.extname(input.sourcePath).toUpperCase() || '.SQL';
  const objectType = extensionToObjectType(ext) as Stage2ObjectType;
  const objectName = objectNameFromPath(input.sourcePath);
  const owner = (input.owner ?? 'TETA_ADMIN').toUpperCase();
  const sourceHash = sha256(input.content);
  const wrapped = isOracleWrappedPlsql(input.content);
  const unwrap = wrapped
    ? defaultUnwrapProvider.unwrap({
        owner,
        objectName,
        objectType,
        wrappedSourceText: input.content,
        wrappedSourceHash: sourceHash,
      })
    : null;

  let parserInputText = input.content;
  let parserInputRepresentation: Stage2NormalizedSource['parserInputRepresentation'] = 'plaintext';
  let sourceStatus: Stage2NormalizedSource['sourceStatus'] = 'available_plaintext';
  let sourceRepresentation: Stage2NormalizedSource['sourceRepresentation'] = 'plaintext';

  if (!input.content.trim()) {
    sourceStatus = 'empty';
    sourceRepresentation = 'empty';
    parserInputText = '';
    parserInputRepresentation = 'none';
  } else if (wrapped) {
    sourceRepresentation = 'oracle_wrapped';
    sourceStatus = 'wrapped';
    if (unwrap?.status === 'unwrapped' && unwrap.unwrappedSourceText) {
      parserInputText = unwrap.unwrappedSourceText;
      parserInputRepresentation = 'unwrapped_plaintext';
      sourceStatus = 'unwrapped_plaintext';
    } else {
      parserInputText = '';
      parserInputRepresentation = 'none';
    }
  }

  return {
    owner,
    objectName,
    objectType,
    sourceText: input.content,
    sourceLines: input.content.split(/\r?\n/),
    sourceOrigin: input.sourcePath.includes('fixture') ? 'synthetic_fixture' : 'filesystem',
    sourceHash,
    sourceComplete: true,
    sourceStatus,
    sourceRepresentation,
    sourcePath: input.sourcePath,
    sourceAcquisitionMethod: 'filesystem_read',
    sourceLength: Buffer.byteLength(input.content, 'utf8'),
    metadata: { sourceExtension: ext },
    parserInputText,
    parserInputRepresentation,
    unwrap: unwrap
      ? {
          status: unwrap.status,
          toolVersion: unwrap.toolVersion,
          unwrappedSourceHash: unwrap.unwrappedSourceHash,
          diagnostics: unwrap.diagnostics,
        }
      : { status: 'not_wrapped', toolVersion: defaultUnwrapProvider.toolVersion, diagnostics: [] },
  };
}

export class FilesystemOracleSourceProvider implements OracleSourceProvider {
  readonly kind = 'filesystem' as const;

  constructor(
    private readonly opts: {
      sourceRoot?: string | null;
      files?: Array<{ sourcePath: string; content: string; owner?: string }>;
      defaultOwner?: string;
    },
  ) {}

  listCapabilities(): OracleSourceProviderCapabilities {
    return { provider: 'filesystem' };
  }

  *iterateSources(): Iterable<Stage2NormalizedSource> {
    const files = [...(this.opts.files ?? [])];
    const root = this.opts.sourceRoot?.trim() || '';
    if (root && fs.existsSync(root)) {
      for (const fp of walkSourceFiles(root)) {
        try {
          files.push({
            sourcePath: fp,
            content: fs.readFileSync(fp, 'utf8'),
            owner: this.opts.defaultOwner,
          });
        } catch {
          // skip
        }
      }
    }
    for (const f of files) {
      yield normalizeFilesystemSource(f);
    }
  }
}

export { SOURCE_EXTS, sha256Text };
