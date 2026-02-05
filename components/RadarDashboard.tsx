
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
  
  return (
    <div className="absolute inset-0 transition-all duration-700 bg-black">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
        <div className="w-[98vw] aspect-square max-w-[850px] border-[16px] border-[#111] rounded-full shadow-[inset_0_0_80px_#000,0_0_30px_#000] flex items-center justify-center overflow-hidden">
          
          <div className={`absolute inset-0 transition-opacity duration-1000 ${isInteracting ? 'opacity-10' : 'opacity-100'}`}>
            <div className="absolute inset-0 flex items-center justify-center scale-110">
              <img 
                src="https://raw.githubusercontent.com/google/genai-toolbox/main/examples/assets/lck_runway.png" 
                alt="LCK Runway"
                className="w-full h-full object-cover opacity-30"
                style={{ filter: 'sepia(100%) hue-rotate(85deg) saturate(900%) brightness(0.5)' }}
              />
            </div>

            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#00ff41 1px, transparent 1px), linear-gradient(90deg, #00ff41 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
            
            <div className="absolute inset-0 opacity-20">
              <svg viewBox="0 0 1000 1000" className="w-full h-full">
                <g stroke="#00ff41" fill="none" strokeWidth="1.5" opacity="0.4">
                  <circle cx="500" cy="500" r="180" />
                  <circle cx="500" cy="500" r="360" />
                  <line x1="500" y1="0" x2="500" y2="1000" />
                  <line x1="0" y1="500" x2="1000" y2="500" />
                </g>
              </svg>
            </div>

            <div className="absolute left-1/2 top-1/2 w-[240%] aspect-square radar-sweep opacity-30"></div>
          </div>

          {state === AppState.IDLE && !showBullets && (
            <div className="absolute z-20 flex flex-col items-center text-center">
              {error ? (
                <div className="text-2xl font-black text-red-500 uppercase animate-pulse">SYSTEM ERROR: {error}</div>
              ) : (
                <>
                  <div className="text-4xl font-black text-[#ffbf00]/40 uppercase amber-glow tracking-widest">Standing By</div>
                  <div className="text-[10px] text-[#00ff41]/30 font-bold mt-4 tracking-[0.6em]">LCK FREQUENCY SECURE</div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="absolute inset-0 z-30 flex items-center justify-center p-8 pointer-events-none">
        {showBullets && (
          <div className="w-full max-w-lg bg-black/90 p-8 rounded border-4 border-[#00ff41] shadow-[0_0_100px_rgba(0,255,65,0.3)] animate-in fade-in zoom-in duration-500">
            <div className="mb-6 border-b-2 border-[#00ff41]/20 pb-2">
              <span className="text-xs font-black text-[#00ff41] uppercase tracking-[0.5em]">{topic || 'HUD_BRIEF'}</span>
            </div>
            <ul className="space-y-6">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-4">
                  <div className="w-4 h-4 bg-[#00ff41] shadow-[0_0_10px_#00ff41] shrink-0 mt-1"></div>
                  <span className="text-2xl font-black text-white uppercase tracking-tight leading-tight">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
