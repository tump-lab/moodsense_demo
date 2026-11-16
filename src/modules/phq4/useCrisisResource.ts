import { useEffect, useState } from 'react';
import { getLocales } from 'expo-localization';
import { peekChosenCommunity, getChosenCommunity } from '../community/store';
import { getCrisisResource, type CrisisResource } from './supportResources';

function localeRegion(): string | null {
  try {
    return getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

/** Crisis resource for the chosen community, falling back to the device locale region. */
export async function loadCrisisResource(): Promise<CrisisResource> {
  const communityId = await getChosenCommunity();
  return getCrisisResource({ communityId, localeRegion: localeRegion() });
}

export function useCrisisResource(): CrisisResource {
  const [resource, setResource] = useState<CrisisResource>(() =>
    getCrisisResource({ communityId: peekChosenCommunity(), localeRegion: localeRegion() })
  );
  useEffect(() => {
    let live = true;
    void loadCrisisResource().then((r) => live && setResource(r));
    return () => {
      live = false;
    };
  }, []);
  return resource;
}
