/**
 * Stage 2E ingest — read Stage 1–2D artifacts into graph (no mutation of sources).
 */
import { createReadStream, existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import * as path from 'path';
import { Stage2eGraphBuilder } from './teta-stage2e.graph';
import { Stage2eIds, normalizeGuid, normalizeAlias, normalizeOracleName } from './teta-stage2e.ids';

const ARTIFACT = {
  stage1: 'docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json',
  stage1Full: '.local/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json',
  stage2a: 'docs/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.json',
  stage2aFull: '.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson',
  stage2b: 'docs/AIA_BOS_ORACLE_MAPPING_STAGE2B.json',
  stage2bFull: '.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson',
  stage2c: 'docs/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.json',
  stage2cFull: '.local/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.full.ndjson',
  stage2d: 'docs/AIA_SQLJOIN_STAGE2D.json',
  stage2dFull: '.local/AIA_SQLJOIN_STAGE2D.full.ndjson',
} as const;

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

async function forEachNdjson(
  filePath: string,
  onRow: (row: Record<string, unknown>) => void | Promise<void>,
  limitLines?: number | null,
): Promise<number> {
  if (!existsSync(filePath)) return 0;
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }) });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    n += 1;
    if (limitLines != null && n > limitLines) break;
    try {
      await onRow(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* skip bad line */
    }
  }
  return n;
}

function assemblyFromType(fullName: string): string {
  const parts = fullName.split('.');
  // Teta.Sumo.Personel.bosListaPlac.BO.X → bosListaPlac-ish: take up to bos*
  const bosIdx = parts.findIndex((p) => /^bos/i.test(p));
  if (bosIdx >= 0) return parts.slice(0, bosIdx + 1).join('.');
  return parts.slice(0, Math.min(4, parts.length)).join('.');
}

export type Stage2eIngestResult = {
  g: Stage2eGraphBuilder;
  /** formType → guid */
  formGuids: Map<string, string>;
  /** oracle object names collected for enrichment */
  oracleObjectNames: Set<string>;
  packageNames: Set<string>;
};

export async function ingestStageArtifacts(
  repoRoot: string,
  options: { limit?: number | null } = {},
): Promise<Stage2eIngestResult> {
  const g = new Stage2eGraphBuilder();
  const formGuids = new Map<string, string>();
  const oracleObjectNames = new Set<string>();
  const packageNames = new Set<string>();
  const limit = options.limit ?? null;

  // --- Stage 1 registry ---
  const stage1Full = path.join(repoRoot, ARTIFACT.stage1Full);
  if (existsSync(stage1Full)) {
    const raw = JSON.parse(readFileSync(stage1Full, 'utf8')) as {
      entries?: Array<Record<string, unknown>>;
    };
    let count = 0;
    for (const e of raw.entries ?? []) {
      if (limit != null && count >= limit) break;
      const guid = normalizeGuid(str(e.guid));
      const className = str(e.className) || str((e.matchedType as { fullName?: string })?.fullName);
      if (!guid) continue;
      count += 1;
      g.coverage.stage1 += 1;
      const fullType =
        str((e.matchedType as { fullName?: string } | undefined)?.fullName) ||
        str(e.className) ||
        'Unknown';
      if (fullType && fullType !== 'Unknown') formGuids.set(fullType, guid);

      const pluginId = Stage2eIds.plugin(guid);
      g.upsertNode({
        id: pluginId,
        type: 'plugin_registry_entry',
        name: str(e.pluginName) || str(e.className) || guid,
        canonicalName: guid,
        sourceStage: '1',
        sourceConfidence: str(e.classResolutionStatus) || 'confirmed',
        provenance: {
          sourceStage: '1',
          sourceArtifact: ARTIFACT.stage1Full,
          sourceRecordId: guid,
        },
        attributes: {
          registryId: e.registryId ?? e.id ?? null,
          assembly: e.assembly ?? null,
          className: e.className ?? null,
          helpPath: e.helpPath ?? null,
          resolvedDllPath: e.resolvedDllPath ?? null,
        },
        evidence: [{ kind: 'registry', name: str(e.className), sourceArtifact: ARTIFACT.stage1Full }],
      });

      const formId = Stage2eIds.form(guid, fullType);
      g.upsertNode({
        id: formId,
        type: 'application_form',
        name: fullType.split('.').pop() || fullType,
        canonicalName: fullType,
        sourceStage: '1',
        sourceConfidence: 'confirmed',
        attributes: { guid, formType: fullType, assembly: e.assembly ?? null },
        provenance: {
          sourceStage: '1',
          sourceArtifact: ARTIFACT.stage1Full,
          sourceRecordId: guid,
        },
      });
      g.addEdge({
        type: 'REGISTERED_AS',
        from: pluginId,
        to: formId,
        sourceStage: '1',
        sourceConfidence: 'confirmed',
      });
      if (e.assembly) {
        const asmId = Stage2eIds.assembly(str(e.assembly));
        g.upsertNode({
          id: asmId,
          type: 'assembly',
          name: str(e.assembly),
          sourceStage: '1',
          sourceConfidence: 'confirmed',
        });
        g.addEdge({
          type: 'IMPLEMENTED_BY',
          from: formId,
          to: asmId,
          sourceStage: '1',
          sourceConfidence: 'confirmed',
        });
      }
    }
  }

  // --- Stage 2A forms ---
  const stage2aPath = path.join(repoRoot, ARTIFACT.stage2aFull);
  let formsSeen = 0;
  await forEachNdjson(stage2aPath, (row) => {
    const formType = str(row.formType);
    const guid = normalizeGuid(str(row.guid)) || formGuids.get(formType) || '';
    if (!formType) return;
    if (limit != null && formsSeen >= limit) return;
    formsSeen += 1;
    g.coverage.stage2a += 1;
    if (guid) formGuids.set(formType, guid);

    const formId = Stage2eIds.form(guid || 'unknown', formType);
    g.upsertNode({
      id: formId,
      type: 'application_form',
      name: formType.split('.').pop() || formType,
      canonicalName: formType,
      sourceStage: '2A',
      sourceConfidence: 'confirmed_from_il',
      attributes: {
        guid: guid || null,
        formType,
        registryId: row.registryId ?? null,
        assembly: row.assembly ?? null,
      },
      provenance: {
        sourceStage: '2A',
        sourceArtifact: ARTIFACT.stage2aFull,
        sourceRecordId: formType,
      },
    });

    for (const ctrl of [
      ...((row.uiControls as Array<Record<string, unknown>>) ?? []),
      ...((row.controls as Array<Record<string, unknown>>) ?? []),
    ]) {
      const controlName = str(ctrl.fieldName);
      if (!controlName) continue;
      const isAction =
        /button|toolbar|tbb|menu|action/i.test(str(ctrl.controlKind) + str(ctrl.fieldType)) ||
        /^tbb/i.test(controlName);
      const ctrlId = isAction
        ? Stage2eIds.actionControl(guid || 'unknown', formType, controlName)
        : Stage2eIds.control(guid || 'unknown', formType, controlName);
      g.upsertNode({
        id: ctrlId,
        type: isAction ? 'action_control' : 'ui_control',
        name: controlName,
        canonicalName: controlName,
        sourceStage: '2A',
        sourceConfidence: str(ctrl.confidence) || 'confirmed_from_il',
        attributes: {
          fieldType: ctrl.fieldType ?? null,
          controlKind: ctrl.controlKind ?? null,
          formType,
          guid: guid || null,
        },
        evidence: (ctrl.evidence as unknown[])?.map((x) => ({
          kind: 'il',
          assignment: typeof x === 'string' ? x : JSON.stringify(x),
        })),
      });
      g.addEdge({
        type: 'HAS_CONTROL',
        from: formId,
        to: ctrlId,
        sourceStage: '2A',
        sourceConfidence: 'confirmed_from_il',
      });
    }

    for (const b of (row.bindings as Array<Record<string, unknown>>) ?? []) {
      const control = str(b.control);
      if (!control) continue;
      const datasetTable = str(b.datasetTable);
      const dataMember = str(b.dataMember);
      const valueMember = str(b.valueMember);
      const displayMember = str(b.displayMember);
      const parameterName = str(b.parameterName);
      const ctrlId = Stage2eIds.control(guid || 'unknown', formType, control);
      // ensure control node exists even if only in bindings
      g.upsertNode({
        id: ctrlId,
        type: parameterName && !dataMember ? 'action_control' : 'ui_control',
        name: control,
        sourceStage: '2A',
        sourceConfidence: str(b.confidence) || 'confirmed_from_il',
        attributes: { formType, parameterName: parameterName || null },
      });
      g.addEdge({
        type: 'HAS_CONTROL',
        from: formId,
        to: ctrlId,
        sourceStage: '2A',
        sourceConfidence: 'confirmed_from_il',
      });

      if (datasetTable && dataMember) {
        const tbId = Stage2eIds.targetBinding(formType, control, datasetTable, dataMember);
        g.upsertNode({
          id: tbId,
          type: 'target_binding',
          name: `${datasetTable}.${dataMember}`,
          canonicalName: `${datasetTable}.${dataMember}`,
          sourceStage: '2A',
          sourceConfidence: str(b.confidence) || 'confirmed_from_il',
          attributes: {
            formType,
            control,
            datasetTable,
            dataMember,
            format: b.format ?? null,
            parameterName: parameterName || null,
          },
          evidence: ((b.evidence as Array<Record<string, unknown>>) ?? []).map((e) => ({
            kind: 'il',
            method: str(e.method),
            offset: str(e.offset),
            assignment: str(e.assignment),
          })),
          provenance: {
            sourceStage: '2A',
            sourceArtifact: ARTIFACT.stage2aFull,
            sourceRecordId: `${formType}:${control}`,
          },
        });
        g.addEdge({
          type: 'BINDS_TARGET',
          from: ctrlId,
          to: tbId,
          sourceStage: '2A',
          sourceConfidence: str(b.confidence) || 'confirmed_from_il',
        });
      }

      if (datasetTable && (valueMember || displayMember)) {
        const lbId = Stage2eIds.lookupBinding(
          formType,
          control,
          datasetTable,
          valueMember || 'ID',
          displayMember || 'NAZWA',
        );
        g.upsertNode({
          id: lbId,
          type: 'lookup_binding',
          name: `${datasetTable}.${valueMember}/${displayMember}`,
          canonicalName: `${datasetTable}.${valueMember}`,
          sourceStage: '2A',
          sourceConfidence: str(b.confidence) || 'confirmed_from_il',
          attributes: {
            formType,
            control,
            datasetTable,
            valueMember,
            displayMember,
          },
        });
        g.addEdge({
          type: 'BINDS_LOOKUP',
          from: ctrlId,
          to: lbId,
          sourceStage: '2A',
          sourceConfidence: str(b.confidence) || 'confirmed_from_il',
        });
      }

      if (parameterName && !dataMember) {
        g.upsertNode({
          id: ctrlId,
          type: 'action_control',
          name: control,
          sourceStage: '2A',
          sourceConfidence: str(b.confidence) || 'confirmed_from_il',
          attributes: {
            parameterName,
            isPermissionAction: true,
            noOracleColumn: true,
          },
        });
      }
    }

    for (const bo of (row.businessObjects as Array<Record<string, unknown>>) ?? []) {
      const fullType = str(bo.fullType);
      if (!fullType) continue;
      const boId = Stage2eIds.businessObject(fullType);
      g.upsertNode({
        id: boId,
        type: 'business_object',
        name: fullType.split('.').pop() || fullType,
        canonicalName: fullType,
        sourceStage: '2A',
        sourceConfidence: str(bo.confidence) || 'confirmed_from_il',
        attributes: { assembly: bo.assembly ?? null, fullType },
      });
      g.addEdge({
        type: 'USES_BO',
        from: formId,
        to: boId,
        sourceStage: '2A',
        sourceConfidence: 'confirmed_from_il',
      });
    }

    for (const df of (row.dataFactories as Array<Record<string, unknown>>) ?? []) {
      const fullType = str(df.fullType);
      if (!fullType) continue;
      const dfId = Stage2eIds.dataFactory(fullType);
      g.upsertNode({
        id: dfId,
        type: 'data_factory',
        name: fullType.split('.').pop() || fullType,
        canonicalName: fullType,
        sourceStage: '2A',
        sourceConfidence: str(df.confidence) || 'confirmed_from_il',
        attributes: { assembly: df.assembly ?? null, fullType },
      });
      g.addEdge({
        type: 'USES_DF',
        from: formId,
        to: dfId,
        sourceStage: '2A',
        sourceConfidence: 'confirmed_from_il',
      });
    }

    for (const ds of (row.dataSources as Array<Record<string, unknown>>) ?? []) {
      const name = str(ds.name);
      if (!name) continue;
      const dsId = Stage2eIds.dataSource(formType, name);
      g.upsertNode({
        id: dsId,
        type: 'data_source',
        name,
        sourceStage: '2A',
        sourceConfidence: str(ds.confidence) || 'confirmed_from_il',
        attributes: { kind: ds.kind ?? null, relatedDf: ds.relatedDf ?? null },
      });
      g.addEdge({
        type: 'USES_DATASOURCE',
        from: formId,
        to: dsId,
        sourceStage: '2A',
        sourceConfidence: 'confirmed_from_il',
      });
    }
  });

  // --- Stage 2B ---
  const stage2bPath = path.join(repoRoot, ARTIFACT.stage2bFull);
  await forEachNdjson(stage2bPath, (row) => {
    const kind = str(row.kind);
    g.coverage.stage2b += 1;

    if (kind === 'gateway') {
      const gatewayType = str(row.gatewayType);
      if (!gatewayType) return;
      const asm = assemblyFromType(gatewayType);
      const gwId = Stage2eIds.gateway(asm, gatewayType);
      const viewName = str(row.viewName);
      const packageName = str(row.packageName);
      const baseTable = str(row.baseTableName);
      g.upsertNode({
        id: gwId,
        type: 'gateway',
        name: gatewayType.split('.').pop() || gatewayType,
        canonicalName: gatewayType,
        sourceStage: '2B',
        sourceConfidence: 'confirmed_from_il',
        attributes: {
          gatewayType,
          datasetTable: row.datasetTable ?? null,
          alias: row.alias ?? null,
          viewName: viewName || null,
          baseTableName: baseTable || null,
          packageName: packageName || null,
          oracleViewStatus: row.oracleViewStatus ?? null,
          oraclePackageStatus: row.oraclePackageStatus ?? null,
        },
        provenance: {
          sourceStage: '2B',
          sourceArtifact: ARTIFACT.stage2bFull,
          sourceRecordId: gatewayType,
        },
      });

      if (viewName) {
        oracleObjectNames.add(normalizeOracleName(viewName));
        const status = str(row.oracleViewStatus);
        const ooId = g.ensureOracleObjectStub({
          objectName: viewName,
          objectType: 'VIEW',
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
          validationStatus:
            status === 'missing_in_oracle' || status === 'missing_in_current_db'
              ? 'missing_in_current_db'
              : status === 'confirmed' || status === 'confirmed_in_oracle'
                ? 'confirmed'
                : 'not_checked',
        });
        g.addEdge({
          type: 'MAPS_TO_ORACLE_OBJECT',
          from: gwId,
          to: ooId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
        });
      }
      if (baseTable) {
        oracleObjectNames.add(normalizeOracleName(baseTable));
        const ooId = g.ensureOracleObjectStub({
          objectName: baseTable,
          objectType: 'TABLE',
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
        });
        g.addEdge({
          type: 'MAPS_TO_ORACLE_OBJECT',
          from: gwId,
          to: ooId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
        });
      }
      if (packageName) {
        packageNames.add(normalizeOracleName(packageName));
        const pkgId = Stage2eIds.oraclePackage('UNKNOWN', packageName);
        g.upsertNode({
          id: pkgId,
          type: 'oracle_package',
          name: normalizeOracleName(packageName),
          canonicalName: normalizeOracleName(packageName),
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
          attributes: {
            owner: 'UNKNOWN',
            objectType: 'PACKAGE',
            objectName: normalizeOracleName(packageName),
            oracleValidationStatus:
              str(row.oraclePackageStatus) === 'missing_in_oracle'
                ? 'missing_in_current_db'
                : str(row.oraclePackageStatus) === 'confirmed' ||
                    str(row.oraclePackageStatus) === 'confirmed_in_oracle'
                  ? 'confirmed'
                  : 'not_checked',
          },
        });
        g.addEdge({
          type: 'USES_PACKAGE',
          from: gwId,
          to: pkgId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
        });
      }
    }

    if (kind === 'type') {
      const fullName = str(row.fullName);
      if (!fullName) return;
      const role = str(row.technicalRole).toUpperCase();
      const typeId =
        role === 'DF'
          ? Stage2eIds.dataFactory(fullName)
          : role === 'BO'
            ? Stage2eIds.businessObject(fullName)
            : Stage2eIds.dotnetType(fullName);
      g.upsertNode({
        id: typeId,
        type:
          role === 'DF' ? 'data_factory' : role === 'BO' ? 'business_object' : 'dotnet_type',
        name: fullName.split('.').pop() || fullName,
        canonicalName: fullName,
        sourceStage: '2B',
        sourceConfidence: 'confirmed_from_il',
        attributes: {
          technicalRole: row.technicalRole ?? null,
          baseType: row.baseType ?? null,
          inheritanceChain: row.inheritanceChain ?? null,
        },
      });
      for (const gw of (row.gateways as Array<Record<string, unknown>>) ?? []) {
        const gatewayType = str(gw.gatewayType);
        if (!gatewayType) continue;
        const gwId = Stage2eIds.gateway(assemblyFromType(gatewayType), gatewayType);
        g.addEdge({
          type: 'RESOLVES_TO_GATEWAY',
          from: typeId,
          to: gwId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_il',
        });
      }
      const baseType = str(row.baseType);
      if (baseType) {
        const baseId = Stage2eIds.dotnetType(baseType);
        g.upsertNode({
          id: baseId,
          type: 'dotnet_type',
          name: baseType.split('.').pop() || baseType,
          canonicalName: baseType,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_il',
        });
        g.addEdge({
          type: 'INHERITS_FROM',
          from: typeId,
          to: baseId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_il',
        });
      }
    }

    if (kind === 'lookupSplit') {
      const formType = str(row.formType);
      const control = str(row.control);
      const guid = formGuids.get(formType) || 'unknown';
      const ctrlId = Stage2eIds.control(guid, formType, control);
      const target = row.targetBinding as Record<string, unknown> | undefined;
      const lookup = row.lookupBinding as Record<string, unknown> | undefined;
      if (target && str(target.datasetTable) && str(target.dataMember)) {
        const tbId = Stage2eIds.targetBinding(
          formType,
          control,
          str(target.datasetTable),
          str(target.dataMember),
        );
        g.upsertNode({
          id: tbId,
          type: 'target_binding',
          name: `${target.datasetTable}.${target.dataMember}`,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
          attributes: { ...target, formType, control, bindingRole: 'target' },
        });
        g.addEdge({
          type: 'BINDS_TARGET',
          from: ctrlId,
          to: tbId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
        });
      }
      if (lookup && str(lookup.datasetTable)) {
        const lbId = Stage2eIds.lookupBinding(
          formType,
          control,
          str(lookup.datasetTable),
          str(lookup.valueMember) || 'ID',
          str(lookup.displayMember) || 'NAZWA',
        );
        g.upsertNode({
          id: lbId,
          type: 'lookup_binding',
          name: `${lookup.datasetTable}.${lookup.valueMember}/${lookup.displayMember}`,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
          attributes: { ...lookup, formType, control, bindingRole: 'lookup' },
        });
        g.addEdge({
          type: 'BINDS_LOOKUP',
          from: ctrlId,
          to: lbId,
          sourceStage: '2B',
          sourceConfidence: 'confirmed_from_stage2b',
        });
      }
    }

    if (kind === 'chain') {
      const viewName = str(row.viewName);
      if (viewName) oracleObjectNames.add(normalizeOracleName(viewName));
      const pkg = str(row.packageName);
      if (pkg) packageNames.add(normalizeOracleName(pkg));
    }
  });

  // --- Stage 2C help ---
  const stage2cPath = path.join(repoRoot, ARTIFACT.stage2cFull);
  await forEachNdjson(stage2cPath, (row) => {
    if (str(row.kind) !== 'formHelp') return;
    g.coverage.stage2c += 1;
    const guid = normalizeGuid(str(row.guid));
    const formType = str(row.formType);
    if (!formType) return;
    const formId = Stage2eIds.form(guid || formGuids.get(formType) || 'unknown', formType);
    const helpStatus = str(row.helpStatus) || str(row.status);

    if (helpStatus === 'help_file_missing' || helpStatus === 'help_unreadable') {
      g.upsertNode({
        id: formId,
        type: 'application_form',
        name: formType.split('.').pop() || formType,
        sourceStage: '2C',
        sourceConfidence: 'confirmed',
        attributes: {
          helpStatus,
          helpOptional: true,
          technicalGraphPreserved: true,
        },
      });
      // Continue — technical graph from 2A/2B stays; no help nodes.
      return;
    }

    const helpDocId = Stage2eIds.helpDocument(guid, formType);
    g.upsertNode({
      id: helpDocId,
      type: 'help_document',
      name: `${formType} Help`,
      sourceStage: '2C',
      sourceConfidence: 'confirmed',
      attributes: {
        guid,
        formType,
        encoding: row.encoding ?? null,
        helpPath: row.helpPath ?? null,
      },
      provenance: {
        sourceStage: '2C',
        sourceArtifact: ARTIFACT.stage2cFull,
        sourceRecordId: guid,
      },
    });
    g.addEdge({
      type: 'HAS_HELP',
      from: formId,
      to: helpDocId,
      sourceStage: '2C',
      sourceConfidence: 'confirmed',
    });

    const fieldEntries = (row.fieldEntries as Array<Record<string, unknown>>) ?? [];
    fieldEntries.forEach((fe, idx) => {
      const label = str(fe.label) || str(fe.normalizedLabel);
      if (!label) return;
      const section = str(fe.section) || 'default';
      const hfId = Stage2eIds.helpField(guid, formType, section, idx, label);
      g.upsertNode({
        id: hfId,
        type: 'help_field',
        name: label,
        canonicalName: label,
        sourceStage: '2C',
        sourceConfidence: 'confirmed',
        attributes: { section, order: idx, description: fe.description ?? null },
      });
      g.addEdge({
        type: 'DESCRIBES',
        from: helpDocId,
        to: hfId,
        sourceStage: '2C',
        sourceConfidence: 'confirmed',
      });
    });

    for (const m of (row.linkedMappings as Array<Record<string, unknown>>) ?? []) {
      const control = str(m.control);
      const helpLabel = str(m.helpLabel) || str(m.label);
      if (!control) continue;
      const ctrlId = Stage2eIds.control(guid || 'unknown', formType, control);
      g.upsertNode({
        id: ctrlId,
        type: 'ui_control',
        name: control,
        sourceStage: '2C',
        sourceConfidence: str(m.matchStatus) || 'confirmed',
      });
      if (helpLabel) {
        const hfId = Stage2eIds.helpField(guid, formType, 'linked', shortOrder(helpLabel), helpLabel);
        g.upsertNode({
          id: hfId,
          type: 'help_field',
          name: helpLabel,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
        });
        g.addEdge({
          type: 'DESCRIBES',
          from: hfId,
          to: ctrlId,
          sourceStage: '2C',
          sourceConfidence: str(m.matchStatus) || 'confirmed',
        });
        g.addEdge({
          type: 'LABEL_FOR',
          from: hfId,
          to: ctrlId,
          sourceStage: '2C',
          sourceConfidence: str(m.matchStatus) || 'confirmed',
        });
      }

      const target = m.targetBinding as Record<string, unknown> | undefined;
      const lookup = m.lookupBinding as Record<string, unknown> | undefined;
      if (target && str(target.datasetTable) && str(target.dataMember)) {
        const tbId = Stage2eIds.targetBinding(
          formType,
          control,
          str(target.datasetTable),
          str(target.dataMember),
        );
        g.upsertNode({
          id: tbId,
          type: 'target_binding',
          name: `${target.datasetTable}.${target.dataMember}`,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
          attributes: { ...target, bindingRole: 'target' },
        });
        g.addEdge({
          type: 'BINDS_TARGET',
          from: ctrlId,
          to: tbId,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
        });
      }
      if (lookup && str(lookup.datasetTable)) {
        const vm = str(lookup.valueMember) || 'ID';
        const dm = str(lookup.displayMember) || 'NAZWA';
        const lbId = Stage2eIds.lookupBinding(
          formType,
          control,
          str(lookup.datasetTable),
          vm,
          dm,
        );
        g.upsertNode({
          id: lbId,
          type: 'lookup_binding',
          name: `${lookup.datasetTable}.${vm}/${dm}`,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
          attributes: { ...lookup, bindingRole: 'lookup' },
        });
        g.addEdge({
          type: 'BINDS_LOOKUP',
          from: ctrlId,
          to: lbId,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
        });
        // DISPLAYS_FROM points at a logical column stub (dataset.column), later Oracle-enriched
        const displayColStub = Stage2eIds.oracleColumn(
          'UNKNOWN',
          str(lookup.datasetTable),
          dm,
        );
        g.upsertNode({
          id: displayColStub,
          type: 'oracle_column',
          name: dm,
          canonicalName: `${lookup.datasetTable}.${dm}`,
          sourceStage: '2C',
          sourceConfidence: 'probable',
          attributes: {
            datasetTable: lookup.datasetTable,
            columnName: dm,
            role: 'display',
            oracleValidationStatus: 'not_checked',
          },
        });
        g.addEdge({
          type: 'DISPLAYS_FROM',
          from: lbId,
          to: displayColStub,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
        });
        const valueColStub = Stage2eIds.oracleColumn('UNKNOWN', str(lookup.datasetTable), vm);
        g.upsertNode({
          id: valueColStub,
          type: 'oracle_column',
          name: vm,
          canonicalName: `${lookup.datasetTable}.${vm}`,
          sourceStage: '2C',
          sourceConfidence: 'probable',
          attributes: {
            datasetTable: lookup.datasetTable,
            columnName: vm,
            role: 'value',
            oracleValidationStatus: 'not_checked',
          },
        });
        g.addEdge({
          type: 'MAPS_TO_ORACLE_COLUMN',
          from: lbId,
          to: valueColStub,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
        });
      }

      const oracle = m.oracleMapping as Record<string, unknown> | undefined;
      if (oracle) {
        for (const o of (oracle.targetObjects as string[]) ?? []) {
          if (!o) continue;
          oracleObjectNames.add(normalizeOracleName(o));
          const ooId = g.ensureOracleObjectStub({
            objectName: o,
            objectType: 'VIEW',
            sourceStage: '2C',
            sourceConfidence: 'confirmed_from_stage2b',
          });
          const tb = m.targetBinding as Record<string, unknown> | undefined;
          if (tb && str(tb.datasetTable) && str(tb.dataMember)) {
            const tbId = Stage2eIds.targetBinding(
              formType,
              control,
              str(tb.datasetTable),
              str(tb.dataMember),
            );
            g.addEdge({
              type: 'MAPS_TO_ORACLE_OBJECT',
              from: tbId,
              to: ooId,
              sourceStage: '2C',
              sourceConfidence: 'confirmed',
            });
          }
        }
        for (const o of (oracle.lookupObjects as string[]) ?? []) {
          if (!o) continue;
          oracleObjectNames.add(normalizeOracleName(o));
          g.ensureOracleObjectStub({
            objectName: o,
            objectType: 'VIEW',
            sourceStage: '2C',
            sourceConfidence: 'confirmed_from_stage2b',
          });
        }
      }

      if (m.parameterName) {
        g.upsertNode({
          id: ctrlId,
          type: 'action_control',
          name: control,
          sourceStage: '2C',
          sourceConfidence: 'confirmed',
          attributes: {
            parameterName: str(m.parameterName),
            isPermissionAction: true,
            noOracleColumn: true,
          },
        });
      }
    }
  });

  // --- Stage 2D datasets ---
  const stage2dPath = path.join(repoRoot, ARTIFACT.stage2dFull);
  await forEachNdjson(stage2dPath, (row) => {
    if (str(row.kind) !== 'dataset') return;
    g.coverage.stage2d += 1;
    const declaringType = str(row.declaringType);
    if (!declaringType) return;
    const asm = str(row.assemblyName) || assemblyFromType(declaringType);
    const datasetTable = str(row.datasetTable) || null;
    const dsId = Stage2eIds.dataset(asm, declaringType, datasetTable);
    g.upsertNode({
      id: dsId,
      type: 'dataset',
      name: datasetTable || declaringType.split('.').pop() || declaringType,
      canonicalName: datasetTable || declaringType,
      sourceStage: '2D',
      sourceConfidence: str(row.confidence) || 'confirmed_from_il',
      attributes: {
        declaringType,
        datasetTable,
        datasetTableStatus: row.datasetTableStatus ?? null,
        assemblyName: asm,
        technicalRole: row.technicalRole ?? null,
      },
      provenance: {
        sourceStage: '2D',
        sourceArtifact: ARTIFACT.stage2dFull,
        sourceRecordId: declaringType,
      },
    });

    const typeRole = /DF$/i.test(declaringType)
      ? 'data_factory'
      : /BO$/i.test(declaringType)
        ? 'business_object'
        : 'dotnet_type';
    const typeId =
      typeRole === 'data_factory'
        ? Stage2eIds.dataFactory(declaringType)
        : typeRole === 'business_object'
          ? Stage2eIds.businessObject(declaringType)
          : Stage2eIds.dotnetType(declaringType);
    g.upsertNode({
      id: typeId,
      type: typeRole,
      name: declaringType.split('.').pop() || declaringType,
      canonicalName: declaringType,
      sourceStage: '2D',
      sourceConfidence: 'confirmed_from_il',
    });
    g.addEdge({
      type: 'PRODUCES_DATASET',
      from: typeId,
      to: dsId,
      sourceStage: '2D',
      sourceConfidence: 'confirmed_from_il',
    });

    const main = row.mainSource as Record<string, unknown> | undefined;
    if (main && str(main.objectName)) {
      const msId = Stage2eIds.mainSource(
        declaringType,
        str(main.objectName),
        str(main.alias) || str(main.objectName),
      );
      g.upsertNode({
        id: msId,
        type: 'main_source',
        name: str(main.objectName),
        canonicalName: `${main.objectName} AS ${main.alias ?? main.objectName}`,
        sourceStage: '2D',
        sourceConfidence: str(main.confidence) || 'confirmed_from_il',
        attributes: { ...main },
      });
      g.addEdge({
        type: 'READS_FROM',
        from: dsId,
        to: msId,
        sourceStage: '2D',
        sourceConfidence: str(main.confidence) || 'confirmed_from_il',
      });
      oracleObjectNames.add(normalizeOracleName(str(main.objectName)));
      const ooId = g.ensureOracleObjectStub({
        objectName: str(main.objectName),
        objectType: str(main.objectKind) === 'table' ? 'TABLE' : 'VIEW',
        sourceStage: '2D',
        sourceConfidence: str(main.confidence) || 'confirmed_from_il',
      });
      g.addEdge({
        type: 'MAPS_TO_ORACLE_OBJECT',
        from: msId,
        to: ooId,
        sourceStage: '2D',
        sourceConfidence: 'confirmed_from_il',
      });
    }

    const joins =
      (row.effectiveJoins as Array<Record<string, unknown>>) ??
      (row.joins as Array<Record<string, unknown>>) ??
      [];
    for (const j of joins) {
      const alias = str(j.alias) || str(j.normalizedAlias);
      const joinedObject = str(j.joinedObject);
      if (!alias && !joinedObject) continue;
      const cond = j.condition as Record<string, unknown> | null;
      const ch = Stage2eIds.conditionHash(str(j.rawCondition), cond);
      const joinId = Stage2eIds.join(declaringType, normalizeAlias(alias), joinedObject, ch);
      g.upsertNode({
        id: joinId,
        type: 'join',
        name: `${alias}→${joinedObject}`,
        canonicalName: `${normalizeAlias(alias)}:${normalizeOracleName(joinedObject)}`,
        sourceStage: '2D',
        sourceConfidence: str(j.confidence) || 'confirmed_from_il',
        attributes: {
          joinedObject,
          alias,
          rawAlias: j.rawAlias ?? alias,
          normalizedAlias: normalizeAlias(alias),
          joinType: j.joinType ?? null,
          condition: cond ?? null,
          rawCondition: j.rawCondition ?? null,
          conditionStatus: j.conditionStatus ?? null,
          inheritanceKind: j.inheritanceKind ?? null,
          alternatives: j.alternatives ?? null,
        },
        evidence: ((j.evidence as Array<Record<string, unknown>>) ?? []).map((e) => ({
          kind: 'il',
          method: str(e.method),
          offset: str(e.offset),
          assignment: str(e.assignment),
        })),
      });
      g.addEdge({
        type: 'JOINS_TO',
        from: dsId,
        to: joinId,
        sourceStage: '2D',
        sourceConfidence: str(j.confidence) || 'confirmed_from_il',
      });
      if (joinedObject) {
        oracleObjectNames.add(normalizeOracleName(joinedObject));
        const ooId = g.ensureOracleObjectStub({
          objectName: joinedObject,
          objectType: 'VIEW',
          sourceStage: '2D',
          sourceConfidence: 'confirmed_from_il',
        });
        g.addEdge({
          type: 'MAPS_TO_ORACLE_OBJECT',
          from: joinId,
          to: ooId,
          sourceStage: '2D',
          sourceConfidence: 'confirmed_from_il',
        });
      }
      if (j.alternatives) {
        g.addConflict({
          conflictType: 'join_definition_conflict',
          subjectId: joinId,
          alternatives: j.alternatives as unknown[],
          evidence: [],
          resolutionStatus: 'unresolved',
        });
      }
    }

    for (const c of (row.projectedColumns as Array<Record<string, unknown>>) ?? []) {
      const expression = str(c.expression);
      if (!expression) continue;
      const calculated = !!c.calculated;
      const colId = calculated
        ? Stage2eIds.calculatedColumn(declaringType, expression)
        : Stage2eIds.projectedColumn(
            declaringType,
            expression,
            str(c.datasetColumnExplicit) || str(c.effectiveDatasetColumn) || str(c.datasetColumn),
          );
      g.upsertNode({
        id: colId,
        type: calculated ? 'calculated_column' : 'projected_column',
        name: str(c.effectiveDatasetColumn) || str(c.datasetColumn) || expression,
        canonicalName: expression,
        sourceStage: '2D',
        sourceConfidence: str(c.confidence) || 'confirmed_from_il',
        attributes: {
          sourceAlias: c.sourceAlias ?? null,
          sourceColumn: c.sourceColumn ?? null,
          expression,
          datasetColumnExplicit: c.datasetColumnExplicit ?? null,
          effectiveDatasetColumn: c.effectiveDatasetColumn ?? null,
          effectiveDatasetColumnStatus: c.effectiveDatasetColumnStatus ?? null,
          calculated,
          calculatedDependencies: c.calculatedDependencies ?? null,
        },
      });
      g.addEdge({
        type: 'PROJECTS',
        from: dsId,
        to: colId,
        sourceStage: '2D',
        sourceConfidence: 'confirmed_from_il',
      });

      const deps = c.calculatedDependencies as Record<string, unknown> | undefined;
      if (calculated && deps) {
        for (const pkg of (deps.referencedPackages as string[]) ?? []) {
          packageNames.add(normalizeOracleName(pkg));
          const pkgId = Stage2eIds.oraclePackage('UNKNOWN', pkg);
          g.upsertNode({
            id: pkgId,
            type: 'oracle_package',
            name: normalizeOracleName(pkg),
            sourceStage: '2D',
            sourceConfidence: 'confirmed_from_il',
            attributes: {
              oracleValidationStatus: 'not_checked',
              objectType: 'PACKAGE',
              objectName: normalizeOracleName(pkg),
            },
          });
          g.addEdge({
            type: 'USES_PACKAGE',
            from: colId,
            to: pkgId,
            sourceStage: '2D',
            sourceConfidence: 'confirmed_from_il',
          });
        }
        for (const fn of (deps.referencedFunctions as string[]) ?? []) {
          const pkgs = (deps.referencedPackages as string[]) ?? ['UNKNOWN'];
          const fnId = Stage2eIds.oracleFunction('UNKNOWN', pkgs[0]!, fn);
          g.upsertNode({
            id: fnId,
            type: 'oracle_function',
            name: fn,
            sourceStage: '2D',
            sourceConfidence: 'confirmed_from_il',
            attributes: {
              functionName: fn,
              packageName: pkgs[0],
              oracleValidationStatus: 'not_checked',
            },
          });
          g.addEdge({
            type: 'CALLS_FUNCTION',
            from: colId,
            to: fnId,
            sourceStage: '2D',
            sourceConfidence: 'confirmed_from_il',
          });
        }
        for (const col of (deps.referencedColumns as string[]) ?? []) {
          g.addEdge({
            type: 'DERIVED_FROM',
            from: colId,
            to: Stage2eIds.projectedColumn(declaringType, col, col),
            sourceStage: '2D',
            sourceConfidence: 'confirmed_from_il',
            attributes: { referencedColumn: col },
          });
          // ensure stub for DERIVED_FROM target
          g.upsertNode({
            id: Stage2eIds.projectedColumn(declaringType, col, col),
            type: 'projected_column',
            name: col,
            sourceStage: '2D',
            sourceConfidence: 'confirmed_from_il',
            attributes: { expression: col, role: 'dependency_ref' },
          });
        }
      }
    }
  });

  return { g, formGuids, oracleObjectNames, packageNames };
}

function shortOrder(label: string): string {
  return Stage2eIds.conditionHash(label).slice(0, 6);
}

export { ARTIFACT };
