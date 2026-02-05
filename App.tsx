
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { RadarDashboard } from './components/RadarDashboard';
import { ActionButtons } from './components/ActionButtons';
import { LogView } from './components/LogView';
import { AppState, LogEntry, GroundingSource } from './types';
import { SYSTEM_INSTRUCTION, UPDATE_LOG_FUNCTION } from './constants';
import { decode, encode, decodeAudioData } from './services/audioUtils';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayBullets, setDisplayBullets] = useState<string[]>([]);
  const [displayTopic, setDisplayTopic] = useState<string>("");
  const [showAuthRequired, setShowAuthRequired] = useState<boolean>(false);
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const isConnectingRef = useRef(false);
  const isWrappingUpRef = useRef(false);

  useEffect(() => {
    const checkAuth = async () => {
      // Safe environment check
      const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;

      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey && !apiKey) setShowAuthRequired(true);
      } else if (!apiKey) {
        setShowAuthRequired(true);
      }
    };
    checkAuth();
  }, []);

  const initAudio = () => {
    if (!audioContextsRef.current) {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const input = new AudioContextClass({ sampleRate: 16000 });
      const output = new AudioContextClass({ sampleRate: 24000 });
      const outputGain = output.createGain();
      outputGain.connect(output.destination);
      audioContextsRef.current = { input, output };
      outputNodeRef.current = outputGain;
    }
    if (audioContextsRef.current.input.state === 'suspended') audioContextsRef.current.input.resume();
    if (audioContextsRef.current.output.state === 'suspended') audioContextsRef.current.output.resume();
  };

  const createBlob = (data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const handleStartTalk = async () => {
    if (isConnectingRef.current || sessionRef.current) return;
    
    try {
      isConnectingRef.current = true;
      initAudio();
      setAppState(AppState.LISTENING);
      isWrappingUpRef.current = false;
      setDisplayBullets([]);
      setDisplayTopic("");
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Attempt to get location context for the system instruction
      let locationContext = "";
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => 
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 })
        );
        locationContext = `\n[NOTE: Wally is currently at Lat: ${pos.coords.latitude}, Long: ${pos.coords.longitude}. Use this for local info.]`;
      } catch (e) {
        console.log("GPS unavailable, using home address context only.");
      }

      const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : '';
      const ai = new GoogleGenAI({ apiKey });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const { input } = audioContextsRef.current!;
            const source = input.createMediaStreamSource(stream);
            const scriptProcessor = input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(() => {});
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'update_flight_log') {
                  const args = fc.args as any;
                  // If we are wrapping up OR the AI explicitly sends a summary
                  if (isWrappingUpRef.current || args.topic === "SESSION SUMMARY") {
                    setLogs(prev => [{
                      id: Date.now().toString(),
                      timestamp: Date.now(),
                      topic: args.topic || 'SESSION SUMMARY',
                      bullets: args.bullets || []
                    }, ...prev]);
                    
                    // If this was the final wrap-up call, close after a delay
                    if (isWrappingUpRef.current) {
                      setTimeout(() => closeSessionInternal(), 2000);
                    }
                  } else {
                    // Normal turn-by-turn update
                    setDisplayBullets(args.bullets || []);
                    setDisplayTopic(args.topic || "WINGMAN NOTE");
                  }

                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "Log Updated" } }
                  })).catch(() => {});
                }
              }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio && audioContextsRef.current && outputNodeRef.current) {
              setAppState(AppState.RESPONDING);
              const { output } = audioContextsRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, output.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), output, 24000, 1);
              const source = output.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0 && !isWrappingUpRef.current) {
                  setAppState(AppState.LISTENING);
                }
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setAppState(AppState.LISTENING);
            }
          },
          onclose: () => {
            sessionRef.current = null;
            setAppState(AppState.IDLE);
          },
          onerror: (e: any) => {
            if (e.message?.includes("403") || e.message?.includes("entity") || e.message?.includes("API_KEY_INVALID")) {
              setShowAuthRequired(true);
            }
            sessionRef.current = null;
            setAppState(AppState.IDLE);
          }
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION + locationContext,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [UPDATE_LOG_FUNCTION] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      if (err.message?.includes("403") || err.message?.includes("entity") || err.message?.includes("API_KEY_INVALID")) {
        setShowAuthRequired(true);
      }
      setAppState(AppState.IDLE);
    } finally {
      isConnectingRef.current = false;
    }
  };

  const closeSessionInternal = () => {
    if (sessionRef.current) { 
      try { sessionRef.current.close(); } catch (e) {} 
      sessionRef.current = null; 
    }
    setAppState(AppState.IDLE);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isWrappingUpRef.current = false;
    setDisplayBullets([]);
    setDisplayTopic("");
  };

  const handleStopTalk = () => {
    if (sessionRef.current && (appState === AppState.LISTENING || appState === AppState.RESPONDING)) {
      isWrappingUpRef.current = true;
      setTimeout(() => {
        if (isWrappingUpRef.current) closeSessionInternal();
      }, 5000);
    } else {
      closeSessionInternal();
    }
  };

  const toggleLog = () => {
    if (appState === AppState.LISTENING || appState === AppState.RESPONDING) {
      handleStopTalk();
    }
    setAppState(prev => prev === AppState.LOG_VIEW ? AppState.IDLE : AppState.LOG_VIEW);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center select-none font-mono">
      <RadarDashboard state={appState} bullets={displayBullets} topic={displayTopic} />

      {appState !== AppState.LOG_VIEW && (
        <main className="z-10 w-full h-full flex flex-col p-6 pt-10 pb-4">
          <header className="mb-4">
            <h1 className="text-3xl font-bold tracking-tighter cockpit-glow uppercase text-[#00ff41]">Wally's Wingman</h1>
            <p className="text-[10px] opacity-60 tracking-[0.3em] font-bold mt-1 uppercase">External Executive Function // LCK-STATION</p>
          </header>

          <div className="flex-1 flex flex-col justify-end items-center mb-6">
            {showAuthRequired && (
              <div className="text-center bg-black/95 p-8 rounded-lg border-2 border-[#ffbf00] shadow-[0_0_50px_rgba(255,191,0,0.3)] max-w-sm">
                <h2 className="text-2xl font-black text-[#ffbf00] mb-4 uppercase tracking-tighter">Comm Link Offline</h2>
                <p className="text-xs text-[#ffbf00]/70 mb-6 uppercase tracking-widest font-bold">Authorization required to establish satellite uplink.</p>
                <button 
                  onClick={() => window.aistudio?.openSelectKey().then(() => setShowAuthRequired(false))} 
                  className="bg-[#ffbf00] text-black w-full py-5 rounded text-2xl font-black uppercase tracking-widest active:scale-95"
                >
                  Authorize
                </button>
              </div>
            )}
            {isWrappingUpRef.current && (
              <div className="bg-black/80 px-4 py-3 border-2 border-[#ffbf00] rounded-lg animate-pulse shadow-[0_0_30px_rgba(255,191,0,0.3)]">
                <span className="text-xs text-[#ffbf00] font-black uppercase tracking-widest">Saving Session Data...</span>
              </div>
            )}
          </div>

          <ActionButtons state={appState} onTalk={handleStartTalk} onStop={handleStopTalk} onLog={toggleLog} />
        </main>
      )}

      {appState === AppState.LOG_VIEW && <LogView logs={logs} onClose={() => setAppState(AppState.IDLE)} />}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle,transparent_40%,rgba(0,0,0,0.8)_100%)]"></div>
    </div>
  );
};

export default App;
