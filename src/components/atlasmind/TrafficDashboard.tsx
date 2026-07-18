import { useEffect, useMemo, useState } from "react";

type Level = "light" | "moderate" | "heavy";

type Road = {
  id: number;
  name: string;
  ref?: string;
  highway: string;
  area: string;
};

const ROADS: Road[] = [
  { id: 1, name: "University Road", ref: "M-9", highway: "primary", area: "City Centre" },
  { id: 2, name: "Main Boulevard", ref: "N-5", highway: "trunk", area: "Downtown" },
  { id: 3, name: "Airport Link", ref: "M-2", highway: "motorway", area: "North Zone" },
  { id: 4, name: "Jail Road", highway: "secondary", area: "Old City" },
  { id: 5, name: "Garden Town Lane", highway: "residential", area: "Garden Town" },
];

function congestionFor(
  highway: string,
  now = new Date(),
): { level: Level; pct: number; label: string; trend: "rising" | "falling" | "stable" } {
  const hour = now.getHours() + now.getMinutes() / 60;
  const day = now.getDay();

  const morning = Math.exp(-Math.pow((hour - 8) / 1.2, 2));
  const evening = Math.exp(-Math.pow((hour - 18) / 1.4, 2));
  const midday = 0.35 * Math.exp(-Math.pow((hour - 13) / 2.5, 2));
  let score = 0.15 + 0.65 * Math.max(morning, evening) + midday;

  if (day === 5 && hour >= 12 && hour <= 14) score += 0.2;
  if ((day === 0 || day === 6) && hour < 10) score *= 0.55;
  if (hour < 6 || hour >= 23) score *= 0.35;

  const weight: Record<string, number> = {
    motorway: 1.1,
    trunk: 1.05,
    primary: 1.0,
    secondary: 0.9,
    tertiary: 0.8,
    residential: 0.65,
    unclassified: 0.7,
  };
  const w = weight[highway] ?? 0.85;
  score = Math.min(1, score * w);

  // Calculate trend by comparing with 30 mins ago
  const hourPrev = hour - 0.5;
  const morningP = Math.exp(-Math.pow((hourPrev - 8) / 1.2, 2));
  const eveningP = Math.exp(-Math.pow((hourPrev - 18) / 1.4, 2));
  const middayP = 0.35 * Math.exp(-Math.pow((hourPrev - 13) / 2.5, 2));
  let prevScore = 0.15 + 0.65 * Math.max(morningP, eveningP) + middayP;
  prevScore = Math.min(1, prevScore * w);

  const diff = score - prevScore;
  const trend: "rising" | "falling" | "stable" =
    diff > 0.04 ? "rising" : diff < -0.04 ? "falling" : "stable";

  const pct = Math.round(score * 100);
  let level: Level = "light";
  let label = "Light";
  if (pct >= 66) {
    level = "heavy";
    label = "Heavy";
  } else if (pct >= 38) {
    level = "moderate";
    label = "Moderate";
  }
  return { level, pct, label, trend };
}

const LEVEL_COLOR: Record<Level, string> = {
  light: "#22c55e",
  moderate: "#f5b301",
  heavy: "#ff2d55",
};

const LEVEL_BG: Record<Level, string> = {
  light: "rgba(34,197,94,0.12)",
  moderate: "rgba(245,179,1,0.12)",
  heavy: "rgba(255,45,85,0.12)",
};

const TREND_ICON: Record<string, string> = {
  rising: "↑",
  falling: "↓",
  stable: "→",
};

export function TrafficDashboard({ active }: { active: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [active]);

  const { timestamp, dayLabel, isRushHour } = useMemo(() => {
    void tick;
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const day = now.getDay();
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const rush = (h >= 7 && h <= 9) || (h >= 17 && h <= 20) || (day === 5 && h >= 12 && h <= 14);
    return {
      timestamp: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      dayLabel: days[day],
      isRushHour: rush,
    };
  }, [tick]);

  const roads = useMemo(() => {
    void tick;
    return ROADS.map((road) => ({ ...road, congestion: congestionFor(road.highway) }));
  }, [tick]);

  const overallLevel: Level = useMemo(() => {
    const avg = roads.reduce((s, r) => s + r.congestion.pct, 0) / roads.length;
    if (avg >= 66) return "heavy";
    if (avg >= 38) return "moderate";
    return "light";
  }, [roads]);

  return (
    <div className="am-anim-fade" style={{ display: "grid", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>🚦 Nearby road congestion</div>
          <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2 }}>
            {dayLabel} · {timestamp} · time-based estimate
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 999,
            background: LEVEL_BG[overallLevel],
            border: `1px solid ${LEVEL_COLOR[overallLevel]}40`,
            fontSize: 11,
            fontWeight: 600,
            color: LEVEL_COLOR[overallLevel],
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{ width: 7, height: 7, borderRadius: "50%", background: LEVEL_COLOR[overallLevel] }}
          />
          Overall: {overallLevel === "light" ? "Light" : overallLevel === "moderate" ? "Moderate" : "Heavy"}
        </div>
      </div>

      {isRushHour && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(245,179,1,0.12)",
            border: "1px solid rgba(245,179,1,0.3)",
            fontSize: 12,
            color: "#f5b301",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>⚠️</span>
          <span>Rush hour active — expect higher congestion on major roads</span>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {(["light", "moderate", "heavy"] as Level[]).map((l) => (
          <span
            key={l}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              color: "var(--am-muted)",
              textTransform: "capitalize",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: LEVEL_COLOR[l],
              }}
            />
            {l}
          </span>
        ))}
        <span style={{ fontSize: 10, color: "var(--am-muted)", marginLeft: "auto" }}>
          ↑ rising &nbsp; ↓ easing
        </span>
      </div>

      {/* Roads */}
      <div style={{ display: "grid", gap: 7 }}>
        {roads.map((road) => {
          const c = road.congestion;
          return (
            <div key={road.id} className="am-card" style={{ cursor: "default", padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: LEVEL_COLOR[c.level],
                        boxShadow: `0 0 8px ${LEVEL_COLOR[c.level]}`,
                        flexShrink: 0,
                      }}
                    />
                    {road.name}
                    {road.ref && (
                      <span style={{ fontSize: 10, color: "var(--am-muted)", fontWeight: 400 }}>
                        {road.ref}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--am-muted)", marginTop: 2 }}>
                    {road.area} · {road.highway} road
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: LEVEL_COLOR[c.level],
                    }}
                  >
                    {c.label} · {c.pct}%
                  </div>
                  <div style={{ fontSize: 10, color: "var(--am-muted)", marginTop: 1 }}>
                    {TREND_ICON[c.trend]} {c.trend}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 6,
                  borderRadius: 999,
                  background: "rgba(139,147,163,0.15)",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: `${c.pct}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${LEVEL_COLOR[c.level]}cc, ${LEVEL_COLOR[c.level]})`,
                    boxShadow: `0 0 12px ${LEVEL_COLOR[c.level]}60`,
                    borderRadius: 999,
                    transition: "width .8s cubic-bezier(.2,.7,.2,1)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 10,
          color: "var(--am-muted)",
          lineHeight: 1.6,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(139,147,163,0.08)",
          border: "1px solid var(--am-border)",
        }}
      >
        <strong>Note:</strong> This is a time-based estimate using typical commute patterns (busy 7–9 AM
        and 5–8 PM, Friday 12–2 PM). It is not live GPS or sensor data. Actual road conditions may differ.
      </div>
    </div>
  );
}
