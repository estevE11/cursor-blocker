# cursor-blocker (server)

Local service for **Cursor Blocker**.

Instead of CLI hooks (or SQLite polling), this server connects to Cursor via **Chrome DevTools Protocol (CDP)** and checks the UI DOM to determine whether Cursor AI is actively generating.

### Run

From the monorepo root:

```bash
pnpm install && pnpm build
cd packages/server
pnpm start
```

### Requirements

- Start Cursor with remote debugging enabled: `--remote-debugging-port=9222`
- Server connects to: `http://127.0.0.1:9222`

### Debug mode (selector discovery)

Run:

```bash
CURSOR_BLOCKER_DEBUG=1 pnpm dev
```

This prints samples of button `aria-label`s / classes in the chat/sidebar so you can tune the DOM heuristic.

### API

- **GET `/status`**: current state snapshot
- **WebSocket `/ws`**: pushes state changes in real time

