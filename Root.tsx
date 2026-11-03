import React, { useCallback, useEffect, useState } from 'react';
import App from './App';
import SetupScreen from './components/SetupScreen';
import { AwsCredentials, clearCredentials, loadCredentials, saveCredentials, subscribeToCredentialChanges } from './lib/credentials';
import { DEFAULT_REGION, S3Location, formatS3Link, parseS3Link } from './lib/s3';
import { loadLastRegion, loadRecentLinks, rememberRecentLink, saveLastRegion } from './lib/preferences';

// Each tab's folder lives in its own URL (?s3=...&region=...), so:
//  - a new tab on the base URL shows the setup screen,
//  - a refresh keeps the folder,
//  - two tabs can review two folders at once.

interface Route {
  location: S3Location | null;
  region: string;
  linkText: string;
  error: string | null;
}

function readRouteFromUrl(): Route {
  const searchParams = new URLSearchParams(window.location.search);
  const linkText = searchParams.get('s3') || '';
  const fallbackRegion = searchParams.get('region') || loadLastRegion() || DEFAULT_REGION;
  if (!linkText) {
    return { location: null, region: fallbackRegion, linkText: loadRecentLinks()[0] || '', error: null };
  }
  try {
    const location = parseS3Link(linkText);
    return { location, region: searchParams.get('region') || location.region || fallbackRegion, linkText, error: null };
  } catch (error) {
    return { location: null, region: fallbackRegion, linkText, error: (error as Error).message };
  }
}

function buildUrl(location: S3Location | null, region?: string): string {
  const baseUrl = `${window.location.pathname}`;
  if (!location) return baseUrl;
  const searchParams = new URLSearchParams({ s3: formatS3Link(location) });
  if (region) searchParams.set('region', region);
  return `${baseUrl}?${searchParams.toString()}`;
}

const Root: React.FC = () => {
  const [credentials, setCredentials] = useState<AwsCredentials | null>(() => loadCredentials());
  const [route, setRoute] = useState<Route>(() => readRouteFromUrl());

  useEffect(() => {
    // Another tab pasted fresh credentials: use them here too. Clearing in another tab is ignored
    // so an open review session is never torn down with unsaved work.
    return subscribeToCredentialChanges((latestCredentials) => {
      if (latestCredentials) setCredentials(latestCredentials);
    });
  }, []);

  useEffect(() => {
    const handlePopState = () => setRoute(readRouteFromUrl());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    document.title = route.location
      ? `${route.location.prefix.split('/').filter(Boolean).pop() || route.location.bucket} · Video Reviewer`
      : 'Massive Video Reviewer';
  }, [route.location]);

  const handleCredentialsChange = useCallback((updatedCredentials: AwsCredentials | null) => {
    if (updatedCredentials) saveCredentials(updatedCredentials);
    else clearCredentials();
    setCredentials(updatedCredentials);
  }, []);

  const handleOpen = (location: S3Location, region: string) => {
    rememberRecentLink(formatS3Link(location));
    saveLastRegion(region);
    window.history.pushState(null, '', buildUrl(location, region));
    setRoute({ location, region, linkText: formatS3Link(location), error: null });
  };

  const handleChangeFolder = () => {
    window.history.pushState(null, '', buildUrl(null));
    setRoute({ ...readRouteFromUrl(), linkText: route.location ? formatS3Link(route.location) : route.linkText });
  };

  // Region auto-detected after a redirect error: fix the URL without remounting the reviewer.
  const handleRegionDetected = useCallback((detectedRegion: string) => {
    saveLastRegion(detectedRegion);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('region', detectedRegion);
    window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`);
  }, []);

  if (!route.location || !credentials) {
    return (
      <SetupScreen
        key={route.linkText}
        initialLink={route.linkText}
        initialRegion={route.region}
        initialError={route.error}
        credentials={credentials}
        onOpen={handleOpen}
        onCredentialsChange={handleCredentialsChange}
      />
    );
  }

  return (
    <App
      key={formatS3Link(route.location)}
      location={route.location}
      initialRegion={route.region}
      credentials={credentials}
      onCredentialsChange={handleCredentialsChange}
      onRegionDetected={handleRegionDetected}
      onChangeFolder={handleChangeFolder}
    />
  );
};

export default Root;
