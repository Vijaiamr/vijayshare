"use client";

import SideMenu from "@/components/SideMenu";
import AppNavbar from "@/components/AppNavbar";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import { ScanProvider } from "@/lib/scan-context";
import { AdminProvider } from "@/lib/admin-context";
import ScanProgressBanner from "@/components/ScanProgressBanner";

// App shell — sidebar + top bar + content. Only mounted for authenticated pages.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScanProvider>
      <AdminProvider>
        <AnalyticsTracker />
        <div className="flex min-h-screen">
        <SideMenu />
        <AppNavbar />
        <main className="flex-1 overflow-auto pb-12 pt-16 md:pt-0 max-md:px-1.5 md:px-3 max-md:mt-16 md:mt-3">
          <ScanProgressBanner />
          <div className="flex flex-col items-center gap-2 max-md:mt-2 md:mt-3">
            {children}
          </div>
        </main>
      </div>
      </AdminProvider>
    </ScanProvider>
  );
}
