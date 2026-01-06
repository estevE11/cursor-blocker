# Cursor Blocker

Blocks distracting sites (Twitter/YouTube) unless **Cursor AI is actively generating code**.

This project is a **fork** of **Claude Blocker** by **Theo Browne** (`t3dotgg`): `https://github.com/t3-content/claude-blocker`.

### How it works

- **Server (localhost)**: connects to Cursor via **Chrome DevTools Protocol (CDP)** and inspects the UI to decide whether the AI is generating.
- **Chrome extension**: connects via WebSocket and shows a soft-block overlay on configured sites when Cursor AI is idle.

### Setup

1. **Install + build**

```bash
pnpm install && pnpm build
```

2. **Launch Cursor with remote debugging enabled**

```bash
# You do this manually (example):
cursor --remote-debugging-port=9222
```

3. **Load the extension**

- Chrome → `chrome://extensions`
- Enable Developer mode
- “Load unpacked” → select `packages/extension/dist`

4. **Run the server**

```bash
cd packages/server
pnpm start
```

Optional debug logging (prints selector/button metadata to help tune heuristics):

```bash
cd packages/server
CURSOR_BLOCKER_DEBUG=1 pnpm dev
```

### Default blocked sites

`x.com`, `twitter.com`, `youtube.com`

### Privacy

- **Local only**: the server connects only to `127.0.0.1:9222` (CDP) and reads UI metadata (no network calls).
- **No exfiltration**: no chat data is sent anywhere; everything stays on localhost.

See [PRIVACY.md](PRIVACY.md).
