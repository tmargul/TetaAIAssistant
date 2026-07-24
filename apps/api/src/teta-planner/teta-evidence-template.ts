/**
 * Stage 3B — evidence requirement materialization from templates.
 */
import type { EvidenceTemplateItem } from './teta-intent-catalog';
import type {
  EvidenceItemStatus,
  EvidenceRequirement,
  PlannerEntity,
  PlannerIntentType,
} from './teta-stage3b.types';
import { hasEntity } from './teta-entity-extractor';
import type { PlannerEntityType } from './teta-stage3b.types';

export function buildEvidenceRequirements(
  intent: PlannerIntentType,
  templates: Record<string, EvidenceTemplateItem[]>,
  entities: PlannerEntity[],
): EvidenceRequirement[] {
  const items = templates[intent] ?? [];
  return items.map((item) => {
    let status = item.defaultStatus as EvidenceItemStatus;
    let missingReason = item.missingReason ?? null;
    const warnings: string[] = [];

    if (item.notes === 'structural_dependency_is_not_execution_proof') {
      warnings.push('structural_dependency_is_not_execution_proof');
    }

    if (item.missingWhenNoEntity?.length) {
      const ok = hasEntity(entities, item.missingWhenNoEntity as PlannerEntityType[]);
      if (!ok && status !== 'deferred' && status !== 'unavailable') {
        status = 'missing';
        missingReason = `missing_entities:${item.missingWhenNoEntity.join(',')}`;
      } else if (ok && status === 'missing') {
        status = item.runtimeSourceRequired ? 'deferred' : 'resolved';
        missingReason = item.runtimeSourceRequired ? 'runtime_source_required' : null;
      } else if (ok && item.runtimeSourceRequired) {
        status = 'deferred';
        missingReason = missingReason ?? 'runtime_source_required';
      }
    } else if (item.runtimeSourceRequired && status !== 'unavailable') {
      status = 'deferred';
      missingReason = missingReason ?? 'runtime_source_required';
    }

    return {
      evidenceType: item.evidenceType,
      required: item.required,
      graphQuery: item.graphQuery,
      graphResolution: null,
      runtimeSourceRequired: item.runtimeSourceRequired,
      status,
      missingReason,
      warnings,
      notes: item.notes ?? null,
    };
  });
}
