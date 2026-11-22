"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, ArrowRight } from "lucide-react";

/**
 * AiOpsLinkCard — additive link from the Auto Pilot page to the
 * "AI Ops & Learning" view (/pilot/aiops). Purely presentational;
 * does not touch any Auto Pilot state or logic.
 */
export default function AiOpsLinkCard() {
  return (
    <Link href="/pilot/aiops" className="block group">
      <Card className="border-border transition-colors group-hover:border-primary">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Brain className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold leading-tight">AI Ops &amp; Learning</p>
              <Badge variant="outline" className="text-[0.55rem] h-4 font-semibold border-primary text-primary bg-primary/10">
                NEW
              </Badge>
            </div>
            <p className="text-[0.65rem] text-muted-foreground leading-snug">
              Morning predict → evening validate → continuous learning (local engine)
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </Link>
  );
}