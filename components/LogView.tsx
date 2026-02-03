
import React from 'react';
import { LogEntry } from '../types';

interface LogViewProps {
  logs: LogEntry[];
  onClose: () => void;
}

export const LogView: React.FC<LogViewProps> = ({ logs, onClose }) => {
  return (
    <div className="absolute inset-0 z-[110] bg-[#f4f1ea] flex flex-col overflow-hidden text-[#1a2b3c] font-sans shadow-2xl">
      {/* Background ruling lines removed per user request */}
      
      {/* Vertical Margin Lines - Kept for paper character */}
      <div className="absolute top-0 bottom-0 left-[2.2rem] w-[1px] bg-red-400/30 pointer-events-none"></div>
      <div className="absolute top-0 bottom-0 left-[2.4rem] w-[1px] bg-red-400/30 pointer-events-none"></div>

      {/* COMPACT ATC-STYLE HEADER */}
      <div className="relative z-10 bg-[#f4f1ea] border-b-4 border-[#1a2b3c]">
        {/* Top Control Row */}
        <div className="flex justify-between items-center px-4 py-3 bg-[#1a2b3c] text-[#f4f1ea]">
          <h1 className="text-2xl font-black tracking-tighter uppercase">Flight Log</h1>
          <button 
            onClick={onClose} 
            className="bg-red-600 text-white px-6 py-2 rounded text-lg font-black shadow-lg active:scale-95 uppercase tracking-widest border-2 border-white/20"
          >
            Close
          </button>
        </div>
        
        {/* ATC Info Grid */}
        <div className="grid grid-cols-3 border-t border-[#1a2b3c]/20 text-[10px] font-black uppercase tracking-widest">
          <div className="px-4 py-1 border-r border-[#1a2b3c]/20">
            <span className="opacity-40 block">Station</span>
            <span className="text-xs">LCK</span>
          </div>
          <div className="px-4 py-1 border-r border-[#1a2b3c]/20">
            <span className="opacity-40 block">Base</span>
            <span className="text-xs">Rickenbacker</span>
          </div>
          <div className="px-4 py-1">
            <span className="opacity-40 block">Status</span>
            <span className="text-xs text-green-700">Active</span>
          </div>
        </div>
      </div>
      
      {/* Log Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-12 relative z-10 log-scrollbar-paper">
        {logs.length === 0 ? (
          <div className="text-center py-32 opacity-20">
            <h2 className="text-3xl font-black italic tracking-widest uppercase">No Entries Recorded</h2>
            <p className="text-lg font-bold mt-4 uppercase tracking-[0.2em]">Standing by for communication...</p>
          </div>
        ) : (
          logs.map((entry, index) => (
            <div key={entry.id} className="relative">
              {/* Entry Time Info - Prominent Date, Secondary Time */}
              <div className="flex items-baseline gap-4 mb-4 border-b border-[#1a2b3c]/20 pb-1">
                <span className="text-3xl font-black text-[#1a2b3c] tracking-tighter">
                  {new Date(entry.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="text-sm font-bold text-[#1a2b3c]/50 uppercase tracking-widest">
                  Time: {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
                <span className="text-[10px] font-black uppercase text-[#1a2b3c]/20 ml-auto tracking-[0.2em]">
                  SEQ_{entry.id.substring(entry.id.length - 4)}
                </span>
              </div>

              {/* Main Log Entry - Handwriting Font */}
              <div className="pl-6 handwritten-entry">
                <div className="mb-4">
                   <h3 className="text-3xl font-bold text-[#1a2b3c] leading-none uppercase tracking-tight">
                    {entry.topic}
                  </h3>
                </div>

                {/* Bullets directly following the topic - No labels */}
                {entry.bullets.length > 0 && (
                  <ul className="space-y-3 mt-4">
                    {entry.bullets.map((bullet, idx) => (
                      <li key={idx} className="flex gap-4 items-start">
                        <span className="text-2xl font-black text-red-500/60 mt-0.5 shrink-0 select-none">/</span>
                        <span className="text-2xl font-medium leading-tight text-[#1a2b3c] tracking-tight">
                          {bullet}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Reference Links - Compact and Scanable */}
              {entry.sources && entry.sources.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2 pl-6">
                  {entry.sources.map((source, sIdx) => (
                    <a 
                      key={sIdx}
                      href={source.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] bg-white/60 border border-[#1a2b3c]/10 text-[#1a2b3c]/80 px-3 py-1.5 rounded font-black uppercase tracking-tighter hover:bg-[#1a2b3c] hover:text-white transition-colors"
                    >
                      REF: {source.title.length > 25 ? source.title.substring(0, 25) + '...' : source.title}
                    </a>
                  ))}
                </div>
              )}
              
              {/* Divider - Subtle */}
              {index < logs.length - 1 && (
                <div className="mt-12 h-[2px] bg-[#1a2b3c]/5 w-full"></div>
              )}
            </div>
          ))
        )}
      </div>

      <style>{`
        .log-scrollbar-paper::-webkit-scrollbar {
            width: 16px;
        }
        .log-scrollbar-paper::-webkit-scrollbar-track {
            background: #f4f1ea;
        }
        .log-scrollbar-paper::-webkit-scrollbar-thumb {
            background: #1a2b3c;
            border: 4px solid #f4f1ea;
            border-radius: 8px;
        }
      `}</style>
    </div>
  );
};
