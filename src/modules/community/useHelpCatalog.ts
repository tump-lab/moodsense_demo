/**
 * The Help catalog for where this person is. It paints at once from what is known locally and the
 * IP lookup only corrects the region afterwards, so reaching a number never waits on a network.
 */
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { getLocales } from 'expo-localization';
import { peekChosenCommunity } from './store';
import { HELP_CATALOG, resolveHelpRegion, type HelpCatalog } from './helpResources';
import { useDevModeStore } from '../settings/devMode';
import { resolveLocation } from './resolveLocation';

function localeRegion(): string | null {
  try {
    return getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

/** One lookup per app session, so moving between Help pages does not repeat the request. */
let ipCountryLookup: Promise<string | null> | null = null;
function lookupIpCountry(): Promise<string | null> {
  ipCountryLookup ??= resolveLocation().then((place) => place?.countryCode ?? null);
  return ipCountryLookup;
}

export function useHelpCatalog(): HelpCatalog {
  const [ipCountry, setIpCountry] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void lookupIpCountry().then((code) => {
      if (live) setIpCountry(code);
    });
    return () => {
      live = false;
    };
  }, []);
  // Screenshot mode stands in for a person who is in their chosen community, so the network's
  // country (the developer's own) must not override it.
  const screenshot = useDevModeStore((st) => st.screenshot);
  return HELP_CATALOG[
    resolveHelpRegion({
      ipCountry: screenshot ? null : ipCountry,
      communityId: peekChosenCommunity(),
      localeRegion: localeRegion(),
    })
  ];
}

export function openHref(href: string) {
  Linking.openURL(href).catch((err: unknown) => console.warn('Could not open resource:', err));
}
