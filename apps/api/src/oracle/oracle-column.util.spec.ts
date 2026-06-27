import {
  hasOracleColumnDefault,
  isInsertRequiredColumn,
  parseOracleNullable,
} from './oracle-column.util';

describe('parseOracleNullable', () => {
  it('treats Y as nullable', () => {
    expect(parseOracleNullable('Y')).toBe(true);
    expect(parseOracleNullable('y')).toBe(true);
  });

  it('treats N as not nullable', () => {
    expect(parseOracleNullable('N')).toBe(false);
    expect(parseOracleNullable('n')).toBe(false);
  });

  it('defaults unknown values to nullable', () => {
    expect(parseOracleNullable(null)).toBe(true);
    expect(parseOracleNullable(undefined)).toBe(true);
    expect(parseOracleNullable('')).toBe(true);
    expect(parseOracleNullable('X')).toBe(true);
  });
});

describe('hasOracleColumnDefault', () => {
  it('detects non-empty defaults', () => {
    expect(hasOracleColumnDefault('0')).toBe(true);
    expect(hasOracleColumnDefault('SYSDATE')).toBe(true);
    expect(hasOracleColumnDefault(' ')).toBe(true);
  });

  it('treats null and blank as no default', () => {
    expect(hasOracleColumnDefault(null)).toBe(false);
    expect(hasOracleColumnDefault(undefined)).toBe(false);
    expect(hasOracleColumnDefault('')).toBe(false);
    expect(hasOracleColumnDefault('   ')).toBe(true);
  });
});

describe('isInsertRequiredColumn', () => {
  it('requires NOT NULL columns without default and not PK', () => {
    expect(isInsertRequiredColumn({ nullable: false, dataDefault: null, isPk: false })).toBe(true);
  });

  it('excludes nullable, PK and defaulted NOT NULL columns', () => {
    expect(isInsertRequiredColumn({ nullable: true, dataDefault: null })).toBe(false);
    expect(isInsertRequiredColumn({ nullable: false, dataDefault: '0', isPk: false })).toBe(false);
    expect(isInsertRequiredColumn({ nullable: false, dataDefault: null, isPk: true })).toBe(false);
  });
});
