export type LocalAiModelRole = "classification" | "general";

export interface LocalAiModelStatus {
  id: string;
  name: string;
  role: LocalAiModelRole;
  description: string;
  bytes: number;
  available: boolean;
  installed: boolean;
  downloading: boolean;
  downloadedBytes: number;
}

export interface LocalAiStatus {
  available: boolean;
  optedIn: boolean;
  enabled: boolean;
  installed: boolean;
  downloading: boolean;
  downloadingModelId?: string | null;
  downloadedBytes: number;
  model: { id: string; name: string; bytes: number };
  models: LocalAiModelStatus[];
}

export const localAiStatusEvent = "local-ai-status";
