/**
 * Stage 3 — bounded program-unit signature loading (ALL_ARGUMENTS).
 * Target-driven: only packages visited by the current analysis are queried.
 */
import { stage2ProgramUnitId, normalizeOracleName } from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { OracleSourceArgument } from '../teta-oracle-source-index-stage2/teta-stage2-provider';
import type { Stage3Confidence, Stage3SignatureSource } from './teta-stage3.types';

export type { Stage3SignatureSource };

export type Stage3ArgumentSignatureRow = {
  owner: string;
  packageName: string | null;
  objectName: string;
  subprogramId: number;
  overload: number;
  position: number | null;
  sequence: number | null;
  argumentName: string | null;
  inOut: string | null;
  dataType: string | null;
  typeOwner: string | null;
  typeName: string | null;
};

export type Stage3ProgramUnitSignature = {
  programUnitId: string;
  owner: string;
  packageName: string | null;
  objectName: string;
  subprogramId: number;
  overload: number;
  signatureSource: Stage3SignatureSource;
  arguments: Stage3ArgumentSignatureRow[];
  parameterNames: Set<string>;
};

export type Stage3SignatureIndex = Map<string, Stage3ProgramUnitSignature>;

export function programUnitIdFromArgument(a: OracleSourceArgument): string {
  return stage2ProgramUnitId(
    a.owner,
    a.packageName,
    a.objectName,
    a.overload ?? 0,
    a.subprogramId ?? 0,
  );
}

/** Build a program-unit signature index from ALL_ARGUMENTS rows. */
export function buildSignatureIndexFromArguments(
  args: OracleSourceArgument[],
  signatureSource: Stage3SignatureSource,
): Stage3SignatureIndex {
  const grouped = new Map<string, Stage3ProgramUnitSignature>();
  for (const a of args) {
    const pid = programUnitIdFromArgument(a);
    let sig = grouped.get(pid);
    if (!sig) {
      sig = {
        programUnitId: pid,
        owner: normalizeOracleName(a.owner),
        packageName: a.packageName ? normalizeOracleName(a.packageName) : null,
        objectName: normalizeOracleName(a.objectName),
        subprogramId: a.subprogramId ?? 0,
        overload: a.overload ?? 0,
        signatureSource,
        arguments: [],
        parameterNames: new Set<string>(),
      };
      grouped.set(pid, sig);
    }
    sig.arguments.push({
      owner: normalizeOracleName(a.owner),
      packageName: a.packageName ? normalizeOracleName(a.packageName) : null,
      objectName: normalizeOracleName(a.objectName),
      subprogramId: a.subprogramId ?? 0,
      overload: a.overload ?? 0,
      position: a.position,
      sequence: a.sequence,
      argumentName: a.argumentName ? normalizeOracleName(a.argumentName) : null,
      inOut: a.inOut,
      dataType: a.dataType,
      typeOwner: a.typeOwner ? normalizeOracleName(a.typeOwner) : null,
      typeName: a.typeName ? normalizeOracleName(a.typeName) : null,
    });
    if (a.argumentName && (a.position ?? 0) > 0) {
      sig.parameterNames.add(normalizeOracleName(a.argumentName));
    }
  }
  for (const sig of grouped.values()) {
    sig.arguments.sort(
      (x, y) => (x.position ?? 0) - (y.position ?? 0) || (x.sequence ?? 0) - (y.sequence ?? 0),
    );
  }
  return grouped;
}

export function resolveProgramUnitSignature(input: {
  programUnitId: string;
  signatureIndex: Stage3SignatureIndex;
  headerParameterNames?: Set<string>;
  programUnitResolution?: 'resolved' | 'unresolved';
}): {
  signature: Stage3ProgramUnitSignature | null;
  parameterNames: Set<string>;
  signatureSource: Stage3SignatureSource | null;
  programUnitResolution: 'resolved' | 'unresolved';
} {
  const exact = input.signatureIndex.get(input.programUnitId);
  if (exact) {
    return {
      signature: exact,
      parameterNames: exact.parameterNames,
      signatureSource: exact.signatureSource,
      programUnitResolution: input.programUnitResolution ?? 'resolved',
    };
  }
  if (input.headerParameterNames && input.headerParameterNames.size > 0) {
    return {
      signature: null,
      parameterNames: input.headerParameterNames,
      signatureSource: 'source_header',
      programUnitResolution: input.programUnitResolution === 'unresolved' ? 'unresolved' : 'unresolved',
    };
  }
  return {
    signature: null,
    parameterNames: new Set<string>(),
    signatureSource: null,
    programUnitResolution: input.programUnitResolution ?? 'unresolved',
  };
}

export function mappingConfidenceForClassification(input: {
  classification: string;
  signatureSource: Stage3SignatureSource | null;
  viaRecordChain: boolean;
  programUnitResolution: 'resolved' | 'unresolved';
}): Stage3Confidence {
  if (input.programUnitResolution === 'unresolved') return 'strong_static';
  if (input.classification === 'direct_param') {
    if (input.signatureSource === 'oracle_all_arguments' || input.signatureSource === 'stage2_index') {
      return 'exact_static';
    }
    if (input.signatureSource === 'source_header') return 'strong_static';
    return 'unresolved';
  }
  if (input.classification === 'direct_field') {
    if (input.viaRecordChain) return 'strong_static';
    return 'exact_static';
  }
  if (input.classification === 'direct_local_symbol' || input.classification === 'direct_package_symbol') {
    return 'exact_static';
  }
  if (input.classification === 'literal' || input.classification === 'sequence') return 'exact_static';
  return 'unresolved';
}

export function detectProgramUnitResolution(
  source: string,
  programUnitId: string,
): 'resolved' | 'unresolved' {
  const m = /^oracle-program-unit:[^:]+:[^:]+:([^:]+):o(\d+):s(\d+)$/.exec(programUnitId);
  if (!m) return 'unresolved';
  const member = normalizeOracleName(m[1]!);
  const text = source.replace(/\s+/g, ' ');
  const re = new RegExp(`\\b(PROCEDURE|FUNCTION)\\s+${member}\\b`, 'gi');
  let count = 0;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(text))) {
    count += 1;
  }
  return count === 1 ? 'resolved' : 'unresolved';
}
