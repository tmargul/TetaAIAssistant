import type { TetaPluginGatewayMeta } from './teta-plugin-metadata.types';
import type { GridOracleColumnLink } from './teta-plugin-grid-column-mapper';
import { parseGatewaySelect } from './teta-plugin-gateway-sql.util';

const DEFAULT_MAX_LABELED_COLUMNS = 40;

function escapeOracleAlias(label: string): string {
  return label.replace(/"/g, '""');
}

function shouldSkipGridAlias(label: string, oracleColumn: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) {
    return true;
  }
  if (/^T_\d+$/i.test(trimmed) || /^N_\d+$/i.test(trimmed) || /^D_\d+$/i.test(trimmed)) {
    return true;
  }
  return trimmed.toUpperCase() === oracleColumn.toUpperCase() && trimmed === trimmed.toUpperCase();
}

function formatSelectExpression(
  alias: string | null,
  oracleColumn: string,
  link: GridOracleColumnLink | undefined,
): string {
  const qualified = alias ? `${alias}.${oracleColumn}` : oracleColumn;
  if (!link?.label || shouldSkipGridAlias(link.label, oracleColumn)) {
    return qualified;
  }
  return `${qualified} AS "${escapeOracleAlias(link.label)}"`;
}

export function buildLabeledSelectSql(
  gateway: TetaPluginGatewayMeta,
  links: GridOracleColumnLink[],
  options?: { maxColumns?: number | null },
): string | null {
  const parsed = parseGatewaySelect(gateway, { preferBuilder: true });
  if (!parsed?.columns.length || !parsed.fromObject) {
    return null;
  }

  const linkByColumn = new Map(links.map((link) => [link.oracleColumnName.toUpperCase(), link]));
  const maxColumns =
    options?.maxColumns === null
      ? parsed.columns.length
      : (options?.maxColumns ?? DEFAULT_MAX_LABELED_COLUMNS);
  const columns = parsed.columns.slice(0, maxColumns);
  const hiddenCount = Math.max(0, parsed.columns.length - columns.length);

  const selectList = columns
    .map((column) =>
      formatSelectExpression(parsed.alias, column, linkByColumn.get(column.toUpperCase())),
    )
    .join(', ');

  const fromClause = parsed.alias
    ? `${parsed.fromObject} ${parsed.alias}`
    : parsed.fromObject;

  const hiddenSuffix =
    hiddenCount > 0 ? `\n-- ... (+${hiddenCount} kolumn bez etykiety grida w metadanych)` : '';

  return `SELECT ${selectList}\nFROM ${fromClause}${hiddenSuffix}`;
}

export function formatColumnMappingLines(links: GridOracleColumnLink[]): string[] {
  return links.map((link) => {
    const synonymPart =
      link.synonyms.length > 0 ? `; synonimy: ${link.synonyms.join(', ')}` : '';
    const gridPart = link.gridColumnName ? ` [grid: ${link.gridColumnName}]` : '';
    return `„${link.label}” → ${link.oracleColumnName}${gridPart}${synonymPart}`;
  });
}
