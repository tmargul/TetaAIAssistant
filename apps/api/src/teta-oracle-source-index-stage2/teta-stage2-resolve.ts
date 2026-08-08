/**
 * Endpoint resolution — turns a raw static reference (owner.name or bare name)
 * into a canonical Stage2 object identity, using real Oracle inventory
 * (ALL_OBJECTS) + synonym metadata (ALL_SYNONYMS) instead of guessing.
 *
 * Rules (see AIA_ORACLE_SOURCE_INDEX_STAGE2 architect notes):
 *  - effective owner = explicit qualifier if qualified, else the source object's own owner.
 *  - never default an unknown name to TABLE when the inventory says VIEW (or anything else).
 *  - never fabricate TABLE for a name absent from a *known* inventory — mark unresolved instead.
 *  - when no inventory is available at all (filesystem/offline corpora with no ALL_OBJECTS
 *    scan), fall back to the legacy "assume base table" heuristic, but flag the reduced
 *    confidence (strong_static_inference, not exact_from_source).
 */

import type { Stage2Confidence, Stage2ObjectType } from './teta-stage2.types';
import type { QualifiedName } from './teta-stage2-parse';
import { normalizeOracleName, stage2ObjectId } from './teta-stage2-parse';

export type ResolvedEndpoint = {
  owner: string;
  objectName: string;
  objectType: Stage2ObjectType | 'unresolved_object';
  id: string;
  confidence: Stage2Confidence;
  synonymTargetId?: string | null;
};

export function inventoryKey(owner: string, objectName: string): string {
  return `${normalizeOracleName(owner)}|${normalizeOracleName(objectName)}`;
}

/**
 * Builds an owner|objectName → objectType lookup from a flat inventory list
 * (typically ALL_OBJECTS rows already mapped to Stage2ObjectType). If the same
 * key somehow carries more than one type, VIEW wins over TABLE over anything
 * else — Oracle disallows a same-named VIEW/TABLE pair for one owner in
 * practice, but this keeps resolution deterministic if it ever happens.
 */
export function buildInventoryIndex(
  inventory: Array<{ owner: string; objectName: string; objectType: Stage2ObjectType }>,
): Map<string, Stage2ObjectType> {
  const idx = new Map<string, Stage2ObjectType>();
  const rank = (t: Stage2ObjectType): number => (t === 'VIEW' ? 2 : t === 'TABLE' ? 1 : 0);
  for (const o of inventory) {
    const key = inventoryKey(o.owner, o.objectName);
    const existing = idx.get(key);
    if (!existing || rank(o.objectType) > rank(existing)) {
      idx.set(key, o.objectType);
    }
  }
  return idx;
}

function resolved(
  owner: string,
  objectName: string,
  objectType: Stage2ObjectType,
  confidence: Stage2Confidence,
  synonymTargetId?: string | null,
): ResolvedEndpoint {
  const out: ResolvedEndpoint = {
    owner,
    objectName,
    objectType,
    id: stage2ObjectId(owner, objectType, objectName),
    confidence,
  };
  if (synonymTargetId !== undefined) out.synonymTargetId = synonymTargetId;
  return out;
}

function unresolved(owner: string, objectName: string): ResolvedEndpoint {
  return {
    owner,
    objectName,
    objectType: 'unresolved_object',
    id: stage2ObjectId(owner, 'other_source_object', objectName),
    confidence: 'unresolved',
  };
}

export function resolveEndpoint(opts: {
  sourceOwner: string;
  qualified: QualifiedName;
  inventory: Map<string, Stage2ObjectType>;
  synonyms?: Map<string, { owner: string; objectName: string }>;
  /**
   * Reserved for future disambiguation (e.g. preferring writable base objects
   * for DML targets). The inventory index only stores one type per key, so
   * this does not change resolution today — kept for API stability/tests.
   */
  prefer?: 'read' | 'dml';
}): ResolvedEndpoint {
  const owner = normalizeOracleName(
    opts.qualified.wasQualified && opts.qualified.owner ? opts.qualified.owner : opts.sourceOwner,
  );
  const objectName = normalizeOracleName(opts.qualified.objectName);
  const key = inventoryKey(owner, objectName);
  const invType = opts.inventory.get(key);

  if (invType === 'SYNONYM') {
    const target = opts.synonyms?.get(key);
    if (target) {
      const targetOwner = normalizeOracleName(target.owner);
      const targetName = normalizeOracleName(target.objectName);
      const targetType = opts.inventory.get(inventoryKey(targetOwner, targetName)) ?? 'TABLE';
      const synonymTargetId = stage2ObjectId(targetOwner, targetType, targetName);
      return resolved(owner, objectName, 'SYNONYM', 'exact_from_source', synonymTargetId);
    }
    return resolved(owner, objectName, 'SYNONYM', 'exact_from_source', null);
  }
  if (invType) {
    return resolved(owner, objectName, invType, 'exact_from_source');
  }
  if (opts.inventory.size === 0) {
    // No ALL_OBJECTS-derived inventory at all (filesystem/offline mode) — keep
    // the historical "assume base table" behavior, but at reduced confidence
    // since it is not verified against real metadata.
    return resolved(owner, objectName, 'TABLE', 'strong_static_inference');
  }
  return unresolved(owner, objectName);
}
