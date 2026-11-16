/**
 * Communities the user belongs to, whose id is the `community_agg/{id}` key in Firestore.
 * Normally the id is a place resolved from the device's IP (`loc:US|California|Mountain View`);
 * the legacy curated ids below (`us_sf`, ...) still resolve so earlier choices keep working.
 */

import CITY_DATA from './cities.json';

export interface City {
  id: string;
  label: string;
}

export interface Country {
  id: string;
  label: string;
  cities: City[];
}

/** A coarse place: ISO country code, state/province/county-level region, and city. */
export interface Place {
  countryCode: string;
  region: string;
  city: string;
}

const LOC_PREFIX = 'loc:';

/** Countries the manual picker offers (country -> region -> city); everywhere else relies on IP resolution. */
export const MANUAL_COUNTRIES: { code: string; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'SG', label: 'Singapore' },
];

/** Cities of 5,000+ people per region, most populous first (GeoNames cities5000); Singapore lists its planning areas. */
const CITIES = CITY_DATA as Record<string, Record<string, string[]>>;

/** Regions with no city that large, so the picker still offers them. */
const EXTRA_REGIONS: Record<string, string[]> = { CA: ['Nunavut'] };

/**
 * Regions (states/provinces) offered by the manual picker, each with its cities. A region can also be
 * chosen as a whole; Singapore is a city-state, so its one region lists planning areas.
 */
export const MANUAL_REGIONS: Record<string, Record<string, string[]>> = {
  US: CITIES.US,
  CA: {
    ...CITIES.CA,
    ...Object.fromEntries(
      (EXTRA_REGIONS.CA ?? []).filter((r) => !(r in CITIES.CA)).map((r) => [r, [] as string[]])
    ),
  },
  SG: CITIES.SG,
};

/** Catch-all for users outside the countries the manual picker lists. */
export const OTHER_PLACE: Place = { countryCode: 'OTHER', region: '', city: 'Other' };

export function placeToCommunityId(place: Place): string {
  return `${LOC_PREFIX}${place.countryCode.toUpperCase()}|${place.region}|${place.city}`;
}

function parsePlace(id: string): Place | undefined {
  if (!id.startsWith(LOC_PREFIX)) return undefined;
  const [countryCode, region, city] = id.slice(LOC_PREFIX.length).split('|');
  if (!countryCode || !city) return undefined;
  return { countryCode, region: region ?? '', city };
}

function countryName(code: string): string {
  const manual = MANUAL_COUNTRIES.find((c) => c.code === code.toUpperCase());
  if (manual) return manual.label;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Display label for a place, e.g. "Mountain View, California, United States". */
export function placeLabel(place: Place): string {
  if (place.countryCode === OTHER_PLACE.countryCode) return 'Other country';
  return [place.city, place.region !== place.city ? place.region : '', countryName(place.countryCode)]
    .filter(Boolean)
    .join(', ');
}

/** Legacy curated communities, kept only so ids chosen before IP resolution still display. */
export const COUNTRIES: Country[] = [
  {
    id: 'us',
    label: 'United States',
    cities: [
      { id: 'us_sf', label: 'San Francisco Bay Area' },
      { id: 'us_nyc', label: 'New York City' },
      { id: 'us_la', label: 'Los Angeles' },
      { id: 'us_chi', label: 'Chicago' },
      { id: 'us_bos', label: 'Boston' },
      { id: 'us_sea', label: 'Seattle' },
      { id: 'us_other', label: 'Other United States City' },
    ],
  },
  {
    id: 'ca',
    label: 'Canada',
    cities: [
      { id: 'ca_tor', label: 'Toronto' },
      { id: 'ca_van', label: 'Vancouver' },
      { id: 'ca_other', label: 'Other Canadian city' },
    ],
  },
  {
    id: 'uk',
    label: 'United Kingdom',
    cities: [
      { id: 'uk_lon', label: 'London' },
      { id: 'uk_other', label: 'Other United Kingdom City' },
    ],
  },
  {
    id: 'cn',
    label: 'China',
    cities: [
      { id: 'cn_bj', label: 'Beijing' },
      { id: 'cn_sh', label: 'Shanghai' },
      { id: 'cn_other', label: 'Other Chinese city' },
    ],
  },
  {
    id: 'sg',
    label: 'Singapore',
    cities: [{ id: 'sg_sin', label: 'Singapore' }],
  },
  {
    id: 'other',
    label: 'Other country',
    cities: [{ id: 'other_city', label: 'Other city' }],
  },
];

/** A resolved place read as a country and city, so country-level features (e.g. the regional crisis line) work for `loc:` ids. */
function placeAsCommunity(id: string): { country: Country; city: City } | undefined {
  const place = parsePlace(id);
  if (!place) return undefined;
  const code = place.countryCode.toLowerCase();
  const country: Country = COUNTRIES.find((c) => c.id === code) ?? {
    id: code,
    label: countryName(place.countryCode),
    cities: [],
  };
  return { country, city: { id, label: place.city } };
}

/** The country and city record for a chosen community id (legacy curated or resolved place), or undefined if unknown. */
export function findCommunity(
  id: string | null | undefined
): { country: Country; city: City } | undefined {
  if (id == null) return undefined;
  for (const country of COUNTRIES) {
    const city = country.cities.find((c) => c.id === id);
    if (city) return { country, city };
  }
  return placeAsCommunity(id);
}

/** Display label for a chosen community id, resolved-place or legacy. */
export function communityLabel(id: string | null | undefined): string | undefined {
  if (id == null) return undefined;
  const place = parsePlace(id);
  if (place) return placeLabel(place);
  const found = findCommunity(id);
  return found ? `${found.city.label}, ${found.country.label}` : undefined;
}
