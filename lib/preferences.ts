// Small per-browser conveniences (recent folders, last region). Losing them is harmless.

const RECENT_LINKS_STORAGE_KEY = 'massiveVideoReviewer.recentLinks';
const LAST_REGION_STORAGE_KEY = 'massiveVideoReviewer.lastRegion';
const MAX_RECENT_LINKS = 5;

export function loadRecentLinks(): string[] {
  try {
    const storedText = window.localStorage.getItem(RECENT_LINKS_STORAGE_KEY);
    const stored = storedText ? JSON.parse(storedText) : [];
    return Array.isArray(stored) ? stored.filter((link) => typeof link === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRecentLink(link: string): void {
  try {
    const updatedLinks = [link, ...loadRecentLinks().filter((existingLink) => existingLink !== link)].slice(0, MAX_RECENT_LINKS);
    window.localStorage.setItem(RECENT_LINKS_STORAGE_KEY, JSON.stringify(updatedLinks));
  } catch {
    // Ignore: recent links are only a convenience.
  }
}

export function loadLastRegion(): string | null {
  try {
    return window.localStorage.getItem(LAST_REGION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLastRegion(region: string): void {
  try {
    window.localStorage.setItem(LAST_REGION_STORAGE_KEY, region);
  } catch {
    // Ignore: the region default is only a convenience.
  }
}
