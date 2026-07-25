/**
 * Stage 3D — semantic bindings + language loaders.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  STAGE3D_BINDINGS_VERSION,
  STAGE3D_IDENTITY_VERSION,
  STAGE3D_LANGUAGE_VERSION,
  type BusinessLanguageFile,
  type SemanticBindingsFile,
  type SubjectSemanticBindings,
} from './teta-business-semantics.types';

export function defaultBindingsPath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-business-semantic-bindings-v1.json');
}

export function defaultLanguagePath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-business-language-pl-v1.json');
}

export function loadSemanticBindings(filePath: string): SemanticBindingsFile {
  if (!existsSync(filePath)) {
    throw new Error(`Brak rejestru bindingów Stage 3D: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as SemanticBindingsFile;
  if (raw.version !== STAGE3D_BINDINGS_VERSION) {
    throw new Error(
      `Unexpected bindings version ${raw.version}; expected ${STAGE3D_BINDINGS_VERSION}`,
    );
  }
  if (raw.identityVersion !== STAGE3D_IDENTITY_VERSION) {
    throw new Error(
      `Unexpected bindings identityVersion ${raw.identityVersion}; expected ${STAGE3D_IDENTITY_VERSION}`,
    );
  }
  if (!raw.graphSourceHash) {
    throw new Error('Bindings registry requires graphSourceHash');
  }
  if (!Array.isArray(raw.subjects)) {
    throw new Error('Bindings registry subjects must be an array');
  }
  return raw;
}

export function getSubjectBindings(
  bindings: SemanticBindingsFile,
  subject: string,
): SubjectSemanticBindings | null {
  return bindings.subjects.find((s) => s.subject === subject) ?? null;
}

export function loadBusinessLanguage(filePath: string): BusinessLanguageFile {
  if (!existsSync(filePath)) {
    throw new Error(`Brak pliku języka Stage 3D: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as BusinessLanguageFile;
  if (raw.version !== STAGE3D_LANGUAGE_VERSION) {
    throw new Error(
      `Unexpected language version ${raw.version}; expected ${STAGE3D_LANGUAGE_VERSION}`,
    );
  }
  return raw;
}
