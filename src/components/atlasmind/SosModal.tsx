import { useState } from "react";
import { Modal } from "./Modal";

type SosResult = {
  name: string;
  fullName: string;
  lat: number;
  lng: number;
};

function pinIconSvg(color: string) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};"></span>`;
}

export function SosModal({
  open,
  onClose,
  mapCenter,
  onLocate,
  flyTo,
}: {
  open: boolean;
  onClose: () => void;
  mapCenter: { lat: number; lng: number } | null;
  onLocate: (cb: (pos: { lat: number; lng: number }) => void) => void;
  flyTo: (lat: number, lng: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hospital, setHospital] = useState<SosResult | null>(null);
  const [pharmacy, setPharmacy] = useState<SosResult | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [shareText, setShareText] = useState<string | null>(null);

  const findNearest = async (query: string, origin: { lat: number; lng: number }) => {
    const dLat = 0.09;
    const dLng = 0.09 / Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180));
    const vb = `${origin.lng - dLng},${origin.lat + dLat},${origin.lng + dLng},${origin.lat - dLat}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=10&q=${encodeURIComponent(query)}&viewbox=${vb}&bounded=1`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("search failed");
    const j = (await r.json()) as { display_name: string; lat: string; lon: string }[];
    if (!j.length) return null;
    // pick nearest by haversine
    let best = j[0];
    let bestD = Infinity;
    for (const p of j) {
      const d = Math.pow(parseFloat(p.lat) - origin.lat, 2) + Math.pow(parseFloat(p.lon) - origin.lng, 2);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return {
      name: best.display_name.split(",")[0],
      fullName: best.display_name,
      lat: parseFloat(best.lat),
      lng: parseFloat(best.lon),
    } as SosResult;
  };

  const runSos = async () => {
    setLoading(true);
    setError(null);
    setHospital(null);
    setPharmacy(null);
    setShareText(null);
    try {
      const pos = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
        onLocate((p) => resolve(p));
        // timeout fallback to map center
        setTimeout(() => resolve(mapCenter ?? { lat: 25.383, lng: 68.356 }), 9000);
      });
      setCoords(pos);
      const [h, p] = await Promise.all([
        findNearest("hospital", pos).catch(() => null),
        findNearest("pharmacy", pos).catch(() => null),
      ]);
      setHospital(h);
      setPharmacy(p);
      const gm = `https://www.google.com/maps?q=${pos.lat},${pos.lng}`;
      const lines = [`EMERGENCY — I need help. My location: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`];
      lines.push(`Map: ${gm}`);
      if (h) lines.push(`Nearest hospital: ${h.fullName}`);
      if (p) lines.push(`Nearest pharmacy: ${p.fullName}`);
      setShareText(lines.join("\n"));
    } catch {
      setError("Could not complete SOS search — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const share = async () => {
    if (!shareText) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "SOS — AtlasMind", text: shareText });
        return;
      } catch {
        /* fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setError(null);
    } catch {
      setError("Could not access clipboard.");
    }
  };

  const copyLink = async () => {
    if (!coords) return;
    const link = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Emergency SOS" icon="🆘" maxWidth={480}>
      <p style={{ fontSize: 13, color: "var(--am-muted)", margin: 0 }}>
        One tap finds the nearest hospital and pharmacy, and gives you a shareable
        location link.
      </p>
      <button
        className="am-btn am-btn-danger"
        onClick={runSos}
        disabled={loading}
        style={{ width: "100%" }}
      >
        {loading ? <span className="am-spinner" /> : "🆘 Find nearest help & share"}
      </button>

      {error && <div style={{ color: "#ff8a95", fontSize: 13 }}>{error}</div>}

      {coords && (
        <div className="am-card" style={{ cursor: "default" }}>
          <div style={{ fontSize: 12, color: "var(--am-muted)" }}>Your location</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button className="am-btn am-btn-primary" onClick={share}>
              📤 Share
            </button>
            <button className="am-btn" onClick={copyLink}>
              🔗 Copy link
            </button>
          </div>
        </div>
      )}

      {hospital && (
        <div
          className="am-card"
          onClick={() => flyTo(hospital.lat, hospital.lng)}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            🏥 {hospital.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--am-muted)" }}>{hospital.fullName}</div>
          <div style={{ fontSize: 11, color: "#00d4ff", marginTop: 4 }}>Tap to view on map →</div>
        </div>
      )}
      {pharmacy && (
        <div
          className="am-card"
          onClick={() => flyTo(pharmacy.lat, pharmacy.lng)}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            💊 {pharmacy.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--am-muted)" }}>{pharmacy.fullName}</div>
          <div style={{ fontSize: 11, color: "#00d4ff", marginTop: 4 }}>Tap to view on map →</div>
        </div>
      )}

      {hospital === null && pharmacy === null && coords && !loading && (
        <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
          No hospitals or pharmacies found nearby in the current area — try zooming
          out and running SOS again.
        </div>
      )}
    </Modal>
  );
}
