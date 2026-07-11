import { matchPluginColumnToSchema, findSchemaColumnByLabel } from './schema-column-matcher.util';

describe('schema-column-matcher.util', () => {
  const schemaColumns = [
    { name: 'IMIE', comment: 'Imię pracownika' },
    { name: 'NAZWISKO', comment: 'Nazwisko pracownika' },
    { name: 'NR_EWD', comment: 'Numer ewidencyjny pracownika' },
  ];

  it('maps plugin NR_EWIDENCYJNY to NR_EWD in schema', () => {
    expect(
      matchPluginColumnToSchema('NR_EWIDENCYJNY', schemaColumns, 'Numer ewidencyjny'),
    ).toBe('NR_EWD');
  });

  it('finds column by label comment', () => {
    expect(findSchemaColumnByLabel('Numer ewidencyjny', schemaColumns)).toBe('NR_EWD');
  });

  it('keeps exact matches', () => {
    expect(matchPluginColumnToSchema('IMIE', schemaColumns, 'Imię')).toBe('IMIE');
  });
});
