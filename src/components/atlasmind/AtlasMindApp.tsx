import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import { AtlasMindLogo } from "./Logo";
import { TrafficDashboard } from "./TrafficDashboard";
import { Modal, ChipButton } from "./Modal";
import { MapActionModal, type MapAction } from "./MapActionModal";
import { SosModal } from "./SosModal";
import { VoiceSearch } from "./VoiceSearch";
import {
  createMeasureTool,
  fmtMeasure,
  type MeasureState,
} from "./MeasureTool";
import {
  fetchCommunityReports,
  deleteCommunityReport,
  fetchPlaces,
  confirmPlace,
  hasConfirmed,
  addFavorite,
  fetchFavorites,
  removeFavorite,
  logRoute,
  fetchRouteHistory,
  clearRouteHistory,
  type CommunityReport,
  type Place,
  type Favorite,
  type RouteHistoryRow,
  type ReportCategory,
} from "@/lib/db";

type LatLng = { lat: number; lng: number };
type SearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
};
type NearbyCategory = {
  key: string;
  label: string;
  icon: string;
  query: string;
};

const NEARBY: NearbyCategory[] = [
  { key: "hospital", label: "Hospital", icon: "🏥", query: "hospital" },
  { key: "pharmacy", label: "Pharmacy", icon: "💊", query: "pharmacy" },
  { key: "food", label: "Food", icon: "🍽️", query: "restaurant" },
  { key: "fuel", label: "Fuel", icon: "⛽", query: "fuel station" },
  { key: "atm", label: "ATM", icon: "🏧", query: "atm" },
  { key: "cafe", label: "Cafés", icon: "☕", query: "cafe" },
  { key: "hotel", label: "Hotels", icon: "🏨", query: "hotel" },
  { key: "school", label: "Schools", icon: "🎓", query: "school" },
  { key: "mosque", label: "Mosque", icon: "🕌", query: "mosque" },
];

type Tab =
  | "search"
  | "route"
  | "nearby"
  | "tips"
  | "traffic"
  | "community"
  | "places"
  | "favorites"
  | "history"
  | "measure"
  | "roadmap";

type ReportMeta = { key: ReportCategory; label: string; icon: string; color: string };
const REPORT_META: ReportMeta[] = [
  { key: "road_damage", label: "Road Damage", icon: "🚧", color: "#ff8a95" },
  { key: "flood", label: "Flood", icon: "🌊", color: "#00d4ff" },
  { key: "construction", label: "Construction", icon: "🏗️", color: "#f5b301" },
  { key: "parking", label: "Parking", icon: "🅿️", color: "#6c5ce7" },
  { key: "safety", label: "Safety", icon: "⚠️", color: "#ff2d55" },
  { key: "facilities", label: "Facilities", icon: "🏛️", color: "#22c55e" },
];
function reportMeta(cat: ReportCategory): ReportMeta {
  return REPORT_META.find((r) => r.key === cat) ?? REPORT_META[0];
}

function fmtDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function pinIcon(color = "#6c5ce7", animate = false) {
  const html = `<div class="${animate ? "am-pin-drop" : ""}" style="width:26px;height:26px;transform:translate(-50%,-100%);">
    <svg viewBox="0 0 24 32" width="26" height="32" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 8.8 12 20 12 20s12-11.2 12-20C24 5.4 18.6 0 12 0z" fill="${color}"/>
      <circle cx="12" cy="12" r="4.5" fill="#fff"/>
    </svg></div>`;
  return L.divIcon({
    html,
    className: "am-pin",
    iconSize: [26, 32],
    iconAnchor: [13, 32],
  });
}

function locationIcon() {
  return L.divIcon({
    html: `<div class="am-loc-dot"></div>`,
    className: "am-loc",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function themeTiles(theme: "dark" | "light") {
  if (theme === "dark") {
    return {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    };
  }
  return {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  };
}

function buildAdvisory(data: {
  temperature: number;
  precipitation: number;
  windspeed: number;
  weathercode: number;
  isDay: boolean;
  hourlyPrecipNext: number;
}) {
  const parts: string[] = [];
  const { temperature: t, precipitation: p, windspeed: w, isDay, hourlyPrecipNext } = data;
  if (p > 0.2 || hourlyPrecipNext > 0.5) {
    parts.push("Rain expected — avoid low-lying roads and drive with headlights on");
  } else if (t >= 35) {
    parts.push("High heat — stay hydrated and prefer air-conditioned routes");
  } else if (t <= 2) {
    parts.push("Near-freezing conditions — watch for ice on bridges and overpasses");
  } else if (w >= 40) {
    parts.push("Strong winds — grip the wheel firmly on open highways");
  } else if (!isDay) {
    parts.push("Night driving — prefer well-lit main roads and reduce speed");
  } else {
    parts.push("Clear conditions — a great time to explore");
  }
  const summary = `${Math.round(t)}°C · wind ${Math.round(w)} km/h${p > 0 ? ` · ${p.toFixed(1)} mm rain` : ""}`;
  return { headline: parts[0], summary };
}

/* ---- Waypoint type for multi-stop routing ---- */
type Waypoint = {
  id: string;
  label: string;
  ll: LatLng | null;
  query: string;
};

function newWaypoint(): Waypoint {
  return { id: crypto.randomUUID(), label: "", ll: null, query: "" };
}

/* ============================================================ */

export default function AtlasMindApp() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const locMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const routeEndpointsRef = useRef<L.LayerGroup | null>(null);
  const clusterRef = useRef<any>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [is3D, setIs3D] = useState(false);
  const [tab, setTab] = useState<Tab>("search");
  const [onboardStep, setOnboardStep] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return window.localStorage.getItem("atlasmind:onboarded") ? -1 : 0;
  });
  const [toast, setToast] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Search
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchLastQRef = useRef<string>("");
  const searchDebounceRef = useRef<number | null>(null);

  // Multi-stop routing
  const [waypoints, setWaypoints] = useState<Waypoint[]>([newWaypoint(), newWaypoint()]);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Nearby
  const [nearbyCat, setNearbyCat] = useState<string | null>(null);
  const [nearbyResults, setNearbyResults] = useState<SearchResult[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  // Weather / advisory
  const [advisory, setAdvisory] = useState<{ headline: string; summary: string } | null>(null);
  const [advisoryLoading, setAdvisoryLoading] = useState(false);

  // Community reports + places
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [placesLoading, setPlacesLoading] = useState(false);
  const communityClusterRef = useRef<any>(null);
  const placesLayerRef = useRef<L.LayerGroup | null>(null);
  const confirmedPlacesRef = useRef<Set<string>>(new Set());

  const [mapAction, setMapAction] = useState<MapAction>(null);
  const [sosOpen, setSosOpen] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const favoriteIdsRef = useRef<Set<string>>(new Set());

  // Route history
  const [routeHistory, setRouteHistory] = useState<RouteHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Measure
  const [measureState, setMeasureState] = useState<MeasureState | null>(null);
  const measureToolRef = useRef<ReturnType<typeof createMeasureTool> | null>(null);

  // Location share
  const [shareLoading, setShareLoading] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 2800);
  }, []);

  /* ---- Offline detection ---- */
  useEffect(() => {
    const setOnline = () => setIsOffline(false);
    const setOffline = () => setIsOffline(true);
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  /* ---- Init map ---- */
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [25.383, 68.356],
      zoom: 12,
      zoomControl: false,
      worldCopyJump: true,
      preferCanvas: true,
    });
    mapRef.current = map;
    const tiles = themeTiles(theme);
    tileRef.current = L.tileLayer(tiles.url, {
      attribution: tiles.attribution,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    routeEndpointsRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    clusterRef.current = (L as unknown as {
      markerClusterGroup: (opts: unknown) => L.LayerGroup;
    }).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
    });
    map.addLayer(clusterRef.current);

    communityClusterRef.current = (L as unknown as {
      markerClusterGroup: (opts: unknown) => L.LayerGroup;
    }).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 50,
    });
    map.addLayer(communityClusterRef.current);
    placesLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (measureToolRef.current?.isActive()) return;
      const { lat, lng } = e.latlng;
      if (clickMarkerRef.current) clickMarkerRef.current.remove();
      clickMarkerRef.current = L.marker([lat, lng], { icon: pinIcon("#00d4ff", true) })
        .addTo(map)
        .bindTooltip(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, {
          permanent: false,
          direction: "top",
          offset: [0, -28],
        })
        .openTooltip();
      setMapAction({ type: "report", lat, lng });
    });

    setTimeout(() => refreshWeather(), 300);
    map.on("moveend", () => {
      window.clearTimeout((refreshWeather as any)._t);
      (refreshWeather as any)._t = window.setTimeout(refreshWeather, 900);
    });

    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Theme swap ---- */
  useEffect(() => {
    document.documentElement.classList.toggle("am-dark", theme === "dark");
    if (mapRef.current && tileRef.current) {
      mapRef.current.removeLayer(tileRef.current);
      const t = themeTiles(theme);
      tileRef.current = L.tileLayer(t.url, {
        attribution: t.attribution,
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(mapRef.current);
    }
  }, [theme]);

  /* ---- Weather / advisory ---- */
  const refreshWeather = useCallback(async () => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    setAdvisoryLoading(true);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(3)}&longitude=${c.lng.toFixed(3)}&current_weather=true&hourly=precipitation&timezone=auto`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Weather fetch failed");
      const j = await r.json();
      const cw = j.current_weather;
      const hourly = j.hourly?.precipitation ?? [];
      const nowIdx = j.hourly?.time?.findIndex((t: string) => t.startsWith(cw.time.slice(0, 13))) ?? -1;
      const next: number =
        nowIdx >= 0 ? Math.max(...(hourly.slice(nowIdx, nowIdx + 3) as number[])) : 0;
      setAdvisory(
        buildAdvisory({
          temperature: cw.temperature,
          precipitation: 0,
          windspeed: cw.windspeed,
          weathercode: cw.weathercode,
          isDay: cw.is_day === 1,
          hourlyPrecipNext: next || 0,
        }),
      );
    } catch {
      setAdvisory({
        headline: "Live advisory unavailable — check your connection",
        summary: "Weather service offline",
      });
    } finally {
      setAdvisoryLoading(false);
    }
  }, []);

  /* ---- Locate me ---- */
  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      showToast("Geolocation not supported");
      return;
    }
    showToast("Locating you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!mapRef.current) return;
        if (locMarkerRef.current) locMarkerRef.current.remove();
        locMarkerRef.current = L.marker([latitude, longitude], {
          icon: locationIcon(),
          zIndexOffset: 1000,
        })
          .addTo(mapRef.current)
          .bindTooltip("You are here", { direction: "top", offset: [0, -10] });
        mapRef.current.flyTo([latitude, longitude], 14, { duration: 1.4 });
        showToast(`📍 Located: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      },
      (err) => showToast(`Location error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [showToast]);

  /* ---- Search ---- */
  const doSearch = useCallback(async (rawQ: string) => {
    const normalize = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[,\s]+$/, "");
    const expandLocal = (q: string): string[] => {
      const n = normalize(q);
      if (!n) return [];
      const lower = n.toLowerCase();
      const LOCAL_CTX = "Latifabad, Hyderabad, Sindh, Pakistan";
      const unitNumMatch = lower.match(/unit\s*(?:no\.?\s*)?#?\s*([0-9]+)/);
      if (unitNumMatch) {
        const num = unitNumMatch[1];
        return [
          `Latifabad Unit No ${num}, Hyderabad, Sindh, Pakistan`,
          `Latifabad Unit ${num}, Hyderabad, Sindh, Pakistan`,
          `Latifabad ${num}, Hyderabad, Sindh, Pakistan`,
        ];
      }
      const hasContext = /hyderabad|sindh|pakistan|latifabad/.test(lower);
      if (n.length <= 16 && !hasContext) {
        return [n, `${n}, ${LOCAL_CTX}`];
      }
      return [n];
    };
    const q = normalize(rawQ);
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    if (searchLastQRef.current === q && searchAbortRef.current) return;
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    searchLastQRef.current = q;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const variants = expandLocal(q);
      let j: SearchResult[] = [];
      for (const variant of variants) {
        if (ac.signal.aborted) return;
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1&q=${encodeURIComponent(variant)}`;
        const r = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });
        if (!r.ok) throw new Error(`Search failed (${r.status})`);
        const partial = (await r.json()) as SearchResult[];
        j = j.concat(partial);
        if (j.length >= 5) break;
      }
      if (ac.signal.aborted) return;
      const seen = new Set<number>();
      const qTokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      const ranked = j
        .filter((r) => {
          if (seen.has(r.place_id)) return false;
          seen.add(r.place_id);
          return true;
        })
        .map((r) => {
          const name = (r.display_name || "").toLowerCase();
          let score = 0;
          qTokens.forEach((t) => { if (name.includes(t)) score++; });
          return { r, score };
        })
        .sort((a, b) => b.score - a.score);
      const final = ranked.map((x) => x.r);
      setSearchResults(final);
      if (final.length === 0) setSearchError("No results found — try a different query");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setSearchResults([]);
      setSearchError("Search failed — please try again in a moment");
    } finally {
      if (searchAbortRef.current === ac) {
        searchAbortRef.current = null;
        setSearchLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    const q = searchQ.trim();
    if (!q) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      searchLastQRef.current = "";
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    if (q.length < 2) return;
    searchDebounceRef.current = window.setTimeout(() => { doSearch(q); }, 500);
    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
  }, [searchQ, doSearch]);

  const flyToResult = useCallback((r: SearchResult, dropMarker = true) => {
    if (!mapRef.current) return;
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    mapRef.current.flyTo([lat, lng], 15, { duration: 1.3 });
    if (dropMarker) {
      if (searchMarkerRef.current) searchMarkerRef.current.remove();
      searchMarkerRef.current = L.marker([lat, lng], { icon: pinIcon("#6c5ce7", true) })
        .addTo(mapRef.current)
        .bindPopup(`<strong>${r.display_name}</strong>`)
        .openPopup();
    }
  }, []);

  /* ---- Multi-stop routing ---- */
  const geocodeOne = useCallback(async (q: string): Promise<LatLng | null> => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as SearchResult[];
    if (!j[0]) return null;
    return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  }, []);

  const updateWaypoint = useCallback((id: string, patch: Partial<Waypoint>) => {
    setWaypoints((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, []);

  const addWaypoint = useCallback(() => {
    setWaypoints((prev) => {
      if (prev.length >= 6) return prev;
      const last = newWaypoint();
      return [...prev, last];
    });
  }, []);

  const removeWaypoint = useCallback((id: string) => {
    setWaypoints((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((w) => w.id !== id);
    });
  }, []);

  const moveWaypoint = useCallback((id: string, dir: -1 | 1) => {
    setWaypoints((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }, []);

  const buildRoute = useCallback(async () => {
    if (!mapRef.current) return;
    setRouteError(null);
    setRouteLoading(true);
    setRouteInfo(null);
    try {
      // Resolve any ungeocoded waypoints
      const resolved: Waypoint[] = [];
      for (const wp of waypoints) {
        if (wp.ll) {
          resolved.push(wp);
          continue;
        }
        if (!wp.query.trim()) throw new Error("Fill in all stops before calculating");
        const ll = await geocodeOne(wp.query.trim());
        if (!ll) throw new Error(`Could not find: "${wp.query}"`);
        resolved.push({ ...wp, ll, label: wp.query });
      }
      setWaypoints(resolved);

      const validWps = resolved.filter((w) => w.ll !== null) as (Waypoint & { ll: LatLng })[];
      if (validWps.length < 2) throw new Error("Add at least 2 stops");

      const coords = validWps.map((w) => `${w.ll.lng},${w.ll.lat}`).join(";");
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Routing service unavailable");
      const j = await r.json();
      if (!j.routes?.[0]) throw new Error("No route found");
      const route = j.routes[0];
      const routeCoords: [number, number][] = route.geometry.coordinates.map(
        (c: [number, number]) => [c[1], c[0]],
      );

      // Clear previous route layers
      routeLayerRef.current?.clearLayers();
      routeEndpointsRef.current?.clearLayers();

      // Draw route
      L.polyline(routeCoords, {
        color: "#6c5ce7",
        weight: 12,
        opacity: 0.25,
      }).addTo(routeLayerRef.current!);
      L.polyline(routeCoords, {
        color: "#00d4ff",
        weight: 6,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(routeLayerRef.current!);

      // Waypoint markers
      const labels = ["A", "B", "C", "D", "E", "F"];
      validWps.forEach((wp, i) => {
        const isLast = i === validWps.length - 1;
        const color = i === 0 ? "#6c5ce7" : isLast ? "#00d4ff" : "#f5b301";
        L.marker([wp.ll.lat, wp.ll.lng], { icon: pinIcon(color, true) })
          .bindTooltip(labels[i] ? `${labels[i]}: ${wp.label || wp.query}` : wp.label || wp.query)
          .addTo(routeEndpointsRef.current!);
      });

      mapRef.current.fitBounds(L.latLngBounds(routeCoords), { padding: [80, 80] });
      setRouteInfo({ distance: route.distance, duration: route.duration });

      // Log to history (from first to last)
      logRoute({
        from_label: validWps[0].label || validWps[0].query,
        to_label: validWps[validWps.length - 1].label || validWps[validWps.length - 1].query,
        from_lat: validWps[0].ll.lat,
        from_lng: validWps[0].ll.lng,
        to_lat: validWps[validWps.length - 1].ll.lat,
        to_lng: validWps[validWps.length - 1].ll.lng,
        distance_m: route.distance,
        duration_s: route.duration,
      }).then(() => loadRouteHistory());
    } catch (e: any) {
      setRouteError(e.message || "Routing failed");
    } finally {
      setRouteLoading(false);
    }
  }, [waypoints, geocodeOne]);

  const useMyLocationAsWaypoint = useCallback(
    (id: string) => {
      if (!navigator.geolocation) return showToast("Geolocation not supported");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          updateWaypoint(id, {
            ll: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            query: "My location",
            label: "My location",
          });
          showToast("Stop set to your location");
        },
        (err) => showToast(err.message),
      );
    },
    [showToast, updateWaypoint],
  );

  const clearRoute = useCallback(() => {
    routeLayerRef.current?.clearLayers();
    routeEndpointsRef.current?.clearLayers();
    setRouteInfo(null);
    setWaypoints([newWaypoint(), newWaypoint()]);
    setRouteError(null);
  }, []);

  /* ---- Community reports + places loaders ---- */
  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    const data = await fetchCommunityReports();
    setReports(data);
    setReportsLoading(false);
    if (communityClusterRef.current) {
      communityClusterRef.current.clearLayers();
      data.forEach((r) => {
        const meta = reportMeta(r.category);
        const m = L.marker([r.lat, r.lng], { icon: pinIcon(meta.color) }).bindPopup(
          `<strong>${meta.icon} ${meta.label}</strong>${r.description ? `<br/>${r.description}` : ""}<br/><small>${new Date(r.created_at).toLocaleString()}</small>`,
        );
        communityClusterRef.current.addLayer(m);
      });
    }
  }, []);

  const loadPlaces = useCallback(async () => {
    setPlacesLoading(true);
    const data = await fetchPlaces();
    setPlaces(data);
    setPlacesLoading(false);
    if (placesLayerRef.current) {
      placesLayerRef.current.clearLayers();
      data.forEach((p) => {
        const color = p.status === "verified" ? "#22c55e" : "#f5b301";
        const icon = L.divIcon({
          html: `<div style="width:26px;height:26px;transform:translate(-50%,-100%);">
            <svg viewBox="0 0 24 32" width="26" height="32" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.4 0 0 5.4 0 12c0 8.8 12 20 12 20s12-11.2 12-20C24 5.4 18.6 0 12 0z" fill="${color}"/>
              <circle cx="12" cy="12" r="4.5" fill="#fff"/>
            </svg></div>`,
          className: "am-pin",
          iconSize: [26, 32],
          iconAnchor: [13, 32],
        });
        const m = L.marker([p.lat, p.lng], { icon }).bindPopup(
          `<strong>${p.name}</strong><br/>${p.category} · ${p.status}<br/><small>Confirmations: ${p.confirmation_count}/3</small>`,
        );
        placesLayerRef.current!.addLayer(m);
      });
    }
    const confirmed = new Set<string>();
    for (const p of data) {
      if (await hasConfirmed(p.id)) confirmed.add(p.id);
    }
    confirmedPlacesRef.current = confirmed;
  }, []);

  const handleConfirmPlace = useCallback(
    async (placeId: string) => {
      if (confirmedPlacesRef.current.has(placeId)) {
        showToast("You already confirmed this place");
        return;
      }
      const { confirmed } = await confirmPlace(placeId);
      if (confirmed) {
        showToast("Place confirmed!");
        loadPlaces();
      } else {
        showToast("Could not confirm — try again");
      }
    },
    [loadPlaces, showToast],
  );

  const handleDeleteReport = useCallback(
    async (id: string) => {
      const ok = await deleteCommunityReport(id);
      if (ok) {
        showToast("Report removed");
        loadReports();
      } else {
        showToast("Could not remove report");
      }
    },
    [loadReports, showToast],
  );

  /* ---- Favorites ---- */
  const loadFavorites = useCallback(async () => {
    setFavoritesLoading(true);
    const data = await fetchFavorites();
    setFavorites(data);
    favoriteIdsRef.current = new Set(data.map((f) => `${f.lat}|${f.lng}`));
    setFavoritesLoading(false);
  }, []);

  const toggleFavorite = useCallback(
    async (name: string, lat: number, lng: number) => {
      const key = `${lat}|${lng}`;
      if (favoriteIdsRef.current.has(key)) {
        const fav = favorites.find((f) => `${f.lat}|${f.lng}` === key);
        if (fav) {
          await removeFavorite(fav.id);
          showToast("Removed from favorites");
        }
      } else {
        const added = await addFavorite({ name, lat, lng });
        if (added) showToast("Added to favorites");
        else showToast("Already in favorites");
      }
      loadFavorites();
    },
    [favorites, loadFavorites, showToast],
  );

  /* ---- Route history ---- */
  const loadRouteHistory = useCallback(async () => {
    setHistoryLoading(true);
    const data = await fetchRouteHistory();
    setRouteHistory(data);
    setHistoryLoading(false);
  }, []);

  const rerunHistoryRoute = useCallback(
    (row: RouteHistoryRow) => {
      setWaypoints([
        { id: crypto.randomUUID(), label: row.from_label, ll: { lat: row.from_lat, lng: row.from_lng }, query: row.from_label },
        { id: crypto.randomUUID(), label: row.to_label, ll: { lat: row.to_lat, lng: row.to_lng }, query: row.to_label },
      ]);
      setTab("route");
      setTimeout(() => buildRoute(), 100);
    },
    [buildRoute],
  );

  /* ---- Load DB data on mount ---- */
  useEffect(() => {
    loadReports();
    loadPlaces();
    loadFavorites();
    loadRouteHistory();
  }, [loadReports, loadPlaces, loadFavorites, loadRouteHistory]);

  /* ---- Distance measurement ---- */
  const toggleMeasure = useCallback(() => {
    if (!mapRef.current) return;
    if (!measureToolRef.current) {
      measureToolRef.current = createMeasureTool(mapRef.current, setMeasureState);
    }
    measureToolRef.current.toggle();
  }, []);

  const resetMeasure = useCallback(() => { measureToolRef.current?.reset(); }, []);

  const flyToCoords = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo([lat, lng], 15, { duration: 1.3 });
  }, []);

  /* ---- Nearby ---- */
  const runNearby = useCallback(
    async (cat: NearbyCategory) => {
      if (!mapRef.current) return;
      setNearbyCat(cat.key);
      setNearbyLoading(true);
      setNearbyError(null);
      setNearbyResults([]);
      clusterRef.current?.clearLayers();
      try {
        const c = mapRef.current.getCenter();
        const dLat = 0.135;
        const dLng = 0.135 / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
        const vb = `${c.lng - dLng},${c.lat + dLat},${c.lng + dLng},${c.lat - dLat}`;
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=40&q=${encodeURIComponent(cat.query)}&viewbox=${vb}&bounded=1`;
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error("Nearby search failed");
        const j = (await r.json()) as SearchResult[];
        setNearbyResults(j);
        if (!j.length) {
          setNearbyError("Nothing found in the current view — zoom out and try again");
          return;
        }
        j.forEach((p) => {
          const m = L.marker([parseFloat(p.lat), parseFloat(p.lon)], {
            icon: pinIcon("#6c5ce7"),
          }).bindPopup(`<strong>${cat.icon} ${cat.label}</strong><br/>${p.display_name}`);
          clusterRef.current.addLayer(m);
        });
      } catch (e: any) {
        setNearbyError(e.message || "Nearby failed");
      } finally {
        setNearbyLoading(false);
      }
    },
    [],
  );

  /* ---- Location sharing ---- */
  const shareLocation = useCallback(async () => {
    setShareLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      });
      const { latitude: lat, longitude: lng } = pos.coords;
      const link = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
      const text = `My current location: ${link}\n(${lat.toFixed(5)}, ${lng.toFixed(5)})`;

      if (navigator.share) {
        await navigator.share({ title: "My Location", text, url: link });
      } else {
        await navigator.clipboard.writeText(text);
        showToast("Location link copied to clipboard!");
      }
    } catch (e: any) {
      if (e.name === "AbortError" || e.name === "NotAllowedError") {
        showToast("Location permission denied");
      } else {
        // Fallback: share map center
        const c = mapRef.current?.getCenter() ?? { lat: 25.383, lng: 68.356 };
        const link = `https://maps.google.com/?q=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
        await navigator.clipboard.writeText(link).catch(() => {});
        showToast("Map center link copied!");
      }
    } finally {
      setShareLoading(false);
    }
  }, [showToast]);

  /* ---- Onboarding ---- */
  const finishOnboarding = useCallback(() => {
    window.localStorage.setItem("atlasmind:onboarded", "1");
    setOnboardStep(-1);
  }, []);

  /* ---- Waypoint labels ---- */
  const waypointLabels = ["From", "Stop 1", "Stop 2", "Stop 3", "Stop 4", "To"];
  function waypointLabel(index: number, total: number): string {
    if (total === 2) return index === 0 ? "From" : "To";
    if (index === 0) return "From";
    if (index === total - 1) return "To";
    return `Stop ${index}`;
  }

  /* ---------- render ---------- */
  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <div className="am-glow am-glow-purple" />
      <div className="am-glow am-glow-cyan" />

      {/* Offline banner */}
      {isOffline && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "8px 16px",
            background: "rgba(255,45,85,0.9)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "center",
            zIndex: 1000,
          }}
          role="alert"
        >
          You are offline — some features unavailable
        </div>
      )}

      <div className={`am-map-wrap ${is3D ? "am-3d" : ""}`}>
        <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
      </div>

      {/* Top bar */}
      <div
        className="am-glass am-anim-in"
        style={{
          position: "absolute",
          top: isOffline ? 44 : 18,
          left: 18,
          right: 18,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 500,
          flexWrap: "wrap",
        }}
      >
        <AtlasMindLogo size={36} />
        <div style={{ lineHeight: 1.1 }}>
          <div className="am-font-display am-accent-text" style={{ fontSize: 18, fontWeight: 700 }}>
            AtlasMind
          </div>
          <div style={{ color: "var(--am-muted)", fontSize: 10, letterSpacing: ".02em" }}>
            Beyond Maps. Beyond Navigation.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="am-btn am-btn-icon"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title="Toggle theme"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          className={`am-btn am-btn-icon ${is3D ? "am-btn-active" : ""}`}
          onClick={() => setIs3D((v) => !v)}
          title="Toggle 3D view"
          aria-label={is3D ? "Disable 3D view" : "Enable 3D view"}
          aria-pressed={is3D}
        >
          3D
        </button>
        <button
          className="am-btn am-btn-icon"
          onClick={shareLocation}
          title="Share my location"
          aria-label="Share my location"
          disabled={shareLoading}
        >
          {shareLoading ? <span className="am-spinner" /> : "📤"}
        </button>
        <button
          className="am-btn am-btn-icon"
          onClick={locateMe}
          title="Locate me"
          aria-label="Center map on my location"
        >
          🎯
        </button>
        <button
          className="am-btn am-btn-danger"
          onClick={() => setSosOpen(true)}
          title="SOS — find nearest help & share location"
          aria-label="SOS emergency"
        >
          🆘 SOS
        </button>
      </div>

      {/* Advisory bar */}
      <div
        className="am-glass am-anim-in"
        style={{
          position: "absolute",
          top: isOffline ? 118 : 90,
          left: 18,
          right: 18,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          zIndex: 490,
          animationDelay: ".05s",
        }}
        role="status"
        aria-live="polite"
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "var(--am-accent)",
            display: "grid",
            placeItems: "center",
            fontSize: 16,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          🤖
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--am-muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>
            AtlasMind · Live Travel Advisory
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {advisoryLoading && !advisory
              ? "Analyzing local conditions…"
              : advisory?.headline ?? "Move the map to get a local advisory"}
          </div>
        </div>
        {advisory && (
          <div className="am-chip" style={{ whiteSpace: "nowrap", fontSize: 11 }}>{advisory.summary}</div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="am-glass am-anim-fade"
          style={{
            position: "absolute",
            top: isOffline ? 178 : 152,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 16px",
            fontSize: 13,
            zIndex: 600,
            whiteSpace: "nowrap",
          }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      {/* Bottom panel */}
      <div
        className="am-glass am-anim-in"
        style={{
          position: "absolute",
          bottom: 18,
          left: 18,
          right: 18,
          padding: 14,
          zIndex: 500,
          maxWidth: 800,
          marginInline: "auto",
          animationDelay: ".1s",
        }}
      >
        {/* Tab bar */}
        <div
          style={{ display: "flex", gap: 5, marginBottom: 12, overflowX: "auto" }}
          className="am-scroll"
          role="tablist"
          aria-label="Navigation tabs"
        >
          {([
            ["search", "🔍 Search"],
            ["route", "🧭 Route"],
            ["nearby", "📍 Nearby"],
            ["community", "📢 Reports"],
            ["places", "✨ Places"],
            ["favorites", "★ Saved"],
            ["history", "🕘 History"],
            ["measure", "📏 Measure"],
            ["tips", "💡 Tips"],
            ["traffic", "🚦 Traffic"],
            ["roadmap", "🗺 Roadmap"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={`am-btn ${tab === k ? "am-btn-active" : ""}`}
              style={{ whiteSpace: "nowrap", fontSize: 12 }}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---- Search tab ---- */}
        {tab === "search" && (
          <div className="am-anim-fade" role="tabpanel" aria-label="Search">
            <form
              onSubmit={(e) => { e.preventDefault(); doSearch(searchQ); }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                className="am-input"
                placeholder="Search a place, city, or address…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                aria-label="Search query"
                aria-describedby={searchError ? "search-error" : undefined}
              />
              <VoiceSearch
                onTranscript={(text) => { setSearchQ(text); doSearch(text); }}
              />
              <button className="am-btn am-btn-primary" type="submit" disabled={searchLoading} aria-label="Run search">
                {searchLoading ? <span className="am-spinner" aria-label="Searching" /> : "Search"}
              </button>
            </form>
            {searchError && (
              <div id="search-error" style={{ marginTop: 10, color: "#ff8a95", fontSize: 13 }} role="alert">
                {searchError}
              </div>
            )}
            {searchLoading && !searchError && searchResults.length === 0 && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" aria-hidden="true" /> Searching…
              </div>
            )}
            {!searchLoading && !searchError && searchResults.length === 0 && searchQ.trim().length >= 2 && (
              <div style={{ marginTop: 14, textAlign: "center", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 28 }} aria-hidden="true">🔍</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Start typing to search for a place</div>
              </div>
            )}
            {searchResults.length > 0 && (
              <div
                className="am-scroll"
                style={{ marginTop: 10, maxHeight: 220, overflowY: "auto", display: "grid", gap: 8 }}
                role="listbox"
                aria-label="Search results"
              >
                {searchResults.map((r) => {
                  const lat = parseFloat(r.lat);
                  const lng = parseFloat(r.lon);
                  const favKey = `${lat}|${lng}`;
                  const isFav = favoriteIdsRef.current.has(favKey);
                  return (
                    <div
                      key={r.place_id}
                      className="am-card"
                      onClick={() => flyToResult(r)}
                      role="option"
                      aria-selected="false"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") flyToResult(r); }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {r.display_name.split(",")[0]}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
                            {r.display_name}
                          </div>
                        </div>
                        <button
                          className={`am-btn am-btn-icon ${isFav ? "am-btn-active" : ""}`}
                          style={{ flexShrink: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(r.display_name.split(",")[0], lat, lng);
                          }}
                          title={isFav ? "Remove from favorites" : "Add to favorites"}
                          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                          aria-pressed={isFav}
                        >
                          {isFav ? "★" : "☆"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- Route tab (multi-stop) ---- */}
        {tab === "route" && (
          <div className="am-anim-fade" role="tabpanel" aria-label="Route planner">
            <div style={{ display: "grid", gap: 8 }}>
              {waypoints.map((wp, i) => (
                <div key={wp.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: i === 0 ? "#6c5ce7" : i === waypoints.length - 1 ? "#00d4ff" : "#f5b301",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    className="am-input"
                    placeholder={waypointLabel(i, waypoints.length)}
                    value={wp.query}
                    onChange={(e) => updateWaypoint(wp.id, { query: e.target.value, ll: null })}
                    aria-label={`Waypoint ${waypointLabel(i, waypoints.length)}`}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    className="am-btn am-btn-icon"
                    onClick={() => useMyLocationAsWaypoint(wp.id)}
                    title="Use my location"
                    aria-label="Use my current location for this stop"
                    style={{ flexShrink: 0 }}
                  >
                    🎯
                  </button>
                  {i > 0 && (
                    <button
                      className="am-btn am-btn-icon"
                      onClick={() => moveWaypoint(wp.id, -1)}
                      title="Move stop up"
                      aria-label="Move stop up"
                      disabled={i === 0}
                      style={{ flexShrink: 0, fontSize: 11 }}
                    >
                      ▲
                    </button>
                  )}
                  {i < waypoints.length - 1 && (
                    <button
                      className="am-btn am-btn-icon"
                      onClick={() => moveWaypoint(wp.id, 1)}
                      title="Move stop down"
                      aria-label="Move stop down"
                      style={{ flexShrink: 0, fontSize: 11 }}
                    >
                      ▼
                    </button>
                  )}
                  {waypoints.length > 2 && (
                    <button
                      className="am-btn am-btn-icon"
                      onClick={() => removeWaypoint(wp.id)}
                      title="Remove stop"
                      aria-label="Remove this stop"
                      style={{ flexShrink: 0 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              {waypoints.length < 6 && (
                <button className="am-btn" onClick={addWaypoint} aria-label="Add another stop">
                  + Add stop
                </button>
              )}
              <button
                className="am-btn am-btn-primary"
                onClick={buildRoute}
                disabled={routeLoading}
                aria-label="Calculate route"
              >
                {routeLoading ? <span className="am-spinner" aria-label="Calculating" /> : "🧭 Get directions"}
              </button>
              <button className="am-btn" onClick={clearRoute} aria-label="Clear route">
                Clear
              </button>
              {routeInfo && (
                <>
                  <span className="am-chip">🛣️ {fmtDistance(routeInfo.distance)}</span>
                  <span className="am-chip">⏱ {fmtDuration(routeInfo.duration)}</span>
                  {waypoints.length > 2 && (
                    <span className="am-chip">📍 {waypoints.length} stops</span>
                  )}
                </>
              )}
            </div>
            {routeError && (
              <div style={{ marginTop: 10, color: "#ff8a95", fontSize: 13 }} role="alert">{routeError}</div>
            )}
          </div>
        )}

        {/* ---- Nearby tab ---- */}
        {tab === "nearby" && (
          <div className="am-anim-fade" role="tabpanel" aria-label="Nearby places">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {NEARBY.map((c) => (
                <button
                  key={c.key}
                  className={`am-btn ${nearbyCat === c.key ? "am-btn-active" : ""}`}
                  onClick={() => runNearby(c)}
                  aria-pressed={nearbyCat === c.key}
                  aria-label={`Find nearby ${c.label}`}
                >
                  <span aria-hidden="true">{c.icon}</span> {c.label}
                </button>
              ))}
            </div>
            {nearbyLoading && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)" }}>
                <span className="am-spinner" aria-hidden="true" /> Scanning the current map area…
              </div>
            )}
            {nearbyError && (
              <div style={{ marginTop: 10, color: "#ff8a95", fontSize: 13 }} role="alert">{nearbyError}</div>
            )}
            {!nearbyLoading && !nearbyError && !nearbyCat && (
              <div style={{ marginTop: 14, textAlign: "center", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 28 }} aria-hidden="true">📍</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Select a category to discover nearby places</div>
              </div>
            )}
            {nearbyResults.length > 0 && (
              <div
                className="am-scroll"
                style={{ marginTop: 10, maxHeight: 200, overflowY: "auto", display: "grid", gap: 6 }}
                role="list"
                aria-label="Nearby results"
              >
                {nearbyResults.slice(0, 30).map((r) => (
                  <div
                    key={r.place_id}
                    className="am-card"
                    onClick={() => flyToResult(r)}
                    role="listitem"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") flyToResult(r); }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.display_name.split(",")[0]}</div>
                    <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
                      {r.display_name.split(",").slice(1, 4).join(",").trim()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Community reports tab ---- */}
        {tab === "community" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }} role="tabpanel" aria-label="Community reports">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>📢 Community reports</div>
              <button className="am-btn am-btn-icon" onClick={loadReports} title="Refresh" aria-label="Refresh reports">↻</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Tap the map to add a report (road damage, flood, construction, parking, safety, facilities).
            </div>
            {reportsLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" aria-hidden="true" /> Loading reports…
              </div>
            )}
            {!reportsLoading && reports.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 32 }} aria-hidden="true">📋</div>
                <div style={{ fontSize: 13, marginTop: 6, fontWeight: 500 }}>No reports yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Tap the map to add the first one.</div>
              </div>
            )}
            {reports.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }} role="list">
                {reports.map((r) => {
                  const meta = reportMeta(r.category);
                  return (
                    <div
                      key={r.id}
                      className="am-card"
                      onClick={() => flyToCoords(r.lat, r.lng)}
                      role="listitem"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") flyToCoords(r.lat, r.lng); }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {meta.icon} {meta.label}
                          </div>
                          {r.description && (
                            <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2 }}>{r.description}</div>
                          )}
                          <div style={{ fontSize: 10, color: "var(--am-muted)", marginTop: 2 }}>
                            {new Date(r.created_at).toLocaleString()} · {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                          </div>
                        </div>
                        <button
                          className="am-btn am-btn-icon"
                          onClick={(e) => { e.stopPropagation(); handleDeleteReport(r.id); }}
                          title="Delete report"
                          aria-label="Delete this report"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- Places tab ---- */}
        {tab === "places" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }} role="tabpanel" aria-label="Community places">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>✨ Community places</div>
              <button className="am-btn am-btn-icon" onClick={loadPlaces} title="Refresh" aria-label="Refresh places">↻</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Add missing places via the map. Places become Verified after 3 community confirmations.
            </div>
            {placesLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" aria-hidden="true" /> Loading places…
              </div>
            )}
            {!placesLoading && places.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 32 }} aria-hidden="true">🗺️</div>
                <div style={{ fontSize: 13, marginTop: 6, fontWeight: 500 }}>No places added yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Tap the map and choose "Add place".</div>
              </div>
            )}
            {places.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }} role="list">
                {places.map((p) => {
                  const verified = p.status === "verified";
                  const alreadyConfirmed = confirmedPlacesRef.current.has(p.id);
                  return (
                    <div
                      key={p.id}
                      className="am-card"
                      onClick={() => flyToCoords(p.lat, p.lng)}
                      role="listitem"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") flyToCoords(p.lat, p.lng); }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2, textTransform: "capitalize" }}>
                            {p.category} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                          </div>
                          <div style={{ marginTop: 6 }}>
                            <span
                              className="am-chip"
                              style={{
                                color: verified ? "#22c55e" : "#f5b301",
                                borderColor: verified ? "rgba(34,197,94,0.4)" : "rgba(245,179,1,0.4)",
                              }}
                            >
                              {verified ? "✓ Verified" : "⏳ Pending"} · {p.confirmation_count}/3
                            </span>
                          </div>
                        </div>
                        {!verified && (
                          <button
                            className={`am-btn ${alreadyConfirmed ? "" : "am-btn-primary"}`}
                            style={{ flexShrink: 0 }}
                            disabled={alreadyConfirmed}
                            onClick={(e) => { e.stopPropagation(); handleConfirmPlace(p.id); }}
                            aria-label={alreadyConfirmed ? "Already confirmed" : "Confirm this place"}
                          >
                            {alreadyConfirmed ? "✓ Confirmed" : "Confirm"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- Favorites tab ---- */}
        {tab === "favorites" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }} role="tabpanel" aria-label="Saved favorites">
            <div style={{ fontSize: 13, fontWeight: 600 }}>★ Saved places</div>
            {favoritesLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" aria-hidden="true" /> Loading favorites…
              </div>
            )}
            {!favoritesLoading && favorites.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 32 }} aria-hidden="true">⭐</div>
                <div style={{ fontSize: 13, marginTop: 6, fontWeight: 500 }}>No saved places yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Search a place and tap ☆ to save it here.</div>
              </div>
            )}
            {favorites.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }} role="list">
                {favorites.map((f) => (
                  <div
                    key={f.id}
                    className="am-card"
                    onClick={() => flyToCoords(f.lat, f.lng)}
                    role="listitem"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") flyToCoords(f.lat, f.lng); }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>★ {f.name}</div>
                        <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
                          {f.lat.toFixed(4)}, {f.lng.toFixed(4)}
                        </div>
                      </div>
                      <button
                        className="am-btn am-btn-icon"
                        onClick={(e) => { e.stopPropagation(); removeFavorite(f.id).then(() => loadFavorites()); }}
                        title="Remove favorite"
                        aria-label={`Remove ${f.name} from favorites`}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- History tab ---- */}
        {tab === "history" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }} role="tabpanel" aria-label="Route history">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🕘 Route history</div>
              {routeHistory.length > 0 && (
                <button
                  className="am-btn am-btn-icon"
                  onClick={() => { clearRouteHistory().then(() => loadRouteHistory()); }}
                  title="Clear history"
                  aria-label="Clear all route history"
                >
                  🗑
                </button>
              )}
            </div>
            {historyLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" aria-hidden="true" /> Loading history…
              </div>
            )}
            {!historyLoading && routeHistory.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 32 }} aria-hidden="true">🧭</div>
                <div style={{ fontSize: 13, marginTop: 6, fontWeight: 500 }}>No routes yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Plan a route in the Route tab to log it here.</div>
              </div>
            )}
            {routeHistory.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }} role="list">
                {routeHistory.map((row) => (
                  <div key={row.id} className="am-card" role="listitem">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {row.from_label} → {row.to_label}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2 }}>
                          {fmtDistance(row.distance_m)} · {fmtDuration(row.duration_s)} · {new Date(row.created_at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        className="am-btn am-btn-primary"
                        style={{ flexShrink: 0 }}
                        onClick={() => rerunHistoryRoute(row)}
                        aria-label={`Re-run route from ${row.from_label} to ${row.to_label}`}
                      >
                        ↻ Re-run
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Measure tab ---- */}
        {tab === "measure" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 10 }} role="tabpanel" aria-label="Distance measurement">
            <div style={{ fontSize: 13, fontWeight: 600 }}>📏 Distance measurement</div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Toggle, then click points on the map to measure the total path distance.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className={`am-btn ${measureState?.active ? "am-btn-active" : ""}`}
                onClick={toggleMeasure}
                aria-pressed={measureState?.active ?? false}
              >
                {measureState?.active ? "⏸ Stop measuring" : "📏 Start measuring"}
              </button>
              {measureState && measureState.points.length > 0 && (
                <button className="am-btn" onClick={resetMeasure} aria-label="Clear measurement">Clear</button>
              )}
            </div>
            {measureState && measureState.points.length > 0 ? (
              <div className="am-card" style={{ cursor: "default" }}>
                <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
                  {measureState.points.length} point{measureState.points.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                  {fmtMeasure(measureState.total)}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "8px 0", color: "var(--am-muted)" }}>
                <div style={{ fontSize: 13 }}>Start measuring, then click points on the map</div>
              </div>
            )}
          </div>
        )}

        {/* ---- Tips tab ---- */}
        {tab === "tips" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }} role="tabpanel" aria-label="Local tips">
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>💡 Local advisory</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                {advisory?.headline ?? "Move the map to get contextual tips for the area."}
              </div>
            </div>
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🕒 Best times to travel</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                Travel between 10:00–16:00 for the lightest urban traffic in most regions.
              </div>
            </div>
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🛡️ Safety tips</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                Prefer main roads at night. Use the 📤 share button to send your location to a contact.
              </div>
            </div>
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🌐 Map tips</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                Tap anywhere on the map to add a community report or place. Use 3D mode for a perspective view.
              </div>
            </div>
          </div>
        )}

        {/* ---- Traffic tab ---- */}
        {tab === "traffic" && <TrafficDashboard active={tab === "traffic"} />}

        {/* ---- Roadmap tab ---- */}
        {tab === "roadmap" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }} role="tabpanel" aria-label="Coming soon roadmap">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🗺 Coming Soon</div>
              <span
                className="am-chip"
                style={{ fontSize: 10, color: "#f5b301", borderColor: "rgba(245,179,1,0.4)" }}
              >
                Future vision — not yet available
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--am-muted)", marginBottom: 4 }}>
              These are ideas we're exploring for future versions of AtlasMind:
            </div>
            {[
              {
                icon: "🏙️",
                title: "Full 3D Building Rendering",
                desc: "Real photorealistic 3D city models with building heights, facades, and shadows using MapLibre GL or CesiumJS.",
              },
              {
                icon: "🧠",
                title: "Natural Language Search",
                desc: "Ask the map anything: \"Find a quiet café near a park that opens before 8am\" — powered by LLM-based query parsing.",
              },
              {
                icon: "📦",
                title: "City-Wide Offline Map Packs",
                desc: "Download full cities for offline use including turn-by-turn navigation without any internet connection.",
              },
              {
                icon: "🚌",
                title: "Real-Time Transit Layer",
                desc: "Live bus and train positions overlaid on the map using GTFS-Realtime feeds where available.",
              },
              {
                icon: "🤖",
                title: "AI Trip Planner",
                desc: "Describe your trip goal and let AtlasMind plan a full multi-day itinerary with stops, timing, and alternatives.",
              },
              {
                icon: "📡",
                title: "Live Crowd-Sourced Traffic",
                desc: "Aggregate anonymized speed data from AtlasMind users to show real-time congestion on a city-wide heatmap.",
              },
            ].map((item) => (
              <div key={item.title} className="am-card" style={{ cursor: "default" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: "rgba(108,92,231,0.15)",
                      border: "1px solid rgba(108,92,231,0.3)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 3, lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding */}
      {onboardStep >= 0 && (
        <div
          className="am-anim-fade"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(10,14,26,0.55)",
            backdropFilter: "blur(14px)",
            zIndex: 900,
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
          role="dialog"
          aria-modal="true"
          aria-label={
            onboardStep === 0
              ? "Welcome to AtlasMind"
              : onboardStep === 1
              ? "Enable location"
              : "Choose your theme"
          }
        >
          <div
            className="am-glass am-anim-in"
            style={{ maxWidth: 440, width: "100%", padding: 28, textAlign: "center" }}
          >
            {onboardStep === 0 && (
              <>
                <div style={{ display: "grid", placeItems: "center", marginBottom: 14 }}>
                  <AtlasMindLogo size={64} />
                </div>
                <h2 className="am-font-display am-accent-text" style={{ fontSize: 26, margin: 0 }}>
                  Welcome to AtlasMind
                </h2>
                <p style={{ color: "var(--am-muted)", marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
                  An AI-powered mapping platform for route planning, nearby discovery, and live travel intelligence.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button
                    className="am-btn"
                    style={{ flex: 1 }}
                    onClick={finishOnboarding}
                  >
                    Skip
                  </button>
                  <button
                    className="am-btn am-btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => setOnboardStep(1)}
                    autoFocus
                  >
                    Get started →
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16 }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: i === 0 ? 20 : 8,
                        height: 8,
                        borderRadius: 4,
                        background: i === 0 ? "var(--am-accent-1)" : "var(--am-border)",
                        transition: "all .3s",
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {onboardStep === 1 && (
              <>
                <div style={{ fontSize: 44 }} aria-hidden="true">📍</div>
                <h2 className="am-font-display" style={{ fontSize: 22, marginTop: 8 }}>Enable location</h2>
                <p style={{ color: "var(--am-muted)", marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
                  Grant location access to center the map on you, show nearby places, and enable SOS.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button className="am-btn" style={{ flex: 1 }} onClick={() => setOnboardStep(2)}>
                    Skip
                  </button>
                  <button
                    className="am-btn am-btn-primary"
                    style={{ flex: 1 }}
                    autoFocus
                    onClick={() => { locateMe(); setOnboardStep(2); }}
                  >
                    Allow
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16 }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: i === 1 ? 20 : 8,
                        height: 8,
                        borderRadius: 4,
                        background: i === 1 ? "var(--am-accent-1)" : "var(--am-border)",
                        transition: "all .3s",
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {onboardStep === 2 && (
              <>
                <div style={{ fontSize: 44 }} aria-hidden="true">🎨</div>
                <h2 className="am-font-display" style={{ fontSize: 22, marginTop: 8 }}>Choose your theme</h2>
                <p style={{ color: "var(--am-muted)", marginTop: 6, fontSize: 14 }}>
                  You can switch anytime from the top bar.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button
                    className={`am-btn ${theme === "dark" ? "am-btn-active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => setTheme("dark")}
                    aria-pressed={theme === "dark"}
                  >
                    🌙 Dark
                  </button>
                  <button
                    className={`am-btn ${theme === "light" ? "am-btn-active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => setTheme("light")}
                    aria-pressed={theme === "light"}
                  >
                    ☀️ Light
                  </button>
                </div>
                <button
                  className="am-btn am-btn-primary"
                  style={{ marginTop: 14, width: "100%" }}
                  onClick={finishOnboarding}
                  autoFocus
                >
                  Enter AtlasMind
                </button>
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16 }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: i === 2 ? 20 : 8,
                        height: 8,
                        borderRadius: 4,
                        background: i === 2 ? "var(--am-accent-1)" : "var(--am-border)",
                        transition: "all .3s",
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Map action modal */}
      <MapActionModal
        action={mapAction}
        onClose={() => setMapAction(null)}
        onDone={() => { loadReports(); loadPlaces(); }}
      />

      {/* SOS modal */}
      <SosModal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        mapCenter={mapRef.current ? mapRef.current.getCenter() : null}
        onLocate={(cb) => {
          if (!navigator.geolocation) {
            cb(mapRef.current ? mapRef.current.getCenter() : { lat: 25.383, lng: 68.356 });
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => cb({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => cb(mapRef.current ? mapRef.current.getCenter() : { lat: 25.383, lng: 68.356 }),
            { enableHighAccuracy: true, timeout: 8000 },
          );
        }}
        flyTo={flyToCoords}
      />
    </div>
  );
}
