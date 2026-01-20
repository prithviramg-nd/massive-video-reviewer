import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Label, VideoItem, AppState } from './types';
import VideoPlayer from './components/VideoPlayer';
import Pagination from './components/Pagination';

const PAGE_SIZE = 6;

const App: React.FC = () => {
  const [videoKeys, setVideoKeys] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, Label>>({});
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [pageVideos, setPageVideos] = useState<VideoItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const stateRef = useRef({ labels, currentPage, videoKeys });
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
      setCurrentPage(data.lastPage || 0);
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
    fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastPage: page,
        labels: labels, // Use current labels
      })
    });
    try {
      const response = await fetch(`/api/page?page=${page}`);
      if (!response.ok) throw new Error("Failed to load page data");

      const data = await response.json();
      const videosWithLabels = (data.videos || []).map((v: any) => ({
        ...v,
        label: labels[v.key] || 'TP'
      }));

      setPageVideos(videosWithLabels);
    } catch (error) {
      console.error("Failed to load page:", error);
    }
  }, [videoKeys, labels]);

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
          lastPage: stateRef.current.currentPage,
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

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PageDown' || e.key === ']') {
        setCurrentPage(prev => Math.min(prev + 1, Math.ceil(videoKeys.length / PAGE_SIZE) - 1));
      } else if (e.key === 'PageUp' || e.key === '[') {
        setCurrentPage(prev => Math.max(0, prev - 1));
      }

      if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'f') {
        const video = pageVideos[focusedIndex];
        if (video) {
          const newLabel = e.key.toLowerCase() === 't' ? 'TP' : 'FP';
          toggleLabel(video.key, newLabel);
        }
      }

      if (e.key.toLowerCase() === 'm') {
        const event = new CustomEvent('toggle-fullscreen-shortcut');
        window.dispatchEvent(event);
      }

      if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        setFocusedIndex(parseInt(e.key) - 1);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [videoKeys.length, pageVideos, focusedIndex]);

  const toggleLabel = (key: string, label: Label) => {
    setLabels(prev => {
      const newLabels = { ...prev, [key]: label };
      // Trigger an async save with the newest data
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastPage: currentPage,
          labels: newLabels,
        })
      });
      return newLabels;
    });
    setPageVideos(prev => prev.map(v => v.key === key ? { ...v, label } : v));
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

  const totalPages = Math.ceil(videoKeys.length / PAGE_SIZE);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-white mr-8">Large Scale Review</h1>
          <div className="text-slate-400 text-sm">
            <span className="font-mono">{videoKeys.length.toLocaleString()}</span> Videos
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

      <main className="flex-1 p-4 bg-slate-900 grid grid-cols-3 grid-rows-[repeat(2,minmax(0,1fr))] gap-4 overflow-y-auto">
        {pageVideos.map((video, idx) => (
          <VideoPlayer
            key={video.key}
            video={video}
            isFocused={focusedIndex === idx}
            onFocus={() => setFocusedIndex(idx)}
            onToggleLabel={(label) => toggleLabel(video.key, label)}
          />
        ))}
        {pageVideos.length === 0 && (
          <div className="col-span-3 row-span-2 flex items-center justify-center text-slate-500">
            No videos found in this page.
          </div>
        )}
      </main>

      <footer className="flex-shrink-0 px-6 py-2 bg-slate-800 text-xs text-slate-400 flex justify-between items-center border-t border-slate-700 shadow-inner">
        <div className="flex space-x-4">
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">Space</kbd> Play/Pause</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">←/→</kbd> Frame Step</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">1-6</kbd> Select</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">T</kbd> Mark TP</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">F</kbd> Mark FP</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">M</kbd> Fullscreen</span>
          <span><kbd className="bg-slate-700 px-1 rounded text-white font-mono shadow-sm">[ / ]</kbd> Navigation</span>
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
