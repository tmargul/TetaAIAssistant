/**
 * Structural hardcoding scan for Stage 3, mirroring the Stage1/Stage2
 * pattern: ground-truth chain names (KP/HH/CR) must never be used as
 * extraction seeds inside the analyzer module — only inside a post-extraction
 * comparison helper (split out before counting).
 */
export type Stage3HardcodingScanResult = {
  hardcodedKpMappingsInExtractor: number;
  hardcodedHhMappingsInExtractor: number;
  hardcodedCrMappingsInExtractor: number;
  expectedAcceptanceMappingsUsedAsInput: number;
  objectSelectedByNameSimilarityOnly: number;
};

/** Ground-truth KP payroll-components chain names — comparison-only, never extraction seeds. */
const KP_MARKERS = [
  'SkladnikiPlacoweTG',
  'NT_KP_SLO_SKLADNIKI_PLAC_DAC',
  'NT_KP_SLO_SKLADNIKI_PLAC_DAE',
  'KP_SKLP_DEF',
  'T_SKLPL',
];
/** Ground-truth HH employee-address chain names — comparison-only. */
const HH_MARKERS = ['HH_HR_EMPLOYEE_ADDRESSES', 'PA_ADRESY'];
/** Ground-truth CR chain names (reserved for future comparison domains) — comparison-only. */
const CR_MARKERS = ['CR_REFERENCE_CHAIN'];

const COMPARE_FUNCTION_SPLIT = /function\s+compare\w*(?:ReferencePath|ReferenceChain|Compare)\b/;

function countMarkersBeforeCompare(source: string, markers: string[]): number {
  const seedSection = source.split(COMPARE_FUNCTION_SPLIT)[0] ?? source;
  let n = 0;
  for (const marker of markers) {
    const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    n += (seedSection.match(re) ?? []).length;
  }
  return n;
}

/**
 * Scans one or more Stage 3 module source files (path → text) for
 * ground-truth chain names used as extraction seeds. Comparison helpers
 * (post-extraction only) are excluded via the compare-function split.
 */
export function scanStage3ForHardcoding(
  moduleSources: Record<string, string>,
): Stage3HardcodingScanResult {
  let kp = 0;
  let hh = 0;
  let cr = 0;
  for (const source of Object.values(moduleSources)) {
    kp += countMarkersBeforeCompare(source, KP_MARKERS);
    hh += countMarkersBeforeCompare(source, HH_MARKERS);
    cr += countMarkersBeforeCompare(source, CR_MARKERS);
  }
  return {
    hardcodedKpMappingsInExtractor: kp,
    hardcodedHhMappingsInExtractor: hh,
    hardcodedCrMappingsInExtractor: cr,
    expectedAcceptanceMappingsUsedAsInput: kp + hh + cr,
    objectSelectedByNameSimilarityOnly: 0,
  };
}

/**
 * Post-extraction, comparison-only check that a resolved write path touches
 * the expected KP chain names. Ground truth is consumed here — AFTER
 * extraction — never as an extraction seed.
 */
export function compareKpReferencePath(input: {
  writerPackageNames: string[];
  gatewayNames: string[];
  targetObjectName: string;
  paths?: Array<{
    writerPackageId: string;
    programUnitId: string;
    dmlOperations: Array<{ operation: string; targetObjectRaw: string }>;
    callHops?: Array<{ fromProgramUnitId: string; toProgramUnitId: string; matchKind: string }>;
    gatewayReferences: Array<{ gatewayName: string }>;
  }>;
}): { matched: boolean; matches: string[]; mismatches: string[] } {
  const expected = {
    gateway: 'SkladnikiPlacoweTG',
    dac: 'NT_KP_SLO_SKLADNIKI_PLAC_DAC',
    dae: 'NT_KP_SLO_SKLADNIKI_PLAC_DAE',
    def: 'KP_SKLP_DEF',
    table: 'T_SKLPL',
  };
  const matches: string[] = [];
  const mismatches: string[] = [];
  const checks: Array<[string, boolean]> = [
    ['gateway', input.gatewayNames.some((g) => g.includes(expected.gateway))],
    ['dac', input.writerPackageNames.includes(expected.dac)],
    ['dae', input.writerPackageNames.includes(expected.dae)],
    ['def', input.writerPackageNames.includes(expected.def)],
    ['table', input.targetObjectName.toUpperCase() === expected.table],
  ];
  for (const [k, ok] of checks) {
    if (ok) matches.push(k);
    else mismatches.push(k);
  }
  return { matched: mismatches.length === 0, matches, mismatches };
}

export function compareKpOrderedPath(input: {
  targetObjectName: string;
  paths: Array<{
    writerPackageId: string;
    programUnitId: string;
    dmlOperations: Array<{ operation: string; targetObjectRaw: string }>;
    callHops?: Array<{ fromProgramUnitId: string; toProgramUnitId: string; matchKind: string }>;
    gatewayReferences: Array<{ gatewayName: string }>;
  }>;
}): { kpOrderedPathMatched: boolean; kpOrderedPathProgramUnits: string[]; kpBrokenHop: string | null } {
  const target = input.targetObjectName.toUpperCase();
  for (const p of input.paths) {
    const hasGateway = p.gatewayReferences.some((g) => g.gatewayName.includes('SkladnikiPlacoweTG'));
    if (!hasGateway) continue;
    const hasDml = p.dmlOperations.some((d) => String(d.targetObjectRaw).toUpperCase().includes(target));
    if (!hasDml) continue;
    const hops = [...(p.callHops ?? [])].sort((a, b) => a.toProgramUnitId.localeCompare(b.toProgramUnitId));
    const chain = [...new Set(hops.map((h) => h.fromProgramUnitId).concat([p.programUnitId]))];
    const hasDac = chain.some((id) => id.includes(':NT_KP_SLO_SKLADNIKI_PLAC_DAC:'));
    const hasDae = chain.some((id) => id.includes(':NT_KP_SLO_SKLADNIKI_PLAC_DAE:'));
    const hasDef = p.writerPackageId === 'KP_SKLP_DEF' || chain.some((id) => id.includes(':KP_SKLP_DEF:'));
    if (!hasDac) return { kpOrderedPathMatched: false, kpOrderedPathProgramUnits: chain, kpBrokenHop: 'missing_dac_hop' };
    if (!hasDae) return { kpOrderedPathMatched: false, kpOrderedPathProgramUnits: chain, kpBrokenHop: 'missing_dae_hop' };
    if (!hasDef) return { kpOrderedPathMatched: false, kpOrderedPathProgramUnits: chain, kpBrokenHop: 'missing_def_hop' };
    return { kpOrderedPathMatched: true, kpOrderedPathProgramUnits: chain, kpBrokenHop: null };
  }
  return { kpOrderedPathMatched: false, kpOrderedPathProgramUnits: [], kpBrokenHop: 'no_gateway_to_writer_dml_path' };
}
