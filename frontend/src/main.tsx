import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import './styles.css';
import { App } from './App';
import { CONSENT_RETURN, OAuthConsent } from './pages/OAuthConsent';
import { supabase } from './data/supabase';

// Back from Google sign-in on the way to approving Claude / Codex: return to that consent screen.
const consentReturn = sessionStorage.getItem(CONSENT_RETURN);
if (consentReturn && window.location.pathname !== '/oauth/consent') supabase?.auth.onAuthStateChange((_event, session) => {
  if (session) { sessionStorage.removeItem(CONSENT_RETURN); window.location.replace(consentReturn); }
});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname === '/oauth/consent' ? <OAuthConsent/> : <App/>}</React.StrictMode>);
