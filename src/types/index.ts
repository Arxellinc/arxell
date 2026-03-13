export interface Project {
  id: string;
  name: string;
  description: string;
  workspace_path: string;
  created_at: number;
  updated_at: number;
}

export interface Conversation {
  id: string;
  project_id: string | null;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}

export interface ChunkEvent {
  id: string;
  delta: string;
  done: boolean;
}

export interface VoiceStateEvent {
  state: "idle" | "listening" | "speaking" | "processing";
}

export interface AmplitudeEvent {
  level: number;
}

export interface TranscriptEvent {
  text: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export type VoiceState = "idle" | "listening" | "speaking" | "processing";

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}
