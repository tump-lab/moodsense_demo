import React from 'react';
import LegalDocScreen from './LegalDocScreen';
import { PRIVACY_POLICY_TEXT } from './legalText';

export default function PrivacyPolicyScreen() {
  return <LegalDocScreen text={PRIVACY_POLICY_TEXT} />;
}
