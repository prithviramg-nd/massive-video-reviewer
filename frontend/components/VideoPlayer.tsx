import React, { useRef, useEffect, useState } from 'react';
import { VideoItem, Label } from '../types';

interface Props {
  video: VideoItem;
  isFocused: boolean;
  onFocus: () => void;
  onToggleLabel: (label: Label) => void;
}

const VideoPlayer: React.FC<Props> = ({ video, isFocused, onFocus, onToggleLabel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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
      className={`relative group bg-black rounded-lg overflow-hidden transition-all flex flex-col ${isFocused ? 'video-focused' : 'border border-slate-800'
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

      <div className="relative bg-black flex items-center justify-center min-h-0">
        <video
          ref={videoRef}
          src={video.url}
          className="w-full h-full object-contain pointer-events-none"
          muted
          loop
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
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

      <div className={`p-2 bg-slate-800/90 backdrop-blur-sm flex items-center justify-between border-t border-white/5`}>
        <div className="flex space-x-1">
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
          {/* fullscreen button */}
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
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          {(videoRef.current?.currentTime || 0).toFixed(2)}s / {Number.isFinite(videoRef.current?.duration) ? videoRef.current?.duration.toFixed(2) : '--.--'}s
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
