import { useMemo, useState, type ReactNode } from 'react';
import type { TetaPluginImportDetailResponse } from '@teta/shared';
import {
  parsePluginImportMetadata,
  pickPreferredSql,
  type PluginColumnDetail,
  type PluginGatewayDetail,
  type PluginSqlCommandSet,
} from './teta-plugin-detail.util';

type TetaPluginImportDetailPanelProps = {
  importDetail: TetaPluginImportDetailResponse | null;
  loading: boolean;
};

function CollapsibleBlock({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  /** Gdy pominięte: rozwinięte bez licznika, zwinięte z licznikiem. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => defaultOpen ?? count == null);

  return (
    <div className="teta-plugins__collapse">
      <button
        type="button"
        className="teta-plugins__collapse-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="teta-plugins__collapse-title">
          {title}
          {count != null ? <span className="teta-plugins__collapse-count">({count})</span> : null}
        </span>
        <span className="teta-plugins__collapse-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open ? <div className="teta-plugins__collapse-body">{children}</div> : null}
    </div>
  );
}

function OracleList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="teta-plugins__oracle-list">
      {items.map((item) => (
        <li key={item}>
          <code>{item}</code>
        </li>
      ))}
    </ul>
  );
}

function CollapsibleOracleGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <CollapsibleBlock title={title} count={items.length}>
      <OracleList items={items} />
    </CollapsibleBlock>
  );
}

function UiColumnsPreview({ columns }: { columns: PluginColumnDetail[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return columns;
    return columns.filter((column) => {
      const haystack = [column.label, column.hint, column.gridColumnName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [columns, query]);

  if (columns.length === 0) return null;

  return (
    <CollapsibleBlock title="Kolumny UI (etykiety formularza)" count={columns.length}>
      <div className="teta-plugins__columns-toolbar">
        <input
          type="search"
          className="teta-plugins__columns-search"
          placeholder="Szukaj etykiety, podpowiedzi lub nazwy technicznej…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="teta-plugins__columns-count">
          {filtered.length === columns.length
            ? `${columns.length} kolumn`
            : `${filtered.length} / ${columns.length}`}
        </span>
      </div>
      <ul className="teta-plugins__columns-list">
        {filtered.map((column) => (
          <li key={column.gridColumnName} className="teta-plugins__columns-item">
            <span className="teta-plugins__columns-label">
              {column.label ?? column.gridColumnName}
            </span>
            {column.label && column.label !== column.gridColumnName ? (
              <code className="teta-plugins__columns-tech">{column.gridColumnName}</code>
            ) : null}
            {column.hint && column.hint !== column.label ? (
              <span className="teta-plugins__columns-hint">{column.hint}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? (
        <p className="teta-plugins__hint">Brak kolumn pasujących do wyszukiwania.</p>
      ) : null}
    </CollapsibleBlock>
  );
}

function SqlField({
  label,
  gateway,
  kind,
}: {
  label: string;
  gateway: PluginGatewayDetail;
  kind: keyof PluginSqlCommandSet;
}) {
  const picked = pickPreferredSql(gateway, kind);
  if (!picked) {
    return (
      <div className="teta-plugins__sql-field teta-plugins__sql-field--empty">
        <span className="teta-plugins__sql-field-label">{label}</span>
        <span className="teta-plugins__sql-empty">—</span>
      </div>
    );
  }

  return (
    <div className="teta-plugins__sql-field">
      <div className="teta-plugins__sql-field-head">
        <span className="teta-plugins__sql-field-label">{label}</span>
        <span className="teta-plugins__sql-source">{picked.source}</span>
      </div>
      <pre className="teta-plugins__sql-pre">{picked.sql}</pre>
    </div>
  );
}

function GatewayCard({ gateway }: { gateway: PluginGatewayDetail }) {
  const [open, setOpen] = useState(true);

  return (
    <article className="teta-plugins__gateway">
      <button
        type="button"
        className="teta-plugins__gateway-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="teta-plugins__gateway-title">
          <code>{gateway.className}</code>
          <span className="teta-plugins__gateway-kind">{gateway.gatewayKind}</span>
          {gateway.sqlStatus && (
            <span className="teta-plugins__gateway-status">{gateway.sqlStatus}</span>
          )}
        </span>
        <span className="teta-plugins__gateway-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="teta-plugins__gateway-body">
          <dl className="teta-plugins__gateway-meta">
            {gateway.viewName && (
              <>
                <dt>Widok Oracle</dt>
                <dd>
                  <code>{gateway.viewName}</code>
                </dd>
              </>
            )}
            {gateway.baseTableName && (
              <>
                <dt>Tabela bazowa</dt>
                <dd>
                  <code>{gateway.baseTableName}</code>
                </dd>
              </>
            )}
            {gateway.packageName && (
              <>
                <dt>Pakiet główny</dt>
                <dd>
                  <code>{gateway.packageName}</code>
                </dd>
              </>
            )}
            {gateway.relatedPackages.dac && (
              <>
                <dt>Pakiet DAC</dt>
                <dd>
                  <code>{gateway.relatedPackages.dac}</code>
                </dd>
              </>
            )}
            {gateway.relatedPackages.agl && (
              <>
                <dt>Pakiet AGL</dt>
                <dd>
                  <code>{gateway.relatedPackages.agl}</code>
                </dd>
              </>
            )}
            {gateway.relatedPackages.lep && (
              <>
                <dt>Pakiet LEP</dt>
                <dd>
                  <code>{gateway.relatedPackages.lep}</code>
                </dd>
              </>
            )}
            {gateway.datasetTableName && (
              <>
                <dt>Tabela DataSet</dt>
                <dd>
                  <code>{gateway.datasetTableName}</code>
                </dd>
              </>
            )}
            {gateway.tableAlias && (
              <>
                <dt>Alias</dt>
                <dd>
                  <code>{gateway.tableAlias}</code>
                </dd>
              </>
            )}
          </dl>

          {(gateway.flatQuery?.trim() || gateway.lastSqlQuery?.trim()) && (
            <CollapsibleBlock title="SQL (runtime)">
              {gateway.flatQuery?.trim() && (
                <div className="teta-plugins__sql-field">
                  <div className="teta-plugins__sql-field-head">
                    <span className="teta-plugins__sql-field-label">FlatQuery</span>
                  </div>
                  <pre className="teta-plugins__sql-pre">{gateway.flatQuery.trim()}</pre>
                </div>
              )}
              {gateway.lastSqlQuery?.trim() && (
                <div className="teta-plugins__sql-field">
                  <div className="teta-plugins__sql-field-head">
                    <span className="teta-plugins__sql-field-label">LastSqlQuery</span>
                  </div>
                  <pre className="teta-plugins__sql-pre">{gateway.lastSqlQuery.trim()}</pre>
                </div>
              )}
            </CollapsibleBlock>
          )}

          <CollapsibleBlock title="SQL">
            <div className="teta-plugins__sql-grid">
              <SqlField label="SELECT" gateway={gateway} kind="Select" />
              <SqlField label="INSERT" gateway={gateway} kind="Insert" />
              <SqlField label="UPDATE" gateway={gateway} kind="Update" />
              <SqlField label="DELETE" gateway={gateway} kind="Delete" />
            </div>
          </CollapsibleBlock>
        </div>
      )}
    </article>
  );
}

export function TetaPluginImportDetailPanel({
  importDetail,
  loading,
}: TetaPluginImportDetailPanelProps) {
  const detail = useMemo(() => {
    if (!importDetail?.metadata) return null;
    return parsePluginImportMetadata(importDetail.metadata, importDetail.chunkCount);
  }, [importDetail]);

  if (loading) {
    return <p className="teta-plugins__hint">Wczytywanie metadanych…</p>;
  }

  if (!detail) {
    return (
      <p className="teta-plugins__hint">
        Brak zapisanych metadanych — zaimportuj wtyczkę ponownie, aby zobaczyć SQL i obiekty Oracle.
      </p>
    );
  }

  return (
    <div className="teta-plugins__detail-panel">
      <section className="teta-plugins__detail-section">
        <CollapsibleBlock title="Co trafiło do RAG">
          <dl className="teta-plugins__detail-stats">
            <div>
              <dt>Chunki</dt>
              <dd>{detail.chunkCount}</dd>
            </div>
            <div>
              <dt>Tryb ekstrakcji</dt>
              <dd>{detail.extractionMode}</dd>
            </div>
            <div>
              <dt>Formularze</dt>
              <dd>{detail.formCount}</dd>
            </div>
            <div>
              <dt>Gatewaye</dt>
              <dd>{detail.gatewayCount}</dd>
            </div>
            <div>
              <dt>Kolumny UI</dt>
              <dd>{detail.columnCount}</dd>
            </div>
            <div>
              <dt>Assembly BO</dt>
              <dd>{detail.businessObjectDllCount}</dd>
            </div>
          </dl>
        </CollapsibleBlock>
      </section>

      {(detail.oracleSummary.views.length > 0 ||
        detail.oracleSummary.tables.length > 0 ||
        detail.oracleSummary.packagesDac.length > 0 ||
        detail.oracleSummary.packagesAgl.length > 0 ||
        detail.oracleSummary.packagesLep.length > 0 ||
        detail.oracleSummary.datasets.length > 0 ||
        detail.oracleDiscovery.aliases.length > 0) && (
        <section className="teta-plugins__detail-section">
          <CollapsibleBlock title="Obiekty Oracle (odkryte w wtyczce)">
            <div className="teta-plugins__oracle-stack">
              <CollapsibleOracleGroup title="Widoki" items={detail.oracleSummary.views} />
              <CollapsibleOracleGroup title="Tabele" items={detail.oracleSummary.tables} />
              <CollapsibleOracleGroup title="Pakiety DAC" items={detail.oracleSummary.packagesDac} />
              <CollapsibleOracleGroup title="Pakiety AGL" items={detail.oracleSummary.packagesAgl} />
              <CollapsibleOracleGroup title="Pakiety LEP" items={detail.oracleSummary.packagesLep} />
              <CollapsibleOracleGroup title="Tabele DataSet" items={detail.oracleSummary.datasets} />
              <CollapsibleOracleGroup title="Aliasy SQL" items={detail.oracleDiscovery.aliases} />
            </div>
          </CollapsibleBlock>
        </section>
      )}

      {detail.columns.length > 0 && (
        <section className="teta-plugins__detail-section">
          <UiColumnsPreview columns={detail.columns} />
        </section>
      )}

      {detail.forms.map((form) => (
        <section key={form.className ?? form.name} className="teta-plugins__detail-section">
          <CollapsibleBlock title={form.name} count={form.gateways.length}>
            {(form.className || form.businessLocalization || form.arl) && (
              <dl className="teta-plugins__form-meta">
                {form.className && (
                  <>
                    <dt>Klasa</dt>
                    <dd>
                      <code>{form.className}</code>
                    </dd>
                  </>
                )}
                {form.businessLocalization && (
                  <>
                    <dt>Lokalizacja</dt>
                    <dd>{form.businessLocalization}</dd>
                  </>
                )}
                {form.arl && (
                  <>
                    <dt>ARL</dt>
                    <dd>{form.arl}</dd>
                  </>
                )}
                <dt>Kolumny UI</dt>
                <dd>{form.columnCount}</dd>
              </dl>
            )}

            {form.gateways.length === 0 ? (
              <p className="teta-plugins__hint">Brak gatewayów w metadanych tego formularza.</p>
            ) : (
              <div className="teta-plugins__gateway-list">
                {form.gateways.map((gateway) => (
                  <GatewayCard key={gateway.className} gateway={gateway} />
                ))}
              </div>
            )}
          </CollapsibleBlock>
        </section>
      ))}

      {detail.businessObjectDlls.length > 0 && (
        <section className="teta-plugins__detail-section">
          <CollapsibleBlock title="Powiązane assembly BO (serwer)" count={detail.businessObjectDlls.length}>
            <ul className="teta-plugins__bo-list">
              {detail.businessObjectDlls.map((dllPath) => (
                <li key={dllPath}>
                  <code>{dllPath.split(/[/\\]/).pop() ?? dllPath}</code>
                  <span className="teta-plugins__bo-path">{dllPath}</span>
                </li>
              ))}
            </ul>
          </CollapsibleBlock>
        </section>
      )}
    </div>
  );
}
