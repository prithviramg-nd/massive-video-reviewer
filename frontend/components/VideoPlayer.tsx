import React, { useRef, useEffect, useState } from 'react';
import { VideoItem, LabelStatus } from '../types';

interface Props {
  video: VideoItem;
  isFocused: boolean;
  onFocus: () => void;
  onToggleLabel: (label: LabelStatus) => void;
  onUpdateTags: (tags: string[]) => void;
  allTags: string[];
}

const VideoPlayer: React.FC<Props> = ({ video, isFocused, onFocus, onToggleLabel, onUpdateTags, allTags }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // Suggestions: all known tags minus the ones already on this video
  const suggestions = allTags.filter(t => !(video.tags || []).includes(t));

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const current = video.tags || [];
    if (current.includes(trimmed)) return; // no duplicates
    onUpdateTags([...current, trimmed]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    onUpdateTags((video.tags || []).filter(t => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Release focus so global shortcuts (A/S/W/X, Space, arrows) work again
      e.preventDefault();
      tagInputRef.current?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && tagInput === '') {
      // Remove last tag when backspacing on empty input
      const current = video.tags || [];
      if (current.length > 0) {
        onUpdateTags(current.slice(0, -1));
      }
    }
  };

  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (v.paused) v.play().catch(console.error);
          else v.pause();
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.pause();
          if (Number.isFinite(v.duration)) {
            v.currentTime = Math.min(v.duration, v.currentTime + 0.1);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.pause();
          v.currentTime = Math.max(0, v.currentTime - 0.1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused) return;

    const handleFullscreenShortcut = () => {
      const v = videoRef.current;
      if (!v) return;

      if (!document.fullscreenElement) {
        v.requestFullscreen?.().catch(console.error);
      } else {
        document.exitFullscreen?.();
      }
    };

    window.addEventListener('toggle-fullscreen-shortcut', handleFullscreenShortcut);
    return () => window.removeEventListener('toggle-fullscreen-shortcut', handleFullscreenShortcut);
  }, [isFocused]);

  // Auto-focus the tag input only when isFocused transitions false→true
  // (i.e. user explicitly pressed a number key to select this video).
  // We must NOT focus on mount — that would steal focus on every page change.
  const prevFocusedRef = useRef(isFocused);
  useEffect(() => {
    const wasFocused = prevFocusedRef.current;
    prevFocusedRef.current = isFocused;
    if (isFocused && !wasFocused) {
      tagInputRef.current?.focus();
    }
  }, [isFocused]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {
        // Handle autoplay block
      });
    }
  }, [video.url]);

  return (
    <div
      onClick={onFocus}
      className={`relative group bg-black rounded-lg overflow-hidden transition-colors flex flex-col ${isFocused ? 'video-focused' : 'border border-slate-800'
        }`}
    >
      <div className="absolute top-2 left-2 z-10 flex space-x-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-tight shadow-md ${video.label === 'TP' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
          {video.label}
        </span>
        <span className="bg-black/60 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono truncate max-w-[200px] backdrop-blur-sm">
          {video.key.split('/').pop()}
        </span>
      </div>

      <div className="relative bg-black flex flex-1 items-center justify-center min-h-0 overflow-hidden">
        <video
          ref={videoRef}
          src={video.url}
          className="w-full h-full max-h-full object-contain pointer-events-none"
          style={{ imageRendering: 'auto' }}
          muted
          loop
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={() => {
            if (!isSeeking && videoRef.current) {
              setCurrentTime(videoRef.current.currentTime);
            }
          }}
          onLoadedMetadata={() => {
            if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
              setDuration(videoRef.current.duration);
            }
          }}
        />

        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
            <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm">
              <svg className="w-6 h-6 text-white opacity-80" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.333-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Seek bar */}
      <div className="relative w-full h-5 bg-slate-900 group/seek cursor-pointer flex items-center px-1"
        onClick={(e) => {
          e.stopPropagation();
          const v = videoRef.current;
          if (!v || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          v.currentTime = pct * duration;
          setCurrentTime(v.currentTime);
        }}
      >
        {/* Track background */}
        <div className="absolute left-1 right-1 h-1 bg-slate-700 rounded-full group-hover/seek:h-1.5 transition-all" />
        {/* Progress fill */}
        <div
          className="absolute left-1 h-1 bg-blue-500 rounded-full group-hover/seek:h-1.5 transition-all"
          style={{ width: duration ? `calc(${(currentTime / duration) * 100}% - 4px)` : '0%' }}
        />
        {/* Seek handle */}
        <div
          className="absolute w-2.5 h-2.5 bg-blue-400 rounded-full opacity-0 group-hover/seek:opacity-100 transition-opacity shadow-md"
          style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 1px)` : '4px' }}
        />
        {/* Hidden range input for drag seeking */}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={currentTime}
          onChange={(e) => {
            const time = parseFloat(e.target.value);
            setCurrentTime(time);
            if (videoRef.current) {
              videoRef.current.currentTime = time;
            }
          }}
          onMouseDown={() => setIsSeeking(true)}
          onMouseUp={() => setIsSeeking(false)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>

      <div className={`p-2 bg-slate-800/90 backdrop-blur-sm flex items-center justify-between border-t border-white/5`}>
        <div className="flex flex-1 items-center space-x-1"> {/* Added flex-1 and items-center */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleLabel('TP'); }}
            className={`px-3 py-1 rounded text-xs font-bold transition-colors ${video.label === 'TP' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          >
            TP
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleLabel('FP'); }}
            className={`px-3 py-1 rounded text-xs font-bold transition-colors ${video.label === 'FP' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          >
            FP
          </button>

          {/* Fullscreen button is now separate and correctly placed before the input */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              videoRef.current?.requestFullscreen?.();
            }}
            className="px-2 py-1 rounded text-xs font-bold bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors flex items-center"
            title="Fullscreen"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          {/* Multi-tag input with chips */}
          <div className="flex-1 px-1">
            <div className="flex flex-wrap items-center gap-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 min-h-[26px] focus-within:ring-1 focus-within:ring-blue-500">
              {(video.tags || []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 bg-blue-600/80 text-white text-[10px] font-medium px-1.5 py-0.5 rounded"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                    className="hover:text-red-300 text-white/70 ml-0.5 font-bold text-[10px] leading-none"
                  >
                    x
                  </button>
                </span>
              ))}
              <input
                ref={tagInputRef}
                list={`tag-suggestions-${video.key}`}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={video.tags?.length ? '' : 'Add tag...'}
                className="flex-1 min-w-[60px] bg-transparent text-xs text-white focus:outline-none py-0.5"
              />
              <datalist id={`tag-suggestions-${video.key}`}>
                {suggestions.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-slate-500 font-mono ml-2">
          {currentTime.toFixed(2)}s / {duration > 0 ? duration.toFixed(2) : '--.--'}s
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
