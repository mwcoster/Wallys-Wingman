
import React from 'react';
import { AppState } from '../types';

interface ActionButtonsProps {
  state: AppState;
  onTalk: () => void;
  onStop: () => void;
  onLog: () => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({ state, onTalk, onStop, onLog }) => {
  const isActive = state === AppState.LISTENING || state === AppState.RESPONDING;

  return (
    <div className="mt-auto grid grid-cols-2 gap-8 pb-12 px-4 w-full max-w-lg z-20">
      {/* AMBER TALK BUTTON */}
      <button 
        onClick={isActive ? onStop : onTalk}
        className={`btn-80s h-36 rounded-xl flex flex-col items-center justify-center transition-all ${
          isActive ? 'btn-80s-amber active shadow-[0_0_60px_#ffbf00]' : 'btn-80s-amber'
        }`}
      >
        <div className="mb-2">
          {isActive ? (
            <div className="w-10 h-10 bg-black/20 rounded flex items-center justify-center">
               <div className="w-5 h-5 bg-black rounded-sm"></div>
            </div>
          ) : (
            <div className="w-12 h-12 flex items-center justify-center">
               <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10">
                 <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                 <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
               </svg>
            </div>
          )}
        </div>
        <span className="text-4xl font-black tracking-widest">
          {isActive ? 'STOP' : 'TALK'}
        </span>
      </button>

      {/* FLIGHT PROGRESS STRIP LOG BUTTON */}
      <button 
        onClick={onLog}
        className={`btn-80s h-36 rounded-xl flex flex-col items-center justify-center btn-80s-green transition-all overflow-hidden ${
          state === AppState.LOG_VIEW ? 'active' : ''
        }`}
      >
        <div className="w-full h-full flex flex-col">
          {/* Progress Strip Headers */}
          <div className="flex border-b border-current/20 text-[8px] font-black uppercase h-8">
            <div className="flex-1 border-r border-current/20 flex items-center justify-center">ID</div>
            <div className="flex-1 border-r border-current/20 flex items-center justify-center">DEP</div>
            <div className="flex-1 flex items-center justify-center">ARR</div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-12 h-10 mb-1 flex flex-col justify-center gap-1.5 px-2">
              <div className="h-1 bg-current rounded-full w-full opacity-60"></div>
              <div className="h-1 bg-current rounded-full w-4/5 opacity-80"></div>
              <div className="h-1 bg-current rounded-full w-full"></div>
            </div>
            <span className="text-4xl font-black tracking-widest">LOG</span>
          </div>
          {/* Progress Strip Footer */}
          <div className="h-4 bg-current/5 border-t border-current/20 flex items-center px-2">
             <div className="text-[6px] font-bold tracking-widest opacity-40">FLT_PROG_STRIP_V2.1</div>
          </div>
        </div>
      </button>
    </div>
  );
};
