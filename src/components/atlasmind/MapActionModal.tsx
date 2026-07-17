import { useState } from "react";
import { Modal, Field, ChipButton } from "./Modal";
import {
  addCommunityReport,
  addPlace,
  type ReportCategory,
  type PlaceCategory,
} from "@/lib/db";

const REPORT_CATEGORIES: { key: ReportCategory; label: string; icon: string }[] = [
  { key: "road_damage", label: "Road Damage", icon: "🚧" },
  { key: "flood", label: "Flood", icon: "🌊" },
  { key: "construction", label: "Construction", icon: "🏗️" },
  { key: "parking", label: "Parking", icon: "🅿️" },
  { key: "safety", label: "Safety", icon: "⚠️" },
  { key: "facilities", label: "Facilities", icon: "🏛️" },
];

const PLACE_CATEGORIES: { key: PlaceCategory; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "shop", label: "Shop", icon: "🏪" },
  { key: "lane", label: "Lane", icon: "🛣️" },
];

export type MapAction =
  | { type: "report"; lat: number; lng: number }
  | { type: "place"; lat: number; lng: number }
  | null;

export function MapActionModal({
  action,
  onClose,
  onDone,
}: {
  action: MapAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reportCat, setReportCat] = useState<ReportCategory>("road_damage");
  const [description, setDescription] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [placeCat, setPlaceCat] = useState<PlaceCategory>("home");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!action) return null;

  const close = () => {
    setDescription("");
    setPlaceName("");
    setError(null);
    onClose();
  };

  const submitReport = async () => {
    if (!action || action.type !== "report") return;
    setSaving(true);
    setError(null);
    const ok = await addCommunityReport({
      category: reportCat,
      description: description.trim() || null,
      lat: action.lat,
      lng: action.lng,
    });
    setSaving(false);
    if (!ok) {
      setError("Could not save report — please try again.");
      return;
    }
    onDone();
    close();
  };

  const submitPlace = async () => {
    if (!action || action.type !== "place") return;
    if (!placeName.trim()) {
      setError("Please enter a name for this place.");
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await addPlace({
      name: placeName.trim(),
      category: placeCat,
      lat: action.lat,
      lng: action.lng,
    });
    setSaving(false);
    if (!ok) {
      setError("Could not save place — please try again.");
      return;
    }
    onDone();
    close();
  };

  return (
    <Modal
      open={Boolean(action)}
      onClose={close}
      title={action.type === "report" ? "Add local report" : "Add a missing place"}
      icon={action.type === "report" ? "📍" : "✨"}
    >
      {action.type === "report" ? (
        <>
          <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
            Reporting at {action.lat.toFixed(5)}, {action.lng.toFixed(5)}
          </div>
          <Field label="Category">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {REPORT_CATEGORIES.map((c) => (
                <ChipButton
                  key={c.key}
                  active={reportCat === c.key}
                  onClick={() => setReportCat(c.key)}
                >
                  <span>{c.icon}</span> {c.label}
                </ChipButton>
              ))}
            </div>
          </Field>
          <Field label="Notes (optional)">
            <textarea
              className="am-input"
              rows={2}
              placeholder="Describe what you noticed…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {error && <div style={{ color: "#ff8a95", fontSize: 13 }}>{error}</div>}
          <button
            className="am-btn am-btn-primary"
            onClick={submitReport}
            disabled={saving}
            style={{ width: "100%" }}
          >
            {saving ? <span className="am-spinner" /> : "Submit report"}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
            Adding place at {action.lat.toFixed(5)}, {action.lng.toFixed(5)}
          </div>
          <Field label="Place name">
            <input
              className="am-input"
              placeholder="e.g. Al-Madina Grocery"
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
            />
          </Field>
          <Field label="Category">
            <div style={{ display: "flex", gap: 6 }}>
              {PLACE_CATEGORIES.map((c) => (
                <ChipButton
                  key={c.key}
                  active={placeCat === c.key}
                  onClick={() => setPlaceCat(c.key)}
                  style={{ flex: 1 }}
                >
                  <span>{c.icon}</span> {c.label}
                </ChipButton>
              ))}
            </div>
          </Field>
          <div
            className="am-chip"
            style={{ justifyContent: "flex-start" }}
          >
            Status: Pending — becomes Verified after 3 community confirmations
          </div>
          {error && <div style={{ color: "#ff8a95", fontSize: 13 }}>{error}</div>}
          <button
            className="am-btn am-btn-primary"
            onClick={submitPlace}
            disabled={saving}
            style={{ width: "100%" }}
          >
            {saving ? <span className="am-spinner" /> : "Add place"}
          </button>
        </>
      )}
    </Modal>
  );
}
