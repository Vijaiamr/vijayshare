import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { parseUploadedFile, dedupKeys } from "@/lib/ledger/engine";
import { ledgerConfigured, getCorrections, insertTransactions } from "@/lib/ledger/db";
import { storeUploadedFile } from "@/lib/uploads";
import type { Transaction } from "@/lib/ledger/types";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/ledger/upload
 *
 * Multipart upload of a bank statement (.xlsx / .xls / .xlsm / .xlsb / .csv /
 * .txt / .pdf — any Indian retail bank, credit card, or UPI export).
 * Parses + categorizes with the TS engine, persists the rows to Supabase
 * scoped to the authenticated user, and returns the categorized result.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!ledgerConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  const filename = file.name || "uploaded_file";
  const lower = filename.toLowerCase();
  const SUPPORTED_EXT = [".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".txt", ".pdf"];
  if (!SUPPORTED_EXT.some((ext) => lower.endsWith(ext))) {
    return NextResponse.json(
      { error: "Unsupported file type. Use .xlsx, .xls, .xlsm, .xlsb, .csv, .txt, or .pdf" },
      { status: 400 },
    );
  }

  try {
    const contents = await file.arrayBuffer();
    const corrections = await getCorrections(user.id);
    const result = await parseUploadedFile(contents, filename, corrections);

    // Never fail silently: if the parser could not extract a single
    // transaction, tell the user instead of returning an empty success.
    if (result.transactions.length === 0) {
      return NextResponse.json(
        {
          error:
            "No transactions could be extracted from this file. It may not be a bank statement, or the layout isn't recognized yet. Supported: .xlsx, .xls, .xlsm, .xlsb, .csv, .txt, .pdf from Indian retail banks, credit cards, and UPI apps (PhonePe / GPay / Paytm).",
        },
        { status: 422 },
      );
    }

    // Persist per-user. Dedupe against existing rows with two tiers:
    //   exact      — (date, raw description, amount). Never false-merges two
    //                genuinely distinct same-day same-amount swipes that carry
    //                different ref numbers.
    //   normalized — (date, ref/handle-stripped description, amount). Catches
    //                cross-bank UPI where only the volatile ref/handle
    //                segments differ between statements of the same txn.
    // Existing rows are fetched only within the file's date range (cheaper and
    // avoids the 10k-row cap hiding older rows from the dedup set).
    const dates = result.transactions.map((t) => t.date).filter(Boolean).sort();
    const existing = await getExistingKeys(user.id, dates[0], dates[dates.length - 1]);
    let skippedExact = 0;
    let skippedNormalized = 0;
    const fresh: Transaction[] = [];
    for (const t of result.transactions) {
      const keys = dedupKeys(t);
      if (existing.exact.has(keys.exact)) {
        skippedExact++;
        continue;
      }
      if (existing.normalized.has(keys.normalized)) {
        skippedNormalized++;
        continue;
      }
      fresh.push(t);
    }
    const saved = await insertTransactions(user.id, fresh);

    // Store the original file in the private `user-uploads` bucket so the
    // owner's Mac can pull it down (sync/download_uploads.py). Best-effort:
    // a storage failure must never fail the import itself.
    try {
      await storeUploadedFile({
        buffer: contents,
        filename,
        userId: user.id,
        source: "ledger",
        contentType: file.type || "application/octet-stream",
      });
    } catch (err) {
      console.error("upload-store:", err instanceof Error ? err.message : err);
    }

    // Return the COMPLETE per-user list (existing + freshly inserted). If we
    // only returned `saved`, a re-upload of an already-imported statement would
    // return [] and the client would wipe its state even though rows exist.
    const { getTransactions } = await import("@/lib/ledger/db");
    const all = await getTransactions(user.id);

    return NextResponse.json({
      transactions: all,
      insights: result.insights,
      budgets: result.budgets,
      isFallback: result.isFallback,
      skippedDuplicates: skippedExact + skippedNormalized,
      skippedExact,
      skippedNormalized,
      importedCount: saved.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: `Cannot parse file. ${message}` }, { status: 400 });
  }
}

async function getExistingKeys(
  ownerId: string,
  startDate?: string,
  endDate?: string,
): Promise<{ exact: Set<string>; normalized: Set<string> }> {
  const { getTransactionsByRange } = await import("@/lib/ledger/db");
  const txs = await getTransactionsByRange(ownerId, startDate, endDate);
  const exact = new Set<string>();
  const normalized = new Set<string>();
  for (const t of txs) {
    const keys = dedupKeys(t);
    exact.add(keys.exact);
    normalized.add(keys.normalized);
  }
  return { exact, normalized };
}