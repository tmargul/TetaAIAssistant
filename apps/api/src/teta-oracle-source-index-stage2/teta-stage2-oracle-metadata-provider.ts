/**
 * Live Oracle metadata source provider (read-only dictionary queries).
 * No business SELECT/DML/DDL/PLSQL execution.
 * runtimeCopilotDependencies=0
 */

import type {
  Stage2NormalizedSource,
  Stage2ObjectType,
} from './teta-stage2.types';
import type {
  OracleSourceArgument,
  OracleSourceDependency,
  OracleSourceInventoryObject,
  OracleSourceProvider,
  OracleSourceProviderCapabilities,
} from './teta-stage2-provider';
import { sha256 } from './teta-stage2-parse';
import { buildInventoryIndex } from './teta-stage2-resolve';
import { defaultUnwrapProvider, isOracleWrappedPlsql } from './teta-stage2-unwrap';

export type OracleConnConfig = {
  user: string;
  password: string;
  connectString: string;
};

type OraConn = {
  execute: (
    sql: string,
    binds?: unknown,
    options?: {
      outFormat?: number;
      maxRows?: number;
      fetchInfo?: Record<string, { type: unknown }>;
    },
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>;
  close: () => Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracledb = require('oracledb') as {
  OUT_FORMAT_OBJECT: number;
  STRING: unknown;
  getConnection: (c: OracleConnConfig) => Promise<OraConn>;
};

export const SYSTEM_OWNERS = new Set([
  'SYS',
  'SYSTEM',
  'XDB',
  'MDSYS',
  'CTXSYS',
  'ORDSYS',
  'ORDDATA',
  'ORDPLUGINS',
  'SI_INFORMTN_SCHEMA',
  'WMSYS',
  'EXFSYS',
  'DBSNMP',
  'OUTLN',
  'DIP',
  'ANONYMOUS',
  'APPQOSSYS',
  'GSMADMIN_INTERNAL',
  'OJVMSYS',
  'DVSYS',
  'LBACSYS',
  'REMOTE_SCHEDULER_AGENT',
  'SYS$UMF',
  'SYSBACKUP',
  'SYSDG',
  'SYSKM',
  'SYSRAC',
  'AUDSYS',
  'GGSYS',
]);

const SOURCE_OBJECT_TYPES = [
  'VIEW',
  'PACKAGE',
  'PACKAGE BODY',
  'PROCEDURE',
  'FUNCTION',
  'TRIGGER',
  'TYPE',
  'TYPE BODY',
] as const;

export type OracleMetadataCounters = {
  oracleMetadataConnectionsOpened: number;
  oracleMetadataSelectStatementsExecuted: number;
  businessSelectStatementsExecuted: number;
  businessRowsRead: number;
  dmlStatementsExecuted: number;
  ddlStatementsExecuted: number;
  plsqlBlocksExecuted: number;
  runtimeCopilotDependencies: number;
};

export function mapOracleObjectType(t: string): Stage2ObjectType {
  const u = t.toUpperCase().replace(/\s+/g, ' ');
  if (u === 'PACKAGE BODY') return 'PACKAGE_BODY';
  if (u === 'TYPE BODY') return 'TYPE_BODY';
  if (u === 'PACKAGE') return 'PACKAGE';
  if (u === 'VIEW') return 'VIEW';
  if (u === 'TRIGGER') return 'TRIGGER';
  if (u === 'FUNCTION') return 'FUNCTION';
  if (u === 'PROCEDURE') return 'PROCEDURE';
  if (u === 'TYPE') return 'TYPE';
  if (u === 'TABLE') return 'TABLE';
  if (u === 'SYNONYM') return 'SYNONYM';
  return 'other_source_object';
}

function buildInBinds(values: string[], prefix: string) {
  const binds: Record<string, string> = {};
  const placeholders = values.map((v, i) => {
    const k = `${prefix}${i}`;
    binds[k] = v;
    return `:${k}`;
  });
  return { binds, placeholders: placeholders.join(',') };
}

export class OracleMetadataSourceProvider implements OracleSourceProvider {
  readonly kind = 'oracle_metadata' as const;
  readonly counters: OracleMetadataCounters = {
    oracleMetadataConnectionsOpened: 0,
    oracleMetadataSelectStatementsExecuted: 0,
    businessSelectStatementsExecuted: 0,
    businessRowsRead: 0,
    dmlStatementsExecuted: 0,
    ddlStatementsExecuted: 0,
    plsqlBlocksExecuted: 0,
    runtimeCopilotDependencies: 0,
  };

  capabilities: OracleSourceProviderCapabilities = {
    provider: 'oracle_metadata',
    errors: [],
  };

  ownersDiscovered: string[] = [];
  ownersIndexed: string[] = [];
  ownersExcluded: string[] = [];
  inventory: OracleSourceInventoryObject[] = [];
  dependencies: OracleSourceDependency[] = [];
  arguments: OracleSourceArgument[] = [];
  /** owner|objectName → Stage2ObjectType, from ALL_OBJECTS (includes TABLE/SYNONYM, unlike `inventory`). */
  inventoryIndex: Map<string, Stage2ObjectType> = new Map();
  /** owner|synonym_name → table_owner/table_name, from ALL_SYNONYMS. */
  synonyms: Map<string, { owner: string; objectName: string }> = new Map();
  argumentScan = {
    argumentRowsAvailable: 0,
    argumentRowsRead: 0,
    argumentRowsPersisted: 0,
    argumentScanComplete: true,
  };
  inventoryCounts: Record<string, number> = {};

  private connection: OraConn | null = null;
  private closed = false;

  constructor(
    private readonly conn: OracleConnConfig,
    private readonly opts: {
      ownerFilter?: string[] | null;
      /** When set, only fetch these object names (acceptance / bounded runs). */
      objectNameAllowlist?: string[] | null;
      fetchArguments?: boolean;
      fetchDependencies?: boolean;
      maxSourceObjects?: number | null;
    } = {},
  ) {}

  private async ensureConnection(): Promise<void> {
    if (this.connection && !this.closed) return;
    this.connection = await oracledb.getConnection(this.conn);
    this.closed = false;
    this.counters.oracleMetadataConnectionsOpened += 1;
  }

  private async metaSelect<T extends Record<string, unknown>>(
    sql: string,
    binds: Record<string, unknown> = {},
    fetchInfo?: Record<string, { type: unknown }>,
  ): Promise<T[]> {
    await this.ensureConnection();
    this.counters.oracleMetadataSelectStatementsExecuted += 1;
    const options: { outFormat: number; fetchInfo?: Record<string, { type: unknown }> } = {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    };
    if (fetchInfo) options.fetchInfo = fetchInfo;
    try {
      const result = await this.connection!.execute(sql, binds, options);
      return (result.rows ?? []) as T[];
    } catch (e) {
      const msg = String(e);
      if (/NJS-500|NJS-501|ECONNRESET|DPI-1010|not connected/i.test(msg)) {
        try {
          await this.connection?.close();
        } catch {
          // ignore
        }
        this.connection = null;
        this.closed = true;
        await this.ensureConnection();
        this.counters.oracleMetadataSelectStatementsExecuted += 1;
        const result = await this.connection!.execute(sql, binds, options);
        return (result.rows ?? []) as T[];
      }
      throw e;
    }
  }

  async open(): Promise<void> {
    await this.ensureConnection();
  }

  async close(): Promise<void> {
    if (this.connection && !this.closed) {
      await this.connection.close();
      this.closed = true;
      this.connection = null;
    }
  }

  async listCapabilities(): Promise<OracleSourceProviderCapabilities> {
    const caps: OracleSourceProviderCapabilities = {
      provider: 'oracle_metadata',
      errors: [],
    };
    const probes: Array<[keyof OracleSourceProviderCapabilities, string]> = [
      ['allObjects', `SELECT 1 AS OK FROM all_objects WHERE ROWNUM = 1`],
      ['allSource', `SELECT 1 AS OK FROM all_source WHERE ROWNUM = 1`],
      ['allViews', `SELECT 1 AS OK FROM all_views WHERE ROWNUM = 1`],
      ['allTriggers', `SELECT 1 AS OK FROM all_triggers WHERE ROWNUM = 1`],
      ['allDependencies', `SELECT 1 AS OK FROM all_dependencies WHERE ROWNUM = 1`],
      ['allArguments', `SELECT 1 AS OK FROM all_arguments WHERE ROWNUM = 1`],
      ['allTabColumns', `SELECT 1 AS OK FROM all_tab_columns WHERE ROWNUM = 1`],
      ['allConstraints', `SELECT 1 AS OK FROM all_constraints WHERE ROWNUM = 1`],
      ['allSynonyms', `SELECT 1 AS OK FROM all_synonyms WHERE ROWNUM = 1`],
    ];
    for (const [key, sql] of probes) {
      try {
        await this.metaSelect(sql);
        (caps as Record<string, unknown>)[key] = true;
      } catch (e) {
        (caps as Record<string, unknown>)[key] = false;
        caps.errors!.push(`${String(key)}: ${String(e)}`);
      }
    }
    try {
      await this.metaSelect(
        `SELECT DBMS_METADATA.GET_DDL('VIEW', :name, :owner) AS DDL FROM dual`,
        { name: 'DUAL', owner: 'SYS' },
      );
      caps.dbmsMetadataGetDdl = true;
    } catch (e) {
      // DUAL may not be a view — try any real view from inventory later; mark unknown
      try {
        await this.metaSelect(`SELECT 1 AS OK FROM dual WHERE DBMS_METADATA.GET_DDL IS NOT NULL`);
        caps.dbmsMetadataGetDdl = false;
        caps.errors!.push(`dbmsMetadataGetDdl: ${String(e)}`);
      } catch (e2) {
        caps.dbmsMetadataGetDdl = false;
        caps.errors!.push(`dbmsMetadataGetDdl: ${String(e)}; ${String(e2)}`);
      }
    }
    this.capabilities = caps;
    return caps;
  }

  async discoverOwners(): Promise<void> {
    const filter = (this.opts.ownerFilter ?? [])
      .map((o) => o.trim().toUpperCase())
      .filter(Boolean);
    const rows = await this.metaSelect<{ OWNER: string; CNT: number }>(
      `SELECT owner AS "OWNER", COUNT(*) AS "CNT"
       FROM all_objects
       WHERE object_type IN ('VIEW','PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','TYPE','TYPE BODY','TABLE','SYNONYM')
       GROUP BY owner
       ORDER BY owner`,
    );
    const discovered = rows.map((r) => String(r.OWNER).toUpperCase());
    this.ownersDiscovered = discovered;
    this.ownersExcluded = discovered.filter((o) => SYSTEM_OWNERS.has(o));
    let indexed = discovered.filter((o) => !SYSTEM_OWNERS.has(o));
    if (filter.length) {
      indexed = indexed.filter((o) => filter.includes(o));
      // Always include filter owners even if empty inventory
      for (const f of filter) if (!indexed.includes(f)) indexed.push(f);
    }
    this.ownersIndexed = [...new Set(indexed)].sort();
  }

  async loadInventory(): Promise<OracleSourceInventoryObject[]> {
    if (!this.ownersIndexed.length) await this.discoverOwners();
    if (!this.ownersIndexed.length) return [];
    const { binds, placeholders } = buildInBinds(this.ownersIndexed, 'o');
    const rows = await this.metaSelect<{
      OWNER: string;
      OBJECT_NAME: string;
      OBJECT_TYPE: string;
      STATUS: string;
      CREATED: unknown;
      LAST_DDL_TIME: unknown;
    }>(
      `SELECT owner AS "OWNER",
              object_name AS "OBJECT_NAME",
              object_type AS "OBJECT_TYPE",
              status AS "STATUS",
              TO_CHAR(created, 'YYYY-MM-DD"T"HH24:MI:SS') AS "CREATED",
              TO_CHAR(last_ddl_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS "LAST_DDL_TIME"
       FROM all_objects
       WHERE owner IN (${placeholders})
         AND object_type IN ('VIEW','PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','TYPE','TYPE BODY')
       ORDER BY owner, object_type, object_name`,
      binds,
    );
    this.inventory = rows.map((r) => ({
      owner: String(r.OWNER),
      objectName: String(r.OBJECT_NAME),
      objectType: String(r.OBJECT_TYPE),
      status: r.STATUS != null ? String(r.STATUS) : null,
      created: r.CREATED != null ? String(r.CREATED) : null,
      lastDdlTime: r.LAST_DDL_TIME != null ? String(r.LAST_DDL_TIME) : null,
    }));
    const allow = this.opts.objectNameAllowlist?.map((n) => n.toUpperCase()) ?? null;
    if (allow?.length) {
      this.inventory = this.inventory.filter((o) => allow.includes(o.objectName.toUpperCase()));
    }
    if (this.opts.maxSourceObjects && this.inventory.length > this.opts.maxSourceObjects) {
      // Prefer keeping payroll view + AKT_DANE + diversity; otherwise truncate deterministically
      this.inventory = this.inventory.slice(0, this.opts.maxSourceObjects);
    }
    this.inventoryCounts = {};
    for (const o of this.inventory) {
      this.inventoryCounts[o.objectType] = (this.inventoryCounts[o.objectType] ?? 0) + 1;
    }
    return this.inventory;
  }

  /**
   * Broad ALL_OBJECTS scan (VIEW/TABLE/SYNONYM/PACKAGE/... for indexed owners),
   * used only for endpoint resolution — unlike `inventory`, TABLE and SYNONYM
   * have no PL/SQL source so they are never yielded by iterateSources().
   */
  async loadInventoryIndex(): Promise<Map<string, Stage2ObjectType>> {
    if (!this.ownersIndexed.length) await this.discoverOwners();
    if (!this.ownersIndexed.length) return this.inventoryIndex;
    const { binds, placeholders } = buildInBinds(this.ownersIndexed, 'o');
    const rows = await this.metaSelect<{
      OWNER: string;
      OBJECT_NAME: string;
      OBJECT_TYPE: string;
    }>(
      `SELECT owner AS "OWNER", object_name AS "OBJECT_NAME", object_type AS "OBJECT_TYPE"
       FROM all_objects
       WHERE owner IN (${placeholders})
         AND object_type IN ('VIEW','TABLE','SYNONYM','PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','TYPE','TYPE BODY')`,
      binds,
    );
    this.inventoryIndex = buildInventoryIndex(
      rows.map((r) => ({
        owner: String(r.OWNER),
        objectName: String(r.OBJECT_NAME),
        objectType: mapOracleObjectType(String(r.OBJECT_TYPE)),
      })),
    );
    return this.inventoryIndex;
  }

  async loadSynonyms(): Promise<Map<string, { owner: string; objectName: string }>> {
    this.synonyms = new Map();
    if (!this.capabilities.allSynonyms) return this.synonyms;
    if (!this.ownersIndexed.length) await this.discoverOwners();
    if (!this.ownersIndexed.length) return this.synonyms;
    const { binds, placeholders } = buildInBinds(this.ownersIndexed, 'o');
    try {
      const rows = await this.metaSelect<{
        OWNER: string;
        SYNONYM_NAME: string;
        TABLE_OWNER: string;
        TABLE_NAME: string;
      }>(
        `SELECT owner AS "OWNER",
                synonym_name AS "SYNONYM_NAME",
                table_owner AS "TABLE_OWNER",
                table_name AS "TABLE_NAME"
         FROM all_synonyms
         WHERE owner IN (${placeholders})`,
        binds,
      );
      for (const r of rows) {
        this.synonyms.set(`${String(r.OWNER)}|${String(r.SYNONYM_NAME)}`, {
          owner: String(r.TABLE_OWNER),
          objectName: String(r.TABLE_NAME),
        });
      }
    } catch (e) {
      this.capabilities.errors = [...(this.capabilities.errors ?? []), `allSynonyms: ${String(e)}`];
    }
    return this.synonyms;
  }

  async loadDependencies(): Promise<OracleSourceDependency[]> {
    if (this.opts.fetchDependencies === false) return [];
    if (!this.capabilities.allDependencies) return [];
    if (!this.ownersIndexed.length) return [];
    const { binds, placeholders } = buildInBinds(this.ownersIndexed, 'o');
    const rows = await this.metaSelect<{
      OWNER: string;
      NAME: string;
      TYPE: string;
      REFERENCED_OWNER: string;
      REFERENCED_NAME: string;
      REFERENCED_TYPE: string;
      DEPENDENCY_TYPE: string;
    }>(
      `SELECT owner AS "OWNER",
              name AS "NAME",
              type AS "TYPE",
              referenced_owner AS "REFERENCED_OWNER",
              referenced_name AS "REFERENCED_NAME",
              referenced_type AS "REFERENCED_TYPE",
              dependency_type AS "DEPENDENCY_TYPE"
       FROM all_dependencies
       WHERE owner IN (${placeholders})
       ORDER BY owner, name, type, referenced_owner, referenced_name`,
      binds,
    );
    this.dependencies = rows.map((r) => ({
      owner: String(r.OWNER),
      name: String(r.NAME),
      type: String(r.TYPE),
      referencedOwner: String(r.REFERENCED_OWNER),
      referencedName: String(r.REFERENCED_NAME),
      referencedType: String(r.REFERENCED_TYPE),
      dependencyType: r.DEPENDENCY_TYPE != null ? String(r.DEPENDENCY_TYPE) : null,
    }));
    return this.dependencies;
  }

  async loadArguments(): Promise<OracleSourceArgument[]> {
    if (this.opts.fetchArguments === false) {
      this.argumentScan = {
        argumentRowsAvailable: 0,
        argumentRowsRead: 0,
        argumentRowsPersisted: 0,
        argumentScanComplete: true,
      };
      return [];
    }
    if (!this.capabilities.allArguments) {
      this.argumentScan = {
        argumentRowsAvailable: 0,
        argumentRowsRead: 0,
        argumentRowsPersisted: 0,
        argumentScanComplete: false,
      };
      return [];
    }
    if (!this.ownersIndexed.length) return [];
    const { binds, placeholders } = buildInBinds(this.ownersIndexed, 'o');

    const countRows = await this.metaSelect<{ CNT: number }>(
      `SELECT COUNT(*) AS "CNT" FROM all_arguments WHERE owner IN (${placeholders})`,
      binds,
    );
    const available = Number(countRows[0]?.CNT ?? 0);
    const pageSize = Number(process.env.TETA_OSI_STAGE2_ARGUMENTS_PAGE_SIZE ?? 5000);
    const collected: OracleSourceArgument[] = [];
    let offset = 0;
    let complete = true;

    while (offset < available || (available === 0 && offset === 0)) {
      if (available === 0) break;
      try {
        const rows = await this.metaSelect<{
          OWNER: string;
          PACKAGE_NAME: string | null;
          OBJECT_NAME: string;
          OVERLOAD: number | null;
          POSITION: number | null;
          SEQUENCE: number | null;
          ARGUMENT_NAME: string | null;
          IN_OUT: string | null;
          DATA_TYPE: string | null;
          TYPE_OWNER: string | null;
          TYPE_NAME: string | null;
          SUBPROGRAM_ID: number | null;
        }>(
          `SELECT * FROM (
             SELECT owner AS "OWNER",
                    package_name AS "PACKAGE_NAME",
                    object_name AS "OBJECT_NAME",
                    overload AS "OVERLOAD",
                    position AS "POSITION",
                    sequence AS "SEQUENCE",
                    argument_name AS "ARGUMENT_NAME",
                    in_out AS "IN_OUT",
                    data_type AS "DATA_TYPE",
                    type_owner AS "TYPE_OWNER",
                    type_name AS "TYPE_NAME",
                    subprogram_id AS "SUBPROGRAM_ID",
                    ROW_NUMBER() OVER (
                      ORDER BY owner, package_name, object_name, subprogram_id, overload, position, sequence
                    ) rn
             FROM all_arguments
             WHERE owner IN (${placeholders})
           ) WHERE rn > :offsetStart AND rn <= :offsetEnd`,
          { ...binds, offsetStart: offset, offsetEnd: offset + pageSize },
        );
        if (!rows.length) break;
        for (const r of rows) {
          collected.push({
            owner: String(r.OWNER),
            packageName: r.PACKAGE_NAME != null ? String(r.PACKAGE_NAME) : null,
            objectName: String(r.OBJECT_NAME),
            overload: r.OVERLOAD != null ? Number(r.OVERLOAD) : null,
            position: r.POSITION != null ? Number(r.POSITION) : null,
            sequence: r.SEQUENCE != null ? Number(r.SEQUENCE) : null,
            subprogramId: r.SUBPROGRAM_ID != null ? Number(r.SUBPROGRAM_ID) : null,
            argumentName: r.ARGUMENT_NAME != null ? String(r.ARGUMENT_NAME) : null,
            inOut: r.IN_OUT != null ? String(r.IN_OUT) : null,
            dataType: r.DATA_TYPE != null ? String(r.DATA_TYPE) : null,
            typeOwner: r.TYPE_OWNER != null ? String(r.TYPE_OWNER) : null,
            typeName: r.TYPE_NAME != null ? String(r.TYPE_NAME) : null,
          });
        }
        offset += rows.length;
        // eslint-disable-next-line no-console
        console.error(`[osi:stage2] ALL_ARGUMENTS ${offset}/${available}`);
        if (rows.length < pageSize) break;
      } catch (e) {
        complete = false;
        this.capabilities.errors = [
          ...(this.capabilities.errors ?? []),
          `allArguments page@${offset}: ${String(e)}`,
        ];
        break;
      }
    }

    if (collected.length < available) complete = false;
    this.arguments = collected;
    this.argumentScan = {
      argumentRowsAvailable: available,
      argumentRowsRead: collected.length,
      argumentRowsPersisted: collected.length,
      argumentScanComplete: complete && collected.length === available,
    };
    return this.arguments;
  }

  private sourceCache = new Map<string, string>();
  private viewCache = new Map<string, { text: string; textLength: number }>();
  private triggerCache = new Map<
    string,
    {
      TRIGGER_NAME: string;
      TABLE_OWNER: string;
      TABLE_NAME: string;
      TRIGGER_TYPE: string;
      TRIGGERING_EVENT: string;
      WHEN_CLAUSE: string | null;
      STATUS: string;
      TRIGGER_BODY: string;
    }
  >();
  /** owner|TYPE|name → wrapped */
  private wrappedFlags = new Map<string, boolean>();

  private cacheKey(owner: string, type: string, name: string) {
    return `${owner}|${type}|${name}`;
  }

  /**
   * Efficient preload: views + triggers + wrapped classification.
   * Does NOT load full ALL_SOURCE for wrapped package bodies.
   */
  async preloadSources(): Promise<void> {
    if (!this.ownersIndexed.length) return;
    const { binds, placeholders } = buildInBinds(this.ownersIndexed, 'o');

    if (this.capabilities.allSource) {
      const wrapRows = await this.metaSelect<{
        OWNER: string;
        NAME: string;
        TYPE: string;
      }>(
        `SELECT owner AS "OWNER", name AS "NAME", type AS "TYPE"
         FROM all_source
         WHERE owner IN (${placeholders})
           AND type IN ('PACKAGE BODY','TYPE BODY','PROCEDURE','FUNCTION','PACKAGE','TYPE')
           AND line = 1
           AND UPPER(text) LIKE '%WRAPPED%'`,
        binds,
      );
      for (const r of wrapRows) {
        this.wrappedFlags.set(
          this.cacheKey(String(r.OWNER), String(r.TYPE), String(r.NAME)),
          true,
        );
      }
    }

    if (this.capabilities.allViews) {
      try {
        // LONG text requires explicit STRING fetch
        const rows = await this.metaSelect<{
          OWNER: string;
          VIEW_NAME: string;
          TEXT: string;
          TEXT_LENGTH: number;
        }>(
          `SELECT owner AS "OWNER", view_name AS "VIEW_NAME", text AS "TEXT", text_length AS "TEXT_LENGTH"
           FROM all_views
           WHERE owner IN (${placeholders})`,
          binds,
          { TEXT: { type: oracledb.STRING } },
        );
        for (const r of rows) {
          this.viewCache.set(`${r.OWNER}|${r.VIEW_NAME}`, {
            text: String(r.TEXT ?? ''),
            textLength: Number(r.TEXT_LENGTH) || 0,
          });
        }
      } catch (e) {
        this.capabilities.errors = [
          ...(this.capabilities.errors ?? []),
          `allViews preload: ${String(e)}`,
        ];
      }
    }

    if (this.capabilities.allTriggers) {
      try {
        const rows = await this.metaSelect<{
          OWNER: string;
          TRIGGER_NAME: string;
          TABLE_OWNER: string;
          TABLE_NAME: string;
          TRIGGER_TYPE: string;
          TRIGGERING_EVENT: string;
          WHEN_CLAUSE: string | null;
          STATUS: string;
          TRIGGER_BODY: string;
        }>(
          `SELECT owner AS "OWNER",
                  trigger_name AS "TRIGGER_NAME",
                  table_owner AS "TABLE_OWNER",
                  table_name AS "TABLE_NAME",
                  trigger_type AS "TRIGGER_TYPE",
                  triggering_event AS "TRIGGERING_EVENT",
                  when_clause AS "WHEN_CLAUSE",
                  status AS "STATUS",
                  trigger_body AS "TRIGGER_BODY"
           FROM all_triggers
           WHERE owner IN (${placeholders})`,
          binds,
        );
        for (const r of rows) {
          this.triggerCache.set(`${r.OWNER}|${r.TRIGGER_NAME}`, r);
        }
      } catch {
        // ignore
      }
    }

    // Bulk-load plaintext PL/SQL in name batches (avoids huge single-cursor disconnects)
    if (this.capabilities.allSource) {
      for (const plsqlType of [
        'PACKAGE',
        'PROCEDURE',
        'FUNCTION',
        'TYPE',
        'TYPE BODY',
        'PACKAGE BODY',
      ] as const) {
        const names = this.inventory
          .filter((o) => o.objectType.toUpperCase() === plsqlType)
          .map((o) => o.objectName)
          .filter((name) => !this.wrappedFlags.get(this.cacheKey(this.ownersIndexed[0]!, plsqlType, name)));
        // Filter wrapped per owner
        const byOwner = new Map<string, string[]>();
        for (const inv of this.inventory) {
          if (inv.objectType.toUpperCase() !== plsqlType) continue;
          if (this.wrappedFlags.get(this.cacheKey(inv.owner, plsqlType, inv.objectName))) continue;
          const list = byOwner.get(inv.owner) ?? [];
          list.push(inv.objectName);
          byOwner.set(inv.owner, list);
        }
        for (const [owner, allNames] of byOwner) {
          for (let i = 0; i < allNames.length; i += 80) {
            const chunk = allNames.slice(i, i + 80);
            const nb = buildInBinds(chunk, 'n');
            const rows = await this.metaSelect<{
              OWNER: string;
              NAME: string;
              TYPE: string;
              LINE: number;
              TEXT: string;
            }>(
              `SELECT owner AS "OWNER", name AS "NAME", type AS "TYPE", line AS "LINE", text AS "TEXT"
               FROM all_source
               WHERE owner = :owner AND type = :ptype AND name IN (${nb.placeholders})
               ORDER BY name, line`,
              { owner, ptype: plsqlType, ...nb.binds },
            );
            const buf = new Map<string, string[]>();
            for (const r of rows) {
              const k = this.cacheKey(String(r.OWNER), String(r.TYPE), String(r.NAME));
              const list = buf.get(k) ?? [];
              list.push(String(r.TEXT ?? ''));
              buf.set(k, list);
            }
            for (const [k, lines] of buf) this.sourceCache.set(k, lines.join(''));
            if ((i / 80) % 10 === 0) {
              // eslint-disable-next-line no-console
              console.error(
                `[osi:stage2] preload ${plsqlType} ${owner}: ${Math.min(i + 80, allNames.length)}/${allNames.length}`,
              );
            }
          }
        }
        void names;
      }
    }
  }

  /**
   * Always fetches the complete, ordered ALL_SOURCE rows (owner,name,type,line,text)
   * and joins them in line order. When the joined text is wrapped, the REAL wrapped
   * payload is kept as-is (sourceText) so defaultUnwrapProvider can actually unwrap
   * it — this must never be replaced by a synthetic "... wrapped" marker string.
   * sourceComplete reflects whether any ALL_SOURCE lines were retrieved at all.
   */
  private async fetchPlsqlSource(
    owner: string,
    name: string,
    type: string,
  ): Promise<{ text: string; complete: boolean; method: string; status: Stage2NormalizedSource['sourceStatus'] }> {
    if (!this.capabilities.allSource) {
      return { text: '', complete: false, method: 'all_source_inaccessible', status: 'inaccessible' };
    }
    const key = this.cacheKey(owner, type, name);
    const cached = this.sourceCache.get(key);
    if (cached !== undefined) {
      if (!cached.trim()) {
        return { text: '', complete: false, method: 'all_source_empty', status: 'empty' };
      }
      const wrapped = isOracleWrappedPlsql(cached);
      return {
        text: cached,
        complete: true,
        method: 'ALL_SOURCE',
        status: wrapped ? 'wrapped' : 'available_plaintext',
      };
    }
    const rows = await this.metaSelect<{ LINE: number; TEXT: string }>(
      `SELECT line AS "LINE", text AS "TEXT"
       FROM all_source
       WHERE owner = :owner AND name = :name AND type = :type
       ORDER BY line`,
      { owner, name, type },
    );
    if (!rows.length) {
      return { text: '', complete: false, method: 'all_source_empty', status: 'empty' };
    }
    const text = rows.map((r) => String(r.TEXT ?? '')).join('');
    if (!text.trim()) {
      return { text: '', complete: false, method: 'all_source_empty', status: 'empty' };
    }
    const wrapped = isOracleWrappedPlsql(text);
    if (wrapped) this.wrappedFlags.set(key, true);
    return {
      text,
      complete: true,
      method: 'ALL_SOURCE',
      status: wrapped ? 'wrapped' : 'available_plaintext',
    };
  }

  private async fetchViewSource(
    owner: string,
    name: string,
  ): Promise<{ text: string; complete: boolean; method: string; status: Stage2NormalizedSource['sourceStatus'] }> {
    const cached = this.viewCache.get(`${owner}|${name}`);
    if (cached) {
      const text = cached.text;
      const declaredLen = cached.textLength;
      const truncated =
        (declaredLen > 0 && text.length + 50 < declaredLen) ||
        (declaredLen > 4000 && text.length <= 4000);
      if (!truncated && text.trim()) {
        return {
          text: `CREATE OR REPLACE VIEW ${owner}.${name} AS\n${text}`,
          complete: true,
          method: 'ALL_VIEWS.TEXT',
          status: 'available_plaintext',
        };
      }
      if (this.capabilities.dbmsMetadataGetDdl) {
        try {
          const ddlRows = await this.metaSelect<{ DDL: string }>(
            `SELECT DBMS_METADATA.GET_DDL('VIEW', :name, :owner) AS "DDL" FROM dual`,
            { name, owner },
          );
          const ddl = String(ddlRows[0]?.DDL ?? '');
          if (ddl.trim()) {
            return {
              text: ddl,
              complete: true,
              method: 'DBMS_METADATA.GET_DDL',
              status: 'available_plaintext',
            };
          }
        } catch {
          // fall through
        }
      }
      if (text.trim()) {
        return {
          text: `CREATE OR REPLACE VIEW ${owner}.${name} AS\n${text}`,
          complete: false,
          method: 'ALL_VIEWS.TEXT_PARTIAL',
          status: 'partial',
        };
      }
    }
    if (this.capabilities.allViews) {
      try {
        const rows = await this.metaSelect<{ TEXT: string; TEXT_LENGTH: number }>(
          `SELECT text AS "TEXT", text_length AS "TEXT_LENGTH"
           FROM all_views
           WHERE owner = :owner AND view_name = :name`,
          { owner, name },
        );
        const row = rows[0];
        if (row) {
          const text = String(row.TEXT ?? '');
          const declaredLen = Number(row.TEXT_LENGTH) || 0;
          const truncated =
            (declaredLen > 0 && text.length + 50 < declaredLen) ||
            (declaredLen > 4000 && text.length <= 4000);
          if (!truncated && text.trim()) {
            return {
              text: `CREATE OR REPLACE VIEW ${owner}.${name} AS\n${text}`,
              complete: true,
              method: 'ALL_VIEWS.TEXT',
              status: 'available_plaintext',
            };
          }
          if (this.capabilities.dbmsMetadataGetDdl) {
            const ddlRows = await this.metaSelect<{ DDL: string }>(
              `SELECT DBMS_METADATA.GET_DDL('VIEW', :name, :owner) AS "DDL" FROM dual`,
              { name, owner },
            );
            const ddl = String(ddlRows[0]?.DDL ?? '');
            if (ddl.trim()) {
              return {
                text: ddl,
                complete: true,
                method: 'DBMS_METADATA.GET_DDL',
                status: 'available_plaintext',
              };
            }
          }
          if (text.trim()) {
            return {
              text: `CREATE OR REPLACE VIEW ${owner}.${name} AS\n${text}`,
              complete: false,
              method: 'ALL_VIEWS.TEXT_PARTIAL',
              status: 'partial',
            };
          }
        }
      } catch {
        // fall through
      }
    }
    if (this.capabilities.dbmsMetadataGetDdl) {
      try {
        const ddlRows = await this.metaSelect<{ DDL: string }>(
          `SELECT DBMS_METADATA.GET_DDL('VIEW', :name, :owner) AS "DDL" FROM dual`,
          { name, owner },
        );
        const ddl = String(ddlRows[0]?.DDL ?? '');
        if (ddl.trim()) {
          return {
            text: ddl,
            complete: true,
            method: 'DBMS_METADATA.GET_DDL',
            status: 'available_plaintext',
          };
        }
      } catch {
        // ignore
      }
    }
    return { text: '', complete: false, method: 'view_inaccessible', status: 'inaccessible' };
  }

  private async fetchTriggerSource(
    owner: string,
    name: string,
  ): Promise<{
    text: string;
    complete: boolean;
    method: string;
    status: Stage2NormalizedSource['sourceStatus'];
    metadata: Record<string, unknown>;
  }> {
    if (!this.capabilities.allTriggers) {
      return {
        text: '',
        complete: false,
        method: 'all_triggers_inaccessible',
        status: 'inaccessible',
        metadata: {},
      };
    }
    const row =
      this.triggerCache.get(`${owner}|${name}`) ??
      (
        await this.metaSelect<{
          TRIGGER_NAME: string;
          TABLE_OWNER: string;
          TABLE_NAME: string;
          TRIGGER_TYPE: string;
          TRIGGERING_EVENT: string;
          WHEN_CLAUSE: string | null;
          STATUS: string;
          TRIGGER_BODY: string;
        }>(
          `SELECT trigger_name AS "TRIGGER_NAME",
              table_owner AS "TABLE_OWNER",
              table_name AS "TABLE_NAME",
              trigger_type AS "TRIGGER_TYPE",
              triggering_event AS "TRIGGERING_EVENT",
              when_clause AS "WHEN_CLAUSE",
              status AS "STATUS",
              trigger_body AS "TRIGGER_BODY"
           FROM all_triggers
           WHERE owner = :owner AND trigger_name = :name`,
          { owner, name },
        )
      )[0];
    if (!row) {
      return { text: '', complete: false, method: 'all_triggers_empty', status: 'empty', metadata: {} };
    }
    const body = String(row.TRIGGER_BODY ?? '');
    const timing = String(row.TRIGGER_TYPE ?? '');
    const events = String(row.TRIGGERING_EVENT ?? '');
    const tableOwner = String(row.TABLE_OWNER ?? owner);
    const tableName = String(row.TABLE_NAME ?? '');
    const header = `CREATE OR REPLACE TRIGGER ${owner}.${name}\n${timing} ${events} ON ${tableOwner}.${tableName}\n`;
    const text = `${header}${body}`;
    return {
      text,
      complete: Boolean(body.trim()),
      method: 'ALL_TRIGGERS',
      status: body.trim() ? 'available_plaintext' : 'empty',
      metadata: {
        tableOwner,
        tableName,
        triggerType: timing,
        triggeringEvent: events,
        whenClause: row.WHEN_CLAUSE,
        status: row.STATUS,
      },
    };
  }

  private toNormalized(
    inv: OracleSourceInventoryObject,
    fetched: {
      text: string;
      complete: boolean;
      method: string;
      status: Stage2NormalizedSource['sourceStatus'];
      metadata?: Record<string, unknown>;
    },
  ): Stage2NormalizedSource {
    const objectType = mapOracleObjectType(inv.objectType);
    const sourceHash = sha256(fetched.text);
    const wrapped =
      fetched.status === 'wrapped' ||
      (fetched.text.trim().length > 0 &&
        objectType !== 'VIEW' &&
        isOracleWrappedPlsql(fetched.text));

    let sourceStatus = fetched.status;
    let sourceRepresentation: Stage2NormalizedSource['sourceRepresentation'] = 'plaintext';
    let parserInputText = fetched.text;
    let parserInputRepresentation: Stage2NormalizedSource['parserInputRepresentation'] = 'plaintext';
    let unwrapResult: Stage2NormalizedSource['unwrap'] = {
      status: 'not_wrapped',
      toolVersion: defaultUnwrapProvider.toolVersion,
      diagnostics: [],
    };

    if (!fetched.text.trim()) {
      sourceRepresentation = fetched.status === 'inaccessible' ? 'inaccessible' : 'empty';
      parserInputText = '';
      parserInputRepresentation = 'none';
    } else if (wrapped) {
      sourceRepresentation = 'oracle_wrapped';
      sourceStatus = 'wrapped';
      const u = defaultUnwrapProvider.unwrap({
        owner: inv.owner,
        objectName: inv.objectName,
        objectType,
        wrappedSourceText: fetched.text,
        wrappedSourceHash: sourceHash,
      });
      unwrapResult = {
        status: u.status,
        toolVersion: u.toolVersion,
        unwrappedSourceHash: u.unwrappedSourceHash,
        diagnostics: u.diagnostics,
      };
      if (u.status === 'unwrapped' && u.unwrappedSourceText) {
        parserInputText = u.unwrappedSourceText;
        parserInputRepresentation = 'unwrapped_plaintext';
        sourceStatus = 'unwrapped_plaintext';
      } else {
        parserInputText = '';
        parserInputRepresentation = 'none';
      }
    } else if (!fetched.complete) {
      sourceRepresentation = 'partial';
      sourceStatus = 'partial';
    }

    return {
      owner: inv.owner,
      objectName: inv.objectName,
      objectType,
      sourceText: fetched.text,
      sourceLines: null,
      sourceOrigin: 'oracle_metadata',
      sourceHash,
      sourceComplete: fetched.complete && sourceStatus !== 'partial',
      sourceStatus,
      sourceRepresentation,
      sourcePath: `oracle://${inv.owner}/${inv.objectType}/${inv.objectName}`,
      sourceAcquisitionMethod: fetched.method,
      sourceLength: Buffer.byteLength(fetched.text, 'utf8'),
      metadata: {
        oracleObjectType: inv.objectType,
        status: inv.status,
        created: inv.created,
        lastDdlTime: inv.lastDdlTime,
        ...(fetched.metadata ?? {}),
      },
      parserInputText,
      parserInputRepresentation,
      unwrap: unwrapResult,
    };
  }

  async *iterateSources(): AsyncIterable<Stage2NormalizedSource> {
    if (!this.inventory.length) await this.loadInventory();
    if (this.viewCache.size === 0 && this.wrappedFlags.size === 0 && this.sourceCache.size === 0) {
      await this.preloadSources();
    }
    for (const inv of this.inventory) {
      const ot = inv.objectType.toUpperCase();
      try {
        if (ot === 'VIEW') {
          yield this.toNormalized(inv, await this.fetchViewSource(inv.owner, inv.objectName));
        } else if (ot === 'TRIGGER') {
          yield this.toNormalized(inv, await this.fetchTriggerSource(inv.owner, inv.objectName));
        } else if (SOURCE_OBJECT_TYPES.includes(ot as (typeof SOURCE_OBJECT_TYPES)[number])) {
          yield this.toNormalized(
            inv,
            await this.fetchPlsqlSource(inv.owner, inv.objectName, ot),
          );
        }
      } catch (e) {
        yield this.toNormalized(inv, {
          text: '',
          complete: false,
          method: `error:${String(e)}`,
          status: 'inaccessible',
        });
      }
    }
  }

  listInventory(): OracleSourceInventoryObject[] {
    return this.inventory;
  }

  listDependencies(): OracleSourceDependency[] {
    return this.dependencies;
  }

  listArguments(): OracleSourceArgument[] {
    return this.arguments;
  }
}
