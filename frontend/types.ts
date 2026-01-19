export type Label = 'TP' | 'FP';

export interface VideoItem {
  key: string;
  url: string;
  label: Label;
}

export interface AppState {
  lastPage: number;
  labels: Record<string, Label>;
  videoKeys: string[];
}

export interface PageData {
  videos: VideoItem[];
  totalPages: number;
}
