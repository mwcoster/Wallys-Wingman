
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
  const [needsKey, setNeedsKey] = useState<boolean>(false);
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const isClosingRef = useRef(false);
  const isConnectingRef = useRef(false);

  // Check for API Key or Studio availability on mount
  useEffect(() => {
    const checkKeyStatus = async () => {
      const apiKey = process.env.API_KEY;
      const hasDirectKey = !!apiKey && apiKey !== "undefined" && apiKey.length > 5;
      
      if (!hasDirectKey) {
        // If we're in the Studio environment, check if a key is selected
        if ((window as any).aistudio) {
          try {
            const selected = await (window as any).aistudio.hasSelectedApiKey();
            if (!selected) setNeedsKey(true);
          } catch (e) {
            setNeedsKey(true);
          }
        } else {
          // Outside of Studio, we need process.env.API_KEY
          setNeedsKey(true);
        }
      } else {
        setNeedsKey(false);
      }
    };
    checkKeyStatus();
  }, []);

  const handleOpenKeySelection = async () => {
    const studio = (window as any).aistudio;
    if (studio && studio.openSelectKey) {
      try {
        await studio.openSelectKey();
        // Assume success after triggering the dialog as per instructions
        setNeedsKey(false);
        setCommError(null);
      } catch (e) {
        setCommError("SAT_LINK_ERROR: Failed to open selector.");
      }
    } else {
      // If we are on Vercel/Standard Web, the Studio selector isn't available
      setCommError("SAT_LINK_OFFLINE: Please configure your API_KEY in project settings.");
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
    if (sessionRef.current || needsKey || isConnectingRef.current) return;
    
    setCommError(null);
    isConnectingRef.current = true;

    try {
      initAudio();
      setAppState(AppState.LISTENING);
      isClosingRef.current = false;
      setDisplayBullets([]);
      setDisplayTopic("");
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Initialize with the latest process.env.API_KEY
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
              // Use sessionPromise to ensure session is resolved and avoid stale closures
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
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
                  
                  // Use sessionPromise to send tool response
                  sessionPromise.then((session) => {
                    session.sendToolResponse({
                      functionResponses: { id: fc.id, name: fc.name, response: { result: "LOG_OK" } }
                    });
                  });
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
          onerror: (e: any) => {
            console.error("Session Link Failure:", e);
            if (e?.message?.includes("API_KEY_INVALID") || e?.message?.includes("entity was not found")) {
              setNeedsKey(true);
              setCommError("SAT_LINK_REJECTED: Unauthorized link.");
            } else {
              setCommError("LINK_LOSS: Check hardware connection.");
            }
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
    } catch (err) {
      setCommError("COMM_INIT_FAIL: Connection setup error.");
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
        <div className="absolute inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm p-8 border-4 border-[#ffbf00] bg-black shadow-[0_0_50px_rgba(255,191,0,0.3)]">
            <h2 className="text-2xl font-black text-[#ffbf00] mb-4 uppercase tracking-tighter">Authentication Required</h2>
            <p className="text-[#ffbf00]/70 mb-8 text-sm leading-relaxed uppercase">
              Wingman systems require a secure uplink. Please link a valid billing-enabled project key.
              <br/><br/>
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline font-bold">Billing Documentation</a>
            </p>
            <button 
              onClick={handleOpenKeySelection}
              className="w-full py-4 bg-[#ffbf00] text-black font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all"
            >
              Open Key Selector
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
