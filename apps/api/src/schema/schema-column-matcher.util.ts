export type SchemaColumnMeta = {
  name: string;
  comment?: string | null;
};

const POLISH_DIACRITICS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => POLISH_DIACRITICS[char] ?? char);
}

function tokenizeColumnName(columnName: string): string[] {
  return columnName
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function scoreLabelAgainstColumnName(label: string, columnName: string): number {
  const normLabel = normalizeText(label);
  const normColumn = normalizeText(columnName.replace(/_/g, ' '));
  if (!normLabel || !normColumn) {
    return 0;
  }

  if (normColumn === normLabel) {
    return 100;
  }
  if (normColumn.includes(normLabel) || normLabel.includes(normColumn)) {
    return 6;
  }

  const labelTokens = normLabel.split(/\s+/).filter((part) => part.length >= 3);
  const columnTokens = tokenizeColumnName(columnName).map((part) => part.toLowerCase());
  let score = 0;
  for (const token of labelTokens) {
    if (columnTokens.some((columnToken) => columnToken.includes(token) || token.includes(columnToken))) {
      score += 3;
    }
  }

  return score;
}

function scorePluginColumnAgainstSchema(
  pluginColumnName: string,
  schemaColumn: SchemaColumnMeta,
  label?: string,
): number {
  const upperPlugin = pluginColumnName.toUpperCase();
  const upperSchema = schemaColumn.name.toUpperCase();
  let score = 0;

  if (upperPlugin === upperSchema) {
    return 100;
  }

  if (upperSchema.includes(upperPlugin) || upperPlugin.includes(upperSchema)) {
    score += 6;
  }

  const pluginTokens = tokenizeColumnName(upperPlugin);
  const schemaTokens = tokenizeColumnName(upperSchema);
  for (const token of pluginTokens) {
    if (schemaTokens.includes(token)) {
      score += 3;
    } else if (token.length >= 4 && upperSchema.includes(token)) {
      score += 2;
    }
  }

  if (label && schemaColumn.comment) {
    const normLabel = normalizeText(label);
    const normComment = normalizeText(schemaColumn.comment);
    if (normComment.includes(normLabel)) {
      score += 8;
    }
    for (const word of normLabel.split(/\s+/).filter((part) => part.length >= 4)) {
      if (normComment.includes(word)) {
        score += 2;
      }
    }
  }

  if (label) {
    score += scoreLabelAgainstColumnName(label, schemaColumn.name);
  }

  return score;
}

export function matchPluginColumnToSchema(
  pluginColumnName: string,
  schemaColumns: SchemaColumnMeta[],
  label?: string,
): string | null {
  if (!pluginColumnName.trim() || schemaColumns.length === 0) {
    return null;
  }

  let best: { name: string; score: number } | null = null;
  for (const column of schemaColumns) {
    const score = scorePluginColumnAgainstSchema(pluginColumnName, column, label);
    if (!best || score > best.score) {
      best = { name: column.name, score };
    }
  }

  if (!best || best.score < 3) {
    return null;
  }

  return best.name;
}

export function findSchemaColumnByLabel(
  label: string,
  schemaColumns: SchemaColumnMeta[],
): string | null {
  if (!label.trim() || schemaColumns.length === 0) {
    return null;
  }

  let best: { name: string; score: number } | null = null;
  for (const column of schemaColumns) {
    let score = scoreLabelAgainstColumnName(label, column.name);
    if (column.comment) {
      const normLabel = normalizeText(label);
      const normComment = normalizeText(column.comment);
      if (normComment.includes(normLabel)) {
        score += 8;
      }
    }
    if (!best || score > best.score) {
      best = { name: column.name, score };
    }
  }

  return best && best.score >= 5 ? best.name : null;
}
