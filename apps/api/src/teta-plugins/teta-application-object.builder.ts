import { existsSync } from 'fs';
import { normalizeSearchText } from './teta-plugin-grid-column-mapper';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import type {
  TetaApplicationObject,
  TetaFormHelpSnapshot,
} from './teta-application-object.types';
import type { TetaPluginFormMetadata, TetaPluginMetadataBundle } from './teta-plugin-metadata.types';

function formDisplayName(form: TetaPluginFormMetadata, dllName: string): string {
  return form.Plugin.Languages?.[0]?.Name ?? form.Plugin.ClassName ?? dllName;
}

function normalizeLabel(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, ' ').trim();
}

function scoreLabelMatch(queryLabel: string, candidate: string): number {
  const a = normalizeLabel(queryLabel);
  const b = normalizeLabel(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.85;
  const aTokens = a.split(' ').filter((token) => token.length >= 3);
  const bTokens = new Set(b.split(' ').filter((token) => token.length >= 3));
  if (aTokens.length === 0) return 0;
  const overlap = aTokens.filter((token) => bTokens.has(token)).length;
  return overlap / aTokens.length;
}

function findBestMapping(
  fieldLabel: string,
  mappings: TetaPluginColumnMapping[],
  formName: string,
): TetaPluginColumnMapping | null {
  let best: TetaPluginColumnMapping | null = null;
  let bestScore = 0;

  for (const mapping of mappings) {
    if (mapping.formName && normalizeLabel(mapping.formName) !== normalizeLabel(formName)) {
      continue;
    }
    const candidates = [mapping.label, ...(mapping.synonyms ?? []), mapping.gridColumnName].filter(
      (candidate): candidate is string => Boolean(candidate),
    );
    for (const candidate of candidates) {
      const score = scoreLabelMatch(fieldLabel, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = mapping;
      }
    }
  }

  return bestScore >= 0.6 ? best : null;
}

function buildObjectId(
  dllName: string,
  formName: string,
  fieldLabel: string | null,
): string {
  const dll = dllName.replace(/\.dll$/i, '');
  const form = normalizeLabel(formName).replace(/\s+/g, '_');
  const field = fieldLabel ? normalizeLabel(fieldLabel).replace(/\s+/g, '_') : 'form';
  return `${dll}:${form}:${field}`;
}

export function buildApplicationObjectsForForm(input: {
  bundle: TetaPluginMetadataBundle;
  form: TetaPluginFormMetadata;
  help: TetaFormHelpSnapshot | null;
  columnMappings: TetaPluginColumnMapping[];
}): TetaApplicationObject[] {
  const formName = formDisplayName(input.form, input.bundle.dllName);
  const guid = input.form.Plugin.Guid?.replace(/[{}]/g, '').trim() ?? null;
  const objects: TetaApplicationObject[] = [];

  if (input.help) {
    objects.push({
      objectId: buildObjectId(input.bundle.dllName, formName, null),
      dllName: input.bundle.dllName,
      formGuid: guid,
      formName,
      fieldLabel: null,
      helpTitle: input.help.title,
      helpSummary: input.help.summary,
      helpFieldText: null,
      helpSection: null,
      binding: null,
      keywords: [
        formName,
        input.help.title,
        ...input.help.sections,
        input.bundle.dllName.replace(/\.dll$/i, ''),
      ],
      confidence: 'confirmed',
    });

    for (const field of input.help.fields) {
      const mapping = findBestMapping(field.label, input.columnMappings, formName);
      objects.push({
        objectId: buildObjectId(input.bundle.dllName, formName, field.label),
        dllName: input.bundle.dllName,
        formGuid: guid,
        formName,
        fieldLabel: field.label,
        helpTitle: input.help.title,
        helpSummary: input.help.summary,
        helpFieldText: field.description,
        helpSection: field.section ?? null,
        binding: mapping
          ? {
              gridColumnName: mapping.gridColumnName,
              oracleColumnName: mapping.oracleColumnName,
              targetObject: mapping.targetObject,
              gatewayClassName: mapping.gatewayClassName,
            }
          : null,
        keywords: [
          field.label,
          formName,
          input.help.title,
          ...(mapping?.synonyms ?? []),
          mapping?.oracleColumnName ?? '',
        ].filter(Boolean),
        confidence: mapping ? 'confirmed' : 'inferred',
      });
    }
  }

  for (const mapping of input.columnMappings) {
    if (mapping.formName && normalizeLabel(mapping.formName) !== normalizeLabel(formName)) {
      continue;
    }
    const objectId = buildObjectId(input.bundle.dllName, formName, mapping.label);
    if (objects.some((item) => item.objectId === objectId)) {
      continue;
    }
    objects.push({
      objectId,
      dllName: input.bundle.dllName,
      formGuid: guid,
      formName,
      fieldLabel: mapping.label,
      helpTitle: null,
      helpSummary: null,
      helpFieldText: null,
      helpSection: null,
      binding: {
        gridColumnName: mapping.gridColumnName,
        oracleColumnName: mapping.oracleColumnName,
        targetObject: mapping.targetObject,
        gatewayClassName: mapping.gatewayClassName,
      },
      keywords: [mapping.label, ...(mapping.synonyms ?? []), mapping.oracleColumnName],
      confidence: 'inferred',
    });
  }

  return objects;
}

export function buildApplicationObjectsForBundle(
  bundle: TetaPluginMetadataBundle,
  helpByFormGuid: Map<string, TetaFormHelpSnapshot>,
): TetaApplicationObject[] {
  const mappings = bundle.columnMappings ?? [];
  const objects: TetaApplicationObject[] = [];

  for (const form of bundle.forms) {
    const guidKey = form.Plugin.Guid?.replace(/[{}]/g, '').trim().toLowerCase() ?? '';
    const help = guidKey ? helpByFormGuid.get(guidKey) ?? null : null;
    const formMappings = mappings.filter(
      (mapping) =>
        !mapping.formName ||
        normalizeLabel(mapping.formName) === normalizeLabel(formDisplayName(form, bundle.dllName)),
    );
    objects.push(
      ...buildApplicationObjectsForForm({
        bundle,
        form,
        help,
        columnMappings: formMappings,
      }),
    );
  }

  return objects;
}

export function helpDirectoryAvailable(clientDirectory: string): boolean {
  if (!clientDirectory.trim()) return false;
  const helpDir = clientDirectory.trim().replace(/[/\\]+$/, '') + '/Help';
  return existsSync(helpDir);
}
