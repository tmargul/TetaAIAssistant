/**
 * Stage 3C — projection/ordering planner (ordering must point at oracleColumnNodeId).
 */
import type { OrderingResolution } from './teta-report-template.types';
import type { QueryColumnRef, QueryOrdering } from './teta-query-plan.types';

export function planOrdering(input: {
  orderingSpecs: OrderingResolution[];
  orderingOrder: string[];
  projections: QueryColumnRef[];
}): QueryOrdering[] {
  const out: QueryOrdering[] = [];
  for (const role of input.orderingOrder) {
    const spec = input.orderingSpecs.find((o) => o.orderRole === role);
    const proj = input.projections.find((p) => p.businessRole === spec?.businessRole);
    if (!spec) {
      out.push({
        orderRole: role,
        status: 'missing',
        oracleColumnNodeId: null,
        direction: 'ascending',
        businessRole: 'unknown',
      });
      continue;
    }
    const resolved =
      proj?.status === 'resolved' && proj.oracleColumnNodeId
        ? proj.oracleColumnNodeId
        : null;
    out.push({
      orderRole: role,
      status: resolved ? 'resolved' : 'missing',
      oracleColumnNodeId: resolved,
      direction: spec.direction,
      businessRole: spec.businessRole,
    });
  }
  return out;
}
