import { useEffect, useMemo, useState } from "react";

type Level = "light" | "moderate" | "heavy";

type Road = {
  id: number;
  name: string;
  ref?: string;
  highway: string;
};

// Fixed, curated list of representative nearby roads. No network request is
// made — congestion is derived purely from time of day and day of week.
const ROADS: Road[] = [
  { id: 1, name: "University Road", ref: "M-9", highway: "primary" },
  { id: 2, name: "Main Boulevard", ref: "N-5", highway: "trunk" },
  { id: 3, name: "Airport Link", ref: "M-2", highway: "motorway" },
  { id: 4, name: "Jail Road", highway: "secondary" },
  { id: 5, name: "Garden Town Lane", highway: "residential" },
];

/**
 * Time-of-day + day-of-week based congestion estimate.
 * Not live GPS data — a modeled baseline.
 * Higher-class roads (trunk/primary) carry more of the peak load.
 */
function congestionFor(highway: string, now = new Date()): { level: Level; pct: number; label: string } {
  const hour = now.getHours() + now.getMinutes() / 60;
  const day = now.getDay(); // 0 Sun ... 5 Fri, 6 Sat

  // base score 0..1 by hour (bell curves around 8am and 6pm)
  const morning = Math.exp(-Math.pow((hour - 8) / 1.2, 2)); // peak 8am
  const evening = Math.exp(-Math.pow((hour - 18) / 1.4, 2)); // peak 6pm
  const midday = 0.35 * Math.exp(-Math.pow((hour - 13) / 2.5, 2));
  let score = 0.15 + 0.65 * Math.max(morning, evening) + midday;

  // Friday 12–2pm bump
  if (day === 5 && hour >= 12 && hour <= 14) score += 0.2;
  // Weekend mornings quieter
  if ((day === 0 || day === 6) && hour < 10) score *= 0.55;
  // Late night quiet
  if (hour < 6 || hour >= 23) score *= 0.35;

  // Road-class weighting — bigger roads absorb more peak traffic
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
  return { level, pct, label };
}

const LEVEL_COLOR: Record<Level, string> = {
  light: "#22c55e",
  moderate: "#f5b301",
  heavy: "#ff2d55",
};

export function TrafficDashboard({ active }: { active: boolean }) {
  const [tick, setTick] = useState(0);

  // Re-evaluate congestion every 60s so the bars stay current if left open
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [active]);

  const timestamp = useMemo(() => {
    void tick;
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [tick]);

  return (
    <div className="am-anim-fade" style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>🚦 Nearby road congestion</div>
          <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2 }}>
            Time-based estimate · not live GPS · updated {timestamp}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
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
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {ROADS.map((road) => {
          const c = congestionFor(road.highway);
          return (
            <div key={road.id} className="am-card" style={{ cursor: "default" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {road.ref ? `${road.ref} · ` : ""}
                    {road.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--am-muted)", textTransform: "capitalize" }}>
                    {road.highway} road
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: LEVEL_COLOR[c.level],
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label} · {c.pct}%
                </div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 6,
                  borderRadius: 999,
                  background: "rgba(139,147,163,0.18)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${c.pct}%`,
                    height: "100%",
                    background: LEVEL_COLOR[c.level],
                    boxShadow: `0 0 12px ${LEVEL_COLOR[c.level]}80`,
                    transition: "width .6s cubic-bezier(.2,.7,.2,1)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 10, color: "var(--am-muted)", lineHeight: 1.5 }}>
        Modeled from typical weekday commute patterns (busier 7–9 AM and 5–8 PM, Friday 12–2 PM).
        Actual conditions may vary — this is a heuristic, not live sensor data.
      </div>
    </div>
  );
}
