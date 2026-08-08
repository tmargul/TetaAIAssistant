/**
 * OracleSourceProvider abstraction — filesystem + oracle_metadata share one contract.
 */

import type { Stage2NormalizedSource } from './teta-stage2.types';

export type OracleSourceProviderKind = 'filesystem' | 'oracle_metadata' | 'synthetic';

export type OracleSourceProviderCapabilities = {
  provider: OracleSourceProviderKind;
  allObjects?: boolean;
  allSource?: boolean;
  allViews?: boolean;
  allTriggers?: boolean;
  allDependencies?: boolean;
  allArguments?: boolean;
  allTabColumns?: boolean;
  allConstraints?: boolean;
  allSynonyms?: boolean;
  dbmsMetadataGetDdl?: boolean;
  errors?: string[];
};

export type OracleSourceInventoryObject = {
  owner: string;
  objectName: string;
  objectType: string;
  status?: string | null;
  created?: string | null;
  lastDdlTime?: string | null;
};

export type OracleSourceDependency = {
  owner: string;
  name: string;
  type: string;
  referencedOwner: string;
  referencedName: string;
  referencedType: string;
  dependencyType?: string | null;
};

export type OracleSourceArgument = {
  owner: string;
  packageName: string | null;
  objectName: string;
  overload: number | null;
  position: number | null;
  sequence: number | null;
  subprogramId: number | null;
  argumentName: string | null;
  inOut: string | null;
  dataType: string | null;
  typeOwner: string | null;
  typeName: string | null;
};

export type OracleSourceMultiSourceCompare = {
  key: string;
  status: 'identical' | 'different' | 'filesystem_only' | 'oracle_only';
  filesystemHash?: string | null;
  oracleHash?: string | null;
};

export interface OracleSourceProvider {
  readonly kind: OracleSourceProviderKind;
  listCapabilities(): Promise<OracleSourceProviderCapabilities> | OracleSourceProviderCapabilities;
  /**
   * Yield normalized source objects. Streaming preferred for large corpora.
   */
  iterateSources(): AsyncIterable<Stage2NormalizedSource> | Iterable<Stage2NormalizedSource>;
  listInventory?(): Promise<OracleSourceInventoryObject[]> | OracleSourceInventoryObject[];
  listDependencies?(): Promise<OracleSourceDependency[]> | OracleSourceDependency[];
  listArguments?(): Promise<OracleSourceArgument[]> | OracleSourceArgument[];
}

export function compareMultiSource(
  filesystem: Array<{ owner: string; objectName: string; objectType: string; sourceHash: string }>,
  oracle: Array<{ owner: string; objectName: string; objectType: string; sourceHash: string }>,
): OracleSourceMultiSourceCompare[] {
  const keyOf = (o: { owner: string; objectName: string; objectType: string }) =>
    `${o.owner.toUpperCase()}|${o.objectType.toUpperCase()}|${o.objectName.toUpperCase()}`;
  const fsMap = new Map(filesystem.map((x) => [keyOf(x), x]));
  const oraMap = new Map(oracle.map((x) => [keyOf(x), x]));
  const keys = new Set([...fsMap.keys(), ...oraMap.keys()]);
  const out: OracleSourceMultiSourceCompare[] = [];
  for (const key of [...keys].sort()) {
    const a = fsMap.get(key);
    const b = oraMap.get(key);
    if (a && b) {
      out.push({
        key,
        status: a.sourceHash === b.sourceHash ? 'identical' : 'different',
        filesystemHash: a.sourceHash,
        oracleHash: b.sourceHash,
      });
    } else if (a) {
      out.push({ key, status: 'filesystem_only', filesystemHash: a.sourceHash, oracleHash: null });
    } else if (b) {
      out.push({ key, status: 'oracle_only', filesystemHash: null, oracleHash: b.sourceHash });
    }
  }
  return out;
}
