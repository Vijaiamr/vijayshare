/**
 * Text-format statement parsers: delimited (tab/semicolon/pipe/comma),
 * fixed-width "text statement" exports, and content-type sniffing.
 *
 * All functions are pure and return a 2D string grid compatible with the
 * shared ledger pipeline (parseBankStatement / parseStandardFile).
 */

import { scoreHeaderRow } from "./engine";

export type ContentType = "xlsx" | "xls" | "pdf" | "text" | "unknown";

/** Sniff the real content type from magic bytes, not the file extension. */
export function sniffContentType(contents: ArrayBuffer | Uint8Array): ContentType {
  const bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
  const magic = Array.from(bytes.slice(0, 8))
    .map((b) => String.fromCharCode(b))
    .join("");
  if (magic.startsWith("%PDF")) return "pdf";
  if (magic.startsWith("PK\x03\x04")) return "xlsx";
  if (magic.startsWith("\xD0\xCF\x11\xE0")) return "xls";
  // Anything else that looks like printable text is treated as text.
  const head = new TextDecoder().decode(bytes.slice(0, 512));
  if (/[\t,;|]/.test(head) || /^[A-Za-z0-9]/.test(head.trim())) return "text";
  return "unknown";
}

/** Pick the most likely delimiter from the first non-empty line. */
export function detectDelimiter(text: string): string | null {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const candidates = ["\t", ";", "|", ","];
  let best: string | null = null;
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return bestCount >= 2 ? best : null;
}

/** Split a delimited text (non-comma) into a 2D grid. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    rows.push(line.split(delimiter).map((c) => c.trim()));
  }
  return rows;
}

/**
 * Fixed-width "text statement" parser. Uses the header line to anchor column
 * boundaries (start of each header token), then slices every line at those
 * boundaries. Returns rows with the header as rows[0].
 */
export function parseFixedWidth(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const score = scoreHeaderRow(lines[i].toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }
  if (headerIdx < 0 || bestScore < 4) return [];

  const headerLine = lines[headerIdx];
  const starts: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(headerLine)) !== null) {
    starts.push(m.index);
  }
  if (starts.length < 2) return [];

  const slice = (line: string, j: number): string => {
    const start = starts[j];
    const end = j + 1 < starts.length ? starts[j + 1] : line.length;
    return line.slice(start, end).trim();
  };

  const rows: string[][] = [];
  for (let i = headerIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const row: string[] = [];
    for (let j = 0; j < starts.length; j++) row.push(slice(line, j));
    rows.push(row);
  }
  return rows;
}