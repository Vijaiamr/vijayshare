import AnalyticsTracker from "@/components/AnalyticsTracker";

export const metadata = {
  title: "VijayMaruthi Wealth",
};

// Minimal centered layout for login / signup pages (no sidebar).
// Terminal backdrop: emerald bloom + subtle grid.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-2">
      <AnalyticsTracker />
      {/* Backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(900px 420px at 50% -10%, rgba(16,185,129,0.10), transparent 60%), linear-gradient(rgba(128,128,128,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,0.06) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 44px 44px, 44px 44px",
        }}
      />
      <div className="relative w-full max-w-[420px]">{children}</div>
    </div>
  );
}