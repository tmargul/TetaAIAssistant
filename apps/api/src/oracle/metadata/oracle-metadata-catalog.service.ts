import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle-driver';
import { OracleConnectionService } from '../oracle-connection.service';
import { getOracleBackendMode } from '../oracle-mode';
import type {
  OracleMetadataCatalogTotals,
} from '@teta/shared';
import type {
  OracleColumnMeta,
  OracleCommentMeta,
  OracleConstraintMeta,
  OracleMetadataCatalogSnapshot,
  OracleMetadataFetchResult,
  OracleNamedObjectMeta,
  OracleSourceLineMeta,
  OracleTableMeta,
} from './oracle-metadata.types';

const SYSTEM_OWNERS = new Set([
  'SYS',
  'SYSTEM',
  'XDB',
  'MDSYS',
  'ORDSYS',
  'CTXSYS',
  'WMSYS',
  'OLAPSYS',
  'ORDDATA',
  'LBACSYS',
  'DVSYS',
  'AUDSYS',
  'GSMADMIN_INTERNAL',
  'OJVMSYS',
  'OUTLN',
  'DBSNMP',
  'APPQOSSYS',
]);

type TableRow = {
  OWNER: string;
  TABLE_NAME: string;
};

type ColumnRow = {
  OWNER: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  NULLABLE: string;
};

type ViewRow = {
  OWNER: string;
  VIEW_NAME: string;
};

type ObjectRow = {
  OWNER: string;
  OBJECT_NAME: string;
  OBJECT_TYPE: string;
  STATUS: string | null;
};

type ConstraintRow = {
  OWNER: string;
  TABLE_NAME: string;
  CONSTRAINT_NAME: string;
  CONSTRAINT_TYPE: string;
  COLUMN_NAME: string;
  POSITION: number;
  R_OWNER: string | null;
  R_TABLE_NAME: string | null;
  R_COLUMN_NAME: string | null;
};

type CommentRow = {
  OWNER: string;
  TABLE_NAME: string;
  COLUMN_NAME: string | null;
  COMMENTS: string | null;
};

type SourceRow = {
  OWNER: string;
  NAME: string;
  TYPE: string;
  LINE: number;
  TEXT: string | null;
};

type VersionRow = {
  BANNER: string;
};

@Injectable()
export class OracleMetadataCatalogService {
  private readonly logger = new Logger(OracleMetadataCatalogService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly oracleConnection: OracleConnectionService,
  ) {}

  async fetchCatalog(onProgress?: (message: string) => void): Promise<OracleMetadataFetchResult> {
    if (getOracleBackendMode(this.config) === 'fake') {
      onProgress?.('Symulator — wczytywanie przykładowego katalogu…');
      const catalog = this.buildFakeCatalog();
      const catalogTotals = this.snapshotToTotals(catalog);
      return { catalog, catalogTotals };
    }

    const stored = this.oracleConnection.getStoredConfigWithPassword();
    if (!stored?.password) {
      throw new Error('Połączenie Oracle nie jest skonfigurowane.');
    }

    const connectString = this.oracleConnection.buildConnectString(stored);
    const databaseLabel = this.resolveDatabaseLabel(stored);
    const ownerFilter = this.resolveOwnerFilter(stored.username);

    onProgress?.('Łączenie z Oracle i odczyt katalogu…');

    return this.withConnection(stored.username, stored.password, connectString, async (connection) => {
      const tetaVersion = await this.fetchDatabaseVersion(connection);
      const owners = await this.fetchOwners(connection, ownerFilter, stored.username);
      onProgress?.(`Właściciele schematów: ${owners.length} — zliczanie obiektów…`);

      const catalogTotals = await this.fetchDatabaseTotals(connection, owners);
      onProgress?.(
        `W katalogu: ${catalogTotals.tables} tabel, ${catalogTotals.views} widoków — import wszystkich obiektów…`,
      );

      const tables = await this.fetchTables(connection, owners);
      onProgress?.(`Tabele: ${tables.length} — kolumny…`);

      const tablesWithColumns = await this.attachColumns(connection, tables, owners);
      onProgress?.(`Kolumny: ${tablesWithColumns.reduce((sum, table) => sum + table.columns.length, 0)} — widoki…`);

      const views = await this.fetchViews(connection, owners);
      onProgress?.(`Widoki: ${views.length} — obiekty PL/SQL…`);

      const plsql = await this.fetchPlsqlObjects(connection, owners);
      onProgress?.(`Obiekty PL/SQL: ${plsql.packages.length} pakietów — ograniczenia…`);

      const constraints = await this.fetchConstraints(connection, owners);
      onProgress?.(`Ograniczenia: ${constraints.length} — komentarze…`);

      const comments = await this.fetchComments(connection, owners);
      onProgress?.(`Komentarze: ${comments.length} — źródła pakietów…`);

      const sources = await this.fetchSources(connection, owners, onProgress);
      onProgress?.('Katalog Oracle odczytany.');

      const catalog: OracleMetadataCatalogSnapshot = {
        owners,
        tables: tablesWithColumns,
        views,
        packages: plsql.packages,
        procedures: plsql.procedures,
        functions: plsql.functions,
        constraints,
        comments,
        sources,
        tetaVersion,
        pilotModule: this.config.get<string>('TETA_ORACLE_METADATA_PILOT_MODULE')?.trim() || null,
        databaseLabel,
      };

      return { catalog, catalogTotals };
    });
  }

  private snapshotToTotals(catalog: OracleMetadataCatalogSnapshot): OracleMetadataCatalogTotals {
    return {
      tables: catalog.tables.length,
      views: catalog.views.length,
      columns: catalog.tables.reduce((sum, table) => sum + table.columns.length, 0),
      packages: catalog.packages.length,
      procedures: catalog.procedures.length,
      functions: catalog.functions.length,
    };
  }

  private async fetchDatabaseTotals(
    connection: import('oracledb').Connection,
    owners: string[],
  ): Promise<OracleMetadataCatalogTotals> {
    if (owners.length === 0) {
      return {
        tables: 0,
        views: 0,
        columns: 0,
        packages: 0,
        procedures: 0,
        functions: 0,
      };
    }

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const placeholders = ownerBinds.placeholders;
    const binds = ownerBinds.binds;

    const [tableCount, viewCount, columnCount, objectCounts] = await Promise.all([
      this.fetchScalarCount(
        connection,
        `SELECT COUNT(*) AS "CNT" FROM all_tables WHERE owner IN (${placeholders})`,
        binds,
      ),
      this.fetchScalarCount(
        connection,
        `SELECT COUNT(*) AS "CNT" FROM all_views WHERE owner IN (${placeholders})`,
        binds,
      ),
      this.fetchScalarCount(
        connection,
        `SELECT COUNT(*) AS "CNT" FROM all_tab_columns WHERE owner IN (${placeholders})`,
        binds,
      ),
      connection.execute<{ OBJECT_TYPE: string; CNT: number }>(
        `SELECT object_type AS "OBJECT_TYPE", COUNT(*) AS "CNT"
         FROM all_objects
         WHERE owner IN (${placeholders})
           AND object_type IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')
           AND generated = 'N'
         GROUP BY object_type`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ),
    ]);

    const plsqlByType = new Map<string, number>();
    for (const row of objectCounts.rows ?? []) {
      plsqlByType.set(row.OBJECT_TYPE, Number(row.CNT) || 0);
    }

    return {
      tables: tableCount,
      views: viewCount,
      columns: columnCount,
      packages: plsqlByType.get('PACKAGE') ?? 0,
      procedures: plsqlByType.get('PROCEDURE') ?? 0,
      functions: plsqlByType.get('FUNCTION') ?? 0,
    };
  }

  private async fetchScalarCount(
    connection: import('oracledb').Connection,
    sql: string,
    binds: Record<string, string>,
  ): Promise<number> {
    const result = await connection.execute<{ CNT: number }>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return Number(result.rows?.[0]?.CNT) || 0;
  }

  private resolveDatabaseLabel(config: { identifier?: string; tnsAlias?: string }): string {
    const identifier = config.identifier?.trim();
    if (identifier) return identifier.toUpperCase();
    const alias = config.tnsAlias?.trim();
    if (alias) return alias.toUpperCase();
    return 'ORACLE';
  }

  private resolveOwnerFilter(_connectionUsername: string): string[] | null {
    const raw = this.config.get<string>('TETA_ORACLE_METADATA_OWNERS')?.trim();
    if (!raw) return null;
    return raw
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
  }

  private async fetchDatabaseVersion(
    connection: import('oracledb').Connection,
  ): Promise<string | null> {
    try {
      const result = await connection.execute<VersionRow>(
        `SELECT banner AS "BANNER" FROM v$version WHERE banner LIKE 'Oracle%' AND ROWNUM = 1`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows?.[0]?.BANNER ?? null;
    } catch (err) {
      this.logger.warn(`Nie udało się odczytać wersji Oracle: ${String(err)}`);
      return null;
    }
  }

  private async fetchOwners(
    connection: import('oracledb').Connection,
    ownerFilter: string[] | null,
    connectionUsername: string,
  ): Promise<string[]> {
    if (ownerFilter && ownerFilter.length > 0) {
      return [...ownerFilter].sort();
    }

    const result = await connection.execute<{ OWNER: string }>(
      `SELECT DISTINCT owner AS "OWNER"
       FROM all_tables
       WHERE owner NOT IN (${this.systemOwnerPlaceholders()})
       ORDER BY owner`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const owners = (result.rows ?? []).map((row) => row.OWNER).filter(Boolean);
    if (owners.length > 0) {
      return owners;
    }

    return [connectionUsername.trim().toUpperCase()];
  }

  private async fetchTables(
    connection: import('oracledb').Connection,
    owners: string[],
  ): Promise<OracleTableMeta[]> {
    if (owners.length === 0) return [];

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const result = await connection.execute<TableRow>(
      `SELECT owner AS "OWNER", table_name AS "TABLE_NAME"
       FROM all_tables
       WHERE owner IN (${ownerBinds.placeholders})
       ORDER BY owner, table_name`,
      ownerBinds.binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return (result.rows ?? []).map((row) => ({
      owner: row.OWNER,
      name: row.TABLE_NAME,
      columns: [],
    }));
  }

  private async attachColumns(
    connection: import('oracledb').Connection,
    tables: OracleTableMeta[],
    owners: string[],
  ): Promise<OracleTableMeta[]> {
    if (tables.length === 0 || owners.length === 0) return tables;

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const result = await connection.execute<ColumnRow>(
      `SELECT owner AS "OWNER",
              table_name AS "TABLE_NAME",
              column_name AS "COLUMN_NAME",
              data_type AS "DATA_TYPE",
              nullable AS "NULLABLE"
       FROM all_tab_columns
       WHERE owner IN (${ownerBinds.placeholders})
       ORDER BY owner, table_name, column_id`,
      ownerBinds.binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const tableKey = (owner: string, name: string) => `${owner}\0${name}`;
    const allowed = new Set(tables.map((table) => tableKey(table.owner, table.name)));
    const columnsByTable = new Map<string, OracleColumnMeta[]>();

    for (const row of result.rows ?? []) {
      const key = tableKey(row.OWNER, row.TABLE_NAME);
      if (!allowed.has(key)) continue;
      const list = columnsByTable.get(key) ?? [];
      list.push({
        name: row.COLUMN_NAME,
        dataType: row.DATA_TYPE,
        nullable: row.NULLABLE === 'Y',
      });
      columnsByTable.set(key, list);
    }

    return tables.map((table) => ({
      ...table,
      columns: columnsByTable.get(tableKey(table.owner, table.name)) ?? [],
    }));
  }

  private async fetchViews(
    connection: import('oracledb').Connection,
    owners: string[],
  ): Promise<OracleNamedObjectMeta[]> {
    if (owners.length === 0) return [];

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const result = await connection.execute<ViewRow>(
      `SELECT owner AS "OWNER", view_name AS "VIEW_NAME"
       FROM all_views
       WHERE owner IN (${ownerBinds.placeholders})
       ORDER BY owner, view_name`,
      ownerBinds.binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return (result.rows ?? []).map((row) => ({
      owner: row.OWNER,
      name: row.VIEW_NAME,
      objectType: 'VIEW',
    }));
  }

  private async fetchPlsqlObjects(
    connection: import('oracledb').Connection,
    owners: string[],
  ): Promise<{
    packages: OracleNamedObjectMeta[];
    procedures: OracleNamedObjectMeta[];
    functions: OracleNamedObjectMeta[];
  }> {
    if (owners.length === 0) {
      return { packages: [], procedures: [], functions: [] };
    }

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const result = await connection.execute<ObjectRow>(
      `SELECT owner AS "OWNER",
              object_name AS "OBJECT_NAME",
              object_type AS "OBJECT_TYPE",
              status AS "STATUS"
       FROM all_objects
       WHERE owner IN (${ownerBinds.placeholders})
         AND object_type IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')
         AND generated = 'N'
       ORDER BY owner, object_type, object_name`,
      ownerBinds.binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const packages: OracleNamedObjectMeta[] = [];
    const procedures: OracleNamedObjectMeta[] = [];
    const functions: OracleNamedObjectMeta[] = [];

    for (const row of result.rows ?? []) {
      const item: OracleNamedObjectMeta = {
        owner: row.OWNER,
        name: row.OBJECT_NAME,
        objectType: row.OBJECT_TYPE,
        status: row.STATUS ?? undefined,
      };

      if (row.OBJECT_TYPE === 'PACKAGE') {
        packages.push(item);
      } else if (row.OBJECT_TYPE === 'PROCEDURE') {
        procedures.push(item);
      } else if (row.OBJECT_TYPE === 'FUNCTION') {
        functions.push(item);
      }
    }

    return { packages, procedures, functions };
  }

  private async fetchConstraints(
    connection: import('oracledb').Connection,
    owners: string[],
  ): Promise<OracleConstraintMeta[]> {
    if (owners.length === 0) return [];

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const result = await connection.execute<ConstraintRow>(
      `SELECT ac.owner AS "OWNER",
              ac.table_name AS "TABLE_NAME",
              ac.constraint_name AS "CONSTRAINT_NAME",
              ac.constraint_type AS "CONSTRAINT_TYPE",
              acc.column_name AS "COLUMN_NAME",
              acc.position AS "POSITION",
              ac.r_owner AS "R_OWNER",
              ac.r_table_name AS "R_TABLE_NAME",
              acc_ref.column_name AS "R_COLUMN_NAME"
       FROM all_constraints ac
       JOIN all_cons_columns acc
         ON ac.owner = acc.owner
        AND ac.constraint_name = acc.constraint_name
       LEFT JOIN all_cons_columns acc_ref
         ON ac.r_owner = acc_ref.owner
        AND ac.r_constraint_name = acc_ref.constraint_name
        AND acc.position = acc_ref.position
       WHERE ac.owner IN (${ownerBinds.placeholders})
         AND ac.constraint_type IN ('P', 'R', 'U', 'C')
       ORDER BY ac.owner, ac.table_name, ac.constraint_name, acc.position`,
      ownerBinds.binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const items: OracleConstraintMeta[] = [];
    for (const row of result.rows ?? []) {
      const type = row.CONSTRAINT_TYPE as OracleConstraintMeta['constraintType'];
      if (!['P', 'R', 'U', 'C'].includes(type)) continue;
      items.push({
        owner: row.OWNER,
        tableName: row.TABLE_NAME,
        constraintName: row.CONSTRAINT_NAME,
        constraintType: type,
        columnName: row.COLUMN_NAME,
        position: Number(row.POSITION) || 1,
        refOwner: row.R_OWNER ?? undefined,
        refTableName: row.R_TABLE_NAME ?? undefined,
        refColumnName: row.R_COLUMN_NAME ?? undefined,
      });
    }
    return items;
  }

  private async fetchComments(
    connection: import('oracledb').Connection,
    owners: string[],
  ): Promise<OracleCommentMeta[]> {
    if (owners.length === 0) return [];

    const ownerBinds = this.buildInBinds(owners, 'owner');
    const [tableComments, columnComments] = await Promise.all([
      connection.execute<CommentRow>(
        `SELECT owner AS "OWNER",
                table_name AS "TABLE_NAME",
                NULL AS "COLUMN_NAME",
                comments AS "COMMENTS"
         FROM all_tab_comments
         WHERE owner IN (${ownerBinds.placeholders})
           AND comments IS NOT NULL`,
        ownerBinds.binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ),
      connection.execute<CommentRow>(
        `SELECT owner AS "OWNER",
                table_name AS "TABLE_NAME",
                column_name AS "COLUMN_NAME",
                comments AS "COMMENTS"
         FROM all_col_comments
         WHERE owner IN (${ownerBinds.placeholders})
           AND comments IS NOT NULL`,
        ownerBinds.binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ),
    ]);

    const items: OracleCommentMeta[] = [];
    for (const row of [...(tableComments.rows ?? []), ...(columnComments.rows ?? [])]) {
      if (!row.COMMENTS?.trim()) continue;
      items.push({
        owner: row.OWNER,
        tableName: row.TABLE_NAME,
        columnName: row.COLUMN_NAME,
        comments: row.COMMENTS.trim(),
      });
    }
    return items;
  }

  private async fetchSources(
    connection: import('oracledb').Connection,
    owners: string[],
    onProgress?: (message: string) => void,
  ): Promise<OracleSourceLineMeta[]> {
    if (owners.length === 0) return [];

    const maxLines = Number(this.config.get('TETA_ORACLE_SOURCE_MAX_LINES', 50_000));
    const ownerBinds = this.buildInBinds(owners, 'owner');
    const result = await connection.execute<SourceRow>(
      `SELECT owner AS "OWNER",
              name AS "NAME",
              type AS "TYPE",
              line AS "LINE",
              text AS "TEXT"
       FROM all_source
       WHERE owner IN (${ownerBinds.placeholders})
         AND type IN ('PACKAGE', 'PACKAGE BODY', 'PROCEDURE', 'FUNCTION', 'TRIGGER')
       ORDER BY owner, name, type, line`,
      ownerBinds.binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const items: OracleSourceLineMeta[] = [];
    for (const row of result.rows ?? []) {
      if (items.length >= maxLines) {
        onProgress?.(`Źródła PL/SQL: osiągnięto limit ${maxLines} linii — reszta pominięta.`);
        break;
      }
      items.push({
        owner: row.OWNER,
        name: row.NAME,
        objectType: row.TYPE,
        line: Number(row.LINE) || 0,
        text: row.TEXT ?? '',
      });
    }
    return items;
  }

  private buildFakeCatalog(): OracleMetadataCatalogSnapshot {
    const tables: OracleTableMeta[] = [
      {
        owner: 'TETA',
        name: 'PRACOWNICY',
        columns: [
          { name: 'ID', dataType: 'NUMBER', nullable: false },
          { name: 'NAZWISKO', dataType: 'VARCHAR2', nullable: false },
          { name: 'IMIE', dataType: 'VARCHAR2', nullable: true },
          { name: 'DATA_ZATRUDNIENIA', dataType: 'DATE', nullable: true },
        ],
      },
      {
        owner: 'TETA',
        name: 'T_PRAC',
        columns: [
          { name: 'PRAC_ID', dataType: 'NUMBER', nullable: false },
          { name: 'NAZWISKO', dataType: 'VARCHAR2', nullable: false },
          { name: 'IMIE', dataType: 'VARCHAR2', nullable: true },
        ],
      },
      {
        owner: 'TETA',
        name: 'STANOWISKA',
        columns: [
          { name: 'ID', dataType: 'NUMBER', nullable: false },
          { name: 'NAZWA', dataType: 'VARCHAR2', nullable: false },
        ],
      },
      {
        owner: 'TETA',
        name: 'DATASET_CFG',
        columns: [
          { name: 'DATASET_ID', dataType: 'NUMBER', nullable: false },
          { name: 'NAZWA', dataType: 'VARCHAR2', nullable: false },
          { name: 'MODUL', dataType: 'VARCHAR2', nullable: true },
        ],
      },
      {
        owner: 'HR',
        name: 'ABSENCJE',
        columns: [
          { name: 'PRACOWNIK_ID', dataType: 'NUMBER', nullable: false },
          { name: 'DATA_OD', dataType: 'DATE', nullable: false },
          { name: 'DATA_DO', dataType: 'DATE', nullable: true },
        ],
      },
      {
        owner: 'TETA',
        name: 'L_BADANIA_BHP',
        columns: [
          { name: 'BADANIE_ID', dataType: 'NUMBER', nullable: false },
          { name: 'PRAC_ID', dataType: 'NUMBER', nullable: false },
          { name: 'DATA_OD', dataType: 'DATE', nullable: true },
          { name: 'DATA_DO', dataType: 'DATE', nullable: true },
        ],
      },
      {
        owner: 'TETA',
        name: 'SL_BADANIA_BHP',
        columns: [
          { name: 'BADANIE_ID', dataType: 'NUMBER', nullable: false },
          { name: 'FIRM_ID', dataType: 'NUMBER', nullable: true },
          { name: 'NAZWA', dataType: 'VARCHAR2', nullable: true },
        ],
      },
    ];

    return {
      databaseLabel: 'TETAHR',
      owners: ['TETA', 'HR'],
      tables,
      views: [
        { owner: 'TETA', name: 'V_PRACOWNICY_AKTYWNI', objectType: 'VIEW' },
        { owner: 'HR', name: 'V_ABSENCJE_BIEZACE', objectType: 'VIEW' },
      ],
      packages: [
        { owner: 'TETA', name: 'HR_PACKAGE', objectType: 'PACKAGE', status: 'VALID' },
        { owner: 'TETA', name: 'DATASET_UTILS', objectType: 'PACKAGE', status: 'VALID' },
      ],
      procedures: [
        { owner: 'TETA', name: 'PRZELICZ_WYNAGRODZENIE', objectType: 'PROCEDURE', status: 'VALID' },
      ],
      functions: [
        { owner: 'TETA', name: 'GET_PRACOWNIK_NAZWA', objectType: 'FUNCTION', status: 'VALID' },
      ],
      constraints: [
        {
          owner: 'TETA',
          tableName: 'PRACOWNICY',
          constraintName: 'PK_PRACOWNICY',
          constraintType: 'P',
          columnName: 'ID',
          position: 1,
        },
        {
          owner: 'HR',
          tableName: 'ABSENCJE',
          constraintName: 'FK_ABSENCJE_PRAC',
          constraintType: 'R',
          columnName: 'PRACOWNIK_ID',
          position: 1,
          refOwner: 'TETA',
          refTableName: 'PRACOWNICY',
          refColumnName: 'ID',
        },
        {
          owner: 'TETA',
          tableName: 'T_PRAC',
          constraintName: 'PK_T_PRAC',
          constraintType: 'P',
          columnName: 'PRAC_ID',
          position: 1,
        },
        {
          owner: 'TETA',
          tableName: 'L_BADANIA_BHP',
          constraintName: 'PK_L_BADANIA',
          constraintType: 'P',
          columnName: 'BADANIE_ID',
          position: 1,
        },
        {
          owner: 'TETA',
          tableName: 'L_BADANIA_BHP',
          constraintName: 'FK_L_BADANIA_PRAC',
          constraintType: 'R',
          columnName: 'PRAC_ID',
          position: 1,
          refOwner: 'TETA',
          refTableName: 'T_PRAC',
          refColumnName: 'PRAC_ID',
        },
        {
          owner: 'TETA',
          tableName: 'SL_BADANIA_BHP',
          constraintName: 'FK_SL_BADANIA_L',
          constraintType: 'R',
          columnName: 'BADANIE_ID',
          position: 1,
          refOwner: 'TETA',
          refTableName: 'L_BADANIA_BHP',
          refColumnName: 'BADANIE_ID',
        },
      ],
      comments: [
        {
          owner: 'TETA',
          tableName: 'L_BADANIA_BHP',
          columnName: 'DATA_DO',
          comments: 'Data końca badania',
        },
        {
          owner: 'TETA',
          tableName: 'PRACOWNICY',
          columnName: null,
          comments: 'Tabela pracowników',
        },
      ],
      sources: [
        {
          owner: 'TETA',
          name: 'HR_PACKAGE',
          objectType: 'PACKAGE',
          line: 1,
          text: 'PACKAGE HR_PACKAGE AS',
        },
      ],
      tetaVersion: 'Oracle Database 19c Enterprise Edition (symulator)',
      pilotModule: this.config.get<string>('TETA_ORACLE_METADATA_PILOT_MODULE')?.trim() || 'HR',
    };
  }

  private systemOwnerPlaceholders(): string {
    return [...SYSTEM_OWNERS].map((owner) => `'${owner}'`).join(', ');
  }

  private buildInBinds(values: string[], prefix: string): { placeholders: string; binds: Record<string, string> } {
    const binds: Record<string, string> = {};
    const placeholders = values
      .map((value, index) => {
        const key = `${prefix}${index}`;
        binds[key] = value;
        return `:${key}`;
      })
      .join(', ');
    return { placeholders, binds };
  }

  private async withConnection<T>(
    username: string,
    password: string,
    connectString: string,
    fn: (connection: import('oracledb').Connection) => Promise<T>,
  ): Promise<T> {
    let connection: import('oracledb').Connection | undefined;
    try {
      connection = await oracledb.getConnection({
        user: username.trim(),
        password,
        connectString,
      });
      return await fn(connection);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ORA-00942')) {
        throw new Error(
          'Konto Oracle nie ma dostępu do widoków katalogowych (ALL_TABLES itd.). Nadaj uprawnienia SELECT_CATALOG_ROLE lub ogranicz import do schematu użytkownika.',
        );
      }
      throw new Error(message);
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }
}
