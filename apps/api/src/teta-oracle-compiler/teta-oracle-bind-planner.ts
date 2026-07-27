/**
 * Stage 3E — bind variable planning.
 *
 * Any value that originates from the user is passed as a bind (`:P001`, `:P002`, …) and never
 * inlined into the statement text. The reference BHP report is fully derived from the graph plus
 * `SYSDATE`, so its bind list is empty.
 */
import { STAGE3E_BIND_PREFIX, type CompiledBind } from './teta-oracle-compiler.types';

export type UserLiteralRequest = {
  filterRole: string;
  oracleType: 'string' | 'number' | 'date';
};

export type ReportPeriodBindRequest = {
  filterRole: string;
  oracleType: 'string' | 'number';
  semanticType: 'positive_integer_days' | 'local_date';
  sourceParameterId: 'report_period_days' | 'report_period_start_date' | 'report_period_end_date';
};

export type BindPlan = {
  binds: CompiledBind[];
  allocate(request: UserLiteralRequest): CompiledBind;
  allocatePeriod(request: ReportPeriodBindRequest): CompiledBind;
  names(): string[];
};

export function bindPlaceholderFor(ordinal: number): string {
  return `:${STAGE3E_BIND_PREFIX}${String(ordinal).padStart(3, '0')}`;
}

export function createBindPlan(): BindPlan {
  const binds: CompiledBind[] = [];
  return {
    binds,
    allocate(request) {
      const ordinal = binds.length + 1;
      const placeholder = bindPlaceholderFor(ordinal);
      const bind: CompiledBind = {
        ordinal,
        name: placeholder.slice(1),
        placeholder,
        filterRole: request.filterRole,
        valueKind: 'user_literal',
        oracleType: request.oracleType,
        semanticType: 'user_literal',
        sourceParameterId: null,
      };
      binds.push(bind);
      return bind;
    },
    allocatePeriod(request) {
      const ordinal = binds.length + 1;
      const placeholder = bindPlaceholderFor(ordinal);
      const bind: CompiledBind = {
        ordinal,
        name: placeholder.slice(1),
        placeholder,
        filterRole: request.filterRole,
        valueKind: 'report_period_parameter',
        oracleType: request.oracleType,
        semanticType: request.semanticType,
        sourceParameterId: request.sourceParameterId,
      };
      binds.push(bind);
      return bind;
    },
    names: () => binds.map((b) => b.placeholder),
  };
}
