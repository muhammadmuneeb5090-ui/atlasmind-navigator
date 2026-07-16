import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { AtlasMindLogo } from "@/components/atlasmind/Logo";

const AtlasMindApp = lazy(() => import("@/components/atlasmind/AtlasMindApp"));

export const Route = createFileRoute("/")({
  component: Index,
});

function BootScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#0a0e1a",
        color: "#eeece4",
      }}
    >
      <div style={{ display: "grid", placeItems: "center", gap: 14 }}>
        <AtlasMindLogo size={64} />
        <div className="am-font-display am-accent-text" style={{ fontSize: 24, fontWeight: 700 }}>
          AtlasMind
        </div>
        <div style={{ fontSize: 12, color: "#8b93a3" }}>Preparing your world…</div>
      </div>
    </div>
  );
}

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <BootScreen />;
  return (
    <Suspense fallback={<BootScreen />}>
      <AtlasMindApp />
    </Suspense>
  );
}
