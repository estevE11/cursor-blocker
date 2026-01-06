import type { ServerMessage } from "@cursor-blocker/shared";
import { CursorCdpWatcher } from "./cursor-cdp-watcher.js";

type StateChangeCallback = (message: ServerMessage) => void;

function deriveServerMessage(snapshot: ReturnType<CursorCdpWatcher["getSnapshot"]>): ServerMessage {
  // Strategy 1: CDP remote-debugging based detection.
  // WORKING (unblocked): Cursor UI indicates AI is generating.
  // IDLE (blocked): otherwise.
  const working = snapshot.connected && snapshot.generating ? 1 : 0;
  const sessions = snapshot.connected ? 1 : 0;
  return { type: "state", blocked: working === 0, sessions, working, waitingForInput: 0 };
}

class CursorState {
  private watcher = new CursorCdpWatcher();
  private listeners: Set<StateChangeCallback> = new Set();
  private started = false;
  private lastMessage: ServerMessage = {
    type: "state",
    blocked: true,
    sessions: 0,
    working: 0,
    waitingForInput: 0,
  };
  private unsubscribeWatcher: (() => void) | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;

    this.watcher.start();
    this.unsubscribeWatcher = this.watcher.subscribe((snapshot) => {
      const next = deriveServerMessage(snapshot);
      const changed =
        next.blocked !== (this.lastMessage as any).blocked ||
        next.sessions !== (this.lastMessage as any).sessions ||
        next.working !== (this.lastMessage as any).working;

      this.lastMessage = next;
      if (changed) this.broadcast();
    });
  }

  subscribe(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    callback(this.lastMessage);
    return () => this.listeners.delete(callback);
  }

  getStatus(): ServerMessage {
    return this.lastMessage;
  }

  private broadcast(): void {
    for (const listener of this.listeners) {
      listener(this.lastMessage);
    }
  }

  destroy(): void {
    this.unsubscribeWatcher?.();
    this.unsubscribeWatcher = null;
    this.watcher.stop();
    this.listeners.clear();
  }
}

export const state = new CursorState();
