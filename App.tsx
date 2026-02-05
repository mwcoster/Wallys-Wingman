
import React, { useState, useEffect, useRef } from 'react';
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
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const isConnectingRef = useRef(false);
  const isClosingRef = useRef(false);

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
    ['input', 'output'].forEach(k => {
      if ((audioContextsRef.current as any)[k].state === 'suspended') (audioContextsRef.current as any)[k].resume();
    });
  };

  const createBlob = (data: Float32Array) => ({
    data: encode(new Uint8Array(new Int16Array(data.map(v => v * 32768)).buffer)),
    mimeType: 'audio/pcm;rate=16000',
  });

  const handleStartTalk = async () => {
    if (isConnectingRef.current || sessionRef.current) return;
    setCommError(null);
    if (!process.env.API_KEY) {
      setCommError("SAT_LINK_MISSING: Key Verification Required");
      return;
    }

    try {
      isConnectingRef.current = true;
      initAudio();
      setAppState(AppState.LISTENING);
      isClosingRef.current = false;
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const { input } = audioContextsRef.current!;
            const source = input.createMediaStreamSource(stream);
            const proc = input.createScriptProcessor(4096, 1, 1);
            proc.onaudioprocess = (e) => {
              if (isClosingRef.current) return;
              const blob = createBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: blob })).catch(() => {});
            };
            source.connect(proc);
            proc.connect(input.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
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
                    if (isClosingRef.current) setTimeout(() => closeInternal(), 1500);
                  } else {
                    setDisplayBullets(args.bullets || []);
                    setDisplayTopic(args.topic || "WINGMAN_HUD");
                  }
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "LOG_OK" } }
                  })).catch(() => {});
                }
              }
            }

            const audio = msg.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (audio && audioContextsRef.current) {
              setAppState(AppState.RESPONDING);
              const { output } = audioContextsRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, output.currentTime);
              const buf = await decodeAudioData(decode(audio), output, 24000, 1);
              const src = output.createBufferSource();
              src.buffer = buf;
              src.connect(outputNodeRef.current!);
              src.onended = () => {
                sourcesRef.current.delete(src);
                if (sourcesRef.current.size === 0 && !isClosingRef.current) setAppState(AppState.LISTENING);
              };
              src.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buf.duration;
              sourcesRef.current.add(src);
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setAppState(AppState.LISTENING);
            }
          },
          onclose: () => closeInternal(),
          onerror: (e) => { setCommError("SAT_LINK_LOSS: Check hardware"); closeInternal(); }
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [UPDATE_LOG_FUNCTION] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      setCommError("COMM_FAIL: Link initialization error");
      setAppState(AppState.IDLE);
    } finally {
      isConnectingRef.current = false;
    }
  };

  const closeInternal = () => {
    if (sessionRef.current) { try { sessionRef.current.close(); } catch(e){} sessionRef.current = null; }
    setAppState(AppState.IDLE);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isClosingRef.current = false;
  };

  const handleStopTalk = () => {
    if (sessionRef.current && (appState === AppState.LISTENING || appState === AppState.RESPONDING)) {
      isClosingRef.current = true;
      // Send sign-off to AI to trigger the SESSION SUMMARY tool call
      sessionRef.current.sendRealtimeInput({ 
        text: "Wally is signing off. Please provide a final SESSION SUMMARY of our discussion for the flight log." 
      });
      // Safety timeout in case AI fails to call tool
      setTimeout(() => { if (isClosingRef.current) closeInternal(); }, 6000);
    } else {
      closeInternal();
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center select-none font-mono">
      <RadarDashboard state={appState} bullets={displayBullets} topic={displayTopic} error={commError} />

      {appState !== AppState.LOG_VIEW && (
        <main className="z-10 w-full h-full flex flex-col p-6 pt-10">
          <header className="mb-4">
            <h1 className="text-3xl font-black cockpit-glow text-[#00ff41]">WALLY'S WINGMAN</h1>
            <p className="text-[10px] opacity-40 tracking-[0.4em] font-bold">LCK STATION // SATELLITE LINK ACTIVE</p>
          </header>

          <div className="flex-1 flex flex-col justify-center items-center">
            {isClosingRef.current && (
              <div className="bg-black/90 p-4 border-2 border-[#ffbf00] rounded animate-pulse">
                <span className="text-xs text-[#ffbf00] font-black tracking-widest uppercase">Writing Flight Log...</span>
              </div>
            )}
          </div>

          <ActionButtons state={appState} onTalk={handleStartTalk} onStop={handleStopTalk} onLog={() => setAppState(AppState.LOG_VIEW)} />
        </main>
      )}

      {appState === AppState.LOG_VIEW && <LogView logs={logs} onClose={() => setAppState(AppState.IDLE)} />}
    </div>
  );
};

export default App;
