// WebSocket messages from server to extension
export type ServerMessage =
  | {
      type: "state";
      blocked: boolean;
      sessions: number;
      working: number;
      waitingForInput?: number;
    }
  | { type: "pong" };

// WebSocket messages from extension to server
export type ClientMessage = { type: "ping" } | { type: "subscribe" };

// Extension storage schema
export interface ExtensionState {
  blockedDomains: string[];
  lastBypassDate: string | null; // ISO date string, e.g. "2025-01-15"
  bypassUntil: number | null; // timestamp when current bypass expires
}

// Default blocked domains
export const DEFAULT_BLOCKED_DOMAINS = ["x.com", "twitter.com", "youtube.com"];

// Server configuration
export const DEFAULT_PORT = 8765;
