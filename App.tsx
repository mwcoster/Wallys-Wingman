import React, { useState, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { RadarDashboard } from './components/RadarDashboard';
import { ActionButtons } from './components/ActionButtons';
import { LogView } from './components/LogView';
import { AppState, LogEntry } from './types';
import { SYSTEM_INSTRUCTION, UPDATE_LOG_FUNCTION } from './constants';
import { decode, encode, decodeAudioData } from './services/audioUtils';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayBullets, setDisplayBullets] = useState<string[]>([]);
  const [displayTopic, setDisplayTopic] = useState<string>("");
  const [commError, setCommError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState<boolean>(false);
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const isClosingRef = useRef(false);
  const isConnectingRef = useRef(false);

  // --- RECONNECT LOGIC ---
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const handleOpenKeySelection = async () => {
    setCommError(null);
    const studio = (window as any).aistudio;
    if (studio && studio.openSelectKey) {
      try {
        await studio.openSelectKey();
        setNeedsKey(false);
      } catch (e) {
        setCommError("SELECTOR_FAULT: Failed to open project menu.");
      }
    } else {
      setCommError("LINK_OFFLINE: Please ensure VITE_API_KEY is set in your deployment environment.");
    }
  };

  const initAudio = () => {
    if (!audioContextsRef.current) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      const input = new AC({ sampleRate: 16000 });
      const output = new AC({ sampleRate: 24000 });
      const gain = output.createGain();
      gain.connect(output.destination);
      audioContextsRef.current = { input, output };
      outputNodeRef.current = gain;
    }
    const { input, output } = audioContextsRef.current;
    if (input.state === 'suspended') input.resume();
    if (output.state === 'suspended') output.resume();
  };

  const createBlob = (data: Float32Array) => {
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      int16[i] = data[i] * 32768;
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const handleStartTalk = async () => {
    if (sessionRef.current || isConnectingRef.current) return;
    
    // Stop if we've tried too many times without success
    if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setCommError("MAX_RETRIES: Link unstable. Please refresh the browser.");
      return;
    }

    setCommError(null);
    isConnectingRef.current = true;

    try {
      initAudio();
      setAppState(AppState.LISTENING);
      isClosingRef.current = false;
      setDisplayBullets([]);
      setDisplayTopic("");
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Vite environment variable fix
      const apiKey = import.meta.env.VITE_API_KEY;
      if (!apiKey) throw new Error("API_KEY_MISSING");

      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            reconnectCountRef.current = 0; // Reset counter on successful link
            const { input } = audioContextsRef.current!;
            const source = input.createMediaStreamSource(stream);
            const scriptProcessor = input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isClosingRef.current) return;
              const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(() => {});
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // --- HANDLE TOOL CALLS ---
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'update_flight_log') {
                  const args = fc.args as any;
                  const isFinal = isClosingRef.current || args.topic?.includes("SUMMARY");
                  
                  if (isFinal) {
                    setLogs(prev => [{
                      id: Date.now().toString(),
                      timestamp: Date.now(),
                      topic: args.topic || 'SESSION SUMMARY',
                      bullets: args.bullets || []
                    }, ...prev]);
                    if (isClosingRef.current) setTimeout(() => closeSessionInternal(), 2000);
                  } else {
                    setDisplayBullets(args.bullets || []);
                    setDisplayTopic(args.topic || "WINGMAN HUD");
                  }
                  
                  sessionPromise.then((session) => {
                    session.sendToolResponse({
                      functionResponses: { id: fc.id, name: fc.name, response: { result: "LOG_OK" } }
                    });
                  }).catch(() => {});
                }
              }
            }

            // --- HANDLE AUDIO RESPONSE ---
            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio && audioContextsRef.current && outputNodeRef.current) {
              setAppState(AppState.RESPONDING);
              const { output } = audioContextsRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, output.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), output, 24000, 1);
              const source = output.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0 && !isClosingRef.current) setAppState(AppState.LISTENING);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            // --- HANDLE INTERRUPTIONS ---
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setAppState(AppState.LISTENING);
            }
          },
          onclose: () => closeSessionInternal(),
          onerror: (e: any) => {
            console.error("Link Failure:", e);
            reconnectCountRef.current++;
            const delay = Math.pow(2, reconnectCountRef.current) * 1000;
            setCommError(`LINK_LOSS: Re-establishing frequency in ${delay/1000}s...`);
            setTimeout(() => handleStartTalk(), delay);
            closeSessionInternal();
          }
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [UPDATE_LOG_FUNCTION] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      isConnectingRef.current = false;
      const errMsg = err?.message?.toLowerCase() || "";
      if (errMsg.includes("key") || errMsg.includes("unauthorized")) {
        setNeedsKey(true);
        setCommError("AUTH_REQUIRED: Satellite uplink not authorized.");
      } else {
        setCommError("LINK_FAILURE: Could not initiate frequency.");
      }
      setAppState(AppState.IDLE);
    } finally {
      isConnectingRef.current = false;
    }
  };

  const closeSessionInternal = () => {
    if (sessionRef.current) { 
      try { sessionRef.current.close(); } catch(e) {} 
      sessionRef.current = null; 
    }
    setAppState(AppState.IDLE);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isClosingRef.current = false;
    isConnectingRef.current = false;
  };

  const handleStopTalk = () => {
    if (sessionRef.current && (appState === AppState.LISTENING || appState === AppState.RESPONDING)) {
      isClosingRef.current = true;
      sessionRef.current.sendRealtimeInput({ 
        text: "I'm signing off now, Wingman. Finalize the Flight Log with a summary." 
      });
      setTimeout(() => { if (isClosingRef.current) closeSessionInternal(); }, 7000);
    } else {
      closeSessionInternal();
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center select-none font-mono">
      <RadarDashboard 
        state={appState} 
        bullets={displayBullets} 
        topic={displayTopic} 
        error={commError} 
      />
      
      <ActionButtons 
        state={appState}
        onTalk={handleStartTalk}
        onStop={handleStopTalk}
        onLog={() => setAppState(AppState.LOG_VIEW)}
      />

      {appState === AppState.LOG_VIEW && (
        <LogView 
          logs={logs} 
          onClose={() => setAppState(AppState.IDLE)} 
        />
      )}

      {needsKey && (
        <div className="absolute inset-0 z-[200] bg-black/95 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm p-8 border-4 border-[#ffbf00] bg-black shadow-[0_0_80px_rgba(255,191,0,0.4)]">
            <h2 className="text-3xl font-black text-[#ffbf00] mb-6 uppercase tracking-tighter amber-glow">Auth Link Required</h2>
            <p className="text-[#ffbf00]/70 mb-8 text-sm leading-relaxed uppercase font-bold">
              Wally, the satellite link needs authorization to access the medical flight systems.
            </p>

            {commError && (
              <div className="mb-8 p-4 border-2 border-red-500 bg-red-950/20 text-red-500 text-xs font-black uppercase tracking-widest animate-pulse">
                ALARM: {commError}
              </div>
            )}

            <button 
              onClick={handleOpenKeySelection}
              className="w-full py-6 bg-[#ffbf00] text-black font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-[0_4px_0_#664d00] mb-6"
            >
              Link Satellite
            </button>
            <button 
              onClick={() => { setNeedsKey(false); setCommError(null); }}
              className="text-[10px] text-white/40 uppercase mt-4 hover:text-white"
            >
              Dismiss Alarm
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;