"use client";

import { AppShell as UpstreamAppShell } from "@/components/AppShell";
import { FleetProvider } from "@/hooks/useFleet";

export function AppShell() {
  if (process.env.NEXT_PUBLIC_PI_FLEET !== "1") return <UpstreamAppShell />;
  return (
    <FleetProvider>
      <UpstreamAppShell />
    </FleetProvider>
  );
}
