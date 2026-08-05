import {
  fingerprint,
  type Stage3k2b2b2b1SafetyCounters,
  type TetaAllowedMetadataStatement,
} from './teta-view-metadata.types';

const SQL: Record<TetaAllowedMetadataStatement['metadataStatementTemplateId'], string> = {
  exact_object_identity_lookup:
    'SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, STATUS, EDITION_NAME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :object_name AND OBJECT_TYPE = :object_type',
  exact_view_ddl_export:
    'SELECT DBMS_METADATA.GET_DDL(:object_type, :object_name, :owner) AS DDL FROM DUAL',
  exact_fragment_completeness_lookup:
    'SELECT TEXT_LENGTH FROM ALL_VIEWS WHERE OWNER = :owner AND VIEW_NAME = :object_name',
};

const BINDS: Record<TetaAllowedMetadataStatement['metadataStatementTemplateId'], string[]> = {
  exact_object_identity_lookup: ['owner', 'object_name', 'object_type'],
  exact_view_ddl_export: ['object_type', 'object_name', 'owner'],
  exact_fragment_completeness_lookup: ['owner', 'object_name'],
};

export function registeredMetadataStatements(input: {
  candidateId: string;
  allowlistId: string;
  policyVersion: string;
  policyHash: string;
  bindValues: { owner: string; object_name: string; object_type: string };
}): TetaAllowedMetadataStatement[] {
  return (Object.keys(SQL) as Array<keyof typeof SQL>).map((id) => {
    const bindNames = BINDS[id];
    const bindValueFingerprints = bindNames.map((n) =>
      fingerprint({ name: n, value: input.bindValues[n as keyof typeof input.bindValues] }),
    );
    return {
      metadataStatementTemplateId: id,
      metadataStatementTemplateVersion: 'v1',
      metadataStatementTemplateHash: fingerprint({ id, version: 'v1', sql: SQL[id], bindNames }),
      metadataStatementClass: id,
      allowedObjectCount: 1,
      bindNames,
      bindValueFingerprints,
      sqlText: SQL[id],
      targetCandidateId: input.candidateId,
      targetAllowlistId: input.allowlistId,
      policyVersion: input.policyVersion,
      policyHash: input.policyHash,
    };
  });
}

export function assertRegisteredStatement(
  s: TetaAllowedMetadataStatement,
  all: TetaAllowedMetadataStatement[],
  counters: Stage3k2b2b2b1SafetyCounters,
): boolean {
  const ok = all.some(
    (x) =>
      x.metadataStatementTemplateId === s.metadataStatementTemplateId &&
      x.metadataStatementTemplateHash === s.metadataStatementTemplateHash,
  );
  if (!ok) {
    counters.unregisteredMetadataStatementExecuted++;
    counters.metadataStatementTemplateHashMismatch++;
  }
  return ok;
}

export function assertAllowlistBound(
  s: TetaAllowedMetadataStatement,
  candidateId: string,
  allowlistId: string,
  counters: Stage3k2b2b2b1SafetyCounters,
): boolean {
  if (s.targetCandidateId !== candidateId || s.targetAllowlistId !== allowlistId) {
    counters.metadataStatementOutsideCandidateAllowlist++;
    return false;
  }
  return true;
}

export function rejectFreeFormIdentifier(
  usedFreeForm: boolean,
  counters: Stage3k2b2b2b1SafetyCounters,
): void {
  if (usedFreeForm) counters.freeFormIdentifierUsedInMetadataExport++;
}
