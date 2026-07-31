import {
  loadOwnershipRegistry,
  type OwnershipRegistryEntry,
} from './teta-runtime-source-policy.service';
import type { SourceOwnership } from './teta-runtime-knowledge.types';

function patternMatches(pattern: string, logicalSourceId: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return logicalSourceId.startsWith(prefix);
  }
  return logicalSourceId === pattern;
}

export type OwnershipResolution = {
  sourceOwnership: SourceOwnership;
  entry: OwnershipRegistryEntry | null;
  resolvedFrom: 'explicit_registry' | 'unknown';
};

export function resolveSourceOwnership(
  logicalSourceId: string,
  repoRoot?: string,
): OwnershipResolution {
  const registry = loadOwnershipRegistry(repoRoot);
  // Prefer longest matching prefix to avoid overly broad matches winning incorrectly.
  const matches = registry.entries
    .filter((e) => patternMatches(e.logicalSourceIdPattern, logicalSourceId))
    .sort((a, b) => b.logicalSourceIdPattern.length - a.logicalSourceIdPattern.length);
  const entry = matches[0] ?? null;
  if (!entry) {
    return { sourceOwnership: 'unknown', entry: null, resolvedFrom: 'unknown' };
  }
  return {
    sourceOwnership: entry.sourceOwnership,
    entry,
    resolvedFrom: 'explicit_registry',
  };
}

export function mustBlockUnknownOwnership(ownership: SourceOwnership): boolean {
  return ownership === 'unknown';
}
