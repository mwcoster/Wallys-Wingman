import React, { useState, useRef, useEffect } from 'react';
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
  const heartbeatRef = useRef<any>(null);
  const isClosingRef = useRef(false);
  const isConnectingRef = useRef(false);
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
      const apiKey = import.meta.env.VITE_API_KEY;
      if (!apiKey) throw new Error("API_KEY_MISSING");

      const ai = new GoogleGenAI({ apiKey: apiKey });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            reconnectCountRef.current = 0;
            
            // HEARTBEAT: Sends a tiny "ping" to Vercel every 10s to stop mid-speech cutoffs
            heartbeatRef.current = setInterval(() => {
              if (sessionRef.current && !isClosingRef.current) {
                try { sessionRef.current.sendRealtimeInput({ text: " " }); } catch(e) {}
              }
            }, 10000);

            const { input } = audioContextsRef.current!;
            const source = input.createMediaStreamSource(stream);
            const scriptProcessor = input.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (!sessionRef.current || isClosingRef.current) return;
              const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
              try {
                sessionRef.current.sendRealtimeInput({ media: pcmBlob });
              } catch (err) { /* Catching prevents the 586 error flood */ }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!sessionRef.current) return;

            // Handle Tool Calls (Flight Log)
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
                  } else {
                    setDisplayBullets(args.bullets || []);
                    setDisplayTopic(args.topic || "WINGMAN HUD");
                  }
                  sessionRef.current?.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "LOG_OK" } }
                  });
                }
              }
            }

            // Handle Audio Playback
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
                if (sourcesRef.current.size === 0 && !isClosingRef.current && sessionRef.current) {
                  setAppState(AppState.LISTENING);
                }
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onclose: (event: any) => {
            console.log(`Link Closed. Code: ${event.code}`);
            closeSessionInternal();
            if (!isClosingRef.current) {
              setCommError("RECONNECTING: Satellite link dropped.");
              setTimeout(() => handleStartTalk(), 2000); // Silent Auto-Rejoin
            }
          },
          onerror: (e: any) => {
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
      setAppState(AppState.IDLE);
    } finally {
      isConnectingRef.current = false;
    }
  };

  const closeSessionInternal = () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
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
      sessionRef.current.sendRealtimeInput({ text: "I'm signing off now, Wingman. Finalize the Flight Log." });
      setTimeout(() => { if (isClosingRef.current) closeSessionInternal(); }, 7000);
    } else {
      closeSessionInternal();
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center select-none font-mono">
      <RadarDashboard state={appState} bullets={displayBullets} topic={displayTopic} error={commError} />
      <ActionButtons state={appState} onTalk={handleStartTalk} onStop={handleStopTalk} onLog={() => setAppState(AppState.LOG_VIEW)} />
      {appState === AppState.LOG_VIEW && <LogView logs={logs} onClose={() => setAppState(AppState.IDLE)} />}
      {needsKey && (
        <div className="absolute inset-0 z-[200] bg-black/95 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm p-8 border-4 border-[#ffbf00] bg-black shadow-[0_0_80px_rgba(255,191,0,0.4)]">
            <h2 className="text-3xl font-black text-[#ffbf00] mb-6 uppercase tracking-tighter">Auth Link Required</h2>
            <p className="text-[#ffbf00]/70 mb-8 text-sm leading-relaxed uppercase font-bold">Wally, the satellite link needs authorization to access the flight systems.</p>
            <button onClick={handleOpenKeySelection} className="w-full py-6 bg-[#ffbf00] text-black font-black uppercase tracking-widest hover:brightness-110 mb-6">Link Satellite</button>
            <button onClick={() => { setNeedsKey(false); setCommError(null); }} className="text-[10px] text-white/40 uppercase hover:text-white">Dismiss Alarm</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;