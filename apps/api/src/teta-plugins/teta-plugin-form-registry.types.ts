import type {
  DotnetClassVerificationStatus,
  DotnetMatchedType,
  DotnetResourceInfo,
} from './teta-dotnet-metadata.reader';
import type { ClassVerificationDiagnostics } from './teta-class-verification-diagnostics';
import type { TetaDllMissingReason } from './teta-plugin-dll-resolver';

export type TetaPluginDllStatus = 'resolved' | 'missing' | 'conflicting';
/** @deprecated use classVerificationStatus */
export type TetaPluginClassStatus = 'found' | 'missing' | 'unverified';
export type TetaPluginHelpStatus = 'found' | 'missing' | 'unavailable';
/** @deprecated use registryStatus + classVerificationStatus + helpStatus */
export type TetaPluginRegistryConfidence = 'confirmed' | 'partial' | 'inferred';

export type TetaRegistryStatus = 'confirmed' | 'absent';
export type TetaClassDeclarationStatus = 'confirmed_by_registry' | 'missing_in_registry';

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

  /** PA_WTYCZKI is canonical — always confirmed when row exists. */
  registryStatus: TetaRegistryStatus;
  dllStatus: TetaPluginDllStatus;
  dllMissingReason?: TetaDllMissingReason | null;
  /** Class is declared by PA_WTYCZKI regardless of DLL verification. */
  classDeclarationStatus: TetaClassDeclarationStatus;
  classVerificationStatus: DotnetClassVerificationStatus;
  classVerificationDiagnostics?: ClassVerificationDiagnostics | null;
  helpStatus: TetaPluginHelpStatus;

  matchedType?: DotnetMatchedType | null;
  dllResources?: DotnetResourceInfo[] | null;
  dllTypeCount?: number | null;
  dllXmlDocPath?: string | null;

  /** @deprecated legacy aggregate — do not use for acceptance */
  classStatus: TetaPluginClassStatus;
  /** @deprecated legacy aggregate — prefer registryStatus */
  confidence: TetaPluginRegistryConfidence;
  evidence: string[];
  formIdentity: string | null;
  isStandardUuid: boolean;
};
