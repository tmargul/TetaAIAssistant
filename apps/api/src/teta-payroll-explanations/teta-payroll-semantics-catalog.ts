/**
 * Stage 3J — verified payroll semantics catalog loader.
 */
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import {
  STAGE3J_SEMANTICS_CATALOG_VERSION,
  type PayrollEvidenceProvenance,
} from './teta-payroll-explanation.types';

export type SemanticsCatalogEntry = {
  status: 'verified' | 'unknown';
  meaning?: string;
  display?: string;
  source?: {
    type: string;
    documentId: string;
    sectionId: string;
  };
};

export type PayrollSemanticsCatalog = {
  catalogVersion: string;
  catalogSha256: string;
  componentTypes: Map<string, SemanticsCatalogEntry>;
  correctionModes: Map<string, SemanticsCatalogEntry>;
  formulaFunctions: Map<string, SemanticsCatalogEntry & { argumentRoles?: string[] }>;
};

let cachedCatalog: PayrollSemanticsCatalog | null = null;

function resolveApiRoot(apiRoot?: string): string {
  if (apiRoot) return apiRoot;
  if (existsSync(path.join(process.cwd(), 'config', 'teta-payroll-component-semantics-v1.json'))) {
    return process.cwd();
  }
  return path.join(process.cwd(), 'apps', 'api');
}

export function resetSemanticsCatalogCache(): void {
  cachedCatalog = null;
}

export function loadPayrollSemanticsCatalog(apiRoot?: string): PayrollSemanticsCatalog {
  if (cachedCatalog) return cachedCatalog;
  const root = resolveApiRoot(apiRoot);
  const filePath = path.join(root, 'config', 'teta-payroll-component-semantics-v1.json');
  const rawText = readFileSync(filePath, 'utf8');
  const raw = JSON.parse(rawText) as {
    catalogVersion: string;
    componentTypes: Array<{ typeCode: string; status: string; meaning: string; source: unknown }>;
    correctionModes: Array<{ modeCode: string; status: string; meaning: string; source: unknown }>;
    formulaFunctions: Array<{
      functionId: string;
      status: string;
      meaning: string;
      argumentRoles?: string[];
      source: unknown;
    }>;
  };
  if (raw.catalogVersion !== STAGE3J_SEMANTICS_CATALOG_VERSION) {
    throw new Error(`Unexpected semantics catalog version ${raw.catalogVersion}`);
  }
  const catalogSha256 = createHash('sha256').update(rawText, 'utf8').digest('hex');
  const componentTypes = new Map<string, SemanticsCatalogEntry>();
  for (const t of raw.componentTypes) {
    componentTypes.set(t.typeCode, {
      status: t.status as 'verified',
      meaning: t.meaning,
      source: t.source as SemanticsCatalogEntry['source'],
    });
  }
  const correctionModes = new Map<string, SemanticsCatalogEntry>();
  for (const m of raw.correctionModes) {
    correctionModes.set(m.modeCode, {
      status: m.status as 'verified',
      meaning: m.meaning,
      source: m.source as SemanticsCatalogEntry['source'],
    });
  }
  const formulaFunctions = new Map<
    string,
    SemanticsCatalogEntry & { argumentRoles?: string[] }
  >();
  for (const f of raw.formulaFunctions) {
    formulaFunctions.set(f.functionId.toLowerCase(), {
      status: f.status as 'verified',
      meaning: f.meaning,
      argumentRoles: f.argumentRoles,
      source: f.source as SemanticsCatalogEntry['source'],
    });
  }
  cachedCatalog = {
    catalogVersion: raw.catalogVersion,
    catalogSha256,
    componentTypes,
    correctionModes,
    formulaFunctions,
  };
  return cachedCatalog;
}

export function lookupComponentTypeMeaning(
  catalog: PayrollSemanticsCatalog,
  typeCode: string | null,
): { meaning: string | null; provenance: PayrollEvidenceProvenance; unknown: boolean } {
  if (!typeCode) {
    return { meaning: null, provenance: 'unknown', unknown: false };
  }
  const entry = catalog.componentTypes.get(typeCode);
  if (!entry) {
    return {
      meaning: `Raport zawiera typ ${typeCode}, ale katalog semantyki nie posiada zweryfikowanego opisu.`,
      provenance: 'unknown',
      unknown: true,
    };
  }
  return { meaning: entry.meaning ?? null, provenance: 'training_semantics_verified', unknown: false };
}

export function lookupCorrectionModeMeaning(
  catalog: PayrollSemanticsCatalog,
  mode: string | null,
): { meaning: string | null; provenance: PayrollEvidenceProvenance; unknown: boolean } {
  if (!mode) {
    return { meaning: null, provenance: 'unknown', unknown: false };
  }
  const entry = catalog.correctionModes.get(mode);
  if (!entry) {
    return {
      meaning: `Raport zawiera tryb korekty ${mode}, ale katalog semantyki nie posiada zweryfikowanego opisu.`,
      provenance: 'unknown',
      unknown: true,
    };
  }
  return { meaning: entry.meaning ?? null, provenance: 'training_semantics_verified', unknown: false };
}

export function lookupFunctionMeaning(
  catalog: PayrollSemanticsCatalog,
  functionId: string,
): { meaning: string | null; provenance: PayrollEvidenceProvenance; unknown: boolean } {
  const entry = catalog.formulaFunctions.get(functionId.toLowerCase());
  if (!entry) {
    return {
      meaning: `Wzór wywołuje funkcję ${functionId}, której znaczenie nie zostało jeszcze potwierdzone w katalogu semantyki.`,
      provenance: 'unknown',
      unknown: true,
    };
  }
  return { meaning: entry.meaning ?? null, provenance: 'training_semantics_verified', unknown: false };
}

export function lookupRelationTypeMeaning(relationType: string): string | null {
  const map: Record<string, string> = {
    current_list_value: 'wartość wcześniej obliczonego składnika z bieżącej listy',
    historical_value: 'wartość historyczna składnika z poprzednich list',
    sql_runtime_value: 'wartość pochodząca z formuły SQL',
    indirect_formula_reference: 'pośrednie odwołanie we wzorze',
    unknown_reference: 'odwołanie o nieznanym typie',
  };
  return map[relationType] ?? null;
}
