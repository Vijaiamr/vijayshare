"use client";

import * as React from "react";
import { useAdminData } from "@/components/admin/analytics/use-admin-data";
import { Panel, LoadingRow, ErrorBanner, EmptyState } from "@/components/admin/analytics/ui";

interface AudiencesData {
  days: number;
  audiences: {
    id: string;
    name: string;
    definition: { type?: string; value?: unknown } | null;
    members: number;
  }[];
}

const TYPE_LABEL: Record<string, string> = {
  source: "Source",
  country: "Country",
  device: "Device",
  returning: "Returning",
  converted: "Converted",
  engaged: "Engaged",
};

export default function AudiencesPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading } = useAdminData<AudiencesData>(`/api/admin/analytics/audiences?days=${days}`, days);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Audiences</h1>
          <p className="text-sm text-muted-foreground">Segments with live member counts</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingRow rows={2} />}

      {data && data.audiences.length === 0 && (
        <EmptyState message="No audiences defined yet. Audiences are seeded with the analytics schema." />
      )}

      {data && data.audiences.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.audiences.map((a) => (
            <Panel key={a.id} title={a.name}>
              <div className="text-3xl font-bold tabular-nums">{a.members.toLocaleString()}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {a.definition?.type ? (
                  <>
                    {TYPE_LABEL[a.definition.type] ?? a.definition.type}:{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5">{String(a.definition.value ?? "")}</code>
                  </>
                ) : (
                  "No definition"
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}