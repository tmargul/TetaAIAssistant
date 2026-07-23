/**
 * Stage 2E Oracle metadata enrichment (read-only).
 * Does not execute business SQL; only dictionary views.
 */
import { Stage2eGraphBuilder } from './teta-stage2e.graph';
import { Stage2eIds, normalizeOracleName } from './teta-stage2e.ids';

export type OracleConn = {
  user: string;
  password: string;
  connectString: string;
};

type OraConn = {
  execute: (
    sql: string,
    binds: unknown,
    options: { outFormat: number },
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>;
  close: () => Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracledb = require('oracledb') as {
  OUT_FORMAT_OBJECT: number;
  getConnection: (c: OracleConn) => Promise<OraConn>;
};

async function queryChunks(
  connection: OraConn,
  names: string[],
  buildSql: (placeholders: string) => string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < names.length; i += 400) {
    const chunk = names.slice(i, i + 400);
    if (!chunk.length) continue;
    const binds: Record<string, string> = {};
    const placeholders = chunk.map((n, idx) => {
      const key = `n${idx}`;
      binds[key] = n;
      return `:${key}`;
    });
    const result = await connection.execute(buildSql(placeholders.join(',')), binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    rows.push(...(result.rows ?? []));
  }
  return rows;
}

export async function enrichStage2eOracle(
  g: Stage2eGraphBuilder,
  oracle: OracleConn,
  objectNames: Set<string>,
  packageNames: Set<string>,
): Promise<{ enrichedObjects: number; enrichedColumns: number; dependencies: number; fks: number }> {
  const connection = await oracledb.getConnection(oracle);
  let enrichedObjects = 0;
  let enrichedColumns = 0;
  let dependencies = 0;
  let fks = 0;

  try {
    const names = [...objectNames].filter(Boolean);
    const pkgs = [...packageNames].filter(Boolean);
    const allNames = [...new Set([...names, ...pkgs])];

    // ALL_OBJECTS validation
    if (allNames.length) {
      const objRows = await queryChunks(
        connection,
        allNames,
        (ph) => `
          SELECT owner, object_name, object_type, status
          FROM all_objects
          WHERE object_type IN ('TABLE','VIEW','PACKAGE','PROCEDURE','FUNCTION','SYNONYM')
            AND object_name IN (${ph})`,
      );

      const byName = new Map<string, Array<Record<string, unknown>>>();
      for (const r of objRows) {
        const n = normalizeOracleName(String(r.OBJECT_NAME ?? r.object_name));
        const list = byName.get(n) ?? [];
        list.push(r);
        byName.set(n, list);
      }

      for (const name of allNames) {
        const hits = byName.get(name) ?? [];
        // Find existing stub nodes for this object name
        const stubs = [...g.nodes.values()].filter(
          (n) =>
            (n.type === 'oracle_object' || n.type === 'oracle_package') &&
            normalizeOracleName(String(n.attributes.objectName ?? n.name)) === name,
        );

        if (hits.length === 0) {
          for (const stub of stubs) {
            stub.attributes.oracleValidationStatus = 'missing_in_current_db';
            stub.attributes.technicalFactPreserved = true;
          }
          if (stubs.length === 0 && names.includes(name)) {
            g.ensureOracleObjectStub({
              objectName: name,
              objectType: 'UNKNOWN',
              sourceStage: '2E',
              validationStatus: 'missing_in_current_db',
              evidence: [{ kind: 'oracle_metadata', view: 'ALL_OBJECTS', name }],
            });
            const created = [...g.nodes.values()].find(
              (n) =>
                (n.type === 'oracle_object' || n.type === 'oracle_package') &&
                normalizeOracleName(String(n.attributes.objectName ?? n.name)) === name,
            );
            if (created) created.attributes.technicalFactPreserved = true;
          }
          continue;
        }

        if (hits.length > 1) {
          const owners = [...new Set(hits.map((h) => String(h.OWNER ?? h.owner)))];
          if (owners.length > 1) {
            g.addConflict({
              conflictType: 'oracle_owner_conflict',
              subjectId: Stage2eIds.oracleObject('MULTI', 'UNKNOWN', name),
              alternatives: hits.map((h) => ({
                owner: h.OWNER ?? h.owner,
                objectType: h.OBJECT_TYPE ?? h.object_type,
              })),
              evidence: [{ kind: 'oracle_metadata', view: 'ALL_OBJECTS', name }],
              resolutionStatus: 'unresolved',
            });
          }
        }

        for (const hit of hits) {
          const owner = String(hit.OWNER ?? hit.owner);
          const objectType = String(hit.OBJECT_TYPE ?? hit.object_type).toUpperCase();
          const status = String(hit.STATUS ?? hit.status ?? 'VALID');
          const id =
            objectType === 'PACKAGE'
              ? Stage2eIds.oraclePackage(owner, name)
              : Stage2eIds.oracleObject(owner, objectType, name);

          g.upsertNode({
            id,
            type: objectType === 'PACKAGE' ? 'oracle_package' : 'oracle_object',
            name,
            canonicalName: `${owner}.${name}`,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_objects',
            confidence: status === 'VALID' ? 'confirmed' : 'probable',
            attributes: {
              owner,
              objectType,
              objectName: name,
              status,
              oracleValidationStatus:
                status === 'INVALID' ? 'invalid_object' : 'confirmed',
            },
            evidence: [
              {
                kind: 'oracle_metadata',
                view: 'ALL_OBJECTS',
                owner,
                name,
              },
            ],
          });
          enrichedObjects += 1;

          // Relink stubs UNKNOWN → confirmed owner via MAPS (keep stubs; add confirmed node)
          for (const stub of stubs) {
            if (stub.id !== id) {
              g.addEdge({
                type: 'VALIDATED_BY_ORACLE',
                from: stub.id,
                to: id,
                sourceStage: '2E',
                sourceConfidence: 'confirmed_from_all_objects',
              });
              stub.attributes.oracleValidationStatus = 'confirmed';
              stub.attributes.resolvedOwner = owner;
              stub.attributes.resolvedObjectType = objectType;
            }
          }
        }
      }
    }

    // Columns for TABLE/VIEW
    const tableLike = [...g.nodes.values()]
      .filter(
        (n) =>
          n.type === 'oracle_object' &&
          ['TABLE', 'VIEW'].includes(String(n.attributes.objectType ?? '').toUpperCase()) &&
          n.attributes.oracleValidationStatus === 'confirmed' &&
          n.attributes.owner &&
          n.attributes.owner !== 'UNKNOWN',
      )
      .map((n) => ({
        owner: String(n.attributes.owner),
        name: String(n.attributes.objectName ?? n.name),
        id: n.id,
      }));

    // Deduplicate owner+name
    const seenTab = new Set<string>();
    const tabs: typeof tableLike = [];
    for (const t of tableLike) {
      const k = `${t.owner}.${t.name}`;
      if (seenTab.has(k)) continue;
      seenTab.add(k);
      tabs.push(t);
    }

    for (let i = 0; i < tabs.length; i += 50) {
      const chunk = tabs.slice(i, i + 50);
      const binds: Record<string, string> = {};
      const parts: string[] = [];
      chunk.forEach((t, idx) => {
        binds[`o${idx}`] = t.owner;
        binds[`n${idx}`] = t.name;
        parts.push(`(owner = :o${idx} AND table_name = :n${idx})`);
      });
      const result = await connection.execute(
        `SELECT owner, table_name, column_name, data_type, data_length, data_precision,
                data_scale, nullable, column_id, data_default, char_used
         FROM all_tab_columns
         WHERE ${parts.join(' OR ')}`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const r of result.rows ?? []) {
        const owner = String(r.OWNER ?? r.owner);
        const tableName = String(r.TABLE_NAME ?? r.table_name);
        const columnName = String(r.COLUMN_NAME ?? r.column_name);
        const colId = Stage2eIds.oracleColumn(owner, tableName, columnName);
        let parentId = Stage2eIds.oracleObject(owner, 'VIEW', tableName);
        if (!g.nodes.has(parentId)) parentId = Stage2eIds.oracleObject(owner, 'TABLE', tableName);

        g.upsertNode({
          id: colId,
          type: 'oracle_column',
          name: columnName,
          canonicalName: `${owner}.${tableName}.${columnName}`,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_tab_columns',
          attributes: {
            owner,
            objectName: tableName,
            columnName,
            dataType: r.DATA_TYPE ?? r.data_type ?? null,
            dataLength: r.DATA_LENGTH ?? r.data_length ?? null,
            dataPrecision: r.DATA_PRECISION ?? r.data_precision ?? null,
            dataScale: r.DATA_SCALE ?? r.data_scale ?? null,
            nullable: r.NULLABLE ?? r.nullable ?? null,
            columnId: r.COLUMN_ID ?? r.column_id ?? null,
            dataDefault: r.DATA_DEFAULT ?? r.data_default ?? null,
            charUsed: r.CHAR_USED ?? r.char_used ?? null,
            oracleValidationStatus: 'confirmed',
          },
          evidence: [
            { kind: 'oracle_metadata', view: 'ALL_TAB_COLUMNS', owner, name: tableName },
          ],
        });
        g.addEdge({
          type: 'HAS_COLUMN',
          from: parentId,
          to: colId,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_tab_columns',
        });
        enrichedColumns += 1;
      }
    }

    // Constraints + FK for confirmed tables/views
    for (let i = 0; i < tabs.length; i += 40) {
      const chunk = tabs.slice(i, i + 40);
      const binds: Record<string, string> = {};
      const parts: string[] = [];
      chunk.forEach((t, idx) => {
        binds[`o${idx}`] = t.owner;
        binds[`n${idx}`] = t.name;
        parts.push(`(c.owner = :o${idx} AND c.table_name = :n${idx})`);
      });
      const result = await connection.execute(
        `SELECT c.owner, c.constraint_name, c.constraint_type, c.table_name,
                c.r_owner, c.r_constraint_name, c.delete_rule, c.deferrable,
                c.deferred, c.status, c.validated,
                cc.column_name, cc.position,
                rc.table_name AS r_table_name, rcc.column_name AS r_column_name
         FROM all_constraints c
         JOIN all_cons_columns cc
           ON c.owner = cc.owner AND c.constraint_name = cc.constraint_name
         LEFT JOIN all_constraints rc
           ON c.r_owner = rc.owner AND c.r_constraint_name = rc.constraint_name
         LEFT JOIN all_cons_columns rcc
           ON rc.owner = rcc.owner AND rc.constraint_name = rcc.constraint_name
          AND rcc.position = cc.position
         WHERE c.constraint_type IN ('P','U','R','C')
           AND (${parts.join(' OR ')})`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      for (const r of result.rows ?? []) {
        const owner = String(r.OWNER ?? r.owner);
        const tableName = String(r.TABLE_NAME ?? r.table_name);
        const ctype = String(r.CONSTRAINT_TYPE ?? r.constraint_type);
        const col = String(r.COLUMN_NAME ?? r.column_name);
        const colId = Stage2eIds.oracleColumn(owner, tableName, col);
        let parentId = Stage2eIds.oracleObject(owner, 'VIEW', tableName);
        if (!g.nodes.has(parentId)) parentId = Stage2eIds.oracleObject(owner, 'TABLE', tableName);

        if (ctype === 'P') {
          g.addEdge({
            type: 'PRIMARY_KEY_OF',
            from: colId,
            to: parentId,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_constraints',
            attributes: {
              constraintName: r.CONSTRAINT_NAME ?? r.constraint_name,
              position: r.POSITION ?? r.position,
              status: r.STATUS ?? r.status,
              validated: r.VALIDATED ?? r.validated,
            },
          });
        } else if (ctype === 'U') {
          g.addEdge({
            type: 'UNIQUE_KEY_OF',
            from: colId,
            to: parentId,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_constraints',
            attributes: {
              constraintName: r.CONSTRAINT_NAME ?? r.constraint_name,
              position: r.POSITION ?? r.position,
            },
          });
        } else if (ctype === 'R') {
          const rOwner = String(r.R_OWNER ?? r.r_owner ?? '');
          const rTable = String(r.R_TABLE_NAME ?? r.r_table_name ?? '');
          const rCol = String(r.R_COLUMN_NAME ?? r.r_column_name ?? '');
          if (rOwner && rTable && rCol) {
            const refColId = Stage2eIds.oracleColumn(rOwner, rTable, rCol);
            g.upsertNode({
              id: refColId,
              type: 'oracle_column',
              name: rCol,
              sourceStage: '2E',
              sourceConfidence: 'confirmed_from_all_constraints',
              attributes: {
                owner: rOwner,
                objectName: rTable,
                columnName: rCol,
                oracleValidationStatus: 'confirmed',
              },
            });
            g.addEdge({
              type: 'FOREIGN_KEY_TO',
              from: colId,
              to: refColId,
              sourceStage: '2E',
              sourceConfidence: 'confirmed_from_all_constraints',
              attributes: {
                constraintName: r.CONSTRAINT_NAME ?? r.constraint_name,
                position: r.POSITION ?? r.position,
                deleteRule: r.DELETE_RULE ?? r.delete_rule,
                deferrable: r.DEFERRABLE ?? r.deferrable,
                deferred: r.DEFERRED ?? r.deferred,
                status: r.STATUS ?? r.status,
                validated: r.VALIDATED ?? r.validated,
              },
            });
            let refObj = Stage2eIds.oracleObject(rOwner, 'TABLE', rTable);
            if (!g.nodes.has(refObj)) {
              // Prefer existing VIEW node if present; otherwise create TABLE stub
              const asView = Stage2eIds.oracleObject(rOwner, 'VIEW', rTable);
              if (g.nodes.has(asView)) {
                refObj = asView;
              } else {
                g.upsertNode({
                  id: refObj,
                  type: 'oracle_object',
                  name: rTable,
                  canonicalName: `${rOwner}.${rTable}`,
                  sourceStage: '2E',
                  sourceConfidence: 'confirmed_from_all_constraints',
                  attributes: {
                    owner: rOwner,
                    objectType: 'TABLE',
                    objectName: rTable,
                    oracleValidationStatus: 'confirmed',
                  },
                });
              }
            }
            // Ensure parent exists too
            if (!g.nodes.has(parentId)) {
              g.upsertNode({
                id: parentId,
                type: 'oracle_object',
                name: tableName,
                canonicalName: `${owner}.${tableName}`,
                sourceStage: '2E',
                sourceConfidence: 'confirmed_from_all_constraints',
                attributes: {
                  owner,
                  objectType: g.nodes.has(Stage2eIds.oracleObject(owner, 'VIEW', tableName))
                    ? 'VIEW'
                    : 'TABLE',
                  objectName: tableName,
                  oracleValidationStatus: 'confirmed',
                },
              });
            }
            g.addEdge({
              type: 'REFERENCES',
              from: parentId,
              to: refObj,
              sourceStage: '2E',
              sourceConfidence: 'confirmed_from_all_constraints',
              attributes: { constraintName: r.CONSTRAINT_NAME ?? r.constraint_name },
            });
            fks += 1;
          }
        }
      }
    }

    // ALL_DEPENDENCIES for views + packages
    const depSubjects = tabs
      .map((t) => ({ owner: t.owner, name: t.name, type: 'VIEW' as string }))
      .concat(
        [...g.nodes.values()]
          .filter(
            (n) =>
              n.type === 'oracle_package' &&
              n.attributes.oracleValidationStatus === 'confirmed' &&
              n.attributes.owner &&
              n.attributes.owner !== 'UNKNOWN',
          )
          .map((n) => ({
            owner: String(n.attributes.owner),
            name: String(n.attributes.objectName ?? n.name),
            type: 'PACKAGE',
          })),
      );

    const seenDep = new Set<string>();
    const depList: typeof depSubjects = [];
    for (const d of depSubjects) {
      const k = `${d.owner}.${d.name}.${d.type}`;
      if (seenDep.has(k)) continue;
      seenDep.add(k);
      depList.push(d);
    }

    for (let i = 0; i < depList.length; i += 40) {
      const chunk = depList.slice(i, i + 40);
      const binds: Record<string, string> = {};
      const parts: string[] = [];
      chunk.forEach((t, idx) => {
        binds[`o${idx}`] = t.owner;
        binds[`n${idx}`] = t.name;
        binds[`t${idx}`] = t.type;
        parts.push(`(owner = :o${idx} AND name = :n${idx} AND type = :t${idx})`);
      });
      const result = await connection.execute(
        `SELECT owner, name, type, referenced_owner, referenced_name, referenced_type, dependency_type
         FROM all_dependencies
         WHERE ${parts.join(' OR ')}`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const r of result.rows ?? []) {
        const owner = String(r.OWNER ?? r.owner);
        const name = String(r.NAME ?? r.name);
        const type = String(r.TYPE ?? r.type);
        const refOwner = String(r.REFERENCED_OWNER ?? r.referenced_owner);
        const refName = String(r.REFERENCED_NAME ?? r.referenced_name);
        const refType = String(r.REFERENCED_TYPE ?? r.referenced_type);
        const depType = String(r.DEPENDENCY_TYPE ?? r.dependency_type ?? '');
        const depId = Stage2eIds.oracleDependency(owner, name, type, refOwner, refName, refType);
        g.upsertNode({
          id: depId,
          type: 'oracle_dependency',
          name: `${name}→${refName}`,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_dependencies',
          attributes: {
            owner,
            name,
            type,
            referencedOwner: refOwner,
            referencedName: refName,
            referencedType: refType,
            dependencyType: depType,
          },
          evidence: [
            { kind: 'oracle_metadata', view: 'ALL_DEPENDENCIES', owner, name },
          ],
        });
        const fromId =
          type === 'PACKAGE'
            ? Stage2eIds.oraclePackage(owner, name)
            : Stage2eIds.oracleObject(owner, type, name);
        const toId =
          refType === 'PACKAGE'
            ? Stage2eIds.oraclePackage(refOwner, refName)
            : Stage2eIds.oracleObject(refOwner, refType, refName);
        g.upsertNode({
          id: toId,
          type: refType === 'PACKAGE' ? 'oracle_package' : 'oracle_object',
          name: refName,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_dependencies',
          attributes: {
            owner: refOwner,
            objectType: refType,
            objectName: refName,
            oracleValidationStatus: 'confirmed',
          },
        });
        g.addEdge({
          type: 'DEPENDS_ON',
          from: fromId,
          to: toId,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_dependencies',
          attributes: { dependencyType: depType },
        });
        dependencies += 1;
      }
    }

    // ALL_PROCEDURES / ALL_ARGUMENTS for packages
    const confirmedPkgs = [...g.nodes.values()].filter(
      (n) =>
        n.type === 'oracle_package' &&
        n.attributes.oracleValidationStatus === 'confirmed' &&
        n.attributes.owner &&
        n.attributes.owner !== 'UNKNOWN',
    );

    for (let i = 0; i < confirmedPkgs.length; i += 30) {
      const chunk = confirmedPkgs.slice(i, i + 30);
      const binds: Record<string, string> = {};
      const parts: string[] = [];
      chunk.forEach((p, idx) => {
        binds[`o${idx}`] = String(p.attributes.owner);
        binds[`n${idx}`] = String(p.attributes.objectName ?? p.name);
        parts.push(`(owner = :o${idx} AND object_name = :n${idx})`);
      });
      const procs = await connection.execute(
        `SELECT owner, object_name, procedure_name, subprogram_id, overload
         FROM all_procedures
         WHERE procedure_name IS NOT NULL AND (${parts.join(' OR ')})`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const r of procs.rows ?? []) {
        const owner = String(r.OWNER ?? r.owner);
        const pkg = String(r.OBJECT_NAME ?? r.object_name);
        const proc = String(r.PROCEDURE_NAME ?? r.procedure_name);
        const overload = String(r.OVERLOAD ?? r.overload ?? '0');
        // Heuristic: treat as function if later args say so; default procedure
        const procId = Stage2eIds.oracleProcedure(owner, pkg, proc, overload);
        g.upsertNode({
          id: procId,
          type: 'oracle_procedure',
          name: proc,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_procedures',
          attributes: {
            owner,
            packageName: pkg,
            procedureName: proc,
            subprogramId: r.SUBPROGRAM_ID ?? r.subprogram_id ?? null,
            overload,
          },
        });
        g.addEdge({
          type: 'HAS_PROCEDURE',
          from: Stage2eIds.oraclePackage(owner, pkg),
          to: procId,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_procedures',
        });
      }

      const args = await connection.execute(
        `SELECT owner, package_name, object_name, overload, argument_name, position,
                sequence, data_type, in_out, defaulted, type_owner, type_name, type_subname
         FROM all_arguments
         WHERE (${parts.map((_, idx) => `(owner = :o${idx} AND package_name = :n${idx})`).join(' OR ')})`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const r of args.rows ?? []) {
        const owner = String(r.OWNER ?? r.owner);
        const pkg = String(r.PACKAGE_NAME ?? r.package_name);
        const sub = String(r.OBJECT_NAME ?? r.object_name);
        const pos = Number(r.POSITION ?? r.position ?? 0);
        const argName = String(r.ARGUMENT_NAME ?? r.argument_name ?? 'RETURN');
        const argId = Stage2eIds.oracleArgument(owner, pkg, sub, pos, argName);
        g.upsertNode({
          id: argId,
          type: 'oracle_argument',
          name: argName,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_all_arguments',
          attributes: {
            owner,
            packageName: pkg,
            subprogram: sub,
            overload: r.OVERLOAD ?? r.overload ?? null,
            argumentName: argName,
            position: pos,
            sequence: r.SEQUENCE ?? r.sequence ?? null,
            dataType: r.DATA_TYPE ?? r.data_type ?? null,
            inOut: r.IN_OUT ?? r.in_out ?? null,
            defaulted: r.DEFAULTED ?? r.defaulted ?? null,
            typeOwner: r.TYPE_OWNER ?? r.type_owner ?? null,
            typeName: r.TYPE_NAME ?? r.type_name ?? null,
            typeSubname: r.TYPE_SUBNAME ?? r.type_subname ?? null,
          },
        });
        const parentProc = Stage2eIds.oracleProcedure(
          owner,
          pkg,
          sub,
          String(r.OVERLOAD ?? r.overload ?? '0'),
        );
        const parentFn = Stage2eIds.oracleFunction(
          owner,
          pkg,
          sub,
          String(r.OVERLOAD ?? r.overload ?? '0'),
        );
        if (g.nodes.has(parentProc)) {
          g.addEdge({
            type: 'HAS_ARGUMENT',
            from: parentProc,
            to: argId,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
          });
        } else if (g.nodes.has(parentFn)) {
          g.addEdge({
            type: 'HAS_ARGUMENT',
            from: parentFn,
            to: argId,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
          });
        } else {
          // create procedure node if missing
          g.upsertNode({
            id: parentProc,
            type: 'oracle_procedure',
            name: sub,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
            attributes: { owner, packageName: pkg, procedureName: sub },
          });
          g.addEdge({
            type: 'HAS_PROCEDURE',
            from: Stage2eIds.oraclePackage(owner, pkg),
            to: parentProc,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
          });
          g.addEdge({
            type: 'HAS_ARGUMENT',
            from: parentProc,
            to: argId,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
          });
        }

        // Upgrade CALLS_FUNCTION confidence when package function exists
        if (!r.ARGUMENT_NAME && (r.DATA_TYPE || r.data_type)) {
          // RETURN argument → function
          const fnId = Stage2eIds.oracleFunction(
            owner,
            pkg,
            sub,
            String(r.OVERLOAD ?? r.overload ?? '0'),
          );
          g.upsertNode({
            id: fnId,
            type: 'oracle_function',
            name: sub,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
            attributes: {
              owner,
              packageName: pkg,
              functionName: sub,
              oracleValidationStatus: 'confirmed',
            },
          });
          g.addEdge({
            type: 'HAS_FUNCTION',
            from: Stage2eIds.oraclePackage(owner, pkg),
            to: fnId,
            sourceStage: '2E',
            sourceConfidence: 'confirmed_from_all_arguments',
          });
        }
      }
    }

    // Upgrade calculated CALLS_FUNCTION edges when Oracle confirmed the function
    for (const e of g.edges.values()) {
      if (e.type !== 'CALLS_FUNCTION') continue;
      const fn = g.nodes.get(e.to);
      if (!fn) continue;
      const fnName = normalizeOracleName(fn.name);
      const confirmed = [...g.nodes.values()].find(
        (n) =>
          n.type === 'oracle_function' &&
          normalizeOracleName(n.name) === fnName &&
          n.attributes.oracleValidationStatus === 'confirmed',
      );
      if (confirmed) {
        e.sourceConfidence = 'confirmed_from_il_and_oracle';
        e.confidence = 'confirmed';
        g.addEdge({
          type: 'VALIDATED_BY_ORACLE',
          from: e.to,
          to: confirmed.id,
          sourceStage: '2E',
          sourceConfidence: 'confirmed_from_il_and_oracle',
        });
      } else {
        const pkgNode = [...g.nodes.values()].find(
          (n) =>
            n.type === 'oracle_package' &&
            normalizeOracleName(String(n.attributes.objectName ?? n.name)) ===
              normalizeOracleName(String(fn.attributes.packageName ?? '')),
        );
        if (pkgNode?.attributes.oracleValidationStatus === 'missing_in_current_db') {
          fn.attributes.oracleValidationStatus = 'missing_in_current_db';
        }
      }
    }
  } finally {
    await connection.close();
  }

  return { enrichedObjects, enrichedColumns, dependencies, fks };
}
