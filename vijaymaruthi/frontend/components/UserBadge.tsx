"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  /** Slim mode: avatar + sign-out only (for the mobile top bar). */
  slim?: boolean;
}

/**
 * Displays the signed-in user (email) and a sign-out button.
 * Falls back to the legacy placeholder when Supabase auth isn't configured
 * (local development mode).
 */
export default function UserBadge({ slim = false }: Props) {
  const [email, setEmail] = React.useState<string | null>(null);
  const router = useRouter();

  React.useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  const handleSignOut = async () => {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    router.push("/login");
    router.refresh();
  };

  const displayName = email ? email.split("@")[0] : "User";
  const initial = (email || "V").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Avatar className="h-[34px] w-[34px] bg-primary text-primary-foreground text-xs font-bold">
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
      {!slim && (
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{email ?? "Signed in"}</p>
        </div>
      )}
      <Tooltip>
        <TooltipTrigger
          onClick={handleSignOut}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>Sign out</TooltipContent>
      </Tooltip>
    </div>
  );
}
