"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CandlestickChart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [inviteCode, setInviteCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const check = await fetch("/api/auth/verify-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode }),
      });
      if (!check.ok) {
        const body = await check.json().catch(() => ({}));
        setError(body.error || "Invalid invite code.");
        return;
      }

      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(authError.message);
        return;
      }
      if (data.session) {
        setMessage("Account created! Redirecting to your dashboard\u2026");
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 1200);
      } else {
        setMessage(
          "Account created! Check your email for a confirmation link, then sign in. " +
            "Your access is pending approval by the administrator.",
        );
        setEmail("");
        setPassword("");
        setInviteCode("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-6">
        <div className="flex items-center justify-center gap-3 mb-1">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[10px]"
            style={{
              background: "linear-gradient(135deg, #34d399 0%, #0b8a5f 100%)",
              boxShadow: "0 0 24px rgba(16,185,129,0.35)",
            }}
          >
            <CandlestickChart size={22} className="text-[#04110b]" />
          </div>
          <h5 className="text-xl font-bold">VijayMaruthi Wealth</h5>
        </div>
        <p className="mb-3 text-center text-sm text-muted-foreground">
          Create an account (invite only)
        </p>

        {error && (
          <div className="mb-2 rounded-lg border border-l-4 border-l-strong-sell border-strong-sell/30 bg-strong-sell/10 p-3 text-sm text-strong-sell">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-2 rounded-lg border border-l-4 border-l-strong-buy border-strong-buy/30 bg-strong-buy/10 p-3 text-sm text-strong-buy">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Create a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteCode">Invite code</Label>
            <Input
              id="inviteCode"
              type="password"
              required
              placeholder="Enter your invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              "Create Account"
            )}
          </Button>
        </form>

        <p className="mt-3 text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
