/**
 * Stage 3D — ontology loader.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  STAGE3D_IDENTITY_VERSION,
  STAGE3D_ONTOLOGY_VERSION,
  type BusinessOntologyFile,
  type BusinessOntologySubject,
} from './teta-business-semantics.types';

export function defaultOntologyPath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-business-ontology-v1.json');
}

export function loadBusinessOntology(filePath: string): BusinessOntologyFile {
  if (!existsSync(filePath)) {
    throw new Error(`Brak ontologii Stage 3D: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as BusinessOntologyFile;
  if (raw.version !== STAGE3D_ONTOLOGY_VERSION) {
    throw new Error(
      `Unexpected ontology version ${raw.version}; expected ${STAGE3D_ONTOLOGY_VERSION}`,
    );
  }
  if (raw.identityVersion !== STAGE3D_IDENTITY_VERSION) {
    throw new Error(
      `Unexpected ontology identityVersion ${raw.identityVersion}; expected ${STAGE3D_IDENTITY_VERSION}`,
    );
  }
  if (!Array.isArray(raw.subjects) || !raw.subjects.length) {
    throw new Error('Ontology must declare at least one subject');
  }
  return raw;
}

export function getOntologySubject(
  ontology: BusinessOntologyFile,
  subject: string,
): BusinessOntologySubject | null {
  return ontology.subjects.find((s) => s.subject === subject) ?? null;
}
