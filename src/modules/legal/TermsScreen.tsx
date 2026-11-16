import React from 'react';
import LegalDocScreen from './LegalDocScreen';
import { TERMS_OF_SERVICE_TEXT } from './legalText';

export default function TermsScreen() {
  return <LegalDocScreen text={TERMS_OF_SERVICE_TEXT} />;
}
