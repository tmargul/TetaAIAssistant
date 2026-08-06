import { resolveEditionEvidenceDecision } from './teta-view-metadata-real-pilot';

describe('Stage 3K.2B2B2B2 edition patch decision tree', () => {
  it('EDITIONABLE+owner disabled is confirmed noneditioned', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'disabled',
      allEditionsVisibilityStatus: 'complete_dba_visibility',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.objectVersioningStatus).toBe('noneditioned');
    expect(result.applicationEditionEvidenceStatus).toBe('confirmed_not_editioned');
    expect(result.editionResolutionStatus).toBe('not_editioned');
  });

  it('owner enabled with one named edition requires application edition evidence', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'enabled',
      allEditionsVisibilityStatus: 'complete_dba_visibility',
      namedEditionRowCount: 1,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.objectVersioningStatus).toBe('editioned');
    expect(result.editionResolutionStatus).toBe('edition_missing');
  });

  it('owner enabled with multiple definitions is editioned', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'enabled',
      allEditionsVisibilityStatus: 'complete_dba_visibility',
      namedEditionRowCount: 2,
      multipleActualDefinitionsDetected: true,
    });
    expect(result.objectVersioningStatus).toBe('editioned');
    expect(result.objectEditionFieldInterpretation).toBe('actualized_in_named_edition');
  });

  it('owner capability unavailable blocks with insufficient metadata', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'unavailable',
      allEditionsVisibilityStatus: 'complete_dba_visibility',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.editionResolutionStatus).toBe('ambiguous');
    expect(result.objectEditionFieldInterpretation).toBe('insufficient_metadata');
  });

  it('insufficient all-editions visibility blocks closed', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'enabled',
      allEditionsVisibilityStatus: 'insufficient_visibility',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.editionResolutionStatus).toBe('ambiguous');
  });

  it('conflicting owner metadata is conflicting', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'conflicting',
      allEditionsVisibilityStatus: 'conflicting',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.applicationEditionEvidenceStatus).toBe('conflicting');
  });

  it('dual flags without edition evidence stays blocked_edition_evidence', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'enabled',
      allEditionsVisibilityStatus: 'accessible_object_visibility',
      namedEditionRowCount: 1,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.editionResolutionStatus).toBe('edition_missing');
  });

  it('ordinary ALL_OBJECTS cannot be interpreted as all-editions proof', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'enabled',
      allEditionsVisibilityStatus: 'insufficient_visibility',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.objectVersioningStatus).toBe('unknown');
  });

  it('null edition without owner check remains ambiguous', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'unavailable',
      allEditionsVisibilityStatus: 'unavailable',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.editionResolutionStatus).toBe('ambiguous');
  });

  it('enabled owner with no named editions can still be noneditioned visible object', () => {
    const result = resolveEditionEvidenceDecision({
      ownerEditionsEnabledStatus: 'enabled',
      allEditionsVisibilityStatus: 'accessible_object_visibility',
      namedEditionRowCount: 0,
      multipleActualDefinitionsDetected: false,
    });
    expect(result.editionResolutionStatus).toBe('not_editioned');
    expect(result.applicationEditionEvidenceStatus).toBe('confirmed_not_editioned');
  });
});
