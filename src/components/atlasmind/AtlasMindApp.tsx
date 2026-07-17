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
  isFavorite,
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
  | "measure";

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

function pinIcon(color = "#6c5ce7") {
  const html = `<div style="width:26px;height:26px;transform:translate(-50%,-100%);">
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

/* ---------- Weather advisory ---------- */
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

/* ============================================================ */

export default function AtlasMindApp() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const locMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
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

  // Search
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchLastQRef = useRef<string>("");
  const searchDebounceRef = useRef<number | null>(null);

  // Routing
  const [routeFrom, setRouteFrom] = useState<{ label: string; ll: LatLng } | null>(null);
  const [routeTo, setRouteTo] = useState<{ label: string; ll: LatLng } | null>(null);
  const [routeFromQ, setRouteFromQ] = useState("");
  const [routeToQ, setRouteToQ] = useState("");
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

  // Community reports + places (shared, DB-backed)
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [placesLoading, setPlacesLoading] = useState(false);
  const reportsLayerRef = useRef<L.LayerGroup | null>(null);
  const placesLayerRef = useRef<L.LayerGroup | null>(null);
  const communityClusterRef = useRef<any>(null);
  const placeClusterRef = useRef<any>(null);
  const confirmedPlacesRef = useRef<Set<string>>(new Set());

  // Map action modal (report / add place) opened by tapping the map
  const [mapAction, setMapAction] = useState<MapAction>(null);

  // SOS modal
  const [sosOpen, setSosOpen] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const favoriteIdsRef = useRef<Set<string>>(new Set());

  // Route history
  const [routeHistory, setRouteHistory] = useState<RouteHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Distance measurement
  const [measureState, setMeasureState] = useState<MeasureState | null>(null);
  const measureToolRef = useRef<ReturnType<typeof createMeasureTool> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 2600);
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

    clusterRef.current = (L as unknown as {
      markerClusterGroup: (opts: unknown) => L.LayerGroup;
    }).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
    });
    map.addLayer(clusterRef.current);

    // Separate cluster layers for community reports and user-added places
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
      // Don't open the action modal while the measure tool is capturing clicks
      if (measureToolRef.current?.isActive()) return;
      const { lat, lng } = e.latlng;
      if (clickMarkerRef.current) clickMarkerRef.current.remove();
      clickMarkerRef.current = L.marker([lat, lng], { icon: pinIcon("#00d4ff") })
        .addTo(map)
        .bindTooltip(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, {
          permanent: false,
          direction: "top",
          offset: [0, -28],
        })
        .openTooltip();
      setMapAction({ type: "report", lat, lng });
    });

    // initial weather at world center — will refresh on move
    setTimeout(() => refreshWeather(), 300);
    map.on("moveend", () => {
      // debounce via ref
      window.clearTimeout((refreshWeather as any)._t);
      (refreshWeather as any)._t = window.setTimeout(refreshWeather, 900);
    });

    // Fix default icon path for any raw markers
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
      ._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
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
        nowIdx >= 0
          ? Math.max(...(hourly.slice(nowIdx, nowIdx + 3) as number[]))
          : 0;
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

  /* ---- Search ----
   * Nominatim rate-limits rapid requests, so:
   *  - debounce keystrokes ~500ms
   *  - skip if the same query is already in flight
   *  - abort any previous inflight request when a newer one starts
   *  - surface a clear "search failed, try again" message on failure
   */
  const doSearch = useCallback(async (rawQ: string) => {
    const q = rawQ.trim();
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
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ac.signal,
      });
      if (!r.ok) throw new Error(`Search failed (${r.status})`);
      const j = (await r.json()) as SearchResult[];
      if (ac.signal.aborted) return;
      setSearchResults(j);
      if (j.length === 0) setSearchError("No results found — try a different query");
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

  // Debounced live search as the user types
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
    searchDebounceRef.current = window.setTimeout(() => {
      doSearch(q);
    }, 500);
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
      searchMarkerRef.current = L.marker([lat, lng], { icon: pinIcon("#6c5ce7") })
        .addTo(mapRef.current)
        .bindPopup(`<strong>${r.display_name}</strong>`)
        .openPopup();
    }
  }, []);

  /* ---- Routing ---- */
  const geocodeOne = useCallback(async (q: string): Promise<LatLng | null> => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as SearchResult[];
    if (!j[0]) return null;
    return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  }, []);

  const buildRoute = useCallback(async () => {
    if (!mapRef.current) return;
    setRouteError(null);
    setRouteLoading(true);
    setRouteInfo(null);
    try {
      let from = routeFrom;
      let to = routeTo;
      if (!from && routeFromQ.trim()) {
        const ll = await geocodeOne(routeFromQ);
        if (!ll) throw new Error("Origin not found");
        from = { label: routeFromQ, ll };
        setRouteFrom(from);
      }
      if (!to && routeToQ.trim()) {
        const ll = await geocodeOne(routeToQ);
        if (!ll) throw new Error("Destination not found");
        to = { label: routeToQ, ll };
        setRouteTo(to);
      }
      if (!from || !to) throw new Error("Set both origin and destination");

      const url = `https://router.project-osrm.org/route/v1/driving/${from.ll.lng},${from.ll.lat};${to.ll.lng},${to.ll.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Routing failed");
      const j = await r.json();
      if (!j.routes?.[0]) throw new Error("No route found");
      const route = j.routes[0];
      const coords: [number, number][] = route.geometry.coordinates.map(
        (c: [number, number]) => [c[1], c[0]],
      );
      if (routeLayerRef.current) routeLayerRef.current.remove();
      routeLayerRef.current = L.polyline(coords, {
        color: "#00d4ff",
        weight: 6,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(mapRef.current);
      // outer glow
      L.polyline(coords, {
        color: "#6c5ce7",
        weight: 12,
        opacity: 0.25,
      }).addTo(routeLayerRef.current as any);

      routeEndpointsRef.current?.clearLayers();
      L.marker([from.ll.lat, from.ll.lng], { icon: pinIcon("#6c5ce7") })
        .bindTooltip("Start")
        .addTo(routeEndpointsRef.current!);
      L.marker([to.ll.lat, to.ll.lng], { icon: pinIcon("#00d4ff") })
        .bindTooltip("Destination")
        .addTo(routeEndpointsRef.current!);

      mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [80, 80] });
      setRouteInfo({ distance: route.distance, duration: route.duration });
      // Persist completed route to history
      logRoute({
        from_label: from.label,
        to_label: to.label,
        from_lat: from.ll.lat,
        from_lng: from.ll.lng,
        to_lat: to.ll.lat,
        to_lng: to.ll.lng,
        distance_m: route.distance,
        duration_s: route.duration,
      }).then(() => loadRouteHistory());
    } catch (e: any) {
      setRouteError(e.message || "Routing failed");
    } finally {
      setRouteLoading(false);
    }
  }, [routeFrom, routeTo, routeFromQ, routeToQ, geocodeOne]);

  const useMyLocationAsOrigin = useCallback(() => {
    if (!navigator.geolocation) return showToast("Geolocation not supported");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRouteFrom({
          label: "My location",
          ll: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        });
        setRouteFromQ("My location");
        showToast("Origin set to your location");
      },
      (err) => showToast(err.message),
    );
  }, [showToast]);

  const clearRoute = useCallback(() => {
    routeLayerRef.current?.remove();
    routeLayerRef.current = null;
    routeEndpointsRef.current?.clearLayers();
    setRouteInfo(null);
    setRouteFrom(null);
    setRouteTo(null);
    setRouteFromQ("");
    setRouteToQ("");
    setRouteError(null);
  }, []);

  /* ---- Community reports + places loaders ---- */
  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    const data = await fetchCommunityReports();
    setReports(data);
    setReportsLoading(false);
    // render markers
    if (communityClusterRef.current) {
      communityClusterRef.current.clearLayers();
      data.forEach((r) => {
        const meta = reportMeta(r.category);
        const m = L.marker([r.lat, r.lng], { icon: pinIcon(meta.color) })
          .bindPopup(`<strong>${meta.icon} ${meta.label}</strong>${r.description ? `<br/>${r.description}` : ""}<br/><small>${new Date(r.created_at).toLocaleString()}</small>`);
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
        const m = L.marker([p.lat, p.lng], { icon })
          .bindPopup(`<strong>${p.name}</strong><br/>${p.category} · ${p.status}<br/><small>Confirmations: ${p.confirmation_count}/3</small>`);
        placesLayerRef.current!.addLayer(m);
      });
    }
    // refresh which places this device has already confirmed
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
        // find and remove
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
      setRouteFrom({ label: row.from_label, ll: { lat: row.from_lat, lng: row.from_lng } });
      setRouteFromQ(row.from_label);
      setRouteTo({ label: row.to_label, ll: { lat: row.to_lat, lng: row.to_lng } });
      setRouteToQ(row.to_label);
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

  /* ---- Distance measurement tool lifecycle ---- */
  const toggleMeasure = useCallback(() => {
    if (!mapRef.current) return;
    if (!measureToolRef.current) {
      measureToolRef.current = createMeasureTool(mapRef.current, setMeasureState);
    }
    measureToolRef.current.toggle();
  }, []);

  const resetMeasure = useCallback(() => {
    measureToolRef.current?.reset();
  }, []);

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
        // Build a viewbox around the current map center (~15 km box) so
        // Nominatim always returns results near what the user is looking at,
        // even if they've zoomed out.
        const c = mapRef.current.getCenter();
        const dLat = 0.135; // ~15 km
        const dLng = 0.135 / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
        const west = c.lng - dLng;
        const east = c.lng + dLng;
        const north = c.lat + dLat;
        const south = c.lat - dLat;
        const vb = `${west},${north},${east},${south}`;
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

  /* ---- SOS ---- */
  const sosCoords = useMemo(() => {
    if (!mapRef.current) return null;
    return mapRef.current.getCenter();
  }, [toast]);
  const triggerSOS = useCallback(() => {
    if (!navigator.geolocation) return showToast("Geolocation not available for SOS");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const gm = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const text = `EMERGENCY — I need help. My location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — ${gm}`;
        if (navigator.share) {
          navigator.share({ title: "SOS — AtlasMind", text }).catch(() => {
            navigator.clipboard.writeText(text);
            showToast("SOS location copied to clipboard");
          });
        } else {
          navigator.clipboard.writeText(text);
          showToast("SOS location copied — share with emergency contacts");
        }
      },
      () => showToast("Could not obtain location for SOS"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [showToast]);

  /* ---- Onboarding ---- */
  const finishOnboarding = useCallback(() => {
    window.localStorage.setItem("atlasmind:onboarded", "1");
    setOnboardStep(-1);
  }, []);

  /* ---------- render ---------- */
  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <div className="am-glow am-glow-purple" />
      <div className="am-glow am-glow-cyan" />

      <div className={`am-map-wrap ${is3D ? "am-3d" : ""}`}>
        <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
      </div>

      {/* Top bar */}
      <div
        className="am-glass am-anim-in"
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          right: 18,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          zIndex: 500,
        }}
      >
        <AtlasMindLogo size={38} />
        <div style={{ lineHeight: 1.1 }}>
          <div className="am-font-display am-accent-text" style={{ fontSize: 20, fontWeight: 700 }}>
            AtlasMind
          </div>
          <div style={{ color: "var(--am-muted)", fontSize: 11, letterSpacing: ".02em" }}>
            Beyond Maps. Beyond Navigation.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="am-btn am-btn-icon"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          className={`am-btn am-btn-icon ${is3D ? "am-btn-active" : ""}`}
          onClick={() => setIs3D((v) => !v)}
          title="Toggle 3D view"
          aria-label="3D view"
        >
          3D
        </button>
        <button
          className="am-btn am-btn-icon"
          onClick={locateMe}
          title="Locate me"
          aria-label="Locate me"
        >
          🎯
        </button>
        <button
          className="am-btn am-btn-danger"
          onClick={() => setSosOpen(true)}
          title="SOS — find nearest help & share location"
        >
          🆘 SOS
        </button>
      </div>

      {/* Advisory bar */}
      <div
        className="am-glass am-anim-in"
        style={{
          position: "absolute",
          top: 90,
          left: 18,
          right: 18,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          zIndex: 490,
          animationDelay: ".05s",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "var(--am-accent)",
            display: "grid",
            placeItems: "center",
            fontSize: 18,
          }}
        >
          🤖
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--am-muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>
            AtlasMind · Live Travel Advisory
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {advisoryLoading && !advisory
              ? "Analyzing local conditions…"
              : advisory?.headline ?? "Move the map to get a local advisory"}
          </div>
        </div>
        {advisory && (
          <div className="am-chip" style={{ whiteSpace: "nowrap" }}>{advisory.summary}</div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="am-glass am-anim-fade"
          style={{
            position: "absolute",
            top: 160,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 16px",
            fontSize: 13,
            zIndex: 600,
          }}
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
          maxWidth: 760,
          marginInline: "auto",
          animationDelay: ".1s",
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }} className="am-scroll">
          {([
            ["search", "🔍 Search"],
            ["route", "🧭 Route"],
            ["nearby", "📍 Nearby"],
            ["community", "📢 Reports"],
            ["places", "✨ Places"],
            ["favorites", "★ Favorites"],
            ["history", "🕘 History"],
            ["measure", "📏 Measure"],
            ["tips", "💡 Local Tips"],
            ["traffic", "🚦 Traffic"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              className={`am-btn ${tab === k ? "am-btn-active" : ""}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "search" && (
          <div className="am-anim-fade">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doSearch(searchQ);
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                className="am-input"
                placeholder="Search a place, city, or address…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              <VoiceSearch
                onTranscript={(text) => {
                  setSearchQ(text);
                  doSearch(text);
                }}
              />
              <button className="am-btn am-btn-primary" type="submit" disabled={searchLoading}>
                {searchLoading ? <span className="am-spinner" /> : "Search"}
              </button>
            </form>
            {searchError && (
              <div style={{ marginTop: 10, color: "#ff8a95", fontSize: 13 }}>{searchError}</div>
            )}
            {searchResults.length > 0 && (
              <div
                className="am-scroll"
                style={{ marginTop: 10, maxHeight: 220, overflowY: "auto", display: "grid", gap: 8 }}
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

        {tab === "route" && (
          <div className="am-anim-fade">
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="am-input"
                  placeholder="From"
                  value={routeFromQ}
                  onChange={(e) => {
                    setRouteFromQ(e.target.value);
                    setRouteFrom(null);
                  }}
                />
                <button className="am-btn am-btn-icon" onClick={useMyLocationAsOrigin} title="Use my location">
                  🎯
                </button>
              </div>
              <input
                className="am-input"
                placeholder="To"
                value={routeToQ}
                onChange={(e) => {
                  setRouteToQ(e.target.value);
                  setRouteTo(null);
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="am-btn am-btn-primary" onClick={buildRoute} disabled={routeLoading}>
                {routeLoading ? <span className="am-spinner" /> : "🧭 Get directions"}
              </button>
              <button className="am-btn" onClick={clearRoute}>Clear</button>
              {routeInfo && (
                <>
                  <span className="am-chip">🛣️ {fmtDistance(routeInfo.distance)}</span>
                  <span className="am-chip">⏱ {fmtDuration(routeInfo.duration)}</span>
                </>
              )}
            </div>
            {routeError && (
              <div style={{ marginTop: 10, color: "#ff8a95", fontSize: 13 }}>{routeError}</div>
            )}
          </div>
        )}

        {tab === "nearby" && (
          <div className="am-anim-fade">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {NEARBY.map((c) => (
                <button
                  key={c.key}
                  className={`am-btn ${nearbyCat === c.key ? "am-btn-active" : ""}`}
                  onClick={() => runNearby(c)}
                >
                  <span>{c.icon}</span> {c.label}
                </button>
              ))}
            </div>
            {nearbyLoading && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)" }}>
                <span className="am-spinner" /> Scanning the current map area…
              </div>
            )}
            {nearbyError && (
              <div style={{ marginTop: 10, color: "#ff8a95", fontSize: 13 }}>{nearbyError}</div>
            )}
            {nearbyResults.length > 0 && (
              <div
                className="am-scroll"
                style={{ marginTop: 10, maxHeight: 200, overflowY: "auto", display: "grid", gap: 6 }}
              >
                {nearbyResults.slice(0, 30).map((r) => (
                  <div key={r.place_id} className="am-card" onClick={() => flyToResult(r)}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {r.display_name.split(",")[0]}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
                      {r.display_name.split(",").slice(1, 4).join(",").trim()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "community" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>📢 Community reports</div>
              <button
                className="am-btn am-btn-icon"
                onClick={loadReports}
                title="Refresh"
              >
                ↻
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Tap the map to add a report (road damage, flood, construction, parking, safety, facilities).
            </div>
            {reportsLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" /> Loading reports…
              </div>
            )}
            {!reportsLoading && reports.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
                No reports yet — tap the map to add the first one.
              </div>
            )}
            {reports.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }}>
                {reports.map((r) => {
                  const meta = reportMeta(r.category);
                  return (
                    <div key={r.id} className="am-card" onClick={() => flyToCoords(r.lat, r.lng)}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {meta.icon} {meta.label}
                          </div>
                          {r.description && (
                            <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2 }}>
                              {r.description}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: "var(--am-muted)", marginTop: 2 }}>
                            {new Date(r.created_at).toLocaleString()} · {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                          </div>
                        </div>
                        <button
                          className="am-btn am-btn-icon"
                          onClick={(e) => { e.stopPropagation(); handleDeleteReport(r.id); }}
                          title="Delete report"
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

        {tab === "places" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>✨ Community places</div>
              <button className="am-btn am-btn-icon" onClick={loadPlaces} title="Refresh">↻</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Add missing places via the map. Places become Verified after 3 community confirmations.
            </div>
            {placesLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" /> Loading places…
              </div>
            )}
            {!placesLoading && places.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
                No places added yet — tap the map and choose "Add place".
              </div>
            )}
            {places.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }}>
                {places.map((p) => {
                  const verified = p.status === "verified";
                  const alreadyConfirmed = confirmedPlacesRef.current.has(p.id);
                  return (
                    <div key={p.id} className="am-card" onClick={() => flyToCoords(p.lat, p.lng)}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--am-muted)", marginTop: 2, textTransform: "capitalize" }}>
                            {p.category} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                          </div>
                          <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
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

        {tab === "favorites" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>★ Favorites</div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Tap ☆ on any search result to save it here.
            </div>
            {favoritesLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" /> Loading favorites…
              </div>
            )}
            {!favoritesLoading && favorites.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
                No favorites yet — search a place and tap ☆ to save it.
              </div>
            )}
            {favorites.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }}>
                {favorites.map((f) => (
                  <div key={f.id} className="am-card" onClick={() => flyToCoords(f.lat, f.lng)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>★ {f.name}</div>
                        <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
                          {f.lat.toFixed(4)}, {f.lng.toFixed(4)}
                        </div>
                      </div>
                      <button
                        className="am-btn am-btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFavorite(f.id).then(() => loadFavorites());
                        }}
                        title="Remove favorite"
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

        {tab === "history" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🕘 Route history</div>
              {routeHistory.length > 0 && (
                <button
                  className="am-btn am-btn-icon"
                  onClick={() => { clearRouteHistory().then(() => loadRouteHistory()); }}
                  title="Clear history"
                >
                  🗑
                </button>
              )}
            </div>
            {historyLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--am-muted)", fontSize: 13 }}>
                <span className="am-spinner" /> Loading history…
              </div>
            )}
            {!historyLoading && routeHistory.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
                No routes yet — plan a route in the Route tab to log it here.
              </div>
            )}
            {routeHistory.length > 0 && (
              <div className="am-scroll" style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6 }}>
                {routeHistory.map((row) => (
                  <div key={row.id} className="am-card">
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

        {tab === "measure" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>📏 Distance measurement</div>
            <div style={{ fontSize: 11, color: "var(--am-muted)" }}>
              Toggle, then click points on the map to measure the total path distance.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className={`am-btn ${measureState?.active ? "am-btn-active" : ""}`}
                onClick={toggleMeasure}
              >
                {measureState?.active ? "⏸ Stop measuring" : "📏 Start measuring"}
              </button>
              {measureState && measureState.points.length > 0 && (
                <button className="am-btn" onClick={resetMeasure}>Clear</button>
              )}
            </div>
            {measureState && measureState.points.length > 0 && (
              <div className="am-card" style={{ cursor: "default" }}>
                <div style={{ fontSize: 12, color: "var(--am-muted)" }}>
                  {measureState.points.length} point{measureState.points.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                  {fmtMeasure(measureState.total)}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "tips" && (
          <div className="am-anim-fade" style={{ display: "grid", gap: 8 }}>
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>💡 Local advisory</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                {advisory?.headline ?? "Move the map to get contextual tips for the area."}
              </div>
            </div>
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🕒 Best times</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                Travel between 10:00–16:00 for the lightest urban traffic in most regions.
              </div>
            </div>
            <div className="am-card" style={{ cursor: "default" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🛡️ Safety</div>
              <div style={{ fontSize: 12, color: "var(--am-muted)", marginTop: 4 }}>
                Prefer main roads at night. Share your live location with a trusted contact.
              </div>
            </div>
          </div>
        )}

        {tab === "traffic" && <TrafficDashboard active={tab === "traffic"} />}
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
        >
          <div
            className="am-glass am-anim-in"
            style={{ maxWidth: 460, width: "100%", padding: 28, textAlign: "center" }}
          >
            {onboardStep === 0 && (
              <>
                <div style={{ display: "grid", placeItems: "center", marginBottom: 14 }}>
                  <AtlasMindLogo size={64} />
                </div>
                <h2 className="am-font-display am-accent-text" style={{ fontSize: 28, margin: 0 }}>
                  Welcome to AtlasMind
                </h2>
                <p style={{ color: "var(--am-muted)", marginTop: 8, fontSize: 14 }}>
                  An AI-powered mapping platform for route planning, nearby discovery, and live travel intelligence.
                </p>
                <button
                  className="am-btn am-btn-primary"
                  style={{ marginTop: 18, width: "100%" }}
                  onClick={() => setOnboardStep(1)}
                >
                  Get started →
                </button>
              </>
            )}
            {onboardStep === 1 && (
              <>
                <div style={{ fontSize: 40 }}>📍</div>
                <h2 className="am-font-display" style={{ fontSize: 22, marginTop: 8 }}>
                  Enable location
                </h2>
                <p style={{ color: "var(--am-muted)", marginTop: 6, fontSize: 14 }}>
                  Grant location access to center the map on you, show nearby places, and enable SOS.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button
                    className="am-btn"
                    style={{ flex: 1 }}
                    onClick={() => setOnboardStep(2)}
                  >
                    Skip
                  </button>
                  <button
                    className="am-btn am-btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => {
                      locateMe();
                      setOnboardStep(2);
                    }}
                  >
                    Allow
                  </button>
                </div>
              </>
            )}
            {onboardStep === 2 && (
              <>
                <div style={{ fontSize: 40 }}>🎨</div>
                <h2 className="am-font-display" style={{ fontSize: 22, marginTop: 8 }}>
                  Choose your theme
                </h2>
                <p style={{ color: "var(--am-muted)", marginTop: 6, fontSize: 14 }}>
                  You can switch anytime from the top bar.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button
                    className={`am-btn ${theme === "dark" ? "am-btn-active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => setTheme("dark")}
                  >
                    🌙 Dark
                  </button>
                  <button
                    className={`am-btn ${theme === "light" ? "am-btn-active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => setTheme("light")}
                  >
                    ☀️ Light
                  </button>
                </div>
                <button
                  className="am-btn am-btn-primary"
                  style={{ marginTop: 14, width: "100%" }}
                  onClick={finishOnboarding}
                >
                  Enter AtlasMind
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Map action modal: report / add place */}
      <MapActionModal
        action={mapAction}
        onClose={() => setMapAction(null)}
        onDone={() => {
          loadReports();
          loadPlaces();
        }}
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