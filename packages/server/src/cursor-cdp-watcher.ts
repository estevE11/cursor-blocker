import puppeteer, { type Browser, type Page } from "puppeteer-core";

export interface CursorDomDebugDump {
  // NOTE: no chat text content is returned (privacy-safe); only metadata about buttons.
  buttonSamples: Array<{
    ariaLabel: string | null;
    text: string | null;
    className: string | null;
  }>;
}

export interface CursorDomSnapshot {
  connected: boolean;
  pageTitle: string | null;
  pageUrl: string | null;
  generating: boolean;
  debug?: CursorDomDebugDump;
  updatedAt: number;
  error: string | null;
}

const CDP_URL = "http://127.0.0.1:9222";
const CONNECT_RETRY_MS = 2000;
const CHECK_INTERVAL_MS = 500;
const DEBUG_DUMP_INTERVAL_MS = 5000;

const DEBUG =
  process.env.CURSOR_BLOCKER_DEBUG === "1" ||
  process.env.CURSOR_BLOCKER_DEBUG === "true" ||
  process.env.CURSOR_BLOCKER_DEBUG === "yes";

function log(line: string): void {
  console.log(`[CursorCDP] ${line}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeBackgroundPage(title: string, url: string): boolean {
  const t = title.toLowerCase();
  const u = url.toLowerCase();

  // Common Chromium/Electron background pages
  if (u.startsWith("chrome-extension://")) return true;
  if (u.startsWith("devtools://")) return true;
  if (u.startsWith("chrome://")) return true;

  // Cursor/VSCode internal targets may include these; we generally want the visible window.
  if (t.includes("shared process")) return true;
  if (t.includes("gpu process")) return true;
  if (t.includes("utility")) return true;
  if (t.includes("worker")) return true;

  return false;
}

function looksLikeWorkspaceWindow(title: string, url: string): boolean {
  const t = title.toLowerCase();
  const u = url.toLowerCase();

  // Heuristics: the visible app window generally contains "Cursor" or a workspace name.
  if (t.includes("cursor")) return true;

  // VSCode-style window urls
  if (u.includes("vscode-webview://")) return true;
  if (u.includes("vscode-file://")) return true;

  return false;
}

async function pickBestPage(browser: Browser): Promise<Page | null> {
  const pages = await browser.pages();
  const scored: Array<{ page: Page; score: number; title: string; url: string }> = [];

  for (const p of pages) {
    let title = "";
    let url = "";
    try {
      title = await p.title();
      url = p.url();
    } catch {
      continue;
    }

    if (looksLikeBackgroundPage(title, url)) continue;

    let score = 0;
    if (looksLikeWorkspaceWindow(title, url)) score += 10;
    if (title.length > 0) score += 2;
    if (url.length > 0) score += 1;
    scored.push({ page: p, score, title, url });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.page ?? null;
}

async function evaluateGenerating(page: Page, includeDebugDump: boolean): Promise<{
  generating: boolean;
  debug?: CursorDomDebugDump;
}> {
  // IMPORTANT: Use string-based evaluation to avoid bundler-injected helpers (e.g. __name)
  // being referenced inside the page context.

  const base = await page.evaluate(
    `(() => {
      const activeComposer = document.querySelector('.composer-bar.editor[data-composer-status="generating"]');
      const generating = activeComposer !== null;
      return { generating };
    })()`
  );

  if (!includeDebugDump) return base as { generating: boolean };

  const debug = await page.evaluate(
    `(() => {
      const containers = document.querySelectorAll('.chat-view, .sidebar, [role="complementary"], .panel');
      const roots = containers.length > 0 ? Array.from(containers) : [document.body];
      const buttons = [];
      for (const root of roots) {
        buttons.push(...Array.from(root.querySelectorAll('button')));
      }
      const uniq = Array.from(new Set(buttons));
      const buttonSamples = uniq.slice(0, 50).map((b) => ({
        ariaLabel: b.getAttribute('aria-label'),
        text: (b.textContent || '').trim().slice(0, 80) || null,
        className: b.className ? String(b.className).slice(0, 120) : null,
      }));
      return { buttonSamples };
    })()`
  );

  return { ...(base as any), debug: debug as CursorDomDebugDump };
}

export class CursorCdpWatcher {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private connectLoopRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private debugInterval: NodeJS.Timeout | null = null;
  private snapshot: CursorDomSnapshot = {
    connected: false,
    pageTitle: null,
    pageUrl: null,
    generating: false,
    updatedAt: Date.now(),
    error: "Not connected",
  };
  private listeners: Set<(s: CursorDomSnapshot) => void> = new Set();
  private lastPrintedDebugAt = 0;
  private lastLoggedState: { connected: boolean; title: string | null; url: string | null; generating: boolean } = {
    connected: false,
    title: null,
    url: null,
    generating: false,
  };

  start(): void {
    if (this.connectLoopRunning) return;
    this.connectLoopRunning = true;
    log(`starting; will connect to ${CDP_URL}`);
    void this.connectLoop();
  }

  stop(): void {
    this.connectLoopRunning = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.debugInterval) clearInterval(this.debugInterval);
    this.pollInterval = null;
    this.debugInterval = null;
    void this.browser?.disconnect();
    this.browser = null;
    this.page = null;
  }

  subscribe(cb: (s: CursorDomSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot);
    return () => this.listeners.delete(cb);
  }

  getSnapshot(): CursorDomSnapshot {
    return this.snapshot;
  }

  private publish(next: CursorDomSnapshot): void {
    this.snapshot = next;
    for (const cb of this.listeners) cb(next);
  }

  private async connectLoop(): Promise<void> {
    while (this.connectLoopRunning) {
      try {
        if (!this.browser) {
          this.publish({
            ...this.snapshot,
            connected: false,
            error: `Connecting to ${CDP_URL}...`,
            updatedAt: Date.now(),
          });
          log(`connecting to ${CDP_URL} (retry every ${CONNECT_RETRY_MS}ms)`);
          this.browser = await puppeteer.connect({ browserURL: CDP_URL });
          log("connected to CDP");
          this.browser.on("disconnected", () => {
            this.browser = null;
            this.page = null;
            this.stopPolling();
            this.publish({
              connected: false,
              pageTitle: null,
              pageUrl: null,
              generating: false,
              updatedAt: Date.now(),
              error: "Cursor disconnected; retrying...",
            });
            log("disconnected from CDP; will retry");
          });
        }

        // Pick the active visible window page
        this.page = await pickBestPage(this.browser);
        if (!this.page) {
          this.publish({
            connected: true,
            pageTitle: null,
            pageUrl: null,
            generating: false,
            updatedAt: Date.now(),
            error: "Connected to Cursor, but no suitable page found yet",
          });
          log("connected, but no suitable page found; retrying page selection");
          await sleep(CONNECT_RETRY_MS);
          continue;
        }

        // Once we have a page, start polling loop.
        await this.refreshOnce(false);
        this.startPolling();

        // Stay alive; polling loop will keep running until disconnected.
        while (this.connectLoopRunning && this.browser) {
          // Re-check the page list occasionally in case a new window becomes active.
          await sleep(5000);
          if (!this.browser) break;
          const next = await pickBestPage(this.browser);
          if (next && next !== this.page) {
            this.page = next;
            log("switched active page");
            await this.refreshOnce(true);
          }
        }
      } catch (e) {
        this.stopPolling();
        if (this.browser) {
          try {
            this.browser.disconnect();
          } catch {}
        }
        this.browser = null;
        this.page = null;
        this.publish({
          connected: false,
          pageTitle: null,
          pageUrl: null,
          generating: false,
          updatedAt: Date.now(),
          error: e instanceof Error ? e.message : "Failed to connect to Cursor",
        });
        log(`connect error: ${e instanceof Error ? e.message : String(e)}`);
        await sleep(CONNECT_RETRY_MS);
      }
    }
  }

  private startPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      void this.refreshOnce(false);
    }, CHECK_INTERVAL_MS);

    this.debugInterval = setInterval(() => {
      void this.refreshOnce(true);
    }, DEBUG_DUMP_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.debugInterval) clearInterval(this.debugInterval);
    this.pollInterval = null;
    this.debugInterval = null;
  }

  private async refreshOnce(includeDebug: boolean): Promise<void> {
    const now = Date.now();
    const page = this.page;
    if (!page) return;

    let title: string | null = null;
    let url: string | null = null;
    try {
      title = await page.title();
      url = page.url();
    } catch {
      // ignore; will recover on next connect loop iteration
    }

    try {
      const includeDump = includeDebug && DEBUG;
      const result = await evaluateGenerating(page, includeDump);

      const next: CursorDomSnapshot = {
        connected: true,
        pageTitle: title,
        pageUrl: url,
        generating: result.generating,
        debug: result.debug,
        updatedAt: now,
        error: null,
      };

      this.publish(next);

      // Log useful state transitions (low-noise)
      const prev = this.lastLoggedState;
      const changed =
        prev.connected !== true ||
        prev.generating !== next.generating ||
        prev.title !== next.pageTitle ||
        prev.url !== next.pageUrl;
      if (changed) {
        this.lastLoggedState = {
          connected: true,
          generating: next.generating,
          title: next.pageTitle,
          url: next.pageUrl,
        };
        log(
          `state connected=true generating=${next.generating} title=${JSON.stringify(next.pageTitle)}`
        );
      }

      if (includeDump && DEBUG && result.debug && now - this.lastPrintedDebugAt >= DEBUG_DUMP_INTERVAL_MS - 50) {
        this.lastPrintedDebugAt = now;
        const samples = result.debug.buttonSamples;
        const shown = samples.slice(0, 20);
        console.log("[SelectorDebug] Buttons in chat/sidebar (sample):");
        for (const b of shown) {
          const aria = b.ariaLabel ? `aria="${b.ariaLabel}"` : "aria=-";
          const text = b.text ? `text="${b.text}"` : "text=-";
          const cls = b.className ? `class="${b.className}"` : "class=-";
          console.log(`  - ${aria} ${text} ${cls}`);
        }
        if (samples.length > shown.length) {
          console.log(`  ... +${samples.length - shown.length} more buttons`);
        }
      }
    } catch (e) {
      this.publish({
        connected: true,
        pageTitle: title,
        pageUrl: url,
        generating: false,
        updatedAt: now,
        error: e instanceof Error ? e.message : "Failed to evaluate DOM",
      });
      log(`evaluate error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}


