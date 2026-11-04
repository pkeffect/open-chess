# Node.js Open Chess (v5.1.0)

![open Chess](./images/image-2025-12-16-183403.png)

> [!TIP]  
> **Give it a try: https://chess.internode.info/**

A feature-rich, containerized, and modular Chess application built with Node.js, Socket.io, and Vanilla JavaScript. This project features a polished "Marble" UI, drag-and-drop mechanics, real-time multiplayer, and advanced AI integration allowing you to play against Local CPU or Large Language Models (LLMs) via API.

---

## 🔒 Security & Privacy: API Keys

**Your privacy is paramount.**

*   **Local Storage:** API keys (for OpenAI, Ollama, etc.) are stored **exclusively in your browser's LocalStorage**.
*   **Client-Side Only:** When playing against an LLM, your API key is sent directly from your browser to the API endpoint you defined.
*   **No Server Logging:** The Node.js server that powers the multiplayer aspect of this game **never** receives, sees, or logs your API keys.
*   **Zero-Knowledge:** The game server only relays move coordinates between players; it does not process AI credentials.

---

## ✨ Features

### 🎮 Gameplay Mechanics
*   **Complete Ruleset:** Fully implements Castling, En Passant, Pawn Promotion, 50-move rule, and 3-fold repetition.
*   **Touch & Mouse:** Seamless Drag-and-Drop support for desktop mouse and mobile touch screens.
*   **Game States:**
    *   Check / Checkmate detection.
    *   Stalemate and Draw detection.
    *   Interactive Graveyard (captured pieces).
    *   Move History (PGN) and FEN String export.

### 🤖 AI Opponents
1.  **Local CPU (Minimax):**
    *   Runs entirely in the browser (offline capable).
    *   **Algorithms:** Minimax with Alpha-Beta Pruning and Piece-Square Tables.
    *   **Difficulty Levels:**
        *   *Easy:* Greedy capture logic.
        *   *Normal:* Depth 2 search.
        *   *Hard:* Depth 3 search.
        *   *Expert:* Depth 4 search (Heavy calculation).
2.  **LLM Agent (API Integration):**
    *   Play against **Ollama** (local), **OpenAI**, or any OpenAI-compatible endpoint.
    *   **Robustness:** Includes logic to validate LLM moves and auto-retry if the AI suggests an illegal move.
    *   **Fallback:** Automatically switches to Local CPU if the API becomes unreachable.
3.  **Hermes Agent (full agent via the Hermes Gateway):**
    *   Play against [Hermes](https://hermes-agent.nousresearch.com) — a self-hosted, full AI **agent** (not a raw model call): every move is a complete agent turn with the harness's tools, context and persistent memory in a dedicated session, so it remembers past games and adapts to your playing style over time.
    *   **Zero-setup:** just paste your gateway URL (e.g. `http://192.168.1.10:9119`) into the UI — Open Chess registers it with its own server automatically and remembers it.
    *   **Protocol:** Native TUI Gateway JSON-RPC over WebSocket (`hermes serve`) — no OpenAI-compat shim.
    *   **Memory:** Games are reported back as PGN at game end; the agent stores and reflects on them with its own memory. Reset anytime via *"Reset agent memory"*.
    *   **Chat:** An in-game chat panel — the agent comments on moves, and you can talk to it about the game (analysis, banter) while you play.
    *   **Robustness:** Same protections as the LLM agent — legal-move validation, automatic retry on illegal answers, per-move timeout with agent-turn interruption, and CPU fallback. Incoming tool-approval/clarify interrupts are auto-declined so a turn never stalls on a dialog.

### 🌐 Multiplayer (P2P)
*   **Real-Time Sockets:** Built on `socket.io` for instant move transmission.
*   **Room System:** Create private rooms and share IDs with friends.
*   **Disconnect Handling:**
    *   Auto-reconnects if the connection drops.
    *   30-second "Disconnect Timer" prevents opponents from stalling by closing the tab.
    *   Spectator support (join a room already in progress).

### 🎨 User Interface
*   **Marble Theme:** High-contrast procedural marble textures.
*   **Visual Feedback:** Highlights for Legal Moves, Last Move, Check, and Selection.
*   **Audio:** Sound effects for moving, capturing, checking, and game over.
*   **Session Restore:** Accidentally refreshed the tab? The game automatically saves your session and prompts you to resume.

---

## 🚀 Installation & Setup

### Prerequisites
*   **Node.js** (v14.0 or higher)
*   **NPM** (Node Package Manager)

### 1. Clone and Install
```bash
git clone https://github.com/your-username/node-marble-chess.git
cd node-marble-chess
npm install
```

### 2. Start the Server
```bash
npm start
```
The application will launch at `http://localhost:3000`.

---

## 🧠 AI Configuration

### Playing against Local LLMs (Ollama)
1.  Ensure [Ollama](https://ollama.com/) is running (`ollama serve`).
2.  Enable CORS on Ollama if necessary (set `OLLAMA_ORIGINS="*"`).
3.  In the game UI, select **LLM**.
4.  **URL:** `http://localhost:11434/api/chat` (or your specific port).
5.  **Model:** Type `llama3:latest` (or your installed model).
6.  **Key:** Leave blank.

### Playing against OpenAI
1.  In the game UI, select **LLM**.
2.  **URL:** `https://api.openai.com/v1/chat/completions`.
3.  **Model:** `gpt-3.5-turbo` or `gpt-4`.
4.  **Key:** Enter your Bearer Token (`sk-...`).

### Playing against a self-hosted Hermes Agent
Play against a full [Hermes](https://hermes-agent.nousresearch.com) agent (tools, context, memory) instead of a raw model. Requires a machine running the Hermes Gateway (`hermes serve`) on your LAN/VPN.

1.  **Run the gateway** (on any trusted machine):
    ```bash
    # one-time: choose dashboard credentials
    cat >> ~/.hermes/.env <<'EOF'
    HERMES_DASHBOARD_BASIC_AUTH_USERNAME=admin
    HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=choose-a-strong-password
    HERMES_DASHBOARD_BASIC_AUTH_SECRET=$(openssl rand -base64 32)
    EOF

    hermes serve --host 0.0.0.0 --port 9119
    ```

2.  **Start Open Chess:** `npm start`. That's it — no env vars, no config files.

3.  **In the game:** select **Hermes Agent**, paste your gateway URL (e.g. `http://192.168.1.10:9119`), enter your gateway username/password (stored in your browser's LocalStorage only — the chess server never sees them), and press *Start Game*. Open Chess registers the URL with its own server and persists it automatically.

**Why the URL goes through this server:** the gateway only trusts same-origin browser clients (CORS + WebSocket origin gate by design), so the chess server ships a credential-free passthrough under `/hermes-gateway` that the client uses automatically. For security it only accepts gateway URLs on **private/loopback** hosts — it is not a general internet proxy.

**Headless/Docker pre-configuration (optional):** skip the UI step by setting `HERMES_GATEWAY_URL=http://<gateway-host>:9119` (env var) or providing `hermes.config.json` (copy `hermes.config.example.json`). With the env var set, the URL is locked; otherwise entering a URL in the UI overwrites `hermes.config.json` automatically.

> 🔒 **Privacy:** your credentials are sent only to the gateway (through the same-origin proxy). The proxy is a dumb transport — no secrets, no AI logic, no game state. Keep both services on a trusted network; the gateway's own login protects it.

---

## 📂 Project Structure

*   **`index.html`**: Main entry point and layout structure.
*   **`css/style.css`**: Styling, grid layout, and marble textures.
*   **`js/game.js`**: Core Chess engine (Move validation, FEN, Game loop).
*   **`js/ui.js`**: DOM manipulation, drag-and-drop handlers, board rendering.
*   **`js/network.js`**: Socket.io client wrapper for multiplayer.
*   **`js/opponent.js`**: Local Minimax AI logic.
*   **`js/llm-player.js`**: Integration layer for communicating with LLM APIs.
*   **`js/hermes-player.js`**: Browser client for a self-hosted Hermes agent (Gateway JSON-RPC over WebSocket).
*   **`hermes-gateway-proxy.js`**: Optional same-origin passthrough to the Hermes Gateway; registers and persists the gateway URL entered in the UI.
*   **`js/storage.js`**: Handles saving/loading settings and sessions to `localStorage`.
*   **`server.js`**: (Assuming existence) Node.js/Socket.io backend.

---

## 🛠️ Configuration Options

| Setting | Location | Description |
| :--- | :--- | :--- |
| **Opponent Mode** | Sidebar | Switch between Local (Hotseat), CPU, LLM, Hermes Agent, or Online. |
| **CPU Level** | Sidebar | Adjust depth of the Minimax algorithm. |
| **Board Flip** | Sidebar | Rotates board 180 degrees. |
| **Copy FEN** | Sidebar | Copies current board state to clipboard. |
| **HERMES_GATEWAY_URL** | Server env var (optional) | Pre-configures the gateway for headless/Docker setups; normally you just enter the URL in the UI. |
| **Time Control** | Sidebar | No limit (relaxed), 5/10/15/30 minutes, or a custom length in minutes. |

---

## 📝 License

This project is open-source. Feel free to modify and distribute.
