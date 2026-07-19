import L from "leaflet";

export type MeasureState = {
  active: boolean;
  points: { lat: number; lng: number }[];
  total: number;
};

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtMeasure(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

/**
 * Attaches click-based measurement to a map. Returns an object with methods to
 * toggle, reset, and tear down. The caller renders the UI from the returned
 * state via the onUpdate callback.
 */
export function createMeasureTool(
  map: L.Map,
  onUpdate: (state: MeasureState) => void,
): {
  toggle: () => void;
  reset: () => void;
  teardown: () => void;
  isActive: () => boolean;
} {
  let active = false;
  let points: { lat: number; lng: number }[] = [];
  let polyline: L.Polyline | null = null;
  let markers: L.Marker[] = [];
  let total = 0;

  const dotIcon = (color: string) =>
    L.divIcon({
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color};"></div>`,
      className: "am-measure-dot",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

  const emit = () => onUpdate({ active, points: [...points], total });

  const redraw = () => {
    const coords = points.map((p) => [p.lat, p.lng] as [number, number]);
    if (polyline) {
      polyline.setLatLngs(coords);
    } else if (coords.length >= 2) {
      polyline = L.polyline(coords, {
        color: "#00d4ff",
        weight: 4,
        opacity: 0.85,
        dashArray: "8 8",
      }).addTo(map);
    }
  };

  const onClick = (e: L.LeafletMouseEvent) => {
    const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (points.length > 0) {
      total += haversineMeters(points[points.length - 1], pt);
    }
    points.push(pt);
    const m = L.marker([pt.lat, pt.lng], { icon: dotIcon("#6c5ce7") }).addTo(map);
    m.bindTooltip(fmtMeasure(total), {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });
    markers.push(m);
    redraw();
    emit();
  };

  const clear = () => {
    polyline?.remove();
    polyline = null;
    markers.forEach((m) => m.remove());
    markers = [];
    points = [];
    total = 0;
  };

  const toggle = () => {
    active = !active;
    if (active) {
      map.on("click", onClick);
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.off("click", onClick);
      map.getContainer().style.cursor = "";
    }
    emit();
  };

  const reset = () => {
    clear();
    emit();
  };

  const teardown = () => {
    map.off("click", onClick);
    map.getContainer().style.cursor = "";
    clear();
    active = false;
    emit();
  };

  const isActive = () => active;

  return { toggle, reset, teardown, isActive };
}
