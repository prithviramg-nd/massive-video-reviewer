import React from 'react';

interface Props {
  current: number;
  total: number;
  onChange: (page: number) => void;
}

const Pagination: React.FC<Props> = ({ current, total, onChange }) => {
  return (
    <div className="flex items-center space-x-4">
      <button 
        onClick={() => onChange(Math.max(0, current - 1))}
        disabled={current === 0}
        className="text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="flex items-center space-x-2 text-sm font-medium">
        <input 
          type="number" 
          value={current + 1}
          min={1}
          max={total}
          onChange={(e) => {
            const val = parseInt(e.target.value) - 1;
            if (!isNaN(val) && val >= 0 && val < total) onChange(val);
          }}
          className="w-16 bg-slate-900 border border-slate-700 rounded text-center py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-blue-400"
        />
        <span className="text-slate-500">/</span>
        <span className="text-slate-400">{total.toLocaleString()}</span>
      </div>

      <button 
        onClick={() => onChange(Math.min(total - 1, current + 1))}
        disabled={current >= total - 1}
        className="text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

export default Pagination;
