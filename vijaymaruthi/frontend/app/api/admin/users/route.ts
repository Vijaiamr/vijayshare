import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Admin-only user management.
 *
 * GET  /api/admin/users
 *   → list all profiles (email, role, approved) + viewerId for the UI
 *
 * POST /api/admin/users
 *   { action: "create", email, password, role?, approved? }  → create account
 *     (email is auto-confirmed — the admin hands credentials to the user;
 *      the on-signup trigger creates the profile, then we apply role/approval)
 *   { action: "update", userId, role?, approved? }           → change role / approval
 *   { action: "delete", userId }                             → delete account
 *     (profile is removed via the ON DELETE CASCADE FK on profiles.id)
 *
 * Auth: valid session + the caller's profile must have role='admin'
 * (checked via the service-role client so the check itself can't be spoofed).
 *
 * Guards:
 *   • a user cannot delete their own account
 *   • the last remaining admin cannot be demoted or deleted (no lockout)
 *   • duplicate emails → 409
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["admin", "user"]);

type AdminCtx =
  | { error: NextResponse; user?: undefined; service?: undefined }
  | { user: User; service: SupabaseClient; error?: undefined };

async function requireAdmin(): Promise<AdminCtx> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const service = await createServiceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 }) };
  }
  return { user, service };
}

async function countAdmins(service: SupabaseClient): Promise<number> {
  const { count } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  return count ?? 0;
}

export async function GET() {
  const ctx = await requireAdmin();
  if (ctx.error) return ctx.error;

  const { data: users, error } = await ctx.service
    .from("profiles")
    .select("id,email,role,approved,created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ users, viewerId: ctx.user.id });
}

export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if (ctx.error) return ctx.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  switch (body.action) {
    case "create":
      return createUser(ctx, body);
    case "update":
      return updateUser(ctx, body);
    case "delete":
      return deleteUser(ctx, body);
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

async function createUser(ctx: AdminCtx, body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "user");
  const approved = body.approved === true;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "role must be 'admin' or 'user'" }, { status: 400 });
  }

  const { data, error } = await ctx.service!.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    const msg = error.message ?? "";
    if (error.code === "23505" || /already registered|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // The on-signup trigger auto-created the profile; now apply the admin's
  // requested role and approval status.
  const { error: profileErr } = await ctx.service!
    .from("profiles")
    .update({ role, approved, updated_at: new Date().toISOString() })
    .eq("id", data.user.id);

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, user: { id: data.user.id, email: data.user.email } },
    { status: 201 },
  );
}

async function updateUser(ctx: AdminCtx, body: Record<string, unknown>) {
  const userId = String(body.userId ?? "");
  const role = body.role === undefined ? undefined : String(body.role);
  const approved = body.approved === undefined ? undefined : body.approved === true;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (role !== undefined && !ROLES.has(role)) {
    return NextResponse.json({ error: "role must be 'admin' or 'user'" }, { status: 400 });
  }
  if (role === undefined && approved === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: target, error: fetchErr } = await ctx.service!
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.role === "admin" && role !== undefined && role !== "admin") {
    const admins = await countAdmins(ctx.service!);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot demote the last administrator" },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (role !== undefined) updates.role = role;
  if (approved !== undefined) updates.approved = approved;

  const { error } = await ctx.service!.from("profiles").update(updates).eq("id", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function deleteUser(ctx: AdminCtx, body: Record<string, unknown>) {
  const userId = String(body.userId ?? "");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (userId === ctx.user!.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 400 },
    );
  }

  const { data: target, error: fetchErr } = await ctx.service!
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.role === "admin") {
    const admins = await countAdmins(ctx.service!);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last administrator" },
        { status: 400 },
      );
    }
  }

  const { error } = await ctx.service!.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
