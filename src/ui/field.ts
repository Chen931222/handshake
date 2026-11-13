/**
 * src/ui/field.ts
 * Field-measurement log: one row per device × environment × run, typed in by a person.
 * Saved in localStorage, exported as RFC 4180 CSV. No network.
 * Requirements (slice 2): 7.1–7.7
 */

import {
  CSV_COLUMNS,
  csvSerialize,
  loadRows,
  saveRows,
  validateRow,
  type Column,
  type MeasurementRow,
} from "./measurements.js";
import "@fontsource/im-fell-english/400.css";
import "./app.css";

const form = document.getElementById("field-form") as HTMLFormElement;
const tbody = document.getElementById("field-rows") as HTMLTableSectionElement;
const empty = document.getElementById("field-empty") as HTMLElement;
const download = document.getElementById("field-download") as HTMLButtonElement;
const summary = document.getElementById("field-summary") as HTMLElement;

const store = (() => {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  }
})();

let rows: MeasurementRow[] = loadRows(store);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function field(name: Column): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function resetForm(): void {
  const keep = { tx_device: field("tx_device").value, rx_device: field("rx_device").value, environment: field("environment").value };
  form.reset();
  field("date").value = today();
  // Keep the setup between runs; only the counts change from attempt to attempt.
  field("tx_device").value = keep.tx_device;
  field("rx_device").value = keep.rx_device;
  field("environment").value = keep.environment;
}

function render(): void {
  tbody.replaceChildren(
    ...rows.map((r, i) => {
      const tr = document.createElement("tr");
      for (const c of CSV_COLUMNS) {
        const td = document.createElement("td");
        td.textContent = r[c];
        if (["distance_m", "payload_bytes", "attempts", "successes"].includes(c)) td.className = "num";
        tr.append(td);
      }
      const td = document.createElement("td");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "link";
      del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete row ${i + 1}`);
      del.addEventListener("click", () => {
        rows.splice(i, 1);
        saveRows(store, rows);
        render();
      });
      td.append(del);
      tr.append(td);
      return tr;
    }),
  );
  empty.hidden = rows.length > 0;
  download.disabled = rows.length === 0;
  const attempts = rows.reduce((s, r) => s + Number(r.attempts), 0);
  const ok = rows.reduce((s, r) => s + Number(r.successes), 0);
  summary.textContent =
    rows.length === 0
      ? "No measurements yet. Nothing here is estimated: every row is a real run."
      : `${rows.length} row${rows.length === 1 ? "" : "s"} · ${ok} of ${attempts} attempts decoded (${((ok / attempts) * 100).toFixed(1)}%)`;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const row = Object.fromEntries(CSV_COLUMNS.map((c) => [c, field(c).value])) as MeasurementRow;
  const errors = validateRow(row);
  for (const c of CSV_COLUMNS) {
    const msg = document.getElementById(`err-${c}`);
    const input = field(c);
    if (msg) msg.textContent = errors[c] ?? "";
    input.setAttribute("aria-invalid", errors[c] ? "true" : "false");
  }
  const first = CSV_COLUMNS.find((c) => errors[c]);
  if (first) {
    field(first).focus();
    return;
  }
  rows.push(Object.fromEntries(CSV_COLUMNS.map((c) => [c, row[c].trim()])) as MeasurementRow);
  saveRows(store, rows);
  render();
  resetForm();
});

download.addEventListener("click", () => {
  const blob = new Blob([csvSerialize(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `handshake-measurements-${today()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

field("date").value = today();
render();
