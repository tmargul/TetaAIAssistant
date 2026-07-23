/**
 * Stage 2E — stable canonical IDs (deterministic, no array index / random UUID).
 */
import { createHash } from 'crypto';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';

export function normalizeGuid(guid?: string | null): string {
  return (guid ?? '').replace(/[{}]/g, '').trim().toLowerCase();
}

export function normalizeOracleName(name?: string | null): string {
  return (name ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeAlias(alias?: string | null): string {
  return (alias ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function collapseWs(s?: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function shortHash(input: string, len = 12): string {
  return createHash('sha1').update(input).digest('hex').slice(0, len);
}

export function mapCanonicalConfidence(source?: string | null): string {
  const s = (source ?? '').toLowerCase();
  if (!s || s === 'unresolved' || s === 'not_checked' || s === 'missing') return 'unresolved';
  if (s.includes('conflict')) return 'conflicting';
  if (s.startsWith('confirmed') || s === 'verified' || s.includes('confirmed_from')) return 'confirmed';
  if (s.includes('probable') || s.includes('matched')) return 'probable';
  if (s.includes('candidate') || s.includes('framework')) return 'candidate';
  return 'probable';
}

export const Stage2eIds = {
  identityVersion: STAGE2E_IDENTITY_VERSION,

  plugin(guid: string): string {
    return `plugin:${normalizeGuid(guid)}`;
  },

  assembly(name: string): string {
    return `assembly:${collapseWs(name)}`;
  },

  dotnetType(fullName: string): string {
    return `dotnet-type:${collapseWs(fullName)}`;
  },

  form(guid: string, fullTypeName: string): string {
    return `form:${normalizeGuid(guid)}:${collapseWs(fullTypeName)}`;
  },

  helpDocument(guid: string, fullTypeName: string): string {
    return `help-doc:${normalizeGuid(guid)}:${collapseWs(fullTypeName)}`;
  },

  helpSection(guid: string, fullTypeName: string, section: string): string {
    return `help-section:${normalizeGuid(guid)}:${collapseWs(fullTypeName)}:${collapseWs(section)}`;
  },

  helpField(
    guid: string,
    fullTypeName: string,
    section: string,
    order: number | string,
    normalizedLabel: string,
  ): string {
    return `help-field:${normalizeGuid(guid)}:${collapseWs(fullTypeName)}:${collapseWs(section)}:${order}:${collapseWs(normalizedLabel).toLowerCase()}`;
  },

  control(guid: string, fullTypeName: string, controlName: string): string {
    return `control:${normalizeGuid(guid)}:${collapseWs(fullTypeName)}:${collapseWs(controlName)}`;
  },

  actionControl(guid: string, fullTypeName: string, controlName: string): string {
    return `action:${normalizeGuid(guid)}:${collapseWs(fullTypeName)}:${collapseWs(controlName)}`;
  },

  targetBinding(
    formType: string,
    control: string,
    datasetTable: string,
    dataMember: string,
  ): string {
    return `binding-target:${collapseWs(formType)}:${collapseWs(control)}:${collapseWs(datasetTable)}:${collapseWs(dataMember)}`;
  },

  lookupBinding(
    formType: string,
    control: string,
    datasetTable: string,
    valueMember: string,
    displayMember: string,
  ): string {
    return `binding-lookup:${collapseWs(formType)}:${collapseWs(control)}:${collapseWs(datasetTable)}:${collapseWs(valueMember)}:${collapseWs(displayMember)}`;
  },

  dataSource(formType: string, name: string): string {
    return `datasource:${collapseWs(formType)}:${collapseWs(name)}`;
  },

  businessObject(fullType: string): string {
    return `bo:${collapseWs(fullType)}`;
  },

  dataFactory(fullType: string): string {
    return `df:${collapseWs(fullType)}`;
  },

  gateway(assembly: string, fullTypeName: string): string {
    return `gateway:${collapseWs(assembly || 'unknown')}:${collapseWs(fullTypeName)}`;
  },

  dataset(assembly: string, fullTypeName: string, datasetTable: string | null): string {
    const ds = datasetTable && datasetTable.trim() ? collapseWs(datasetTable) : 'unresolved';
    return `dataset:${collapseWs(assembly || 'unknown')}:${collapseWs(fullTypeName)}:${ds}`;
  },

  mainSource(declaringType: string, objectName: string, alias: string): string {
    return `main-source:${collapseWs(declaringType)}:${normalizeOracleName(objectName)}:${normalizeAlias(alias)}`;
  },

  join(
    declaringType: string,
    normalizedAlias: string,
    joinedObject: string,
    conditionHash: string,
  ): string {
    return `join:${collapseWs(declaringType)}:${normalizeAlias(normalizedAlias)}:${normalizeOracleName(joinedObject)}:${conditionHash}`;
  },

  projectedColumn(
    declaringType: string,
    expression: string,
    datasetColumn: string | null,
  ): string {
    return `projected:${collapseWs(declaringType)}:${collapseWs(expression)}:${collapseWs(datasetColumn || 'unnamed')}`;
  },

  calculatedColumn(declaringType: string, expression: string): string {
    return `calculated:${collapseWs(declaringType)}:${shortHash(collapseWs(expression))}`;
  },

  oracleObject(owner: string, objectType: string, objectName: string): string {
    return `oracle-object:${normalizeOracleName(owner || 'UNKNOWN')}:${normalizeOracleName(objectType)}:${normalizeOracleName(objectName)}`;
  },

  oracleColumn(owner: string, objectName: string, columnName: string): string {
    return `oracle-column:${normalizeOracleName(owner || 'UNKNOWN')}:${normalizeOracleName(objectName)}:${normalizeOracleName(columnName)}`;
  },

  oraclePackage(owner: string, packageName: string): string {
    return `oracle-package:${normalizeOracleName(owner || 'UNKNOWN')}:${normalizeOracleName(packageName)}`;
  },

  oracleProcedure(owner: string, packageName: string, procedureName: string, overload = '0'): string {
    return `oracle-procedure:${normalizeOracleName(owner || 'UNKNOWN')}:${normalizeOracleName(packageName)}:${normalizeOracleName(procedureName)}:${overload}`;
  },

  oracleFunction(owner: string, packageName: string, functionName: string, overload = '0'): string {
    return `oracle-function:${normalizeOracleName(owner || 'UNKNOWN')}:${normalizeOracleName(packageName)}:${normalizeOracleName(functionName)}:${overload}`;
  },

  oracleArgument(
    owner: string,
    packageName: string,
    subprogram: string,
    position: number | string,
    argumentName: string,
  ): string {
    return `oracle-argument:${normalizeOracleName(owner || 'UNKNOWN')}:${normalizeOracleName(packageName)}:${normalizeOracleName(subprogram)}:${position}:${normalizeOracleName(argumentName || 'RETURN')}`;
  },

  oracleDependency(
    owner: string,
    name: string,
    type: string,
    refOwner: string,
    refName: string,
    refType: string,
  ): string {
    return `oracle-dep:${normalizeOracleName(owner)}:${normalizeOracleName(name)}:${normalizeOracleName(type)}:${normalizeOracleName(refOwner)}:${normalizeOracleName(refName)}:${normalizeOracleName(refType)}`;
  },

  edge(
    type: string,
    from: string,
    to: string,
    extra = '',
  ): string {
    return `edge:${type}:${from}:${to}${extra ? `:${shortHash(extra)}` : ''}`;
  },

  conditionHash(raw?: string | null, condition?: Record<string, unknown> | null): string {
    if (condition?.leftColumn) {
      const parts = [
        normalizeAlias(String(condition.leftAlias ?? '')),
        normalizeOracleName(String(condition.leftColumn ?? '')),
        String(condition.operator ?? '='),
        normalizeAlias(String(condition.rightAlias ?? '')),
        normalizeOracleName(String(condition.rightColumn ?? '')),
      ];
      return shortHash(parts.join('|'));
    }
    if (raw) return shortHash(collapseWs(raw).toUpperCase());
    return shortHash('null');
  },
};
