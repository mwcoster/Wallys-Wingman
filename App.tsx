import React, { useEffect, useRef, useState } from 'react';
import { experimental_useRealtime as useRealtime } from '@ai-sdk/react';
import { gateway } from '@ai-sdk/gateway';
import { RadarDashboard } from './components/RadarDashboard';
import { ActionButtons } from './components/ActionButtons';
import { LogView } from './components/LogView';
import { AppState, LogEntry } from './types';
import { SYSTEM_INSTRUCTION } from './constants';

const realtimeModel = gateway.experimental_realtime('openai/gpt-realtime-mini');

const messageText = (message: any) =>
  (message?.parts || [])
    .filter((part: any) => part?.type === 'text' && part?.text)
    .map((part: any) => part.text)
    .join(' ')
    .trim();

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayBullets, setDisplayBullets] = useState<string[]>([]);
  const [displayTopic, setDisplayTopic] = useState<string>('');
  const [commError, setCommError] = useState<string | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const captureStartedRef = useRef(false);
  const connectingRef = useRef(false);

  const realtime = useRealtime({
    model: realtimeModel,
    api: { token: '/api/realtime-token' },
    sessionConfig: {
      instructions: SYSTEM_INSTRUCTION,
      inputAudioTranscription: {},
      voice: 'alloy',
      turnDetection: { type: 'server-vad' },
    },
  });

  useEffect(() => {
    if (realtime.status === 'connected') {
      connectingRef.current = false;
      setCommError(null);
      setDisplayTopic('LINK SECURE');
      setAppState(AppState.LISTENING);

      if (micStreamRef.current && !captureStartedRef.current) {
        try {
          realtime.startAudioCapture(micStreamRef.current);
          captureStartedRef.current = true;
        } catch (error) {
          console.error('Microphone capture failed', error);
          setCommError('MIC_LINK_FAULT: Could not start microphone audio.');
        }
      }
    }

    if (realtime.status === 'disconnected' && !connectingRef.current) {
      captureStartedRef.current = false;
      if (appState !== AppState.LOG_VIEW) setAppState(AppState.IDLE);
    }
  }, [realtime.status]);

  useEffect(() => {
    const messages = realtime.messages as any[];
    const latestAssistant = [...messages]
      .reverse()
      .find((message: any) => message?.role === 'assistant' && messageText(message));

    if (!latestAssistant) return;

    const text = messageText(latestAssistant);
    setDisplayTopic('WINGMAN COMMS');
    setDisplayBullets([text.length > 180 ? `${text.slice(0, 177)}...` : text]);

    if (realtime.status === 'connected') {
      setAppState(AppState.RESPONDING);
      const timer = window.setTimeout(() => {
        if (realtime.status === 'connected') setAppState(AppState.LISTENING);
      }, 1200);
      return () => window.clearTimeout(timer);
    }
  }, [realtime.messages, realtime.status]);

  const stopMicrophone = () => {
    if (captureStartedRef.current) {
      try {
        realtime.stopAudioCapture();
      } catch (error) {
        console.warn('Unable to stop capture cleanly', error);
      }
      captureStartedRef.current = false;
    }

    micStreamRef.current?.getTracks().forEach(track => track.stop());
    micStreamRef.current = null;
  };

  const checkRealtimeTokenRoute = async () => {
    const response = await fetch('/api/realtime-token', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const raw = await response.text();
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const detail = body?.detail || body?.error || raw || `HTTP ${response.status}`;
      throw new Error(`TOKEN ROUTE ${response.status}: ${detail}`);
    }

    if (!body?.token || !body?.url) {
      throw new Error('TOKEN ROUTE: Server responded, but no realtime token was returned.');
    }
  };

  const handleStartTalk = async () => {
    if (connectingRef.current || realtime.status === 'connected') return;

    setCommError(null);
    setDisplayBullets(['Checking Vercel AI Gateway…']);
    setDisplayTopic('CONNECTING');
    setAppState(AppState.LISTENING);
    connectingRef.current = true;

    try {
      await checkRealtimeTokenRoute();
      setDisplayBullets(['Gateway ready. Opening microphone…']);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('MICROPHONE: This browser does not support microphone capture.');
      }

      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setDisplayBullets(['Microphone ready. Linking Wingman…']);
      await realtime.connect();
    } catch (error: any) {
      console.error('Wingman connection failed', error);
      connectingRef.current = false;
      stopMicrophone();
      setAppState(AppState.IDLE);
      setDisplayTopic('LINK OFFLINE');
      setDisplayBullets([]);
      setCommError(error?.message || 'Could not connect to the Wingman service.');
    }
  };

  const saveFlightLog = () => {
    const transcript = (realtime.messages as any[])
      .map((message: any) => ({ role: message?.role, text: messageText(message) }))
      .filter(item => item.text)
      .slice(-4)
      .map(item => `${item.role === 'assistant' ? 'Wingman' : 'Wally'}: ${item.text}`)
      .map(text => (text.length > 110 ? `${text.slice(0, 107)}...` : text));

    if (transcript.length) {
      setLogs(prev => [
        {
          id: Date.now().toString(),
          timestamp: Date.now(),
          topic: 'SESSION SUMMARY',
          bullets: transcript,
        },
        ...prev,
      ]);
    }
  };

  const handleStopTalk = () => {
    saveFlightLog();
    stopMicrophone();
    try {
      realtime.disconnect();
    } catch (error) {
      console.warn('Wingman disconnect warning', error);
    }
    connectingRef.current = false;
    setDisplayTopic('');
    setDisplayBullets([]);
    setCommError(null);
    setAppState(AppState.IDLE);
  };

  useEffect(() => {
    return () => {
      stopMicrophone();
      try {
        realtime.disconnect();
      } catch {
        // Component is leaving; nothing else to clean up.
      }
    };
  }, []);

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
        <LogView logs={logs} onClose={() => setAppState(AppState.IDLE)} />
      )}
    </div>
  );
};

export default App;
