import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LabelStatus, PageVideo, ReviewDb, StoredLabel, normalizeLabel } from './types';
import VideoPlayer from './components/VideoPlayer';
import Pagination from './components/Pagination';
import { CredentialsModal } from './components/CredentialsForm';
import CorsHelp from './components/CorsHelp';
import {
  AwsCredentials,
  areCredentialsExpired,
  describeAccessKey,
  formatDuration,
  getMillisecondsUntilExpiry,
} from './lib/credentials';
import {
  DB_FILENAME,
  ListProgress,
  S3ErrorKind,
  S3Location,
  createS3Client,
  describeS3Error,
  formatS3Link,
  listVideoKeys,
  loadReviewDb,
  presignVideoUrl,
  saveReviewDb,
  toS3RequestError,
} from './lib/s3';
import { isTypingTarget } from './lib/dom';

type GridLayout = '1x2' | '2x2' | '2x3';

const GRID_OPTIONS: { value: GridLayout; label: string; rows: number; cols: number }[] = [
  { value: '1x2', label: '1x2 (2 videos)', rows: 1, cols: 2 },
  { value: '2x2', label: '2x2 (4 videos)', rows: 2, cols: 2 },
  { value: '2x3', label: '2x3 (6 videos)', rows: 2, cols: 3 },
];

const getGridConfig = (layout: GridLayout) => {
  const option = GRID_OPTIONS.find((gridOption) => gridOption.value === layout)!;
  return { rows: option.rows, cols: option.cols, pageSize: option.rows * option.cols };
};

// lastPage in review_db.json is always stored as a 1x2 page number (pageSize=2).
// This keeps it layout-independent so switching grids across sessions works correctly.
const toNormalizedPage = (page: number, pageSize: number) => Math.floor(page * pageSize / 2);
const fromNormalizedPage = (normalizedPage: number, pageSize: number) => Math.floor(normalizedPage * 2 / pageSize);

const SAVE_DEBOUNCE_MS = 1000;
const MAX_SAVE_ATTEMPTS = 4;
const EXPIRY_WARNING_MS = 10 * 60 * 1000;

type LoadPhase = 'loading' | 'ready' | 'error';
type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

interface Props {
  location: S3Location;
  initialRegion: string;
  credentials: AwsCredentials;
  onCredentialsChange: (credentials: AwsCredentials | null) => void;
  onRegionDetected: (region: string) => void;
  onChangeFolder: () => void;
}

const kbdClass = 'bg-slate-700 px-1 rounded text-white font-mono shadow-sm';

const App: React.FC<Props> = ({ location, initialRegion, credentials, onCredentialsChange, onRegionDetected, onChangeFolder }) => {
  const [region, setRegion] = useState(initialRegion);
  const s3Client = useMemo(() => createS3Client(credentials, region), [credentials, region]);

  const [videoKeys, setVideoKeys] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, StoredLabel>>({});
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>('loading');
  const [loadStage, setLoadStage] = useState('Listing videos');
  const [listProgress, setListProgress] = useState<ListProgress | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; kind: S3ErrorKind } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [pageVideos, setPageVideos] = useState<PageVideo[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [saveErrorKind, setSaveErrorKind] = useState<S3ErrorKind | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [gridLayout, setGridLayout] = useState<GridLayout>('2x3');
  const [credentialsPrompt, setCredentialsPrompt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pathCopied, setPathCopied] = useState(false);

  const { rows: gridRows, cols: gridCols, pageSize: PAGE_SIZE } = getGridConfig(gridLayout);
  const folderLink = formatS3Link(location);

  // --- Refs read by the save queue: always the latest values, independent of render timing ---
  const s3ClientRef = useRef(s3Client);
  s3ClientRef.current = s3Client;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const pageSizeRef = useRef(PAGE_SIZE);
  pageSizeRef.current = PAGE_SIZE;
  const labelsRef = useRef<Record<string, StoredLabel>>({});
  /** Video keys changed locally but not yet saved -> change number when they were last changed. */
  const dirtyKeysRef = useRef(new Map<string, number>());
  const changeCounterRef = useRef(0);
  const pageDirtyRef = useRef(false);
  const savedNormalizedPageRef = useRef(0);
  /** Top-level fields of review_db.json other than lastPage/labels, preserved on save. */
  const extraDbFieldsRef = useRef<Record<string, unknown>>({});
  const etagRef = useRef<string | null>(null);
  const dbExistsRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const saveRequestedRef = useRef(false);
  const warnedNoEtagRef = useRef(false);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});
  const dismissedPromptCredentialsRef = useRef<AwsCredentials | null>(null);

  const hasPendingChanges = () => dirtyKeysRef.current.size > 0 || pageDirtyRef.current;

  const applyLoadedDb = (loadedData: ReviewDb, etag: string | null, exists: boolean) => {
    const { lastPage: _ignoredPage, labels: _ignoredLabels, ...extraFields } = loadedData;
    extraDbFieldsRef.current = extraFields;
    etagRef.current = etag;
    dbExistsRef.current = exists;
    if (exists && !etag && !warnedNoEtagRef.current) {
      warnedNoEtagRef.current = true;
      console.warn('ETag header is not exposed by the bucket CORS rules; saves cannot detect edits from other tabs.');
    }
  };

  // ---------------------------------------------------------------------------
  // Initial load: list videos, then read review_db.json
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const abortController = new AbortController();
    const activeClient = s3ClientRef.current;
    setLoadPhase('loading');
    setLoadError(null);
    setListProgress(null);
    setLoadStage('Listing videos');

    if (areCredentialsExpired(credentials)) {
      setLoadError({ message: 'Your stored AWS credentials have expired.', kind: 'credentials' });
      setLoadPhase('error');
      setCredentialsPrompt('Your stored AWS credentials have expired. Paste fresh ones to open this folder.');
      return;
    }

    const runLoad = async () => {
      let operation: 'list' | 'read' = 'list';
      try {
        const listedKeys = await listVideoKeys(activeClient, location, setListProgress, abortController.signal);
        operation = 'read';
        setLoadStage(`Reading ${DB_FILENAME}`);
        const loadedDb = await loadReviewDb(activeClient, location, abortController.signal);
        if (abortController.signal.aborted) return;

        applyLoadedDb(loadedDb.data, loadedDb.etag, loadedDb.exists);
        labelsRef.current = loadedDb.data.labels;
        setLabels(loadedDb.data.labels);
        setVideoKeys(listedKeys);
        const totalPages = Math.ceil(listedKeys.length / pageSizeRef.current);
        const restoredPage = Math.max(0, Math.min(fromNormalizedPage(loadedDb.data.lastPage, pageSizeRef.current), totalPages - 1));
        savedNormalizedPageRef.current = toNormalizedPage(restoredPage, pageSizeRef.current);
        setCurrentPage(restoredPage);
        setLoadPhase('ready');
      } catch (error) {
        if (abortController.signal.aborted || (error as Error)?.name === 'AbortError') return;
        const requestError = toS3RequestError(error);
        console.error(`Failed to open ${folderLink}:`, requestError);
        if (requestError.kind === 'region' && requestError.detectedRegion && requestError.detectedRegion !== region) {
          console.info(`Bucket is in ${requestError.detectedRegion}; retrying with that region.`);
          setRegion(requestError.detectedRegion);
          onRegionDetected(requestError.detectedRegion);
          setLoadAttempt((attempt) => attempt + 1);
          return;
        }
        const message = describeS3Error(requestError, operation, location);
        setLoadError({ message, kind: requestError.kind });
        setLoadPhase('error');
        if (requestError.kind === 'credentials') setCredentialsPrompt(message);
      }
    };
    void runLoad();
    return () => abortController.abort();
    // Re-run only on explicit retries; this component is remounted for a new folder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  // ---------------------------------------------------------------------------
  // Save queue: one PUT at a time, debounced, conflict-safe (ETag conditional writes)
  // ---------------------------------------------------------------------------
  const scheduleSave = useCallback((delayMs: number = SAVE_DEBOUNCE_MS) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSaveRef.current();
    }, delayMs);
  }, []);

  const flushSave = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      saveRequestedRef.current = true;
      return;
    }
    if (!hasPendingChanges()) {
      setSaveStatus('saved');
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus('saving');
    let saveFailed = false;
    try {
      for (let attemptNumber = 1; ; attemptNumber += 1) {
        const changeNumberAtStart = changeCounterRef.current;
        const normalizedPage = toNormalizedPage(currentPageRef.current, pageSizeRef.current);
        const reviewDb: ReviewDb = { ...extraDbFieldsRef.current, lastPage: normalizedPage, labels: labelsRef.current };
        try {
          const newEtag = await saveReviewDb(s3ClientRef.current, location, reviewDb, etagRef.current, dbExistsRef.current);
          applyLoadedDb(reviewDb, newEtag, true);
          for (const [videoKey, changeNumber] of Array.from(dirtyKeysRef.current.entries())) {
            if (changeNumber <= changeNumberAtStart) dirtyKeysRef.current.delete(videoKey);
          }
          savedNormalizedPageRef.current = normalizedPage;
          pageDirtyRef.current = toNormalizedPage(currentPageRef.current, pageSizeRef.current) !== normalizedPage;
          console.log(`Saved ${DB_FILENAME} (${Object.keys(reviewDb.labels).length} labels, page ${normalizedPage}).`);
          break;
        } catch (error) {
          const requestError = toS3RequestError(error);
          if (requestError.kind !== 'conflict' || attemptNumber >= MAX_SAVE_ATTEMPTS) throw requestError;

          // Another tab (or person) saved this folder's review_db.json since we read it.
          // Take their labels, put our unsaved changes on top, and try again.
          const remoteDb = await loadReviewDb(s3ClientRef.current, location);
          const mergedLabels: Record<string, StoredLabel> = { ...remoteDb.data.labels };
          for (const dirtyKey of Array.from(dirtyKeysRef.current.keys())) {
            if (dirtyKey in labelsRef.current) mergedLabels[dirtyKey] = labelsRef.current[dirtyKey];
          }
          labelsRef.current = mergedLabels;
          setLabels(mergedLabels);
          applyLoadedDb(remoteDb.data, remoteDb.etag, remoteDb.exists);
          console.info(
            `${DB_FILENAME} was changed elsewhere; merged ${Object.keys(remoteDb.data.labels).length} remote labels `
            + `with ${dirtyKeysRef.current.size} local changes (attempt ${attemptNumber}).`,
          );
        }
      }
      setSaveErrorMessage(null);
      setSaveErrorKind(null);
    } catch (error) {
      saveFailed = true;
      const requestError = toS3RequestError(error);
      console.error(`Failed to save ${DB_FILENAME}:`, requestError);
      const message = requestError.kind === 'conflict'
        ? `${DB_FILENAME} keeps changing in another tab. Your changes are kept here; press Save to retry.`
        : describeS3Error(requestError, 'save', location);
      setSaveErrorMessage(message);
      setSaveErrorKind(requestError.kind);
      if (requestError.kind === 'credentials') setCredentialsPrompt(message);
    } finally {
      saveInFlightRef.current = false;
      setSaveStatus(saveFailed ? 'error' : hasPendingChanges() ? 'unsaved' : 'saved');
      if (saveRequestedRef.current) {
        saveRequestedRef.current = false;
        scheduleSave(0);
      } else if (!saveFailed && hasPendingChanges()) {
        scheduleSave();
      }
    }
  };
  flushSaveRef.current = flushSave;

  const markChanged = (videoKey: string) => {
    changeCounterRef.current += 1;
    dirtyKeysRef.current.set(videoKey, changeCounterRef.current);
    setSaveStatus((previousStatus) => (previousStatus === 'saving' ? previousStatus : 'unsaved'));
    scheduleSave();
  };

  const updateVideoData = (videoKey: string, status: LabelStatus, tags: string[]) => {
    const updatedLabels = { ...labelsRef.current, [videoKey]: { status, tags } };
    labelsRef.current = updatedLabels;
    setLabels(updatedLabels);
    markChanged(videoKey);
  };

  // Page changes are saved too (lastPage), so the next session resumes here.
  useEffect(() => {
    if (loadPhase !== 'ready') return;
    if (toNormalizedPage(currentPage, PAGE_SIZE) !== savedNormalizedPageRef.current) {
      pageDirtyRef.current = true;
      setSaveStatus((previousStatus) => (previousStatus === 'saving' ? previousStatus : 'unsaved'));
      scheduleSave();
    }
  }, [currentPage, PAGE_SIZE, loadPhase, scheduleSave]);

  // Warn before closing with unsaved changes; save right away when the tab is hidden.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasPendingChanges() || saveInFlightRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && hasPendingChanges()) void flushSaveRef.current();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Credentials: expiry countdown, prompt, and retry after new credentials arrive
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(intervalId);
  }, []);

  const remainingCredentialMs = getMillisecondsUntilExpiry(credentials, nowMs);
  const credentialsExpired = remainingCredentialMs !== null && remainingCredentialMs <= 0;

  useEffect(() => {
    if (credentialsExpired && dismissedPromptCredentialsRef.current !== credentials) {
      setCredentialsPrompt((currentPrompt) => currentPrompt || 'Your AWS credentials have expired. Paste fresh ones to keep saving.');
    }
  }, [credentialsExpired, credentials]);

  const previousCredentialsRef = useRef(credentials);
  useEffect(() => {
    if (previousCredentialsRef.current === credentials) return;
    previousCredentialsRef.current = credentials;
    setCredentialsPrompt(null);
    if (loadPhase === 'error') {
      setLoadAttempt((attempt) => attempt + 1);
    } else if (hasPendingChanges()) {
      void flushSaveRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  const dismissCredentialsPrompt = () => {
    dismissedPromptCredentialsRef.current = credentials;
    setCredentialsPrompt(null);
  };

  // ---------------------------------------------------------------------------
  // Current page: presign the video URLs (local signing, no network)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (loadPhase !== 'ready') return;
    let cancelled = false;
    const startIndex = currentPage * PAGE_SIZE;
    const keysOnPage = videoKeys.slice(startIndex, startIndex + PAGE_SIZE);
    Promise.all(keysOnPage.map(async (videoKey) => ({
      key: videoKey,
      url: await presignVideoUrl(s3Client, location.bucket, videoKey),
    })))
      .then((signedVideos) => {
        if (!cancelled) setPageVideos(signedVideos);
      })
      .catch((error) => console.error('Failed to sign video URLs:', error));
    return () => {
      cancelled = true;
    };
  }, [loadPhase, currentPage, PAGE_SIZE, videoKeys, s3Client, location.bucket]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (unchanged)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (credentialsPrompt || isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const pressedKey = event.key.toLowerCase();
      const lastPageIndex = Math.max(0, Math.ceil(videoKeys.length / PAGE_SIZE) - 1);

      if (event.key === 'PageDown' || pressedKey === 's') {
        setCurrentPage(Math.min(currentPage + 1, lastPageIndex));
      } else if (event.key === 'PageUp' || pressedKey === 'a') {
        setCurrentPage(Math.max(0, currentPage - 1));
      }

      if (pressedKey === 'x') {
        const video = pageVideos[focusedIndex];
        if (video) {
          // This extracts the filename from the S3 key path
          const fileName = video.key.split('/').pop() || video.key;
          navigator.clipboard.writeText(fileName).then(() => {
            console.log('Copied to clipboard:', fileName);
          }).catch((error) => {
            console.error('Failed to copy:', error);
          });
        }
      }

      if (pressedKey === 'q' || pressedKey === 'w') {
        const video = pageVideos[focusedIndex];
        if (video) {
          const newLabel: LabelStatus = pressedKey === 'q' ? 'TP' : 'FP';
          updateVideoData(video.key, newLabel, normalizeLabel(labelsRef.current[video.key]).tags);
        }
      }

      if (pressedKey === 'z') {
        window.dispatchEvent(new CustomEvent('toggle-fullscreen-shortcut'));
      }

      if (['1', '2', '3', '4', '5', '6'].includes(event.key)) {
        const videoIndex = parseInt(event.key, 10) - 1;
        if (videoIndex < PAGE_SIZE) {
          event.preventDefault(); // prevent digit from being typed into the auto-focused tag input
          setFocusedIndex(videoIndex);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKeys.length, pageVideos, focusedIndex, PAGE_SIZE, currentPage, credentialsPrompt]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    const videoIndex = videoKeys.findIndex((videoKey) => videoKey.toLowerCase().includes(trimmedQuery.toLowerCase()));
    if (videoIndex !== -1) {
      setCurrentPage(Math.floor(videoIndex / PAGE_SIZE));
      setFocusedIndex(videoIndex % PAGE_SIZE);
      setSearchQuery('');
      setSearchMessage(null);
    } else {
      setSearchMessage('Video not found');
      setTimeout(() => setSearchMessage(null), 3000);
    }
  };

  const handleGridLayoutChange = (newLayout: GridLayout) => {
    const newConfig = getGridConfig(newLayout);
    // Calculate which video is first on the current page, and map it to the new page
    const firstVideoIndex = currentPage * PAGE_SIZE;
    setGridLayout(newLayout);
    setCurrentPage(Math.floor(firstVideoIndex / newConfig.pageSize));
    setFocusedIndex(0);
  };

  const handleChangeFolderClick = async () => {
    if (hasPendingChanges() || saveInFlightRef.current) await flushSaveRef.current();
    if (hasPendingChanges() && !window.confirm('Some changes could not be saved yet. Leave this folder anyway?')) return;
    onChangeFolder();
  };

  const copyFolderLink = () => {
    navigator.clipboard.writeText(folderLink).then(() => {
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 1500);
    }).catch((error) => console.error('Failed to copy:', error));
  };

  const allUniqueTags = useMemo(() => Array.from(new Set(
    Object.values(labels).flatMap((storedLabel) => normalizeLabel(storedLabel).tags),
  )), [labels]);

  const credentialsModal = credentialsPrompt && (
    <CredentialsModal reason={credentialsPrompt} onSave={onCredentialsChange} onClose={dismissCredentialsPrompt} />
  );

  if (loadPhase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 space-y-3 px-4 text-center">
        <div className="text-xl text-slate-300 animate-pulse">{loadStage}…</div>
        <div className="text-sm text-slate-500 font-mono break-all">{folderLink}</div>
        {listProgress && (
          <div className="text-sm text-slate-400 font-mono">
            Scanned {listProgress.scannedObjects.toLocaleString()} objects · {listProgress.videosFound.toLocaleString()} videos
            · {Math.round(listProgress.elapsedMs / 1000)}s
          </div>
        )}
        {credentialsModal}
      </div>
    );
  }

  if (loadPhase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-slate-300 p-8 text-center">
        <div className="text-red-500 text-3xl mb-4 font-bold">Could not open folder</div>
        <div className="bg-slate-800 p-6 rounded-lg border border-red-900 max-w-2xl space-y-4">
          <p className="text-sm text-slate-500 font-mono break-all">{folderLink} ({region})</p>
          <p className="text-lg">{loadError?.message}</p>
          {loadError?.kind === 'network' && <div className="text-sm text-blue-300"><CorsHelp bucket={location.bucket} /></div>}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => setCredentialsPrompt(loadError?.message || 'Paste fresh AWS credentials.')}
              className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium transition-colors"
            >
              Update credentials
            </button>
            <button
              onClick={onChangeFolder}
              className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium transition-colors"
            >
              Change folder
            </button>
          </div>
        </div>
        {credentialsModal}
      </div>
    );
  }

  const totalPages = Math.ceil(videoKeys.length / PAGE_SIZE);
  const saveStatusView = {
    saved: { text: '✓ Saved', className: 'text-green-400' },
    unsaved: { text: '● Unsaved', className: 'text-amber-400' },
    saving: { text: 'Saving…', className: 'text-blue-300' },
    error: { text: '⚠ Save failed', className: 'text-red-400' },
  }[saveStatus];
  const expiryClassName = credentialsExpired
    ? 'text-red-400'
    : remainingCredentialMs !== null && remainingCredentialMs < EXPIRY_WARNING_MS ? 'text-amber-400' : 'text-slate-400';

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-white mr-8">Large Scale Review</h1>
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              placeholder="Search video name..."
              value={searchQuery}
              onChange={(event) => { setSearchQuery(event.target.value); setSearchMessage(null); }}
              className="bg-slate-900 border border-slate-700 rounded-md px-4 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 transition-all"
            />
            <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            {searchMessage && <div className="absolute left-0 top-full mt-1 text-xs text-amber-400">{searchMessage}</div>}
          </form>
          <div className="text-slate-400 text-sm">
            <span className="font-mono">{videoKeys.length.toLocaleString()}</span> Videos
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="grid-layout" className="text-slate-400 text-sm">Grid:</label>
            <select
              id="grid-layout"
              value={gridLayout}
              onChange={(event) => handleGridLayoutChange(event.target.value as GridLayout)}
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {GRID_OPTIONS.map((gridOption) => (
                <option key={gridOption.value} value={gridOption.value}>{gridOption.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
          <span className={`text-sm font-medium ${saveStatusView.className}`} title={saveErrorMessage || undefined}>
            {saveStatusView.text}
          </span>
          <button
            onClick={() => void flushSave()}
            disabled={saveStatus === 'saving'}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${saveStatus === 'saving' ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg'
              }`}
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Manual Save'}
          </button>
        </div>
      </header>

      <div className="flex items-center justify-between px-6 py-1.5 bg-slate-800/60 border-b border-slate-700 text-xs">
        <div className="flex items-center space-x-3 min-w-0">
          <span className="font-mono text-slate-300 truncate" title={`${folderLink} (${region})`}>{folderLink}</span>
          <button onClick={copyFolderLink} className="text-slate-400 hover:text-white flex-shrink-0">
            {pathCopied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => void handleChangeFolderClick()} className="text-blue-400 hover:text-blue-300 flex-shrink-0">
            Change folder
          </button>
          <a
            href={window.location.pathname}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 flex-shrink-0"
          >
            Open another folder ↗
          </a>
        </div>
        <div className="flex items-center space-x-3 flex-shrink-0 ml-4">
          <span className={expiryClassName}>
            Key {describeAccessKey(credentials)}
            {remainingCredentialMs !== null && (credentialsExpired ? ' · expired' : ` · ${formatDuration(remainingCredentialMs)} left`)}
          </span>
          <button
            onClick={() => setCredentialsPrompt('Paste fresh AWS credentials. They are shared with your other tabs.')}
            className="text-blue-400 hover:text-blue-300"
          >
            Update credentials
          </button>
        </div>
      </div>

      {saveErrorMessage && (
        <div className="px-6 py-2 bg-red-950/60 border-b border-red-900 text-sm text-red-200 max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span>{saveErrorMessage}</span>
            <button onClick={() => void flushSave()} className="ml-4 px-3 py-1 rounded bg-red-800 hover:bg-red-700 text-white text-xs flex-shrink-0">
              Retry save
            </button>
          </div>
          {saveErrorKind === 'network' && <CorsHelp bucket={location.bucket} />}
        </div>
      )}

      <main
        className="flex-1 p-4 bg-slate-900 grid gap-4 overflow-y-auto"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
        }}
      >
        {pageVideos.map((pageVideo, videoIndex) => {
          const { status, tags } = normalizeLabel(labels[pageVideo.key]);
          return (
            <VideoPlayer
              key={pageVideo.key}
              video={{ ...pageVideo, label: status, tags }}
              allTags={allUniqueTags}
              isFocused={focusedIndex === videoIndex}
              onFocus={() => setFocusedIndex(videoIndex)}
              onToggleLabel={(newStatus) => updateVideoData(pageVideo.key, newStatus, tags)}
              onUpdateTags={(newTags) => updateVideoData(pageVideo.key, status, newTags)}
            />
          );
        })}
        {pageVideos.length === 0 && (
          <div
            className="flex items-center justify-center text-slate-500"
            style={{ gridColumn: `span ${gridCols}`, gridRow: `span ${gridRows}` }}
          >
            No videos found in this page.
          </div>
        )}
      </main>

      <footer className="flex-shrink-0 px-6 py-2 bg-slate-800 text-xs text-slate-400 flex justify-between items-center border-t border-slate-700 shadow-inner">
        <div className="flex space-x-4">
          <span><kbd className={kbdClass}>Space</kbd> Play/Pause</span>
          <span><kbd className={kbdClass}>←/→</kbd> Frame Step</span>
          <span><kbd className={kbdClass}>1-{PAGE_SIZE}</kbd> Select</span>
          <span><kbd className={kbdClass}>Q</kbd> Mark TP</span>
          <span><kbd className={kbdClass}>W</kbd> Mark FP</span>
          <span><kbd className={kbdClass}>Z</kbd> Fullscreen</span>
          <span><kbd className={kbdClass}>X</kbd> Copy Video Name</span>
          <span><kbd className={kbdClass}>A / S</kbd> Navigation</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded border border-blue-800/50">
            Focused Video: {focusedIndex + 1}
          </span>
        </div>
      </footer>
      {credentialsModal}
    </div>
  );
};

export default App;
