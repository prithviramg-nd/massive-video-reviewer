// All S3 access, done directly from the browser.
//
// Reads (listing, review_db.json, videos) use presigned GET URLs fetched with no custom headers.
// Those are "simple" CORS requests: no preflight, and they work with a GET-only bucket CORS rule.
// Writes (review_db.json) use the SDK's PutObject, which needs a CORS rule allowing PUT
// (see s3-cors.json), and use ETag conditions so two tabs never silently overwrite each other.

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AwsCredentials } from './credentials';
import type { ReviewDb } from '../types';

export const DB_FILENAME = 'review_db.json';
export const DEFAULT_REGION = 'us-west-1';
const VIDEO_URL_EXPIRY_SECONDS = 3600;
const API_URL_EXPIRY_SECONDS = 900;

export interface S3Location {
  bucket: string;
  /** Always '' or ends with '/'. */
  prefix: string;
  /** Region found in the pasted link itself (console / regional URLs), if any. */
  region?: string;
}

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

function normalizePrefix(rawPrefix: string): string {
  const prefixParts = rawPrefix.split('/').filter((part) => part.length > 0);
  return prefixParts.length > 0 ? `${prefixParts.join('/')}/` : '';
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Accepts `s3://bucket/prefix/`, `bucket/prefix`, virtual-hosted or path-style S3 https URLs,
 * and AWS console URLs (`https://us-west-1.console.aws.amazon.com/s3/buckets/bucket?prefix=...&region=...`).
 */
export function parseS3Link(rawLink: string): S3Location {
  const link = rawLink.trim();
  if (!link) throw new Error('Enter an S3 folder link.');

  let bucket = '';
  let rawPrefix = '';
  let region: string | undefined;

  if (/^s3:\/\//i.test(link)) {
    const withoutScheme = link.replace(/^s3:\/\//i, '');
    const slashIndex = withoutScheme.indexOf('/');
    bucket = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
    rawPrefix = slashIndex === -1 ? '' : withoutScheme.slice(slashIndex + 1);
  } else if (/^https?:\/\//i.test(link)) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(link);
    } catch {
      throw new Error('That URL could not be parsed.');
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    const virtualHostedMatch = hostname.match(/^(.+)\.s3(?:[.-]([a-z0-9-]+))?\.amazonaws\.com$/);
    const pathStyleMatch = hostname.match(/^s3(?:[.-]([a-z0-9-]+))?\.amazonaws\.com$/);

    if (hostname.endsWith('console.aws.amazon.com')) {
      const consolePathMatch = parsedUrl.pathname.match(/\/s3\/(?:buckets|object)\/([^/]+)/);
      if (!consolePathMatch) throw new Error('This AWS console link does not point to an S3 bucket folder.');
      bucket = safeDecode(consolePathMatch[1]);
      rawPrefix = parsedUrl.searchParams.get('prefix') || '';
      const hostRegionMatch = hostname.match(/^([a-z]{2}-[a-z]+-\d)\.console/);
      region = parsedUrl.searchParams.get('region') || hostRegionMatch?.[1] || undefined;
    } else if (pathStyleMatch) {
      const [firstSegment, ...remainingSegments] = parsedUrl.pathname.replace(/^\//, '').split('/');
      bucket = safeDecode(firstSegment || '');
      rawPrefix = safeDecode(remainingSegments.join('/'));
      region = pathStyleMatch[1] && pathStyleMatch[1] !== 'external-1' ? pathStyleMatch[1] : undefined;
    } else if (virtualHostedMatch) {
      bucket = virtualHostedMatch[1];
      rawPrefix = safeDecode(parsedUrl.pathname.replace(/^\//, ''));
      region = virtualHostedMatch[2] && virtualHostedMatch[2] !== 'external-1' ? virtualHostedMatch[2] : undefined;
    } else {
      throw new Error('That URL is not an S3 or AWS console link.');
    }
  } else {
    const slashIndex = link.indexOf('/');
    bucket = slashIndex === -1 ? link : link.slice(0, slashIndex);
    rawPrefix = slashIndex === -1 ? '' : link.slice(slashIndex + 1);
  }

  bucket = bucket.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error(`"${bucket || '(empty)'}" is not a valid S3 bucket name.`);
  }
  if (region && region.startsWith('dualstack')) region = undefined;
  return { bucket, prefix: normalizePrefix(rawPrefix), region };
}

export function formatS3Link(location: Pick<S3Location, 'bucket' | 'prefix'>): string {
  return `s3://${location.bucket}/${location.prefix}`;
}

export function getReviewDbKey(location: S3Location): string {
  return `${location.prefix}${DB_FILENAME}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type S3ErrorKind =
  | 'credentials' // expired / invalid keys: ask for new ones
  | 'access-denied' // valid keys, but no permission
  | 'region' // wrong region; `detectedRegion` may tell the right one
  | 'conflict' // review_db.json changed since we read it (another tab)
  | 'network' // request blocked (usually bucket CORS) or offline
  | 'other';

export class S3RequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly kind: S3ErrorKind;
  readonly detectedRegion?: string;

  constructor(message: string, code: string, status: number, kind: S3ErrorKind, detectedRegion?: string) {
    super(message);
    this.name = 'S3RequestError';
    this.code = code;
    this.status = status;
    this.kind = kind;
    this.detectedRegion = detectedRegion;
  }
}

const CREDENTIAL_ERROR_CODES = new Set([
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidAccessKeyId',
  'InvalidToken',
  'TokenRefreshRequired',
  'SignatureDoesNotMatch',
  'InvalidClientTokenId',
  'CredentialsProviderError',
]);
const REGION_ERROR_CODES = new Set([
  'PermanentRedirect',
  'AuthorizationHeaderMalformed',
  'AuthorizationQueryParametersError',
  'IllegalLocationConstraintException',
]);

function classifyError(code: string, status: number, detectedRegion?: string): S3ErrorKind {
  if (code === 'PreconditionFailed' || code === 'ConditionalRequestConflict' || status === 412 || status === 409) return 'conflict';
  if (CREDENTIAL_ERROR_CODES.has(code)) return 'credentials';
  if (REGION_ERROR_CODES.has(code) || status === 301) return detectedRegion || code !== 'AuthorizationQueryParametersError' ? 'region' : 'other';
  if (code === 'AccessDenied' || status === 403) return 'access-denied';
  return 'other';
}

function regionFromEndpoint(endpoint: string | null | undefined): string | undefined {
  const endpointMatch = endpoint?.match(/s3[.-]([a-z]{2}-[a-z]+-\d)\.amazonaws\.com/);
  return endpointMatch?.[1];
}

function parseErrorXml(xmlText: string): { code: string; message: string; region?: string } {
  try {
    const xmlDocument = new DOMParser().parseFromString(xmlText, 'application/xml');
    const readTag = (tagName: string) => xmlDocument.getElementsByTagName(tagName)[0]?.textContent?.trim() || '';
    const messageText = readTag('Message');
    const regionInMessage = messageText.match(/expecting '([a-z]{2}-[a-z]+-\d)'/)?.[1];
    return {
      code: readTag('Code'),
      message: messageText,
      region: readTag('Region') || regionFromEndpoint(readTag('Endpoint')) || regionInMessage || undefined,
    };
  } catch {
    return { code: '', message: xmlText.slice(0, 200) };
  }
}

async function errorFromResponse(response: Response): Promise<S3RequestError> {
  const bodyText = await response.text().catch(() => '');
  const parsedError = parseErrorXml(bodyText);
  const detectedRegion = response.headers.get('x-amz-bucket-region') || parsedError.region;
  const code = parsedError.code || `HTTP${response.status}`;
  const message = parsedError.message || response.statusText || `S3 responded with HTTP ${response.status}`;
  return new S3RequestError(message, code, response.status, classifyError(code, response.status, detectedRegion), detectedRegion);
}

/** Convert anything thrown by fetch / the AWS SDK into an S3RequestError. */
export function toS3RequestError(error: unknown): S3RequestError {
  if (error instanceof S3RequestError) return error;
  const errorRecord = (error || {}) as Record<string, any>;
  const errorName: string = errorRecord.name || errorRecord.Code || 'Error';
  const errorMessage: string = errorRecord.message || String(error);
  if (errorName === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(errorMessage)) {
    return new S3RequestError(errorMessage, 'NetworkError', 0, 'network');
  }
  const status: number = errorRecord.$metadata?.httpStatusCode || 0;
  const detectedRegion: string | undefined = errorRecord.Region || regionFromEndpoint(errorRecord.Endpoint);
  return new S3RequestError(errorMessage, errorName, status, classifyError(errorName, status, detectedRegion), detectedRegion);
}

export type S3Operation = 'list' | 'read' | 'save';

/** User-facing explanation for an S3 failure. */
export function describeS3Error(error: unknown, operation: S3Operation, location?: S3Location): string {
  const requestError = toS3RequestError(error);
  const bucketText = location ? ` on bucket "${location.bucket}"` : '';
  switch (requestError.kind) {
    case 'credentials':
      return `Your AWS credentials are expired or invalid (${requestError.code}). Paste fresh credentials.`;
    case 'access-denied':
      return `S3 denied access${bucketText} (${requestError.code}). Check that these credentials allow `
        + (operation === 'save' ? 's3:PutObject' : operation === 'list' ? 's3:ListBucket' : 's3:GetObject')
        + ' for this folder.';
    case 'network':
      return operation === 'save'
        ? `Saving was blocked. Bucket "${location?.bucket ?? ''}" does not allow saving from this site yet `
          + '(one-time CORS setup per bucket), or the network is down.'
        : `Could not reach S3. Bucket "${location?.bucket ?? ''}" may not allow this site yet `
          + '(one-time CORS setup per bucket), or the network is down.';
    case 'region':
      return `The bucket is in a different region${requestError.detectedRegion ? ` (${requestError.detectedRegion})` : ''}. `
        + 'Set the correct region and try again.';
    case 'conflict':
      return 'review_db.json was changed by another tab or person.';
    default:
      return `${requestError.code}: ${requestError.message}`;
  }
}

// ---------------------------------------------------------------------------
// Client + operations
// ---------------------------------------------------------------------------

export function createS3Client(credentials: AwsCredentials, region: string): S3Client {
  return new S3Client({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    // Keep requests minimal: no optional checksum headers / query params.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function fetchPresigned(url: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw toS3RequestError(error);
  }
  return response;
}

function decodeListedKey(encodedKey: string): string {
  // With encoding-type=url, S3 encodes spaces as '+' and everything else as %XX.
  return safeDecode(encodedKey.replace(/\+/g, ' '));
}

export interface ListProgress {
  scannedObjects: number;
  videosFound: number;
  elapsedMs: number;
}

/** List every .mp4 under the prefix (recursively), sorted by file name like the old backend. */
export async function listVideoKeys(
  client: S3Client,
  location: S3Location,
  onProgress: (progress: ListProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const startedAtMs = performance.now();
  const videoKeys: string[] = [];
  let scannedObjects = 0;
  let continuationToken: string | undefined;

  do {
    const listUrl = await getSignedUrl(
      client,
      new ListObjectsV2Command({
        Bucket: location.bucket,
        Prefix: location.prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
        EncodingType: 'url',
      }),
      { expiresIn: API_URL_EXPIRY_SECONDS },
    );
    const response = await fetchPresigned(listUrl, signal);
    if (!response.ok) throw await errorFromResponse(response);

    const xmlDocument = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const contentElements = Array.from(xmlDocument.getElementsByTagName('Contents'));
    for (const contentElement of contentElements) {
      const encodedKey = contentElement.getElementsByTagName('Key')[0]?.textContent;
      if (!encodedKey) continue;
      const objectKey = decodeListedKey(encodedKey);
      if (objectKey.endsWith('.mp4') && !objectKey.endsWith(DB_FILENAME)) videoKeys.push(objectKey);
    }
    scannedObjects += contentElements.length;

    const isTruncated = xmlDocument.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
    continuationToken = isTruncated
      ? xmlDocument.getElementsByTagName('NextContinuationToken')[0]?.textContent || undefined
      : undefined;
    onProgress({ scannedObjects, videosFound: videoKeys.length, elapsedMs: performance.now() - startedAtMs });
  } while (continuationToken);

  const fileName = (objectKey: string) => (objectKey.split('/').pop() || objectKey).toLowerCase();
  return videoKeys.sort((firstKey, secondKey) => fileName(firstKey).localeCompare(fileName(secondKey)));
}

/** Local signing only (no network). `<video src>` loads do not need CORS. */
export function presignVideoUrl(client: S3Client, bucket: string, objectKey: string): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), {
    expiresIn: VIDEO_URL_EXPIRY_SECONDS,
  });
}

export interface LoadedReviewDb {
  data: ReviewDb;
  /** ETag of the file we read; null when the file does not exist or the ETag header is not exposed by CORS. */
  etag: string | null;
  exists: boolean;
}

export async function loadReviewDb(client: S3Client, location: S3Location, signal?: AbortSignal): Promise<LoadedReviewDb> {
  const dbUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: location.bucket, Key: getReviewDbKey(location) }),
    { expiresIn: API_URL_EXPIRY_SECONDS },
  );
  const response = await fetchPresigned(dbUrl, signal);
  if (response.status === 404) {
    return { data: { lastPage: 0, labels: {} }, etag: null, exists: false };
  }
  if (!response.ok) throw await errorFromResponse(response);

  const bodyText = await response.text();
  let parsedDb: Partial<ReviewDb> = {};
  if (bodyText.trim()) {
    try {
      parsedDb = JSON.parse(bodyText);
    } catch (error) {
      throw new S3RequestError(`${DB_FILENAME} is not valid JSON: ${(error as Error).message}`, 'InvalidJson', 200, 'other');
    }
  }
  return {
    data: { ...parsedDb, lastPage: Number(parsedDb.lastPage) || 0, labels: parsedDb.labels || {} },
    etag: response.headers.get('ETag'),
    exists: true,
  };
}

/**
 * Write review_db.json. Uses `If-Match: <etag>` (or `If-None-Match: *` for a new file), so a
 * concurrent write from another tab is rejected with a 'conflict' S3RequestError instead of lost.
 * Returns the new ETag (null if CORS does not expose it).
 */
export async function saveReviewDb(
  client: S3Client,
  location: S3Location,
  reviewDb: ReviewDb,
  etag: string | null,
  fileExists: boolean,
): Promise<string | null> {
  const conditionalHeaders = etag ? { IfMatch: etag } : fileExists ? {} : { IfNoneMatch: '*' };
  try {
    const response = await client.send(new PutObjectCommand({
      Bucket: location.bucket,
      Key: getReviewDbKey(location),
      Body: JSON.stringify(reviewDb),
      ContentType: 'application/json',
      ...conditionalHeaders,
    }));
    return response.ETag || null;
  } catch (error) {
    throw toS3RequestError(error);
  }
}
