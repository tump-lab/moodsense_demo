/**
 * Looks up the device's coarse place (country, region, city) from its IP via ipwho.is, called directly
 * from the app (no Cloud Function, so no Blaze plan needed). Only the coarse place is kept; the IP is never stored.
 * Returns null whenever it cannot (offline, rate-limited, lookup failed, no country at all) so the picker
 * falls back to manual choice. When the IP resolves a country/region but not a specific city, falls back to
 * a region-wide "radius" place (city set to the region, same bucket as the manual "Elsewhere in <region>"
 * choice) instead of forcing the full manual flow.
 */
import type { Place } from './communities';

const TIMEOUT_MS = 6000;

export async function resolveLocation(): Promise<Place | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://ipwho.is/?fields=success,country_code,region,city', {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      country_code?: string;
      region?: string;
      city?: string;
    };
    if (!data.success || !data.country_code) return null;
    if (data.city) {
      return { countryCode: data.country_code, region: data.region ?? '', city: data.city };
    }
    // No city-level resolution: fall back to a region-wide bucket when we at least have a region,
    // otherwise there isn't enough signal to auto-resolve anything.
    if (data.region) {
      return { countryCode: data.country_code, region: data.region, city: data.region };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
