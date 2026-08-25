import React, { useEffect, useRef, useState } from 'react';
import { RadarDashboard } from './components/RadarDashboard';
import { ActionButtons } from './components/ActionButtons';
import { LogView } from './components/LogView';
import { AppState, LogEntry } from './types';

type ConversationMessage = { role: 'user' | 'assistant'; content: string };

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayBullets, setDisplayBullets] = useState<string[]>([]);
  const [displayTopic, setDisplayTopic] = useState<string>('');
  const [commError, setCommError] = useState<string | null>(null);

  const activeRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const conversationRef = useRef<ConversationMessage[]>([]);

  const stopRecognition = () => {
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
  };

  const speak = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setAppState(AppState.RESPONDING);
    utterance.onend = () => {
      if (activeRef.current) {
        setAppState(AppState.LISTENING);
        window.setTimeout(startListening, 250);
      } else {
        setAppState(AppState.IDLE);
      }
    };
    utterance.onerror = () => {
      if (activeRef.current) window.setTimeout(startListening, 250);
    };
    window.speechSynthesis.speak(utterance);
  };

  const askWingman = async (heard: string) => {
    const userMessage: ConversationMessage = { role: 'user', content: heard };
    conversationRef.current = [...conversationRef.current, userMessage].slice(-8);
    setDisplayTopic('THINKING');
    setDisplayBullets([heard]);
    setAppState(AppState.RESPONDING);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationRef.current }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
      }

      const text = String(data?.text || '').trim();
      if (!text) throw new Error('Wingman returned an empty response.');

      conversationRef.current = [
        ...conversationRef.current,
        { role: 'assistant', content: text },
      ].slice(-8);

      setCommError(null);
      setDisplayTopic('WINGMAN COMMS');
      setDisplayBullets([text.length > 180 ? `${text.slice(0, 177)}...` : text]);
      speak(text);
    } catch (error: any) {
      setAppState(AppState.IDLE);
      activeRef.current = false;
      stopRecognition();
      setCommError(`LINK OFFLINE: ${error?.message || 'Could not reach Wingman.'}`);
    }
  };

  const startListening = () => {
    if (!activeRef.current || recognitionRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      activeRef.current = false;
      setAppState(AppState.IDLE);
      setCommError('VOICE LINK UNAVAILABLE: Use Chrome or Edge with speech recognition enabled.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setCommError(null);
      setDisplayTopic('LISTENING');
      setDisplayBullets([]);
      setAppState(AppState.LISTENING);
    };

    recognition.onresult = (event: any) => {
      const heard = event?.results?.[0]?.[0]?.transcript?.trim();
      recognitionRef.current = null;
      if (heard) void askWingman(heard);
      else if (activeRef.current) window.setTimeout(startListening, 250);
    };

    recognition.onerror = (event: any) => {
      recognitionRef.current = null;
      const code = event?.error || 'unknown';
      if (code === 'no-speech' || code === 'aborted') {
        if (activeRef.current) window.setTimeout(startListening, 350);
        return;
      }
      activeRef.current = false;
      setAppState(AppState.IDLE);
      setCommError(`VOICE LINK FAULT: ${code}`);
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch (error: any) {
      recognitionRef.current = null;
      activeRef.current = false;
      setAppState(AppState.IDLE);
      setCommError(`VOICE LINK FAULT: ${error?.message || 'Could not start microphone.'}`);
    }
  };

  const handleStartTalk = () => {
    if (activeRef.current) return;
    setCommError(null);
    activeRef.current = true;
    startListening();
  };

  const saveFlightLog = () => {
    const transcript = conversationRef.current
      .slice(-4)
      .map(item => `${item.role === 'assistant' ? 'Wingman' : 'Wally'}: ${item.content}`)
      .map(text => (text.length > 110 ? `${text.slice(0, 107)}...` : text));

    if (transcript.length) {
      setLogs(prev => [{
        id: Date.now().toString(),
        timestamp: Date.now(),
        topic: 'SESSION SUMMARY',
        bullets: transcript,
      }, ...prev]);
    }
  };

  const handleStopTalk = () => {
    saveFlightLog();
    activeRef.current = false;
    stopRecognition();
    window.speechSynthesis.cancel();
    setDisplayTopic('');
    setDisplayBullets([]);
    setAppState(AppState.IDLE);
  };

  useEffect(() => () => {
    activeRef.current = false;
    stopRecognition();
    window.speechSynthesis.cancel();
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center select-none font-mono">
      <RadarDashboard state={appState} bullets={displayBullets} topic={displayTopic} error={commError} />
      <ActionButtons state={appState} onTalk={handleStartTalk} onStop={handleStopTalk} onLog={() => setAppState(AppState.LOG_VIEW)} />
      {appState === AppState.LOG_VIEW && <LogView logs={logs} onClose={() => setAppState(AppState.IDLE)} />}
    </div>
  );
};

export default App;
