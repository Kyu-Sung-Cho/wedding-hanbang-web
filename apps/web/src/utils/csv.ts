export type CsvCellValue = string | number | boolean | null | undefined;

// Spreadsheet applications can interpret cells as formulas even when a
// dangerous prefix follows spaces or control whitespace. Prefixing with an
// apostrophe forces text interpretation while preserving the visible value.
const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/u;
const DANGEROUS_CONTROL_PREFIX = /^[\t\r]/u;

export function csvCell(value: CsvCellValue): string {
  const raw = String(value ?? "").replace(/\0/g, "");
  const neutralized = typeof value === "string"
    && (FORMULA_PREFIX.test(raw) || DANGEROUS_CONTROL_PREFIX.test(raw))
      ? `'${raw}`
      : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function csvRow(values: readonly CsvCellValue[]): string {
  return values.map(csvCell).join(",");
}
