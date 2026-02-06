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
      if (!apiKey) throw new Error