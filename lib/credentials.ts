// Temporary AWS credentials pasted by the user.
// They live in localStorage so every tab of this site shares them (paste once, review in many tabs).

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** ISO-8601 timestamp, when known (e.g. from `aws configure export-credentials`). */
  expiration?: string;
}

const CREDENTIALS_STORAGE_KEY = 'massiveVideoReviewer.awsCredentials';

const ENV_NAME_TO_FIELD: Record<string, keyof AwsCredentials> = {
  AWS_ACCESS_KEY_ID: 'accessKeyId',
  AWS_SECRET_ACCESS_KEY: 'secretAccessKey',
  AWS_SESSION_TOKEN: 'sessionToken',
  AWS_SECURITY_TOKEN: 'sessionToken',
  AWS_CREDENTIAL_EXPIRATION: 'expiration',
};

const JSON_NAME_TO_FIELD: Record<string, keyof AwsCredentials> = {
  accesskeyid: 'accessKeyId',
  secretaccesskey: 'secretAccessKey',
  sessiontoken: 'sessionToken',
  expiration: 'expiration',
};

function parseJsonCredentials(text: string): Partial<AwsCredentials> {
  const parsedJson = JSON.parse(text);
  // `aws sts assume-role` style output nests everything under "Credentials".
  const source = parsedJson && typeof parsedJson === 'object' && parsedJson.Credentials
    ? parsedJson.Credentials
    : parsedJson;
  const result: Partial<AwsCredentials> = {};
  for (const [jsonName, jsonValue] of Object.entries(source || {})) {
    const field = JSON_NAME_TO_FIELD[jsonName.toLowerCase()];
    if (field && typeof jsonValue === 'string' && jsonValue.trim()) {
      result[field] = jsonValue.trim();
    }
  }
  return result;
}

function parseLineCredentials(text: string): Partial<AwsCredentials> {
  const result: Partial<AwsCredentials> = {};
  // Handles: `export AWS_X=...`, `AWS_X=...`, `set AWS_X=...`, `$Env:AWS_X="..."`,
  // and ~/.aws/credentials style `aws_access_key_id = ...`.
  const linePattern = /^\s*(?:export\s+|set\s+|\$env:)?(aws_[a-z_]+)\s*=\s*(.+?)\s*$/i;
  for (const line of text.split(/\r?\n/)) {
    const lineMatch = line.match(linePattern);
    if (!lineMatch) continue;
    const field = ENV_NAME_TO_FIELD[lineMatch[1].toUpperCase()];
    if (!field) continue;
    const cleanedValue = lineMatch[2].replace(/^["']|["'];?$/g, '').replace(/;$/, '').trim();
    if (cleanedValue) result[field] = cleanedValue;
  }
  return result;
}

/**
 * Parse whatever the user pasted into credentials.
 * Throws an Error with a user-facing message when the text is not usable.
 */
export function parseCredentialsText(rawText: string): AwsCredentials {
  const text = rawText.trim();
  if (!text) throw new Error('Paste your AWS credentials first.');

  let parsed: Partial<AwsCredentials>;
  if (text.startsWith('{')) {
    try {
      parsed = parseJsonCredentials(text);
    } catch {
      throw new Error('That looks like JSON but could not be parsed.');
    }
  } else {
    parsed = parseLineCredentials(text);
  }

  if (!parsed.accessKeyId || !parsed.secretAccessKey) {
    throw new Error('Could not find both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the pasted text.');
  }
  if (parsed.expiration && Number.isNaN(Date.parse(parsed.expiration))) {
    delete parsed.expiration;
  }
  return parsed as AwsCredentials;
}

export function loadCredentials(): AwsCredentials | null {
  try {
    const storedText = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (!storedText) return null;
    const stored = JSON.parse(storedText);
    if (stored && stored.accessKeyId && stored.secretAccessKey) return stored as AwsCredentials;
  } catch (error) {
    console.warn('Could not read stored credentials:', error);
  }
  return null;
}

export function saveCredentials(credentials: AwsCredentials): void {
  try {
    window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(credentials));
  } catch (error) {
    console.warn('Could not store credentials (they will only last for this page):', error);
  }
}

export function clearCredentials(): void {
  try {
    window.localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
  } catch (error) {
    console.warn('Could not clear stored credentials:', error);
  }
}

/** Fires when another tab stores or clears credentials. Returns an unsubscribe function. */
export function subscribeToCredentialChanges(callback: (credentials: AwsCredentials | null) => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CREDENTIALS_STORAGE_KEY || event.key === null) {
      callback(loadCredentials());
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}

/** Milliseconds until the credentials expire, or null when the expiry is unknown. */
export function getMillisecondsUntilExpiry(credentials: AwsCredentials | null, nowMs: number = Date.now()): number | null {
  if (!credentials?.expiration) return null;
  const expiryMs = Date.parse(credentials.expiration);
  return Number.isNaN(expiryMs) ? null : expiryMs - nowMs;
}

export function areCredentialsExpired(credentials: AwsCredentials | null, nowMs: number = Date.now()): boolean {
  const remainingMs = getMillisecondsUntilExpiry(credentials, nowMs);
  return remainingMs !== null && remainingMs <= 0;
}

export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Short, non-secret description of the credentials, e.g. "ASIA…7QXZ". */
export function describeAccessKey(credentials: AwsCredentials): string {
  const keyId = credentials.accessKeyId;
  return keyId.length > 8 ? `${keyId.slice(0, 4)}…${keyId.slice(-4)}` : keyId;
}
