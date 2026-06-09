import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VideoLabel, LabelStatus, VideoItem, AppState } from './types';
import VideoPlayer from './components/VideoPlayer';
import Pagination from './components/Pagination';

type GridLayout = '1x2' | '2x2' | '2x3';

const GRID_OPTIONS: { value: GridLayout; label: string; rows: number; cols: number }[] = [
  { value: '1x2', label: '1x2 (2 videos)', rows: 1, cols: 2 },
  { value: '2x2', label: '2x2 (4 videos)', rows: 2, cols: 2 },
  { value: '2x3', label: '2x3 (6 videos)', rows: 2, cols: 3 },
];

const getGridConfig = (layout: GridLayout) => {
  const option = GRID_OPTIONS.find(o => o.value === layout)!;
  return { rows: option.rows, cols: option.cols, pageSize: option.rows * option.cols };
};

// lastPage in review_db.json is always stored as a 1x2 page number (pageSize=2).
// This keeps it layout-independent so switching grids across sessions works correctly.
const toNormalizedPage = (page: number, pageSize: number) => Math.floor(page * pageSize / 2);
const fromNormalizedPage = (normalizedPage: number, pageSize: number) => Math.floor(normalizedPage * 2 / pageSize);

const App: React.FC = () => {
  const [videoKeys, setVideoKeys] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, VideoLabel>>({});
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [pageVideos, setPageVideos] = useState<VideoItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [gridLayout, setGridLayout] = useState<GridLayout>('2x3');

  const { rows: gridRows, cols: gridCols, pageSize: PAGE_SIZE } = getGridConfig(gridLayout);

  const stateRef = useRef({ labels, currentPage, videoKeys });
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    stateRef.current = { labels, currentPage, videoKeys };
  }, [labels, currentPage, videoKeys]);

  const initApp = async () => {
    try {
      const response = await fetch('/api/init');
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
      }
      const data: AppState = await response.json();
      setVideoKeys(data.videoKeys || []);
      setLabels(data.labels || {});
      // lastPage is stored as 1x2-normalized; convert to current layout's page
      setCurrentPage(fromNormalizedPage(data.lastPage || 0, PAGE_SIZE));
      setIsLoading(false);
    } catch (error: any) {
      console.error("Failed to initialize app:", error);
      setErrorStatus(error.message || String(error));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initApp();
  }, []);

  const loadPage = useCallback(async (page: number) => {
    if (videoKeys.length === 0) return;
    try {
      const response = await fetch(`/api/page?page=${page}&size=${PAGE_SIZE}`);
      if (!response.ok) throw new Error("Failed to load page data");

      const data = await response.json();
      const videosWithLabels = (data.videos || []).map((v: any) => {
        const labelData = labels[v.key];
        return {
          ...v,
          label: typeof labelData === 'object' ? labelData.status : (labelData || 'TP'),
          tag: typeof labelData === 'object' ? labelData.tag : ''
        };
      });

      setPageVideos(videosWithLabels);
    } catch (error) {
      console.error("Failed to load page:", error);
    }
  }, [videoKeys, labels, PAGE_SIZE]);

  useEffect(() => {
    if (!isLoading && !errorStatus) {
      loadPage(currentPage);
    }
  }, [currentPage, isLoading, errorStatus, loadPage]);

  const saveState = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastPage: toNormalizedPage(stateRef.current.currentPage, PAGE_SIZE),
          labels: stateRef.current.labels,
        })
      });
      if (!response.ok) throw new Error("Failed to save state");
    } catch (error) {
      console.error("Failed to save state:", error);
      alert("Save failed. Check console for details.");
    } finally {
      setIsSaving(false);
    }
  };

  const debouncedSave = (page: number, currentLabels: Record<string, Label>) => {
    // Clear the previous timer if it exists
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Start a new timer for 500ms
    saveTimeoutRef.current = setTimeout(() => {
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastPage: toNormalizedPage(page, PAGE_SIZE),
          labels: currentLabels,
        })
      });
      console.log("Debounced save triggered for page:", page);
    }, 500); // 500 milliseconds of silence required
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'PageDown' || e.key.toLowerCase() === 's') {
        const nextPage = Math.min(currentPage + 1, Math.ceil(videoKeys.length / PAGE_SIZE) - 1);
        setCurrentPage(nextPage);
        debouncedSave(nextPage, stateRef.current.labels); // Use the new helper
      } else if (e.key === 'PageUp' || e.key.toLowerCase() === 'a') {
        const prevPage = Math.max(0, currentPage - 1);
        setCurrentPage(prevPage);
        debouncedSave(prevPage, stateRef.current.labels); // Use the new helper
      }

      if (e.key.toLowerCase() === 'x') {
        const video = pageVideos[focusedIndex];
        if (video) {
          // This extracts the filename from the S3 key path
          const fileName = video.key.split('/').pop() || video.key;

          // Standard web API to copy to clipboard
          navigator.clipboard.writeText(fileName).then(() => {
            console.log("Copied to clipboard:", fileName);
          }).catch(err => {
            console.error("Failed to copy:", err);
          });
        }
      }

      if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'w') {
        const video = pageVideos[focusedIndex];
        if (video) {
          const newLabel = e.key.toLowerCase() === 'q' ? 'TP' : 'FP';
          updateVideoData(video.key, newLabel, video.tag || '');
        }
      }

      if (e.key.toLowerCase() === 'z') {
        const event = new CustomEvent('toggle-fullscreen-shortcut');
        window.dispatchEvent(event);
      }

      if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        const idx = parseInt(e.key) - 1;
        if (idx < PAGE_SIZE) setFocusedIndex(idx);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [videoKeys.length, pageVideos, focusedIndex, PAGE_SIZE, currentPage]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Find the index of the video that matches the query
    // We search by filename (the part after the last slash)
    const videoIndex = videoKeys.findIndex(key =>
      key.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (videoIndex !== -1) {
      const targetPage = Math.floor(videoIndex / PAGE_SIZE);
      setCurrentPage(targetPage);

      // Optional: Focus the specific video in that page
      setFocusedIndex(videoIndex % PAGE_SIZE);
      setSearchQuery(''); // Clear search after finding
    } else {
      alert("Video not found");
    }
  };

  const handleGridLayoutChange = (newLayout: GridLayout) => {
    const oldPageSize = PAGE_SIZE;
    const newConfig = getGridConfig(newLayout);
    // Calculate which video is first on the current page, and map it to the new page
    const firstVideoIndex = currentPage * oldPageSize;
    const newPage = Math.floor(firstVideoIndex / newConfig.pageSize);
    setGridLayout(newLayout);
    setCurrentPage(newPage);
    setFocusedIndex(0);
  };

  const updateVideoData = (key: string, status: LabelStatus, tag: string) => {
    setLabels(prev => {
      const newLabels = { ...prev, [key]: { status, tag } };
      // Trigger an async save with the newest data
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastPage: toNormalizedPage(currentPage, PAGE_SIZE),
          labels: newLabels,
        })
      });
      return newLabels;
    });
    setPageVideos(prev => prev.map(v => v.key === key ? { ...v, label: status, tag } : v));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-xl text-slate-300 animate-pulse">Initializing 100k+ Video Metadata...</div>
      </div>
    );
  }

  if (errorStatus) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-slate-300 p-8 text-center">
        <div className="text-red-500 text-4xl mb-4 font-bold">Initialization Error</div>
        <div className="bg-slate-800 p-6 rounded-lg border border-red-900 max-w-2xl">
          <p className="mb-4 text-lg">{errorStatus}</p>
          <p className="text-sm text-slate-500 mb-6 font-mono">
            Check if the backend server is running at port 3000 and AWS credentials are set.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }
  const allUniqueTags = Array.from(new Set(Object.values(labels).map(l => l.tag).filter(Boolean)));
  const totalPages = Math.ceil(videoKeys.length / PAGE_SIZE);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-white mr-8">Large Scale Review</h1>
          {/* New Search Bar */}
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              placeholder="Search video name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-md px-4 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 transition-all"
            />
            <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </form>
          <div className="text-slate-400 text-sm">
            <span className="font-mono">{videoKeys.length.toLocaleString()}</span> Videos
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="grid-layout" className="text-slate-400 text-sm">Grid:</label>
            <select
              id="grid-layout"
              value={gridLayout}
              onChange={(e) => handleGridLayoutChange(e.target.value as GridLayout)}
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {GRID_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <Pagination
            current={currentPage}
            total={totalPages}
            onChange={setCurrentPage}
          />
          <button
            onClick={saveState}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${isSaving ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg'
              }`}
          >
            {isSaving ? 'Saving...' : 'Manual Save'}
          </button>
        </div>
      </header>

      <main
        className="flex-1 p-4 bg-slate-900 grid gap-4 overflow-y-auto"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
        }}
      >
        {pageVideos.map((video, idx) => (
          <VideoPlayer
            key={video.key}
            video={video}
            allTags={allUniqueTags}
            isFocused={focusedIndex === idx}
            onFocus={() => setFocusedIndex(idx)}
            onToggleLabel={(status) => updateVideoData(video.key, status, video.tag || '')}
            onUpdateTag={(tag) => updateVideoData(video.key, video.label as LabelStatus, tag)}
          />
        ))}
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
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">Space</kbd> Play/Pause</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">←/→</kbd> Frame Step</span>
           <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">1-{PAGE_SIZE}</kbd> Select</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">Q</kbd> Mark TP</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">W</kbd> Mark FP</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">Z</kbd> Fullscreen</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">X</kbd> Copy Video Name</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">A / S</kbd> Navigation</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded border border-blue-800/50">
            Focused Video: {focusedIndex + 1}
          </span>
        </div>
      </footer>
    </div>
  );
};

export default App;
