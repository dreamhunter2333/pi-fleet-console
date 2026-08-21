import { Suspense } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { FleetProvider } from "@/hooks/useFleet";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <FleetProvider />
      </I18nProvider>
    </Suspense>
  );
}
