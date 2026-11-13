/**
 * src/ui/measurements.ts
 * Field-measurement rows: validation, RFC 4180 CSV, and localStorage persistence.
 * Pure functions, so they are tested in Node. Rows are only ever typed in by a person.
 * Requirements (slice 2): 7.1–7.7
 */

export const CSV_COLUMNS = [
  "date",
  "tx_device",
  "rx_device",
  "environment",
  "distance_m",
  "payload_bytes",
  "attempts",
  "successes",
  "notes",
] as const;

export type Column = (typeof CSV_COLUMNS)[number];
export type MeasurementRow = Record<Column, string>;

export const STORAGE_KEY = "handshake-field-measurements";

const REQUIRED: Column[] = [
  "date",
  "tx_device",
  "rx_device",
  "environment",
  "distance_m",
  "payload_bytes",
  "attempts",
  "successes",
];

/** Returns a message per invalid field; an empty object means the row is valid. */
export function validateRow(row: MeasurementRow): Partial<Record<Column, string>> {
  const errors: Partial<Record<Column, string>> = {};
  for (const c of REQUIRED) {
    if (row[c].trim() === "") errors[c] = "required";
  }
  const isNonNegInt = (s: string) => /^\d+$/.test(s.trim());
  if (!errors.distance_m && !(Number(row.distance_m) >= 0 && Number.isFinite(Number(row.distance_m)))) {
    errors.distance_m = "must be a number ≥ 0";
  }
  if (!errors.payload_bytes && !(isNonNegInt(row.payload_bytes) && Number(row.payload_bytes) >= 1 && Number(row.payload_bytes) <= 140)) {
    errors.payload_bytes = "must be a whole number from 1 to 140";
  }
  if (!errors.attempts && !(isNonNegInt(row.attempts) && Number(row.attempts) >= 1)) {
    errors.attempts = "must be a whole number ≥ 1";
  }
  if (!errors.successes && !isNonNegInt(row.successes)) {
    errors.successes = "must be a whole number ≥ 0";
  }
  if (!errors.attempts && !errors.successes && Number(row.successes) > Number(row.attempts)) {
    errors.successes = "cannot exceed attempts";
  }
  return errors;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvSerialize(rows: MeasurementRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvField(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** RFC 4180 parser, used by tests to check that serialization round-trips. */
export function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 2;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function saveRows(store: KeyValueStore, rows: MeasurementRow[]): void {
  store.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function loadRows(store: KeyValueStore): MeasurementRow[] {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is MeasurementRow =>
        typeof r === "object" && r !== null && CSV_COLUMNS.every((c) => typeof (r as Record<string, unknown>)[c] === "string"),
    );
  } catch {
    return [];
  }
}
