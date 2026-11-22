/**
 * PDF bank-statement parser.
 *
 * Uses pdfjs-dist (serverless-safe, no worker needed in Node) to extract
 * positioned text items, groups them into lines, finds the column header via
 * the shared header scorer, then slices every line into columns using the
 * header tokens' x-positions as boundaries. Output is a 2D string grid that
 * flows through the standard ledger pipeline.
 */

import { scoreHeaderRow } from "./engine";

interface PdfItem {
  x: number;
  text: string;
}

interface PdfLine {
  y: number;
  items: PdfItem[];
}

export async function parsePdfToRows(contents: ArrayBuffer): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(contents),
    useWorkerFetch: false,
    disableFontFace: true,
    // No standardFontDataUrl: fonts are only needed for rendering, not text
    // extraction. pdfjs logs a benign warning in Node when a PDF uses
    // standard fonts; parsing is unaffected.
  }).promise;

  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const byY = new Map<number, PdfItem[]>();
    for (const item of tc.items) {
      if (!("str" in item)) continue;
      const str = (item as { str: string }).str;
      if (!str || !str.trim()) continue;
      const transform = (item as { transform: number[] }).transform;
      const y = Math.round(transform[5]);
      const x = transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, text: str });
    }
    // PDF y-axis is bottom-up; sort top-to-bottom, items left-to-right.
    const sortedYs = [...byY.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const items = byY.get(y)!.sort((a, b) => a.x - b.x);
      lines.push({ y, items });
    }
  }

  return splitPdfLinesIntoColumns(lines);
}

export function splitPdfLinesIntoColumns(lines: PdfLine[]): string[][] {
  // Find the header line (best header score).
  let headerIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].items.map((it) => it.text).join(" ").toLowerCase();
    const score = scoreHeaderRow(text);
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }
  if (headerIdx < 0 || bestScore < 4) return [];

  const headerItems = lines[headerIdx].items;
  const boundaries: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < headerItems.length; i++) {
    const start = headerItems[i].x;
    const end = i + 1 < headerItems.length ? headerItems[i + 1].x : Infinity;
    boundaries.push({ start, end });
  }

  const rows: string[][] = [headerItems.map((it) => it.text)];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const row: string[] = [];
    for (const b of boundaries) {
      const cell = line.items
        .filter((it) => it.x >= b.start && it.x < b.end)
        .map((it) => it.text)
        .join(" ");
      row.push(cell.trim());
    }
    rows.push(row);
  }
  return rows;
}