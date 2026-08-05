import fs from 'fs';
import path from 'path';
import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import {
  assessDefinitionCompleteness,
  parseOracleViewDefinition,
} from './teta-enrichment-view-parser';
import {
  STAGE3K2B2B2A_PARSER_VERSION,
  sha256,
  type Stage3k2b2b2aSafetyCounters,
  type TetaCandidateScopedEnrichmentAllowlist,
  type TetaViewDefinitionEvidenceArtifact,
} from './teta-enrichment.types';

export interface TetaViewDefinitionImportManifest {
  manifestVersion: string;
  targetCandidateId: string;
  targetViewRef: string;
  expectedOwner: string;
  expectedObjectType: string;
  sourceKind: TetaViewDefinitionEvidenceArtifact['definitionSourceKind'];
  contentFile: string;
  declaredFingerprint: string;
  acquisitionMode: string;
  containsClientRows: false;
  containsPersonalData: false;
  vendorOnly: true;
  synthetic?: boolean;
}

export function defaultViewImportManifestPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    '.local',
    'stage3k2b2b2a',
    'vendor-only',
    'view-definition-import-manifest.json',
  );
}

/** Enforce not_parsed ⇒ not_evaluated / null parser fields. */
export function enforceNotParsedSemantics(
  artifact: TetaViewDefinitionEvidenceArtifact,
  counters: Stage3k2b2b2aSafetyCounters,
): TetaViewDefinitionEvidenceArtifact {
  if (artifact.parseStatus === 'not_parsed') {
    if (Array.isArray(artifact.unsupportedConstructs) && artifact.unsupportedConstructs.length === 0) {
      counters.notParsedDefinitionReportedNoUnsupportedConstructs += 1;
    }
    if (artifact.unsupportedConstructsStatus === 'evaluated') {
      counters.notParsedDefinitionWithEvaluatedParserOutput += 1;
    }
    return {
      ...artifact,
      unsupportedConstructsStatus: 'not_evaluated',
      unsupportedConstructs: null,
      parseWarnings: null,
    };
  }

  if (
    artifact.definitionCompletenessStatus === 'missing' &&
    artifact.parseStatus === 'parsed'
  ) {
    counters.missingDefinitionReportedAsCleanParse += 1;
  }

  if (artifact.parseStatus === 'parsed') {
    return {
      ...artifact,
      unsupportedConstructsStatus: 'evaluated',
      unsupportedConstructs: artifact.unsupportedConstructs ?? [],
      parseWarnings: artifact.parseWarnings ?? [],
    };
  }

  // parse_failed / parsed_with_unsupported_constructs → evaluated arrays
  return {
    ...artifact,
    unsupportedConstructsStatus: 'evaluated',
    unsupportedConstructs: artifact.unsupportedConstructs ?? [],
    parseWarnings: artifact.parseWarnings ?? [],
  };
}

function missingArtifactBase(): TetaViewDefinitionEvidenceArtifact {
  const viewRef = `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`;
  return {
    artifactId: 'viewdef:P1:missing',
    sourceObjectRef: viewRef,
    sourceObjectOwner: REAL_EMPLOYEE_OBJECT_OWNER,
    sourceObjectType: 'VIEW',
    sourceObjectEdition: null,
    definitionSourceKind: null,
    rawContentFingerprint: null,
    canonicalContentFingerprint: null,
    definitionCompletenessStatus: 'missing',
    sourceLength: null,
    expectedLength: null,
    fragmentCount: 0,
    fragmentOrderingVerified: false,
    parseStatus: 'not_parsed',
    parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
    oracleDialectVersion: 'oracle-sql-view-v1',
    unsupportedConstructsStatus: 'not_evaluated',
    unsupportedConstructs: null,
    parseWarnings: null,
    artifactPresentStatus: 'missing',
    artifactImportCapabilityStatus: 'capable',
    artifactValidationStatus: 'missing',
    artifactSemanticEffect: 'none',
    viewDefinitionArtifactStatus: 'requires_vendor_export',
  };
}

export function importViewDefinitionArtifact(input: {
  repoRoot: string;
  allowlist: TetaCandidateScopedEnrichmentAllowlist;
  counters: Stage3k2b2b2aSafetyCounters;
  forRealP1: boolean;
  manifestPath?: string;
}): {
  artifact: TetaViewDefinitionEvidenceArtifact;
  rawContent: string | null;
  synthetic: boolean;
} {
  const viewRef = `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`;
  const missing = missingArtifactBase();

  const manifestPath = input.manifestPath ?? defaultViewImportManifestPath(input.repoRoot);
  if (!fs.existsSync(manifestPath)) {
    return {
      artifact: enforceNotParsedSemantics(missing, input.counters),
      rawContent: null,
      synthetic: false,
    };
  }

  let manifest: TetaViewDefinitionImportManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TetaViewDefinitionImportManifest;
  } catch {
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          artifactImportCapabilityStatus: 'rejected',
          artifactValidationStatus: 'invalid',
          viewDefinitionArtifactStatus: 'rejected',
          parseWarnings: null,
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: false,
    };
  }

  if (manifest.synthetic && input.forRealP1) {
    input.counters.syntheticViewDefinitionUsedForRealP1 += 1;
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          artifactValidationStatus: 'invalid',
          viewDefinitionArtifactStatus: 'synthetic_fixture_only',
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: true,
    };
  }

  if (manifest.targetCandidateId !== 'cand:P1:employee') {
    input.counters.artifactsReadOutsideAllowlist += 1;
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          artifactValidationStatus: 'invalid',
          viewDefinitionArtifactStatus: 'rejected',
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: Boolean(manifest.synthetic),
    };
  }

  if (
    manifest.expectedOwner !== REAL_EMPLOYEE_OBJECT_OWNER ||
    manifest.targetViewRef !== viewRef ||
    manifest.expectedObjectType !== 'VIEW'
  ) {
    input.counters.artifactsReadOutsideAllowlist += 1;
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          artifactValidationStatus: 'invalid',
          viewDefinitionArtifactStatus: 'rejected',
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: Boolean(manifest.synthetic),
    };
  }

  if (!input.allowlist.allowedArtifactKinds.includes('view_definition_import_manifest')) {
    input.counters.artifactsReadOutsideAllowlist += 1;
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          viewDefinitionArtifactStatus: 'rejected',
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: Boolean(manifest.synthetic),
    };
  }

  const contentPath = path.isAbsolute(manifest.contentFile)
    ? manifest.contentFile
    : path.join(path.dirname(manifestPath), manifest.contentFile);

  const norm = contentPath.replace(/\\/g, '/');
  if (norm.includes('/docs/') || norm.includes('\\docs\\')) {
    input.counters.rawViewDefinitionCommittedToRepo += 1;
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          viewDefinitionArtifactStatus: 'rejected',
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: Boolean(manifest.synthetic),
    };
  }

  if (!fs.existsSync(contentPath)) {
    return {
      artifact: enforceNotParsedSemantics(missing, input.counters),
      rawContent: null,
      synthetic: Boolean(manifest.synthetic),
    };
  }

  const raw = fs.readFileSync(contentPath, 'utf8');
  input.counters.viewDefinitionsLocated += 1;
  const rawFp = sha256(raw);
  if (rawFp !== manifest.declaredFingerprint) {
    return {
      artifact: enforceNotParsedSemantics(
        {
          ...missing,
          artifactPresentStatus: 'rejected',
          artifactValidationStatus: 'invalid',
          viewDefinitionArtifactStatus: 'rejected',
          rawContentFingerprint: rawFp,
        },
        input.counters,
      ),
      rawContent: null,
      synthetic: Boolean(manifest.synthetic),
    };
  }

  input.counters.viewDefinitionsImported += 1;
  const completeness = assessDefinitionCompleteness({ content: raw });
  if (
    completeness.fragmentCount > 1 &&
    !completeness.fragmentOrderingVerified &&
    (completeness.definitionCompletenessStatus === 'complete' ||
      completeness.definitionCompletenessStatus === 'fragmented_complete')
  ) {
    input.counters.unorderedDefinitionFragmentsAccepted += 1;
  }
  const parsed = parseOracleViewDefinition(raw);
  if (parsed.parseStatus === 'parsed' || parsed.parseStatus === 'parsed_with_unsupported_constructs') {
    input.counters.viewDefinitionsParsed += 1;
  }
  if (parsed.parseStatus === 'parse_failed') {
    input.counters.viewDefinitionParseFailures += 1;
  }

  const artifact: TetaViewDefinitionEvidenceArtifact = {
    artifactId: `viewdef:P1:${rawFp.slice(0, 12)}`,
    sourceObjectRef: viewRef,
    sourceObjectOwner: REAL_EMPLOYEE_OBJECT_OWNER,
    sourceObjectType: 'VIEW',
    sourceObjectEdition: null,
    definitionSourceKind: manifest.sourceKind,
    rawContentFingerprint: rawFp,
    canonicalContentFingerprint: parsed.canonicalContentFingerprint,
    definitionCompletenessStatus: completeness.definitionCompletenessStatus,
    sourceLength: completeness.sourceLength,
    expectedLength: completeness.expectedLength,
    fragmentCount: completeness.fragmentCount,
    fragmentOrderingVerified: completeness.fragmentOrderingVerified,
    parseStatus: parsed.parseStatus,
    parserVersion: parsed.parserVersion,
    oracleDialectVersion: parsed.oracleDialectVersion,
    unsupportedConstructsStatus:
      parsed.parseStatus === 'not_parsed' ? 'not_evaluated' : 'evaluated',
    unsupportedConstructs:
      parsed.parseStatus === 'not_parsed' ? null : parsed.unsupportedConstructs,
    parseWarnings: parsed.parseStatus === 'not_parsed' ? null : parsed.parseWarnings,
    artifactPresentStatus: 'present',
    artifactImportCapabilityStatus: 'capable',
    artifactValidationStatus: 'validated',
    artifactSemanticEffect: input.forRealP1 && !manifest.synthetic ? 'preview_only' : 'none',
    viewDefinitionArtifactStatus: 'imported',
  };

  return {
    artifact: enforceNotParsedSemantics(artifact, input.counters),
    rawContent: raw,
    synthetic: Boolean(manifest.synthetic),
  };
}
