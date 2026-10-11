import { parse } from 'csv-parse/sync';

export type ImportDelimiter = 'auto' | 'tab' | 'comma' | 'semicolon' | 'dash';

export interface CardDraft {
  term: string;
  definition: string;
  phonetic?: string;
  partOfSpeech?: string;
  example?: string;
  exampleTrans?: string;
}

export interface ImportRowError {
  line: number;
  reason: string;
}

export interface ParsedImport {
  delimiter: Exclude<ImportDelimiter, 'auto'>;
  cards: (CardDraft & { line: number })[];
  errors: ImportRowError[];
}

export class CardImportParseError extends Error {}

type Field = keyof CardDraft;

/** Column order when there is no header row. */
const POSITIONAL: Field[] = [
  'term',
  'definition',
  'phonetic',
  'partOfSpeech',
  'example',
  'exampleTrans',
];

export const FIELD_MAX_LENGTH: Record<Field, number> = {
  term: 200,
  definition: 1000,
  phonetic: 100,
  partOfSpeech: 50,
  example: 500,
  exampleTrans: 500,
};

const HEADER_ALIASES: Record<string, Field> = {
  term: 'term',
  word: 'term',
  front: 'term',
  từ: 'term',
  definition: 'definition',
  meaning: 'definition',
  back: 'definition',
  nghĩa: 'definition',
  phonetic: 'phonetic',
  ipa: 'phonetic',
  pronunciation: 'phonetic',
  'phiên âm': 'phonetic',
  partofspeech: 'partOfSpeech',
  pos: 'partOfSpeech',
  type: 'partOfSpeech',
  'từ loại': 'partOfSpeech',
  example: 'example',
  'ví dụ': 'example',
  exampletrans: 'exampleTrans',
  exampletranslation: 'exampleTrans',
  'dịch ví dụ': 'exampleTrans',
};

// " - " or " – " between term and definition, e.g. "apple - quả táo".
const DASH_SEPARATOR = /\s+[-–]\s+/;

/**
 * Turns pasted text or an uploaded CSV/TSV into card drafts.
 * Rows that can't become a card (missing term/definition, too long) are reported, not fatal;
 * only malformed CSV (e.g. an unclosed quote) throws CardImportParseError.
 */
export function parseCardImport(
  content: string,
  options: { delimiter?: ImportDelimiter; hasHeader?: boolean } = {},
): ParsedImport {
  const text = content.replace(/^﻿/, '');
  const delimiter =
    !options.delimiter || options.delimiter === 'auto'
      ? detectDelimiter(text)
      : options.delimiter;

  const rows =
    delimiter === 'dash'
      ? splitDashLines(text)
      : parseDelimited(text, delimiter);

  let columns: (Field | undefined)[] = POSITIONAL;
  if (options.hasHeader && rows.length > 0) {
    columns = headerColumns(rows[0].values);
    rows.shift();
  }

  const result: ParsedImport = { delimiter, cards: [], errors: [] };
  for (const { line, values } of rows) {
    const draft: Partial<Record<Field, string>> = {};
    columns.forEach((field, index) => {
      const value = values[index]?.trim();
      if (field && value) draft[field] = value;
    });

    const error = validateDraft(draft);
    if (error) result.errors.push({ line, reason: error });
    else result.cards.push({ ...(draft as CardDraft), line });
  }
  return result;
}

function detectDelimiter(text: string): Exclude<ImportDelimiter, 'auto'> {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (firstLine.includes('\t')) return 'tab';
  // Definitions often contain commas, so " - " wins over "," when both appear.
  if (DASH_SEPARATOR.test(firstLine)) return 'dash';
  const semicolons = firstLine.split(';').length;
  const commas = firstLine.split(',').length;
  return semicolons > commas ? 'semicolon' : 'comma';
}

interface RawRow {
  line: number;
  values: string[];
}

function splitDashLines(text: string): RawRow[] {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    if (!raw.trim()) return [];
    const match = DASH_SEPARATOR.exec(raw);
    const values = match
      ? [raw.slice(0, match.index), raw.slice(match.index + match[0].length)]
      : [raw];
    return [{ line: index + 1, values }];
  });
}

function parseDelimited(
  text: string,
  delimiter: 'tab' | 'comma' | 'semicolon',
): RawRow[] {
  const char = { tab: '\t', comma: ',', semicolon: ';' }[delimiter];
  try {
    const records = parse(text, {
      delimiter: char,
      relax_column_count: true,
      skip_empty_lines: true,
      // Quizlet/Excel TSV exports don't quote, and a stray " in a definition must not break the row.
      quote: delimiter === 'tab' ? false : '"',
      info: true,
    }) as unknown as { record: string[]; info: { lines: number } }[];
    return records
      .filter(({ record }) => record.some((value) => value.trim()))
      .map(({ record, info }) => ({ line: info.lines, values: record }));
  } catch (error) {
    throw new CardImportParseError(
      error instanceof Error ? error.message : 'Could not parse the file',
    );
  }
}

/** Unknown header names map to undefined, so that column is ignored. */
function headerColumns(header: string[]): (Field | undefined)[] {
  return header.map((name) => {
    const lower = name.trim().toLowerCase();
    return (
      HEADER_ALIASES[lower.replace(/[\s_-]+/g, '')] ?? HEADER_ALIASES[lower]
    );
  });
}

function validateDraft(
  draft: Partial<Record<Field, string>>,
): string | undefined {
  if (!draft.term) return 'Missing term';
  if (!draft.definition) return 'Missing definition';
  for (const [field, max] of Object.entries(FIELD_MAX_LENGTH)) {
    const value = draft[field as Field];
    if (value && value.length > max)
      return `${field} is longer than ${max} characters`;
  }
  return undefined;
}
