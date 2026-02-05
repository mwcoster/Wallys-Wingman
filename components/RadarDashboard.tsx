
import React from 'react';
import { AppState } from '../types';

interface RadarDashboardProps {
  state: AppState;
  bullets: string[];
  topic: string;
  error?: string | null;
}

export const RadarDashboard: React.FC<RadarDashboardProps> = ({ state, bullets, topic, error }) => {
  const isInteracting = state === AppState.LISTENING || state === AppState.RESPONDING;
  const showBullets = bullets.length > 0 && state !== AppState.LOG_VIEW;
  const isIdle = state === AppState.IDLE;
  
  return (
    <div className="absolute inset-0 transition-all duration-1000 bg-black">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
        <div className="w-[98vw] aspect-square max-w-[800px] border-[12px] border-[#1a1a1a] rounded-full shadow-[inset_0_0_100px_rgba(0,0,0,1),0_0_20px_rgba(0,0,0,0.8)] flex items-center justify-center overflow-hidden">
          
          <div className={`absolute inset-0 transition-opacity duration-1000 ${isInteracting ? 'opacity-0' : 'opacity-100'}`}>
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden scale-110">
              <img 
                src="https://raw.githubusercontent.com/google/genai-toolbox/main/examples/assets/lck_runway.png" 
                alt="LCK Runway"
                className="w-full h-full object-cover opacity-60"
                style={{ filter: 'sepia(100%) hue-rotate(80deg) saturate(800%) brightness(0.6) contrast(1.3)' }}
              />
            </div>

            <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(#00ff41 1px, transparent 1px), linear-gradient(90deg, #00ff41 1px, transparent 1px)', backgroundSize: '60px 60px' }}></div>
            
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <svg viewBox="0 0 1000 1000" className="w-full h-full">
                <g stroke="#00ff41" fill="none" strokeWidth="1" opacity="0.3">
                  <circle cx="500" cy="500" r="150" />
                  <circle cx="500" cy="500" r="300" />
                  <circle cx="500" cy="500" r="450" />
                  <line x1="500" y1="0" x2="500" y2="1000" />
                  <line x1="0" y1="500" x2="1000" y2="500" />
                </g>
              </svg>
            </div>

            <div className="absolute left-1/2 top-1/2 w-[220%] aspect-square radar-sweep pointer-events-none opacity-40"></div>
          </div>

          {isIdle && !showBullets && (
            <div className="absolute z-20 flex flex-col items-center pointer-events-none text-center px-12">
              {error ? (
                <>
                  <div className="text-3xl font-black tracking-tight font-mono text-red-500 uppercase animate-pulse">
                    COMM LINK FAILURE
                  </div>
                  <div className="text-xs text-red-500/60 font-bold uppercase mt-2 tracking-widest">
                    {error}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-4xl font-black tracking-tight font-mono text-[#ffbf00]/60 uppercase amber-glow">
                    Standing by...
                  </div>
                  <div className="mt-4 flex flex-col items-center gap-2">
                     <div className="flex items-center gap-4">
                        <div className="h-[1px] w-12 bg-[#00ff41]/20"></div>
                        <div className="text-[10px] text-[#00ff41]/40 font-bold uppercase tracking-[0.5em]">LCK SECURE</div>
                        <div className="h-[1px] w-12 bg-[#00ff41]/20"></div>
                     </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-8 pointer-events-none">
        {showBullets && (
          <div className="w-full max-w-md bg-black/95 backdrop-blur-xl p-8 rounded-lg border-2 border-[#00ff41] transition-all duration-700 shadow-[0_0_80px_rgba(0,255,65,0.25)] animate-in fade-in slide-in-from-bottom-10">
            <div className="flex items-center justify-between mb-6 border-b border-[#00ff41]/30 pb-3">
              <span className="text-sm font-black text-[#00ff41] uppercase tracking-[0.4em]">{topic || 'WINGMAN BRIEF'}</span>
              <div className="w-1.5 h-1.5 bg-[#00ff41] animate-pulse"></div>
            </div>
            <ul className="space-y-8">
              {bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-5">
                  <span className="mt-3 w-4 h-4 bg-[#00ff41] rounded-sm shrink-0 shadow-[0_0_12px_#00ff41]"></span>
                  <span className="text-2xl font-black leading-[1.1] text-white tracking-tighter uppercase font-sans">
                    {bullet}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
