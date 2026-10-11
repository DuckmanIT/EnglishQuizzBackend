import { CardImportParseError, parseCardImport } from './card-import.js';

describe('parseCardImport', () => {
  it('parses Quizlet/Excel style TSV, keeping commas and quotes in definitions', () => {
    const result = parseCardImport(
      'apple\tquả táo, trái táo\nsay "hi"\tchào\n',
    );
    expect(result.delimiter).toBe('tab');
    expect(result.cards).toEqual([
      { term: 'apple', definition: 'quả táo, trái táo', line: 1 },
      { term: 'say "hi"', definition: 'chào', line: 2 },
    ]);
  });

  it('parses quoted CSV with all optional columns in positional order', () => {
    const result = parseCardImport(
      'run,"chạy, điều hành",/rʌn/,verb,I run every day,Tôi chạy mỗi ngày',
    );
    expect(result.delimiter).toBe('comma');
    expect(result.cards[0]).toEqual({
      term: 'run',
      definition: 'chạy, điều hành',
      phonetic: '/rʌn/',
      partOfSpeech: 'verb',
      example: 'I run every day',
      exampleTrans: 'Tôi chạy mỗi ngày',
      line: 1,
    });
  });

  it('parses pasted "term - definition" lines', () => {
    const result = parseCardImport(
      'well-known - nổi tiếng, được biết đến\r\n\r\nhello – xin chào',
    );
    expect(result.delimiter).toBe('dash');
    expect(result.cards).toEqual([
      { term: 'well-known', definition: 'nổi tiếng, được biết đến', line: 1 },
      { term: 'hello', definition: 'xin chào', line: 3 },
    ]);
  });

  it('detects semicolons (Excel in many European/Vietnamese locales)', () => {
    const result = parseCardImport('cat;con mèo\ndog;con chó');
    expect(result.delimiter).toBe('semicolon');
    expect(result.cards).toHaveLength(2);
  });

  it('maps columns by header name, including Vietnamese and aliases, ignoring unknown ones', () => {
    const result = parseCardImport(
      'Nghĩa,Từ,IPA,Ghi chú\ncon mèo,cat,/kæt/,ignored',
      { hasHeader: true },
    );
    expect(result.cards).toEqual([
      { term: 'cat', definition: 'con mèo', phonetic: '/kæt/', line: 2 },
    ]);
  });

  it('reports bad rows with their line number instead of failing the import', () => {
    const result = parseCardImport(
      `ok\tfine\nonly-term\n\t\tmissing\n${'x'.repeat(201)}\ttoo long`,
      { delimiter: 'tab' },
    );
    expect(result.cards).toHaveLength(1);
    expect(result.errors).toEqual([
      { line: 2, reason: 'Missing definition' },
      { line: 3, reason: 'Missing term' },
      { line: 4, reason: 'term is longer than 200 characters' },
    ]);
  });

  it('strips a UTF-8 BOM from files saved by Excel', () => {
    const result = parseCardImport('﻿term,definition\nsun,mặt trời', {
      hasHeader: true,
    });
    expect(result.cards).toEqual([
      { term: 'sun', definition: 'mặt trời', line: 2 },
    ]);
  });

  it('honours an explicit delimiter over detection', () => {
    const result = parseCardImport('a - b,c', { delimiter: 'comma' });
    expect(result.cards).toEqual([{ term: 'a - b', definition: 'c', line: 1 }]);
  });

  it('throws on malformed CSV', () => {
    expect(() =>
      parseCardImport('a,"unclosed\nb,c', { delimiter: 'comma' }),
    ).toThrow(CardImportParseError);
  });
});
