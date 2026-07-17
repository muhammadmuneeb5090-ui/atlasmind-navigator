import { supabase, supabaseReady } from "./supabase";
import { getDeviceId } from "./device-id";

export type ReportCategory =
  | "road_damage"
  | "flood"
  | "construction"
  | "parking"
  | "safety"
  | "facilities";

export type PlaceCategory = "home" | "shop" | "lane";

export type CommunityReport = {
  id: string;
  device_id: string;
  category: ReportCategory;
  description: string | null;
  lat: number;
  lng: number;
  created_at: string;
};

export type Place = {
  id: string;
  device_id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  status: "pending" | "verified";
  confirmation_count: number;
  created_at: string;
};

export type Favorite = {
  id: string;
  device_id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
};

export type RouteHistoryRow = {
  id: string;
  device_id: string;
  from_label: string;
  to_label: string;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  distance_m: number;
  duration_s: number;
  created_at: string;
};

/* ---------- Community reports ---------- */

export async function addCommunityReport(
  r: Omit<CommunityReport, "id" | "device_id" | "created_at">,
): Promise<CommunityReport | null> {
  if (!supabaseReady) return null;
  const { data, error } = await supabase
    .from("community_reports")
    .insert({ ...r, device_id: getDeviceId() })
    .select()
    .single();
  if (error) {
    console.error("addCommunityReport", error);
    return null;
  }
  return data as CommunityReport;
}

export async function fetchCommunityReports(): Promise<CommunityReport[]> {
  if (!supabaseReady) return [];
  const { data, error } = await supabase
    .from("community_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchCommunityReports", error);
    return [];
  }
  return (data ?? []) as CommunityReport[];
}

export async function deleteCommunityReport(id: string): Promise<boolean> {
  if (!supabaseReady) return false;
  const { error } = await supabase.from("community_reports").delete().eq("id", id);
  if (error) {
    console.error("deleteCommunityReport", error);
    return false;
  }
  return true;
}

/* ---------- Places ---------- */

export async function addPlace(
  p: Omit<Place, "id" | "device_id" | "created_at" | "status" | "confirmation_count">,
): Promise<Place | null> {
  if (!supabaseReady) return null;
  const { data, error } = await supabase
    .from("places")
    .insert({ ...p, device_id: getDeviceId() })
    .select()
    .single();
  if (error) {
    console.error("addPlace", error);
    return null;
  }
  return data as Place;
}

export async function fetchPlaces(): Promise<Place[]> {
  if (!supabaseReady) return [];
  const { data, error } = await supabase
    .from("places")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchPlaces", error);
    return [];
  }
  return (data ?? []) as Place[];
}

export async function confirmPlace(placeId: string): Promise<{ place: Place | null; confirmed: boolean }> {
  if (!supabaseReady) return { place: null, confirmed: false };
  const deviceId = getDeviceId();
  const { error } = await supabase
    .from("place_confirmations")
    .insert({ place_id: placeId, device_id: deviceId });
  if (error) {
    // 23505 = unique violation (already confirmed by this device) — treat as success
    if (error.code !== "23505") {
      console.error("confirmPlace", error);
      return { place: null, confirmed: false };
    }
  }
  // Re-fetch the place to get updated status/count (trigger-synced)
  const { data: place } = await supabase
    .from("places")
    .select("*")
    .eq("id", placeId)
    .maybeSingle();
  return { place: (place as Place) ?? null, confirmed: true };
}

export async function hasConfirmed(placeId: string): Promise<boolean> {
  if (!supabaseReady) return false;
  const { data } = await supabase
    .from("place_confirmations")
    .select("id")
    .eq("place_id", placeId)
    .eq("device_id", getDeviceId())
    .maybeSingle();
  return Boolean(data);
}

/* ---------- Favorites ---------- */

export async function addFavorite(
  f: { name: string; lat: number; lng: number },
): Promise<Favorite | null> {
  if (!supabaseReady) return null;
  const { data, error } = await supabase
    .from("favorites")
    .insert({ ...f, device_id: getDeviceId() })
    .select()
    .single();
  if (error) {
    // 23505 = duplicate (already favorited this exact lat/lng) — not an error for UX
    if (error.code === "23505") return null;
    console.error("addFavorite", error);
    return null;
  }
  return data as Favorite;
}

export async function fetchFavorites(): Promise<Favorite[]> {
  if (!supabaseReady) return [];
  const { data, error } = await supabase
    .from("favorites")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchFavorites", error);
    return [];
  }
  return (data ?? []) as Favorite[];
}

export async function removeFavorite(id: string): Promise<boolean> {
  if (!supabaseReady) return false;
  const { error } = await supabase.from("favorites").delete().eq("id", id);
  if (error) {
    console.error("removeFavorite", error);
    return false;
  }
  return true;
}

export async function isFavorite(lat: number, lng: number): Promise<boolean> {
  if (!supabaseReady) return false;
  const { data } = await supabase
    .from("favorites")
    .select("id")
    .eq("device_id", getDeviceId())
    .eq("lat", lat)
    .eq("lng", lng)
    .maybeSingle();
  return Boolean(data);
}

/* ---------- Route history ---------- */

export async function logRoute(
  r: Omit<RouteHistoryRow, "id" | "device_id" | "created_at">,
): Promise<RouteHistoryRow | null> {
  if (!supabaseReady) return null;
  const { data, error } = await supabase
    .from("route_history")
    .insert({ ...r, device_id: getDeviceId() })
    .select()
    .single();
  if (error) {
    console.error("logRoute", error);
    return null;
  }
  return data as RouteHistoryRow;
}

export async function fetchRouteHistory(): Promise<RouteHistoryRow[]> {
  if (!supabaseReady) return [];
  const { data, error } = await supabase
    .from("route_history")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("fetchRouteHistory", error);
    return [];
  }
  return (data ?? []) as RouteHistoryRow[];
}

export async function clearRouteHistory(): Promise<boolean> {
  if (!supabaseReady) return false;
  const { error } = await supabase.from("route_history").delete().eq("device_id", getDeviceId());
  if (error) {
    console.error("clearRouteHistory", error);
    return false;
  }
  return true;
}
