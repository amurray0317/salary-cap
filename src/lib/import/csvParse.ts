/**
 * Minimal RFC 4180 CSV parser (counterpart to src/lib/csv.ts's serializer).
 * Handles quoted fields, escaped quotes, CRLF/LF, and trailing newlines.
 */

export interface ParsedCsv {
  headers: string[];
  /** Data rows (header row excluded), each aligned to headers by index. */
  rows: string[][];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export function parseCsv(text: string, opts: { maxRows?: number } = {}): ParsedCsv {
  const maxRows = opts.maxRows ?? 5000;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Skip fully empty records (blank lines).
    if (!(record.length === 1 && record[0] === "")) {
      records.push(record);
      if (records.length > maxRows + 1) {
        throw new CsvParseError(`File exceeds the maximum of ${maxRows} data rows`);
      }
    }
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) {
        // Stray quote mid-field; treat literally (lenient).
        field += ch;
      } else {
        inQuotes = true;
      }
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRecord();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) throw new CsvParseError("Unterminated quoted field");
  if (field.length > 0 || record.length > 0) pushRecord();

  const headerRow = records[0];
  if (!headerRow || headerRow.every((h) => h.trim() === "")) {
    throw new CsvParseError("File has no header row");
  }
  const headers = headerRow.map((h) => h.trim());
  const width = headers.length;
  const rows = records.slice(1).map((r) => {
    const aligned = r.slice(0, width);
    while (aligned.length < width) aligned.push("");
    return aligned.map((v) => v.trim());
  });
  return { headers, rows };
}
