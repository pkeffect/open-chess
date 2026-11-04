// VERSION: 1.2.0
/**
 * Hermes Agent opponent for Open Chess.
 *
 * Plays against a self-hosted Hermes Agent (https://hermes-agent.nousresearch.com)
 * through its native TUI Gateway protocol (JSON-RPC over WebSocket). This is not
 * a raw LLM call: every move is produced by a full agent turn with the harness's
 * tools, context and memory, in a persistent session — so the agent remembers
 * past games and the human's playing style across sessions.
 *
 * Transport: the gateway deliberately only trusts same-origin/loopback browser
 * clients (CORS + WebSocket origin gate), so this client always talks to the
 * gateway through the same-origin proxy shipped in hermes-gateway-proxy.js
 * (server side). The gateway URL entered in the UI is registered with that
 * proxy via POST /hermes-gateway/target — no server-side setup needed.
 *
 * Auth follows the project's privacy model: credentials are entered in the
 * browser and live in LocalStorage only. The server-side proxy carries no
 * secrets — the browser authenticates directly against the gateway (cookie
 * scoped to this origin) exactly like the official web dashboard does.
 */
class HermesPlayer {
    constructor(config) {
        this.gatewayUrl = (config.gatewayUrl || '').trim();
        this.username = config.username || '';
        this.password = config.password || '';
        this.moveTimeoutMs = config.moveTimeoutMs || 120000;
        this.onStatus = config.onStatus || (() => {});
        this.onAgentMessage = config.onAgentMessage || (() => {});
        this.maxRetries = 2; // invalid-move feedback retries per turn

        this.ws = null;
        this.sessionId = localStorage.getItem('chess_hermes_session_id') || null;
        this.pending = new Map();     // JSON-RPC request id -> {resolve, reject}
        this.moveWaiter = null;       // {resolve, reject, timer} while awaiting a turn
        this.reqCounter = 0;
        this.reqPrefix = 'oc_' + Math.random().toString(36).slice(2, 8) + '_';
    }

    // --- CONFIG ---

    isConfigured() {
        return /^https?:\/\//i.test(this.gatewayUrl) && this.username.trim() !== '' && this.password !== '';
    }

    // --- CONNECTION ---

    async ensureConnected() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        // Register the gateway URL with the server-side proxy (validates the
        // URL, activates it and persists it so a server restart keeps it).
        this._status('Registering gateway URL...');
        await this._setTarget();

        // The gateway may run auth-less on loopback (dev setups): check first.
        let authRequired = true;
        try {
            const status = await fetch(`${this._httpBase()}/api/status`, { credentials: 'same-origin' });
            if (status.ok) authRequired = !!(await status.json()).auth_required;
        } catch (e) {
            throw new Error('gateway unreachable through proxy');
        }

        if (authRequired) {
            if (!this.isConfigured()) throw new Error('gateway credentials missing');
            this._status('Logging in...');
            const res = await fetch(`${this._httpBase()}/auth/password-login`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'basic',
                    username: this.username,
                    password: this.password
                })
            });
            if (res.status === 401) throw new Error('login rejected (wrong username/password?)');
            if (!res.ok) throw new Error(`login failed (HTTP ${res.status})`);
            // Success = 2xx: the gateway answers {"ok": true, "next": ...} and
            // sets the session cookies. (Older docs mention a "success" flag —
            // the live route does not send one.)
            const data = await res.json().catch(() => ({}));
            if (data && data.ok === false) throw new Error('login rejected by gateway');
        }

        this._status('Connecting...');

        // Browsers cannot reliably carry the session cookie on a WebSocket
        // upgrade. The gateway's documented mechanism for exactly this is a
        // single-use, 30 s upgrade ticket minted over the authenticated
        // session (the official desktop client uses the same flow):
        // POST /api/auth/ws-ticket -> connect with ?token=<ticket>.
        let wsUrl = this._wsUrl();
        if (authRequired) {
            try {
                const t = await fetch(`${this._httpBase()}/api/auth/ws-ticket`, {
                    method: 'POST',
                    credentials: 'same-origin'
                });
                if (t.ok) {
                    const d = await t.json();
                    if (d && d.ticket) {
                        wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'ticket=' + encodeURIComponent(d.ticket);
                        this._status('Authenticating socket...');
                    }
                }
            } catch (e) { /* fall back to cookie-based upgrade */ }
        }

        this.ws = new WebSocket(wsUrl);
        this.ws.onmessage = (e) => { try { this._onMessage(e.data); } catch (err) { console.warn('Hermes WS message error', err); } };
        this.ws.onclose = () => {
            const hadSession = this.sessionId;
            this.ws = null;
            this.pending.forEach(p => p.reject(new Error('connection closed')));
            this.pending.clear();
            if (this.moveWaiter) this._failMove(new Error('connection closed'));
            if (hadSession) this._status('Disconnected — reconnects on next move');
        };
        this.ws.onerror = () => { /* onclose follows */ };

        await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = () => reject(new Error('WebSocket connection failed (gateway running? URL correct?)'));
        });

        // Advertise interrupt capability so tool-approval/clarify requests reach us
        // and we can decline them fast instead of stalling the turn (see _onMessage).
        try { await this._rpc('client.capabilities', { server_requests: true }); } catch (e) { /* older gateways */ }
    }

    /** POST the UI-entered gateway URL to the proxy's /target endpoint. */
    async _setTarget() {
        if (this._targetSetFor === this.gatewayUrl) return;
        const res = await fetch(`${this._httpBase()}/target`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: this.gatewayUrl })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `gateway URL rejected (HTTP ${res.status})`);
        }
        this._targetSetFor = this.gatewayUrl;
        this._status(data.persisted ? 'Gateway URL saved' : 'Gateway URL set');
    }

    _httpBase() {
        return '/hermes-gateway';
    }

    _wsUrl() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${location.host}${this._httpBase()}/api/ws`;
    }

    _rpc(method, params) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('not connected'));
                return;
            }
            const id = `${this.reqPrefix}${++this.reqCounter}`;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        });
    }

    _onMessage(raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        // JSON-RPC response to one of our requests
        if (msg.id !== undefined && msg.id !== null && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else p.resolve(msg.result);
            return;
        }

        if (!msg.method) return;

        // Server -> client REQUESTS (interrupts). A chess client must never block
        // on a human dialog: decline everything immediately so the turn finishes.
        if (msg.id !== undefined && msg.id !== null) {
            switch (msg.method) {
                case 'approval.request':
                    this._reply(msg.id, { approved: false });
                    this._status('Hermes wanted to use a tool — declined');
                    break;
                case 'clarify.request':
                    // A result without answers cancels the whole card by contract.
                    this._reply(msg.id, { outcome: 'cancelled' });
                    this._status('Hermes asked a question — auto-cancelled');
                    break;
                case 'sudo.request':
                case 'secret.request':
                    this._replyError(msg.id, 'declined by chess client');
                    break;
                default:
                    this._replyError(msg.id, 'unsupported request from chess client');
            }
            return;
        }

        // Events. Real wire format: {"method":"event","params":{"type":...,
        // "session_id":...,"payload":{...}}} (older docs show the event name as
        // the method directly — support both shapes defensively).
        let type, payload;
        if (msg.method === 'event') {
            type = msg.params && msg.params.type;
            payload = (msg.params && msg.params.payload) || {};
        } else {
            type = msg.method;
            payload = msg.params || {};
        }

        switch (type) {
            case 'gateway.ready':
                this._status('Connected');
                break;
            case 'message.complete':
                // This socket drives exactly one pending turn at a time (the game
                // loop serialises), so the next completion is ours. The gateway
                // delivers the assistant text as payload.text.
                if (this.moveWaiter) {
                    this._completeMove(payload.text || payload.content || '');
                } else if (this._reportWaiter) {
                    const w = this._reportWaiter;
                    this._reportWaiter = null;
                    w.resolve(payload.text || payload.content || '');
                }
                break;
            case 'error':
                if (this.moveWaiter) {
                    this._failMove(new Error(payload.message || 'gateway error'));
                }
                break;
            default:
                break; // message.delta, session.updated, tool.* etc. — not needed for moves
        }
    }

    _reply(id, result) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
        }
    }

    _replyError(id, message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }));
        }
    }

    _status(text) {
        try { this.onStatus(text); } catch (e) { /* UI callback must never break the game */ }
    }

    // --- SESSION (persistent => the agent remembers games and playing style) ---

    async ensureSession() {
        if (this.sessionId) return;
        const res = await this._rpc('session.create', {});
        const id = res && (res.id || (res.session && res.session.id) || res.session_id);
        if (!id) throw new Error('session.create returned no id');
        this.sessionId = id;
        localStorage.setItem('chess_hermes_session_id', id);

        // First contact in a fresh session: explain the setup once. The greeting
        // turn is awaited with a short budget; failure is non-fatal (the move
        // prompts below are self-contained anyway).
        this._status('Starting agent session...');
        try {
            await this._submitAndWait(this._introPrompt(), Math.min(45000, this.moveTimeoutMs));
        } catch (e) { /* keep going regardless */ }
    }

    resetSession() {
        this.sessionId = null;
        localStorage.removeItem('chess_hermes_session_id');
    }

    // --- MOVES ---

    /**
     * Mirrors LLMPlayer.getBestMove(): resolves to {fromRow, fromCol, toRow, toCol}
     * or null (caller falls back to the CPU opponent / shows an error).
     */
    async getBestMove(game) {
        try {
            await this.ensureConnected();
            await this.ensureSession();
        } catch (e) {
            this._status(`Error: ${e.message}`);
            return null;
        }

        const legalUCI = game.getAllLegalMoves(game.turn).map(m => this.coordsToUCI(m));
        let prompt = this._movePrompt(game, legalUCI, null);
        let sessionRebuilt = false;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            this._status(`Thinking... (move ${attempt + 1}/${this.maxRetries + 1})`);
            let reply;
            try {
                reply = await this._submitAndWait(prompt, this.moveTimeoutMs);
            } catch (e) {
                if (this._maybeResetBrokenSession(e)) continue;
                // A turn can hang forever (e.g. the session survived a page
                // reload as a detached zombie): the timeout already sent a
                // session.interrupt — rebuild the session once and retry.
                if (!sessionRebuilt) {
                    sessionRebuilt = true;
                    this._status('Recovering: restarting agent session...');
                    this.resetSession();
                    try {
                        await this.ensureSession();
                        prompt = this._movePrompt(game, legalUCI, null);
                        attempt--; // recovery attempt doesn't consume a retry
                        continue;
                    } catch (e2) {
                        this._status(`Error: ${e2.message}`);
                        return null;
                    }
                }
                this._status(`Error: ${e.message}`);
                return null;
            }

            const uci = this.extractUCI(reply, legalUCI);
            if (uci) {
                this._status('Connected');
                this._emitAgentMessage(reply);
                return this.uciToCoords(uci);
            }
            this._emitAgentMessage(reply);
            this._status('Illegal move — asking again...');
            prompt = this._movePrompt(game, legalUCI,
                `"${(reply || '').trim().slice(-120)}" is not a legal move in this position.`);
        }

        this._status('No valid move received');
        return null;
    }

    /**
     * Chat: the human talks to the agent inside the game session (full game
     * context). Rejects while a move is being computed so conversations and
     * move turns never interleave in the session queue.
     */
    async sendChatMessage(text) {
        if (this.moveWaiter) throw new Error('I am still thinking about my move — try again in a moment.');
        if (!this.sessionId) throw new Error('start a game first, then we can talk.');
        await this.ensureConnected();
        const prompt = [
            'CHAT MESSAGE from your opponent (not a move request — do NOT include a MOVE line):',
            `"${text}"`,
            'Reply briefly in the language the human used.'
        ].join('\n');
        const reply = await this._submitAndWait(prompt, Math.min(60000, this.moveTimeoutMs));
        return this._extractComment(reply);
    }

    /** Surface the agent's commentary (reply minus the MOVE line) via onAgentMessage. */
    _emitAgentMessage(reply) {
        const comment = this._extractComment(reply);
        if (comment) {
            try { this.onAgentMessage(comment); } catch (e) { /* UI callback must never break the game */ }
        }
    }

    _extractComment(reply) {
        if (!reply) return '';
        return reply
            .split('\n')
            .filter(line => !/MOVE:\s*[a-h][1-8]/i.test(line))
            .join('\n')
            .trim();
    }

    /**
     * Reports a finished game (result + PGN) to the agent so it can store and
     * learn from it with its own memory. After the report turn completes, the
     * session is closed cleanly (session.close) and its id forgotten — an open
     * ownership lease after the tab closes must never block other clients
     * (e.g. writing from the desktop dashboard).
     */
    async notifyGameOver(game) {
        if (this._reportedGameOver) return; // resign + turn-switch paths can both call this
        this._reportedGameOver = true;
        if (!this.sessionId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const pgn = this.buildPGN(game);
        const text = [
            'GAME OVER. Result: ' + this._resultString(game) + ` (${game.status}).`,
            'PGN:',
            pgn,
            '',
            'Please store this game and a short note on the human player\'s style ' +
            '(openings, tactics, recurring mistakes) with your memory so future games ' +
            'can build on it. Acknowledge with one short sentence.'
        ].join('\n');

        this._status('Sending game report...');
        try {
            // Wait for the report turn (bounded) so the PGN is actually stored
            // before we close the session underneath it.
            await new Promise((resolve, reject) => {
                this._reportWaiter = { resolve, reject };
                const fail = (e) => {
                    if (!this._reportWaiter) return;
                    this._reportWaiter = null;
                    reject(e);
                };
                this._rpc('prompt.submit', { text, session_id: this.sessionId }).catch(fail);
                setTimeout(() => fail(new Error('report not confirmed in 30s')), 30000);
            });
            this._status('Game stored — closing session...');
        } catch (e) {
            console.warn('Hermes game report failed:', e.message); // still close below
        }

        // Close the session cleanly so nothing blocks other clients after the
        // tab closes. Best effort in both orders.
        try { await this._rpc('session.close', { session_id: this.sessionId }); } catch (e) { /* maybe already gone */ }
        this.resetSession();
        this._status('Game stored — session closed');
    }

    /** Abort a running computation (resign / new game / page state change). */
    abort() {
        if (this.moveWaiter) this._failMove(new Error('aborted'));
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
            this._rpc('session.interrupt', { session_id: this.sessionId }).catch(() => {});
        }
    }

    close() {
        this.abort();
        if (this.ws) { try { this.ws.close(); } catch (e) { /* already closing */ } this.ws = null; }
    }

    // --- TURN SUBMISSION ---

    _submitAndWait(text, timeoutMs) {
        return new Promise((resolve, reject) => {
            this.moveWaiter = { resolve, reject, timer: null };

            this._rpc('prompt.submit', { text, session_id: this.sessionId })
                .then((res) => {
                    // The gateway reports statuses like "queued"/"accepted" while
                    // the turn runs — completion is awaited via message.complete
                    // below. Real failures (ownership, unknown session) arrive
                    // as RPC errors and are handled in _rpc.
                    const status = res && res.status;
                    if (status === 'rejected' && this.moveWaiter) {
                        this._failMove(new Error('prompt rejected: ' + JSON.stringify(res)));
                    }
                })
                .catch((e) => { if (this.moveWaiter) this._failMove(e); });

            this.moveWaiter.timer = setTimeout(() => {
                // Cancel the agent turn so it stops consuming resources, then fail
                // (caller retries or falls back to the CPU opponent).
                this._rpc('session.interrupt', { session_id: this.sessionId }).catch(() => {});
                this._failMove(new Error(`no move within ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs);
        });
    }

    _completeMove(content) {
        const w = this.moveWaiter;
        if (!w) return;
        if (w.timer) clearTimeout(w.timer);
        this.moveWaiter = null;
        w.resolve(content);
    }

    _failMove(err) {
        const w = this.moveWaiter;
        if (!w) return;
        if (w.timer) clearTimeout(w.timer);
        this.moveWaiter = null;
        w.reject(err);
    }

    /** Reset the stored session when the gateway reports it unusable (deleted, not owned). */
    _maybeResetBrokenSession(err) {
        const msg = (err && err.message ? err.message : '').toLowerCase();
        if (msg.includes('not owned') || msg.includes('session_not_owned') || msg.includes('not found')) {
            this.resetSession();
            return true;
        }
        return false;
    }

    // --- PROMPTS ---

    _introPrompt() {
        return [
            'CONNECT: You have been connected to "Open Chess" (open-source Node.js chess app) as an AI opponent.',
            'From now on this session carries chess games against a human player. You always play BLACK; the human plays WHITE and moves first.',
            'Each chess move request will contain the move list so far, the current FEN and your legal moves in UCI notation.',
            'For every request: reply with at most one short sentence of commentary (any language), and make your LAST line exactly:',
            'MOVE: <your move in UCI, e.g. e7e5>',
            'Pick one of the listed legal moves. Do not use tools for chess moves. Acknowledge briefly now.'
        ].join('\n');
    }

    _movePrompt(game, legalUCI, invalidFeedback) {
        const parts = [
            'CHESS MOVE REQUEST (automated client — answer quickly, do not use tools)',
            'You play BLACK.'
        ];
        if (invalidFeedback) parts.push('PROBLEM with your previous answer: ' + invalidFeedback);
        const pgnLine = this._pgnLine(game.pgnHistory);
        if (pgnLine) parts.push('Moves so far: ' + pgnLine);
        else parts.push('The game just started; no moves played yet.');
        parts.push('Current FEN: ' + game.toFEN());
        parts.push('Legal moves (UCI): ' + legalUCI.join(', '));
        parts.push('Pick the best move. End your reply with exactly: MOVE: <uci>');
        return parts.join('\n');
    }

    _pgnLine(pgnHistory) {
        const out = [];
        for (let i = 0; i < pgnHistory.length; i += 2) {
            out.push(`${(i / 2) + 1}. ${pgnHistory[i]}${pgnHistory[i + 1] ? ' ' + pgnHistory[i + 1] : ''}`);
        }
        return out.join(' ');
    }

    _resultString(game) {
        if (game.winner === 'white') return '1-0';
        if (game.winner === 'black') return '0-1';
        return '1/2-1/2';
    }

    buildPGN(game) {
        const date = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const tags = [
            '[Event "Open Chess"]',
            '[Site "Open Chess (local)"]',
            `[Date "${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}"]`,
            '[White "Human"]',
            '[Black "Hermes"]',
            `[Result "${this._resultString(game)}"]`
        ];
        return tags.join('\n') + '\n\n' + this._pgnLine(game.pgnHistory) + ' ' + this._resultString(game);
    }

    // --- MOVE PARSING / CONVERSION (kept compatible with LLMPlayer) ---

    extractUCI(text, legalMovesUCI) {
        if (!text) return null;
        // 1) Contract format: last "MOVE: <uci>" line wins.
        const contract = text.match(/MOVE:\s*"?([a-h][1-8][a-h][1-8][qrbn]?)"?/i);
        if (contract) {
            const uci = this._normalizeUCI(contract[1], legalMovesUCI);
            if (uci) return uci;
        }
        // 2) Fallback: first chess-move-looking token that is legal.
        const matches = text.match(/[a-h][1-8][a-h][1-8][qrbn]?/gi);
        if (matches) {
            for (const m of matches) {
                const uci = this._normalizeUCI(m, legalMovesUCI);
                if (uci) return uci;
            }
        }
        return null;
    }

    _normalizeUCI(token, legalMovesUCI) {
        const clean = token.toLowerCase();
        const bare = clean.slice(0, 4);
        // Accept explicit promotion suffixes and bare promotion squares
        // (game.js auto-promotes to queen when unspecified, matching LLMPlayer).
        if (legalMovesUCI.includes(bare)) return bare;
        if (legalMovesUCI.includes(clean)) return clean;
        return null;
    }

    coordsToUCI(move) {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        return `${files[move.fromCol]}${8 - move.fromRow}${files[move.toCol]}${8 - move.toRow}`;
    }

    uciToCoords(uci) {
        if (!uci || uci.length < 4) return null;
        const files = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4, 'f': 5, 'g': 6, 'h': 7 };
        return {
            fromRow: 8 - parseInt(uci[1]),
            fromCol: files[uci[0]],
            toRow: 8 - parseInt(uci[3]),
            toCol: files[uci[2]]
        };
    }
}
