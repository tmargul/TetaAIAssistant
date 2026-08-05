import fs from 'fs';
import path from 'path';
import {
  fingerprint,
  sha256,
  type AtomicWriteStatus,
  type Stage3k2b2b2b1SafetyCounters,
  type StorageContainmentStatus,
} from './teta-view-metadata.types';

export const vendorRoot = (root: string) =>
  path.join(root, '.local', 'teta-vendor-artifacts', 'view-definitions');

export function storageRootInfo(root: string) {
  const dir = vendorRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const resolved = fs.realpathSync(dir);
  return {
    vendorArtifactRootId: 'local:teta-vendor-artifacts:view-definitions:v1',
    vendorArtifactRootFingerprint: fingerprint(resolved),
    resolvedRoot: resolved,
  };
}

export function assessPathContainment(
  root: string,
  relative: string,
  counters: Stage3k2b2b2b1SafetyCounters,
): { status: StorageContainmentStatus; resolvedPath: string | null } {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]+/).includes('..')) {
    counters.payloadPathTraversalAccepted += 0;
    return { status: 'path_invalid', resolvedPath: null };
  }
  try {
    // A first payload write has no root yet; create only the fixed vendor root
    // before resolving the untrusted relative path.
    fs.mkdirSync(vendorRoot(root), { recursive: true });
    const base = fs.realpathSync(vendorRoot(root));
    const unresolved = path.resolve(base, relative);
    // Reject if any path segment before realpath is a symlink/junction escaping
    let walk = base;
    const parts = path.relative(base, unresolved).split(path.sep).filter(Boolean);
    for (const part of parts) {
      walk = path.join(walk, part);
      if (fs.existsSync(walk)) {
        const st = fs.lstatSync(walk);
        if (st.isSymbolicLink()) {
          const real = fs.realpathSync(walk);
          if (!real.startsWith(base + path.sep) && real !== base) {
            return { status: 'symlink_or_reparse_escape', resolvedPath: null };
          }
        }
      }
    }
    const target = fs.existsSync(unresolved) ? fs.realpathSync(unresolved) : unresolved;
    if (!target.startsWith(base + path.sep) && target !== base) {
      return { status: 'outside_vendor_root', resolvedPath: null };
    }
    return { status: 'contained', resolvedPath: target };
  } catch {
    return { status: 'path_invalid', resolvedPath: null };
  }
}

export function containedPayloadPath(root: string, relative: string): string {
  const assessed = assessPathContainment(root, relative, emptyCountersProxy());
  if (assessed.status !== 'contained' || !assessed.resolvedPath) {
    throw new Error(`path_containment:${assessed.status}`);
  }
  return assessed.resolvedPath;
}

function emptyCountersProxy(): Stage3k2b2b2b1SafetyCounters {
  return new Proxy({} as Stage3k2b2b2b1SafetyCounters, {
    get: () => 0,
    set: () => true,
  });
}

export function atomicWriteVendorPayload(
  root: string,
  relative: string,
  data: Buffer,
  counters: Stage3k2b2b2b1SafetyCounters,
): {
  payloadPath: string;
  payloadRelativePath: string;
  payloadResolvedPathFingerprint: string;
  rawPayloadSha256: string;
  temporaryPayloadFingerprint: string;
  finalPayloadFingerprint: string;
  storageContainmentStatus: StorageContainmentStatus;
  atomicWriteStatus: AtomicWriteStatus;
} {
  const containment = assessPathContainment(root, relative, counters);
  if (containment.status === 'outside_vendor_root') {
    counters.payloadWrittenOutsideVendorRoot++;
    throw new Error('outside_vendor_root');
  }
  if (containment.status === 'symlink_or_reparse_escape') {
    counters.payloadSymlinkEscapeAccepted++;
    throw new Error('symlink_or_reparse_escape');
  }
  if (containment.status === 'path_invalid' || !containment.resolvedPath) {
    counters.payloadPathTraversalAccepted++;
    throw new Error('path_invalid');
  }

  const target = containment.resolvedPath;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, data);
  const temporaryPayloadFingerprint = sha256(fs.readFileSync(temp));
  fs.renameSync(temp, target);
  const finalBuf = fs.readFileSync(target);
  const finalPayloadFingerprint = sha256(finalBuf);
  if (finalPayloadFingerprint !== temporaryPayloadFingerprint) {
    counters.payloadChangedBetweenValidationAndParse++;
    throw new Error('atomic_write_hash_mismatch');
  }
  return {
    payloadPath: target,
    payloadRelativePath: relative.replace(/\\/g, '/'),
    payloadResolvedPathFingerprint: fingerprint(fs.realpathSync(target)),
    rawPayloadSha256: finalPayloadFingerprint,
    temporaryPayloadFingerprint,
    finalPayloadFingerprint,
    storageContainmentStatus: 'contained',
    atomicWriteStatus: 'completed',
  };
}

export function rehashPayloadFile(payloadPath: string): string {
  return sha256(fs.readFileSync(payloadPath));
}
