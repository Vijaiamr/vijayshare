/**
 * UPI app export adapters (PhonePe / Google Pay / Paytm).
 *
 * These apps export CSVs with app-specific columns. Each adapter normalizes
 * the export into a standard grid:
 *
 *   ["Date", "Description", "Amount", "Dr/Cr"]
 *
 * which the shared pipeline (autoDetectColumns + parseStandardFile) then
 * handles — "Dr/Cr" values like Debit/Credit/Paid/Received flip the sign.
 */

import { parseCsv } from "./engine";

export function parseUpiExport(text: string): string[][] | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0].map((c) => c.toLowerCase().trim());
  const joined = header.join(" ");

  if (joined.includes("utr") && joined.includes("sender") && joined.includes("recipient")) {
    return normalizePhonePe(rows);
  }
  if (joined.includes("category") && joined.includes("utr") && joined.includes("debit") && joined.includes("credit")) {
    return normalizeGpay(rows);
  }
  if (joined.includes("reference") && joined.includes("type") && joined.includes("note")) {
    return normalizePaytm(rows);
  }
  return null;
}

function colIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.includes(name));
}

function normalizePhonePe(rows: string[][]): string[][] {
  const header = rows[0].map((c) => c.toLowerCase().trim());
  const dateI = colIndex(header, "date");
  const typeI = colIndex(header, "type");
  const amountI = colIndex(header, "amount");
  const senderI = colIndex(header, "sender");
  const recipientI = colIndex(header, "recipient");
  const noteI = colIndex(header, "note");

  const out: string[][] = [["Date", "Description", "Amount", "Dr/Cr"]];
  for (const r of rows.slice(1)) {
    const date = r[dateI] ?? "";
    const type = r[typeI] ?? "";
    const amount = r[amountI] ?? "";
    const sender = r[senderI] ?? "";
    const recipient = r[recipientI] ?? "";
    const note = r[noteI] ?? "";
    const desc = [sender, recipient, note].filter(Boolean).join(" ");
    out.push([date, desc, amount, type]);
  }
  return out;
}

function normalizeGpay(rows: string[][]): string[][] {
  const header = rows[0].map((c) => c.toLowerCase().trim());
  const dateI = colIndex(header, "date");
  const typeI = colIndex(header, "type");
  const catI = colIndex(header, "category");
  const debitI = colIndex(header, "debit");
  const creditI = colIndex(header, "credit");
  const noteI = colIndex(header, "note");

  const out: string[][] = [["Date", "Description", "Amount", "Dr/Cr"]];
  for (const r of rows.slice(1)) {
    const date = r[dateI] ?? "";
    const type = r[typeI] ?? "";
    const cat = r[catI] ?? "";
    const debit = r[debitI] ?? "";
    const credit = r[creditI] ?? "";
    const note = r[noteI] ?? "";
    const desc = [cat, note].filter(Boolean).join(" ");
    const amount = debit ? debit : credit;
    out.push([date, desc, amount, type]);
  }
  return out;
}

function normalizePaytm(rows: string[][]): string[][] {
  const header = rows[0].map((c) => c.toLowerCase().trim());
  const dateI = colIndex(header, "date");
  const typeI = colIndex(header, "type");
  const amountI = colIndex(header, "amount");
  const noteI = colIndex(header, "note");

  const out: string[][] = [["Date", "Description", "Amount", "Dr/Cr"]];
  for (const r of rows.slice(1)) {
    const date = r[dateI] ?? "";
    const type = r[typeI] ?? "";
    const amount = r[amountI] ?? "";
    const note = r[noteI] ?? "";
    out.push([date, note, amount, type]);
  }
  return out;
}