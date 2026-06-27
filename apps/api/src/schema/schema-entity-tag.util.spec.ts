import {
  extractQueryTags,
  isClarificationReply,
  normalizeEntityTag,
  parseSchemaObjectReference,
} from './schema-entity-tag.util';

describe('normalizeEntityTag', () => {
  it('stems Polish plural forms', () => {
    expect(normalizeEntityTag('pracowników')).toBe('pracownik');
    expect(normalizeEntityTag('pracownicy')).toBe('pracownik');
  });
});

describe('extractQueryTags', () => {
  it('extracts entity words from natural query', () => {
    const tags = extractQueryTags('wyszukaj pracowników na literę A');
    expect(tags).toContain('pracownik');
  });
});

describe('parseSchemaObjectReference', () => {
  it('parses qualified and bare table names', () => {
    expect(parseSchemaObjectReference('TETA_ADMIN.T_PRAC')).toEqual({
      owner: 'TETA_ADMIN',
      name: 'T_PRAC',
    });
    expect(parseSchemaObjectReference('T_PRAC')).toEqual({
      owner: null,
      name: 'T_PRAC',
    });
  });
});

describe('isClarificationReply', () => {
  it('detects table name reply after assistant question', () => {
    const history = [
      { role: 'user', content: 'pokaż pracowników' },
      { role: 'assistant', content: 'Która tabela przechowuje pracowników?' },
    ];
    expect(isClarificationReply(history, 'T_PRAC')).toBe(true);
    expect(isClarificationReply(history, 'na literę A')).toBe(false);
  });
});
