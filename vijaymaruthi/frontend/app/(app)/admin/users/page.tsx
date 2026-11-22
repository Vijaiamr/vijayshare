"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Home, Shield, UserPlus, Trash2, Eye, EyeOff, Dices } from "lucide-react";

interface UserRow {
  id: string;
  email: string;
  role: string;
  approved: boolean;
  created_at: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateStrongPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = upper + lower + digits + symbols;
  const buf = new Uint32Array(1);
  const pick = (set: string) => {
    crypto.getRandomValues(buf);
    return set[buf[0] % set.length];
  };
  const pw = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(symbols),
    ...Array.from({ length: 12 }, () => pick(all)),
  ];
  for (let i = pw.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join("");
}

export default function AdminUsersPage() {
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [viewerId, setViewerId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState("user");
  const [approved, setApproved] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [createBusy, setCreateBusy] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed (${res.status})`);
        setUsers([]);
        return;
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setViewerId(data.viewerId ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const postUpdate = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Update failed (${res.status})`);
    await load();
  };

  const handleApproval = async (u: UserRow, value: boolean) => {
    setBusyId(u.id);
    setError(null);
    setNotice(null);
    try {
      await postUpdate({ userId: u.id, approved: value });
      setNotice(`${u.email} ${value ? "approved" : "suspended"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (u: UserRow, value: string) => {
    setBusyId(u.id);
    setError(null);
    setNotice(null);
    try {
      await postUpdate({ userId: u.id, role: value });
      setNotice(`${u.email} is now ${value}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Role update failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setCreateBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          email: trimmed,
          password,
          role,
          approved,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Create failed (${res.status})`);
        return;
      }
      setNotice(`Account created for ${trimmed}. They can sign in immediately.`);
      setEmail("");
      setPassword("");
      setRole("user");
      setApproved(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", userId: deleteTarget.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Delete failed (${res.status})`);
        return;
      }
      setNotice(`Deleted ${deleteTarget.email}.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  const ownRow = (u: UserRow) => viewerId !== null && u.id === viewerId;

  return (
    <div className="w-full max-w-[1000px]">
      <TooltipProvider>
        {/* Breadcrumb */}
        <nav className="mb-1 flex items-center gap-2 text-sm">
          <Link
            href="/"
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Home size={16} />
            Home
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground">User Management</span>
        </nav>

        {/* ── Create user ── */}
        <Card className="mb-3">
          <CardContent>
            <div className="mb-1 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              <h6 className="text-base font-bold">Create User</h6>
            </div>
            <p className="mb-2 text-sm text-muted-foreground">
              Create an account instantly &mdash; the email is auto-confirmed, so the
              user can sign in with these credentials right away.
            </p>

            {error && (
              <div className="mb-2 rounded-lg border border-l-4 border-l-red-500 border-red-200 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
                <button
                  onClick={() => setError(null)}
                  className="ml-2 text-destructive/60 hover:text-destructive"
                >
                  &times;
                </button>
              </div>
            )}
            {notice && (
              <div className="mb-2 rounded-lg border border-l-4 border-l-green-500 border-green-200 bg-green-50 p-3 text-sm text-green-700">
                {notice}
                <button
                  onClick={() => setNotice(null)}
                  className="ml-2 text-green-700/60 hover:text-green-700"
                >
                  &times;
                </button>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="create-email">Email</Label>
                  <Input
                    id="create-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={createBusy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="create-password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={createBusy}
                      className="pr-20"
                    />
                    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          disabled={createBusy}
                          onClick={() => setPassword(generateStrongPassword())}
                          className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
                        >
                          <Dices className="h-4 w-4" />
                        </TooltipTrigger>
                        <TooltipContent>Generate strong password</TooltipContent>
                      </Tooltip>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={createBusy}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                   <Select value={role} onValueChange={(v) => v && setRole(v)} disabled={createBusy}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={approved ? "approved" : "pending"}
                    onValueChange={(v) => setApproved(v === "approved")}
                    disabled={createBusy}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">
                        Approved &mdash; immediate access
                      </SelectItem>
                      <SelectItem value="pending">
                        Pending &mdash; requires approval
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" disabled={createBusy} className="gap-2">
                {createBusy ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Create User
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── User list ── */}
        <Card>
          <CardContent>
            <div className="mb-1 flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h6 className="text-base font-bold">User Management</h6>
            </div>
            <p className="mb-2 text-sm text-muted-foreground">
              Approve new sign-ups, change roles, or delete accounts. The first user is
              automatically the administrator.
            </p>

            {loading ? (
              <div className="flex justify-center py-16">
                <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users yet.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Signed up</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const isSelf = ownRow(u);
                      const isBusy = busyId === u.id;
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            {u.email}
                            {isSelf && (
                              <Badge variant="secondary" className="ml-1 text-[0.6rem]">
                                you
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {isSelf ? (
                              <Badge variant="outline" className="capitalize">
                                {u.role}
                              </Badge>
                            ) : (
                              <Select
                                value={u.role}
                                onValueChange={(v) => v && handleRoleChange(u, v)}
                                disabled={isBusy}
                              >
                                <SelectTrigger className="w-24">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="user">User</SelectItem>
                                  <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={u.approved ? "default" : "secondary"}
                              className={u.approved ? "bg-green-600 hover:bg-green-600/80" : "border-amber-400 text-amber-700"}
                            >
                              {u.approved ? "Approved" : "Pending"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {u.created_at
                              ? new Date(u.created_at).toLocaleDateString()
                              : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isSelf ? (
                                <span className="text-xs text-muted-foreground">
                                  (you)
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant={u.approved ? "outline" : "default"}
                                  className={
                                    u.approved
                                      ? "border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      : "bg-strong-buy hover:bg-strong-buy/90"
                                  }
                                  disabled={isBusy}
                                  onClick={() => handleApproval(u, !u.approved)}
                                >
                                  {u.approved ? "Suspend" : "Approve"}
                                </Button>
                              )}
                              <Tooltip>
                                <TooltipTrigger
                                  disabled={isBusy || isSelf}
                                  onClick={() => setDeleteTarget(u)}
                                  className="inline-flex items-center justify-center rounded-md p-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isSelf
                                    ? "You cannot delete your own account"
                                    : "Delete user"}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Delete confirmation ── */}
        <Dialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && !deleteBusy && setDeleteTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete user?</DialogTitle>
              <DialogDescription>
                Delete <strong>{deleteTarget?.email}</strong>? Their account is removed
                immediately and they can no longer sign in. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteBusy}
                onClick={confirmDelete}
                className="gap-2"
              >
                {deleteBusy ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </div>
  );
}
