/**
 * Logos for the Find Resources cards, from each organization's own site. Bundled rather than
 * fetched, so opening Help tells no third party what someone is looking at. Separate from
 * helpResources.ts because `require` on an image does not run under plain Node.
 */
import type { ImageSourcePropType } from 'react-native';

export const MHA_LOGO: ImageSourcePropType = require('../../../assets/logos/mha.png');
const mha = MHA_LOGO;
const mindline = require('../../../assets/logos/mindline.png');

/** Keyed by HelpResource.logo. */
export const RESOURCE_LOGOS: Record<string, ImageSourcePropType> = {
  mha,
  mindline,
  purdue: require('../../../assets/logos/purdue.png'),
  ctl: require('../../../assets/logos/ctl.png'),
  nami: require('../../../assets/logos/nami.png'),
  moh: require('../../../assets/logos/moh.png'),
  findahelpline: require('../../../assets/logos/findahelpline.png'),
};
