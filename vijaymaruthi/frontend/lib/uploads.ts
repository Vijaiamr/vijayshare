/**
 * Server-only helper: store user-uploaded files in the private Supabase
 * Storage bucket `user-uploads` so they can be pulled down to the owner's
 * Mac by `sync/download_uploads.py`.
 *
 * ⚠️ Never import from client components — reads service-role env vars.
 *
 * Object path convention (parsed by the Mac downloader):
 *   {userId}/{ISO-timestamp}_{source}_{sanitized-filename}
 * e.g. b1beaa3b-…/2026-09-13T07-32-42-890Z_ledger_Statement_Aug.xlsx
 */

import { supabaseConfigured } from "./supabase";

const BUCKET = "user-uploads";

export interface StoredUpload {
  path: string;
  size: number;
  uploadedAt: string;
}

export async function storeUploadedFile(opts: {
  buffer: ArrayBuffer;
  filename: string;
  userId: string;
  source: string;
  contentType?: string;
}): Promise<StoredUpload | null> {
  if (!supabaseConfigured()) return null;

  const { buffer, filename, userId, source, contentType } = opts;
  const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${userId}/${ts}_${source}_${safeName}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": contentType ?? "application/octet-stream",
      "x-upsert": "false",
    },
    body: buffer,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage upload failed: ${res.status} ${body.slice(0, 200)}`);
  }

  return { path, size: buffer.byteLength, uploadedAt: new Date().toISOString() };
}