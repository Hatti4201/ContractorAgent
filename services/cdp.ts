// A minimal Chrome DevTools Protocol client for the exposure channel (Phase 9). It drives a tab in the
// user's own, already signed-in Chrome, which the user starts with remote debugging on
// (scripts/exposure-chrome.ts). Clicks and typing go through Input.*, the same path as a real mouse.
// ponytail: raw CDP over Node's built-in WebSocket instead of Playwright; add a library only if this
// ever needs frames, downloads or network interception.

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Listener = (params: Record<string, unknown>) => void;

const COMMAND_TIMEOUT_MS = 30_000;

export class CdpTab {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Listener>>();

  private constructor(private readonly socket: WebSocket, readonly targetId: string) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(`Chrome refused ${message.error.message}`));
        else waiter?.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
      }
    });
    socket.addEventListener("close", () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("The exposure Chrome window closed."));
      this.pending.clear();
    });
  }

  /**
   * Attaches to the tab already showing in the dedicated window. Creating a tab would make Chrome
   * activate its window, which on macOS pulls it in front of whatever the user is doing (and out of
   * the Dock); driving the existing tab never asks for focus. Only if every tab was closed is one
   * created, which brings the window forward that one time.
   */
  static async open(baseUrl: string) {
    type Target = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };
    let target: Target | undefined;
    try {
      const listed = await fetch(`${baseUrl}/json/list`, { signal: AbortSignal.timeout(5_000) });
      if (!listed.ok) throw new Error(String(listed.status));
      // Chrome lists the most recently used tab first.
      target = (await listed.json() as Target[]).find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl && !/^(chrome|devtools|chrome-extension):/.test(entry.url));
      if (!target) {
        const created = await fetch(`${baseUrl}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5_000) });
        if (!created.ok) throw new Error(String(created.status));
        target = await created.json() as Target;
      }
    } catch {
      throw new Error("The exposure Chrome is not running. Start it with `npm run exposure:chrome` and keep it open.");
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("Could not find a tab in the exposure Chrome.");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not attach to the exposure Chrome tab.")), { once: true });
    });
    const tab = new CdpTab(socket, target.id);
    // Leaving a half-filled wizard raises "Leave site?", and an open dialog stalls every later
    // navigation. Only that and plain alerts are answered; a confirm (which could mean "submit?") is
    // dismissed, so no dialog can ever push an application through.
    tab.on("Page.javascriptDialogOpening", (params) => {
      const accept = params.type === "beforeunload" || params.type === "alert";
      void tab.send("Page.handleJavaScriptDialog", { accept }).catch(() => {});
    });
    await tab.send("Page.enable");
    // A covered or minimized window loses focus; pages that check focus should behave as if it had it.
    await tab.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    return tab;
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome did not answer ${method} in time.`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value as T); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    this.listeners.set(event, listeners);
    listeners.add(listener);
  }

  private once(event: string, timeoutMs: number) {
    return new Promise<void>((resolve) => {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      this.listeners.set(event, listeners);
      const done = () => { clearTimeout(timer); listeners.delete(done); resolve(); };
      // A page that never fires load still gets inspected; the caller's checks decide what it is.
      const timer = setTimeout(done, timeoutMs);
      listeners.add(done);
    });
  }

  async navigate(url: string) {
    const loaded = this.once("Page.loadEventFired", 30_000);
    await this.send("Page.navigate", { url });
    await loaded;
  }

  /** Runs an expression in the page and returns its JSON value. */
  async evaluate<T>(expression: string) {
    const result = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(`Page script failed: ${result.exceptionDetails.text}`);
    return result.result.value as T;
  }

  async clickAt(x: number, y: number) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async insertText(text: string) {
    await this.send("Input.insertText", { text });
  }

  /** Detaches only. The tab stays open so the next run can reuse it without raising the window. */
  close() {
    try {
      this.socket.close();
    } catch {
      // Already closed; nothing depends on it.
    }
  }
}

export function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether the dedicated Chrome is up; the page shows this before anyone presses Run. */
export async function chromeReachable(baseUrl: string) {
  try {
    return (await fetch(`${baseUrl}/json/version`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}
