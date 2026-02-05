
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
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
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
    [audioContextsRef.current.input, audioContextsRef.current.output].forEach(ctx => {
      if (ctx.state === 'suspended') ctx.resume();
    });
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
    if (sessionRef.current) return;
    setCommError(null);
    
    // Strict literal process.env.API_KEY for build-time replacement
    if (!process.env.API_KEY) {
      setCommError("SAT_LINK_FAILED: No authorization key detected.");
      return;
    }

    try {
      initAudio();
      setAppState(AppState.LISTENING);
      isClosingRef.current = false;
      setDisplayBullets([]);
      setDisplayTopic("");
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const { input } = audioContextsRef.current!;
            const source = input.createMediaStreamSource(stream);
            const scriptProcessor = input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isClosingRef.current) return;
              const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob })).catch(() => {});
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
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

                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "LOG_OK" } }
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
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0 && !isClosingRef.current) setAppState(AppState.LISTENING);
              };
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
          onclose: () => closeSessionInternal(),
          onerror: () => { setCommError("LINK_LOSS: Satellite connection interrupted."); closeSessionInternal(); }
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [UPDATE_LOG_FUNCTION] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setCommError("COMM_INIT_FAIL: Link failed to establish.");
      setAppState(AppState.IDLE);
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
  };

  const handleStopTalk = () => {
    if (sessionRef.current && (appState === AppState.LISTENING || appState === AppState.RESPONDING)) {
      isClosingRef.current = true;
      sessionRef.current.sendRealtimeInput({ 
        text: "I'm signing off now, Wingman. Please finalize our Flight Log with a SESSION SUMMARY of everything we discussed." 
      });
      // Safety timeout in case the tool call never arrives
      setTimeout(() => { if (isClosingRef.current) closeSessionInternal(); }, 7000);
    } else {
      closeSessionInternal();
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center select-none font-mono">
      <RadarDashboard state={appState} bullets={displayBullets} topic={displayTopic} error={commError} />

      {appState !== AppState.LOG_VIEW && (
        <main className="z-10 w-full h-full flex flex-col p-6 pt-10 pb-4">
          <header className="mb-4">
            <h1 className="text-3xl font-black cockpit-glow uppercase text-[#00ff41]">Wally's Wingman</h1>
            <p className="text-[10px] opacity-60 tracking-[0.4em] font-bold mt-1 uppercase">LCK STATION // SATELLITE LINK ACTIVE</p>
          </header>

          <div className="flex-1 flex flex-col justify-end items-center mb-6">
            {isClosingRef.current && (
              <div className="bg-black/90 px-6 py-4 border-2 border-[#ffbf00] rounded-lg animate-pulse shadow-[0_0_30px_rgba(255,191,0,0.4)]">
                <span className="text-xs text-[#ffbf00] font-black uppercase tracking-widest">Compiling Log Summary...</span>
              </div>
            )}
          </div>

          <ActionButtons state={appState} onTalk={handleStartTalk} onStop={handleStopTalk} onLog={() => setAppState(AppState.LOG_VIEW)} />
        </main>
      )}

      {appState === AppState.LOG_VIEW && <LogView logs={logs} onClose={() => setAppState(AppState.IDLE)} />}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle,transparent_40%,rgba(0,0,0,0.8)_100%)]"></div>
    </div>
  );
};

export default App;
