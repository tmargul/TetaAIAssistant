export type TetaPluginDllStatus = 'resolved' | 'missing' | 'conflicting';
export type TetaPluginClassStatus = 'found' | 'missing' | 'unverified';
export type TetaPluginHelpStatus = 'found' | 'missing' | 'unavailable';
export type TetaPluginRegistryConfidence = 'confirmed' | 'partial' | 'inferred';

/** Raw row from Oracle PA_WTYCZKI (read-only). */
export type PaWtyczkiRow = {
  id: number | string;
  guid: string | null;
  assembly: string | null;
  className: string | null;
  parameters: string | null;
  pluginName: string | null;
  pluginType: string | null;
  description: string | null;
  webPlugin: string | number | null;
  routePath: string | null;
  apiPath: string | null;
};

/**
 * Canonical form/plugin registry entry:
 * PA_WTYCZKI → GUID → ASSEMBLY → DLL → NAZWA_KLASY → Help/{GUID}.html
 */
export type TetaPluginRegistryEntry = {
  registryId: string;
  guid: string | null;
  assembly: string | null;
  className: string | null;
  simpleClassName: string | null;
  parameters: string | null;
  pluginName: string | null;
  pluginType: string | null;
  description: string | null;
  webPlugin: string | number | null;
  routePath: string | null;
  apiPath: string | null;
  resolvedDllPath: string | null;
  helpPath: string | null;
  helpExists: boolean;
  helpSize: number | null;
  dllStatus: TetaPluginDllStatus;
  classStatus: TetaPluginClassStatus;
  helpStatus: TetaPluginHelpStatus;
  /** confirmed only when PA + DLL + class + help all OK. */
  confidence: TetaPluginRegistryConfidence;
  evidence: string[];
  /** Stable form id: guid:className */
  formIdentity: string | null;
  isStandardUuid: boolean;
};
