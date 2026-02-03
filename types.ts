
export interface GroundingSource {
  title: string;
  uri: string;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  topic: string;
  bullets: string[];
  sources?: GroundingSource[];
}

export enum AppState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  RESPONDING = 'RESPONDING',
  LOG_VIEW = 'LOG_VIEW'
}
