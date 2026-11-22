"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { analytics } from "@/lib/analytics/client-tracker";

/**
 * Global analytics tracker — renders nothing.
 *
 * Mounted in the (app) shell (protected pages) and the (auth) layout
 * (login/signup landings). Survives client-side route transitions, so
 * usePathname() gives continuous page-view + time-on-page coverage.
 */
export default function AnalyticsTracker() {
  const pathname = usePathname();
  const first = React.useRef(true);

  React.useEffect(() => {
    analytics.init();
    analytics.pageView(pathname);
    first.current = false;
  }, [pathname]);

  return null;
}