import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { assetIdFromHash, portableAssetPath, sha256 } from './teta-canonical-source-contract';

export type StoredAsset = {
  assetId: string;
  relativePortablePath: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  duplicateOfExisting: boolean;
};

export class ContentAddressedAssetStore {
  private readonly assetsRoot: string;
  private readonly stored = new Map<string, StoredAsset>();

  constructor(private readonly outputRoot: string) {
    this.assetsRoot = path.join(outputRoot, 'assets', 'sha256');
    mkdirSync(this.assetsRoot, { recursive: true });
  }

  storeBinary(input: {
    buffer: Buffer;
    ext: string;
    mimeType: string;
  }): StoredAsset {
    const hash = sha256(input.buffer);
    const relativePortablePath = portableAssetPath(hash, input.ext);
    const abs = path.join(this.outputRoot, relativePortablePath);
    const duplicateOfExisting = existsSync(abs);
    if (!duplicateOfExisting) {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, input.buffer);
    }
    const stored: StoredAsset = {
      assetId: assetIdFromHash(hash),
      relativePortablePath,
      mimeType: input.mimeType,
      sha256: hash,
      sizeBytes: input.buffer.length,
      duplicateOfExisting,
    };
    this.stored.set(hash, stored);
    return stored;
  }

  copyFrameFile(input: {
    sourcePath: string;
    ext: string;
    mimeType?: string;
  }): StoredAsset {
    const buffer = readFileSync(input.sourcePath);
    return this.storeBinary({ buffer, ext: input.ext, mimeType: input.mimeType ?? 'image/jpeg' });
  }

  getStats(): { portableAssetsStored: number; uniquePortableAssets: number; duplicatePortableAssets: number } {
    const all = [...this.stored.values()];
    return {
      portableAssetsStored: all.length,
      uniquePortableAssets: all.filter((a) => !a.duplicateOfExisting).length,
      duplicatePortableAssets: all.filter((a) => a.duplicateOfExisting).length,
    };
  }
}

export function writeManifest(outputRoot: string, manifest: unknown): void {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function manifestContainsAbsolutePaths(manifestJson: string): boolean {
  return /[A-Za-z]:[\\/]/.test(manifestJson) || manifestJson.includes(':\\\\');
}
