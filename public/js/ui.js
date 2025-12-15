// VERSION: 5.1.0
class ChessUI {
    constructor() {
        // Board
        this.gameBoard = document.getElementById('chessboard');
        this.graveyardTop = document.getElementById('graveyard-top');
        this.graveyardBottom = document.getElementById('graveyard-bottom');

        // Status
        this.statusText = document.getElementById('status-text');
        this.winnerDisplay = document.getElementById('winner-display');
        this.timerWhite = document.getElementById('timer-white');
        this.timerBlack = document.getElementById('timer-black');
        this.loadingIndicator = document.getElementById('loading-indicator');

        // Controls
        this.startBtn = document.getElementById('start-btn');
        this.resignBtn = document.getElementById('resign-btn');
        this.drawBtn = document.getElementById('draw-btn');
        this.historyPanel = document.getElementById('history-panel');
        this.copyFenBtn = document.getElementById('btn-copy-fen');
        this.flipBtn = document.getElementById('btn-flip-board');
        this.readmeBtn = document.getElementById('btn-readme'); // NEW

        // Settings
        this.radioHuman = document.getElementById('vs-human');
        this.radioCpu = document.getElementById('vs-cpu');
        this.radioLlm = document.getElementById('vs-llm');
        this.radioP2P = document.getElementById('vs-p2p');

        this.cpuDifficultySelect = document.getElementById('cpu-difficulty');
        this.cpuSettingsDiv = document.getElementById('cpu-settings');

        this.llmSettingsDiv = document.getElementById('llm-settings');
        this.p2pPanel = document.getElementById('p2p-panel');

        // Inputs
        this.llmUrlInput = document.getElementById('llm-url');
        this.llmModelSelect = document.getElementById('llm-model');
        this.llmKeyInput = document.getElementById('llm-key');
        this.refreshModelsBtn = document.getElementById('refresh-models-btn');

        // P2P UI
        this.netCreateBtn = document.getElementById('net-create-btn');
        this.netJoinModeBtn = document.getElementById('net-join-mode-btn');
        this.netRoomInput = document.getElementById('net-room-input');
        this.netJoinBtn = document.getElementById('net-join-btn');
        this.netStatus = document.getElementById('net-status');
        this.netStep1 = document.getElementById('net-step-1');
        this.netStep2 = document.getElementById('net-step-2');
        this.netStep3 = document.getElementById('net-step-3');
        this.displayRoomId = document.getElementById('display-room-id');

        // Modals
        this.restoreModal = document.getElementById('restore-modal');
        this.restoreYesBtn = document.getElementById('restore-yes');
        this.restoreNoBtn = document.getElementById('restore-no');

        this.promotionModal = document.getElementById('promotion-modal');
        this.promotionOptions = document.getElementById('promotion-options');

        this.drawModal = document.getElementById('draw-modal');
        this.drawAcceptBtn = document.getElementById('draw-accept');
        this.drawDeclineBtn = document.getElementById('draw-decline');

        this.readmeModal = document.getElementById('readme-modal'); // NEW
        this.readmeClose = document.querySelector('.readme-close'); // NEW

        this.pieceSymbols = {
            'r': '♜\uFE0E', 'n': '♞\uFE0E', 'b': '♝\uFE0E', 'q': '♛\uFE0E', 'k': '♚\uFE0E', 'p': '♟\uFE0E',
            'R': '♜\uFE0E', 'N': '♞\uFE0E', 'B': '♝\uFE0E', 'Q': '♛\uFE0E', 'K': '♚\uFE0E', 'P': '♟\uFE0E'
        };

        this.disconnectInterval = null;
        this.isFlipped = false;

        // --- DRAG STATE ---
        this.dragState = {
            isDragging: false,
            element: null,
            startX: 0,
            startY: 0
        };

        // --- AUDIO ---
        this.sounds = {
            move: new Audio('audio/beat1.wav'),
            capture: new Audio('audio/fire.wav'),
            check: new Audio('audio/ufo-small.wav'),
            gameStart: new Audio('audio/extra-player.wav'),
            gameOver: new Audio('audio/ufo-large.wav'),
            promote: new Audio('audio/thrust.wav')
        };
        Object.values(this.sounds).forEach(s => s.load());

        // Global Mouse Listeners for Dragging
        document.addEventListener('mousemove', (e) => this.handleDragMove(e));
        document.addEventListener('mouseup', (e) => this.handleDragEnd(e));

        // Touch Listeners (Mobile)
        document.addEventListener('touchmove', (e) => this.handleDragMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleDragEnd(e));
    }

    playSound(type) {
        const s = this.sounds[type];
        if (s) {
            s.currentTime = 0;
            s.play().catch(e => console.log("Audio play failed (interaction required):", e));
        }
    }

    // --- BINDING EVENTS ---
    bindStart(handler) { this.startBtn.addEventListener('click', handler); }
    bindResign(handler) { this.resignBtn.addEventListener('click', handler); }
    bindDraw(handler) { this.drawBtn.addEventListener('click', handler); }

    bindDrawResponses(onAccept, onDecline) {
        this.drawAcceptBtn.addEventListener('click', () => {
            this.drawModal.style.display = 'none';
            onAccept();
        });
        this.drawDeclineBtn.addEventListener('click', () => {
            this.drawModal.style.display = 'none';
            onDecline();
        });
    }

    bindOpponentChange(handler) {
        [this.radioHuman, this.radioCpu, this.radioLlm, this.radioP2P].forEach(r => {
            if (r) r.addEventListener('change', handler);
        });
    }
    bindSettingsChange(handler) {
        this.llmUrlInput.addEventListener('input', handler);
        this.llmKeyInput.addEventListener('input', handler);
        this.llmModelSelect.addEventListener('change', handler);

        // Bind CPU Difficulty Change
        this.cpuDifficultySelect.addEventListener('change', handler);
    }
    bindRefreshModels(handler) {
        if (this.refreshModelsBtn) this.refreshModelsBtn.addEventListener('click', handler);
    }
    bindRestore(onYes, onNo) {
        if (this.restoreYesBtn) this.restoreYesBtn.addEventListener('click', () => {
            this.restoreModal.style.display = 'none';
            onYes();
        });
        if (this.restoreNoBtn) this.restoreNoBtn.addEventListener('click', () => {
            this.restoreModal.style.display = 'none';
            onNo();
        });
    }
    bindCopyFen(game) {
        this.copyFenBtn.addEventListener('click', () => {
            const fen = game.toFEN();
            navigator.clipboard.writeText(fen).then(() => {
                const originalText = this.copyFenBtn.innerText;
                this.copyFenBtn.innerText = "Copied!";
                setTimeout(() => this.copyFenBtn.innerText = originalText, 2000);
            });
        });
    }
    bindFlipBoard(callback) {
        this.flipBtn.addEventListener('click', () => {
            this.isFlipped = !this.isFlipped;
            callback(); // Re-render board
        });
    }

    // NEW: README BINDING
    bindShowReadme() {
        this.readmeBtn.addEventListener('click', () => {
            this.readmeModal.style.display = 'flex';
        });
        this.readmeClose.addEventListener('click', () => {
            this.readmeModal.style.display = 'none';
        });
        // Click outside to close
        this.readmeModal.addEventListener('click', (e) => {
            if (e.target === this.readmeModal) {
                this.readmeModal.style.display = 'none';
            }
        });
    }

    // --- P2P BINDINGS ---
    bindNetCreate(handler) { if (this.netCreateBtn) this.netCreateBtn.addEventListener('click', handler); }
    bindNetJoinMode(handler) {
        if (this.netJoinModeBtn) this.netJoinModeBtn.addEventListener('click', () => {
            this.netStep1.style.display = 'none';
            this.netStep2.style.display = 'flex';
            handler();
        });
    }
    bindNetConnect(handler) {
        if (this.netJoinBtn) this.netJoinBtn.addEventListener('click', () => {
            handler(this.netRoomInput.value.trim());
        });
    }

    // --- PROMOTION UI ---
    showPromotionModal(color, callback) {
        this.promotionOptions.innerHTML = '';
        const pieces = ['q', 'r', 'b', 'n'];

        pieces.forEach(p => {
            const btn = document.createElement('div');
            btn.className = 'promo-btn';
            const code = (color === 'white') ? p.toUpperCase() : p;
            btn.innerText = this.pieceSymbols[code];

            btn.addEventListener('click', () => {
                this.promotionModal.style.display = 'none';
                callback(p);
            });
            this.promotionOptions.appendChild(btn);
        });

        this.promotionModal.style.display = 'flex';
    }

    showDrawModal() {
        this.drawModal.style.display = 'flex';
    }

    setBoardLocked(isLocked) {
        if (isLocked) {
            this.gameBoard.classList.add('board-locked');
        } else {
            this.gameBoard.classList.remove('board-locked');
        }
    }

    // --- DRAG AND DROP HANDLERS ---

    handleDragStart(e, row, col, onSquareClick) {
        // Normalize Touch vs Mouse
        let clientX, clientY;
        if (e.type === 'touchstart') {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
            e.preventDefault();
        } else {
            if (e.button !== 0) return;
            e.preventDefault();
            clientX = e.clientX;
            clientY = e.clientY;
        }

        onSquareClick(row, col);

        const pieceEl = e.target;
        if (!pieceEl.classList.contains('piece')) return;

        const clone = pieceEl.cloneNode(true);
        clone.classList.add('dragging-clone');
        document.body.appendChild(clone);

        this.dragState = {
            isDragging: true,
            element: clone,
            originRow: row,
            originCol: col,
            onAction: onSquareClick
        };
        this.updateDragPosition(clientX, clientY);
    }

    handleDragMove(e) {
        if (!this.dragState.isDragging || !this.dragState.element) return;
        e.preventDefault();

        let clientX, clientY;
        if (e.type === 'touchmove') {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        this.updateDragPosition(clientX, clientY);
    }

    handleDragEnd(e) {
        if (!this.dragState.isDragging) return;

        // Coordinates
        let clientX, clientY;
        if (e.type === 'touchend') {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        this.dragState.element.style.display = 'none';
        const elemBelow = document.elementFromPoint(clientX, clientY);
        const square = elemBelow ? elemBelow.closest('.square') : null;

        if (square) {
            const r = parseInt(square.dataset.row);
            const c = parseInt(square.dataset.col);
            if (r !== this.dragState.originRow || c !== this.dragState.originCol) {
                this.dragState.onAction(r, c);
            }
        }

        if (this.dragState.element) {
            this.dragState.element.remove();
        }
        this.dragState = { isDragging: false, element: null };
    }

    updateDragPosition(x, y) {
        if (this.dragState.element) {
            this.dragState.element.style.left = x + 'px';
            this.dragState.element.style.top = y + 'px';
        }
    }

    // --- RENDERING ---
    createBoard(game, selectedSquare, onSquareClick) {
        this.gameBoard.innerHTML = '';

        let validMoves = [];
        if (selectedSquare) {
            const allMoves = game.getAllLegalMoves(game.turn);
            validMoves = allMoves.filter(m => m.fromRow === selectedSquare.row && m.fromCol === selectedSquare.col);
        }

        const rows = this.isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
        const cols = this.isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

        for (let rIdx = 0; rIdx < 8; rIdx++) {
            const row = rows[rIdx];
            for (let cIdx = 0; cIdx < 8; cIdx++) {
                const col = cols[cIdx];

                const square = document.createElement('div');
                square.classList.add('square');

                if ((row + col) % 2 === 0) square.classList.add('white-marble');
                else square.classList.add('black-marble');

                square.dataset.row = row;
                square.dataset.col = col;

                if (game.lastMove) {
                    if ((game.lastMove.from.row === row && game.lastMove.from.col === col) ||
                        (game.lastMove.to.row === row && game.lastMove.to.col === col)) {
                        square.classList.add('last-move');
                    }
                }

                if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
                    square.classList.add('selected');
                }

                const validMove = validMoves.find(m => m.toRow === row && m.toCol === col);
                if (validMove) {
                    square.classList.add('valid-move');
                    if (game.getPieceAt(row, col) !== '') {
                        square.classList.add('capture-hint');
                    }
                }

                const pieceCode = game.getPieceAt(row, col);
                if (pieceCode !== '') {
                    const pieceElement = document.createElement('div');
                    pieceElement.classList.add('piece');
                    pieceElement.innerText = this.pieceSymbols[pieceCode];

                    if (pieceCode === pieceCode.toUpperCase()) pieceElement.classList.add('white');
                    else pieceElement.classList.add('black');

                    // MOUSE DRAG
                    pieceElement.addEventListener('mousedown', (e) => {
                        const isWhitePiece = pieceCode === pieceCode.toUpperCase();
                        if ((game.turn === 'white' && isWhitePiece) || (game.turn === 'black' && !isWhitePiece)) {
                            this.handleDragStart(e, row, col, onSquareClick);
                        } else {
                            onSquareClick(row, col);
                        }
                    });

                    // TOUCH DRAG
                    pieceElement.addEventListener('touchstart', (e) => {
                        const isWhitePiece = pieceCode === pieceCode.toUpperCase();
                        if ((game.turn === 'white' && isWhitePiece) || (game.turn === 'black' && !isWhitePiece)) {
                            this.handleDragStart(e, row, col, onSquareClick);
                        }
                    }, { passive: false });

                    square.appendChild(pieceElement);
                } else {
                    square.addEventListener('click', () => onSquareClick(row, col));
                }

                if (pieceCode === '') {
                    square.addEventListener('click', () => onSquareClick(row, col));
                }

                this.gameBoard.appendChild(square);
            }
        }
        this.updateGraveyards(game);
        this.updateStatus(game);
        this.updateHistory(game);
    }

    updateGraveyards(game) {
        this.graveyardTop.innerHTML = '';
        this.graveyardBottom.innerHTML = '';

        game.capturedWhite.forEach(p => {
            const el = document.createElement('div');
            el.className = 'piece white';
            el.innerText = this.pieceSymbols[p];
            this.graveyardTop.appendChild(el);
        });

        game.capturedBlack.forEach(p => {
            const el = document.createElement('div');
            el.className = 'piece black';
            el.innerText = this.pieceSymbols[p];
            this.graveyardBottom.appendChild(el);
        });
    }

    updateHistory(game) {
        this.historyPanel.innerHTML = '';
        if (game.pgnHistory.length === 0) {
            this.historyPanel.innerHTML = '<div style="color: #666; font-style: italic;">Moves will appear here...</div>';
            return;
        }

        for (let i = 0; i < game.pgnHistory.length; i += 2) {
            const row = document.createElement('div');
            row.className = 'history-row';

            const num = document.createElement('div');
            num.className = 'history-num';
            num.innerText = `${(i / 2) + 1}.`;

            const whiteMove = document.createElement('div');
            whiteMove.className = 'history-move';
            whiteMove.innerText = game.pgnHistory[i];

            const blackMove = document.createElement('div');
            blackMove.className = 'history-move';
            blackMove.innerText = game.pgnHistory[i + 1] || '';

            row.appendChild(num);
            row.appendChild(whiteMove);
            row.appendChild(blackMove);
            this.historyPanel.appendChild(row);
        }
        this.historyPanel.scrollTop = this.historyPanel.scrollHeight;
    }

    updateTimers(clock, isGameStarted, gameOver, turn) {
        this.timerWhite.innerText = clock.getTimeString('white');
        this.timerBlack.innerText = clock.getTimeString('black');

        if (isGameStarted && !gameOver) {
            if (turn === 'white') {
                this.timerWhite.classList.add('active');
                this.timerBlack.classList.remove('active');
            } else {
                this.timerWhite.classList.remove('active');
                this.timerBlack.classList.add('active');
            }
        } else {
            this.timerWhite.classList.remove('active');
            this.timerBlack.classList.remove('active');
        }
    }

    updateStatus(game) {
        if (game.gameOver) {
            let msg = '';
            if (game.status === 'checkmate') msg = `Checkmate! ${game.winner.toUpperCase()} Wins!`;
            if (game.status === 'stalemate') msg = "Draw (Stalemate)";
            if (game.status === 'resign') {
                const loser = (game.winner === 'white') ? 'BLACK' : 'WHITE';
                msg = `${loser} Resigned. ${game.winner.toUpperCase()} Wins!`;
            }
            if (game.status === 'timeout') msg = `Time Out! ${game.winner.toUpperCase()} Wins!`;
            if (game.status === 'draw') msg = `Draw! (${game.winner})`;
            if (game.status === 'timeout (disconnect)') msg = `Opponent Disconnected. ${game.winner.toUpperCase()} Wins!`;

            this.statusText.innerText = "Game Over";
            this.winnerDisplay.innerText = msg;

            this.setGameActive(false);
        } else {
            if (this.startBtn.disabled) {
                const turnColor = game.turn.charAt(0).toUpperCase() + game.turn.slice(1);
                this.statusText.innerText = `${turnColor}'s Turn`;
            } else {
                this.statusText.innerText = "Ready to Play";
            }
            if (game.isKingInCheck(game.turn)) this.winnerDisplay.innerText = "CHECK!";
            else this.winnerDisplay.innerText = "";
        }
    }

    setSpectatorMode() {
        this.statusText.innerText = "Spectating";
        this.startBtn.disabled = true;
        this.resignBtn.disabled = true;
        this.drawBtn.disabled = true;
        this.netStatus.innerText = "You are a Spectator";
        this.netStatus.style.color = "#ccc";
    }

    startDisconnectTimer(seconds) {
        if (this.disconnectInterval) clearInterval(this.disconnectInterval);

        let remaining = Math.floor(seconds / 1000);
        this.winnerDisplay.innerText = `Opponent Disconnected! Auto-win in ${remaining}s`;
        this.winnerDisplay.style.color = "#f44336";

        this.disconnectInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(this.disconnectInterval);
                this.winnerDisplay.innerText = "Opponent Timed Out";
            } else {
                this.winnerDisplay.innerText = `Opponent Disconnected! Auto-win in ${remaining}s`;
            }
        }, 1000);
    }

    clearDisconnectTimer() {
        if (this.disconnectInterval) {
            clearInterval(this.disconnectInterval);
            this.disconnectInterval = null;
        }
        this.winnerDisplay.innerText = "";
        this.winnerDisplay.style.color = "#ffd700"; // Reset to default gold
    }

    setGameActive(isActive) {
        this.startBtn.disabled = isActive;
        this.resignBtn.disabled = !isActive;
        this.drawBtn.disabled = !isActive;
        if (!isActive) {
            this.startBtn.innerText = "New Game";
            this.loadingIndicator.style.display = 'none';
        }
    }

    setLoading(isLoading) {
        this.loadingIndicator.style.display = isLoading ? 'block' : 'none';
    }

    updateSettingsVisibility() {
        this.llmSettingsDiv.style.display = 'none';
        this.p2pPanel.style.display = 'none';
        this.cpuSettingsDiv.style.display = 'none';

        if (this.radioLlm.checked) this.llmSettingsDiv.style.display = 'flex';
        if (this.radioP2P.checked) this.p2pPanel.style.display = 'flex';
        if (this.radioCpu.checked) this.cpuSettingsDiv.style.display = 'flex';
    }

    getOpponentMode() {
        if (this.radioCpu.checked) return 'cpu';
        if (this.radioLlm.checked) return 'llm';
        if (this.radioP2P.checked) return 'p2p';
        return 'human';
    }

    setOpponentMode(mode) {
        if (mode === 'cpu') this.radioCpu.checked = true;
        else if (mode === 'llm') this.radioLlm.checked = true;
        else if (mode === 'p2p') this.radioP2P.checked = true;
        else this.radioHuman.checked = true;
        this.updateSettingsVisibility();
    }

    // New Helper for CPU Difficulty
    getDifficulty() {
        return this.cpuDifficultySelect.value;
    }

    setDifficulty(val) {
        this.cpuDifficultySelect.value = val;
    }

    populateModels(models, currentSelection) {
        this.llmModelSelect.innerHTML = '';
        if (models.length === 0) {
            const option = document.createElement('option');
            option.text = "No models found";
            this.llmModelSelect.add(option);
        } else {
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.text = model.id;
                option.title = model.id;
                this.llmModelSelect.add(option);
            });
        }
        if (currentSelection && Array.from(this.llmModelSelect.options).some(o => o.value === currentSelection)) {
            this.llmModelSelect.value = currentSelection;
        }
    }

    getLLMConfig() {
        return {
            url: this.llmUrlInput.value,
            model: this.llmModelSelect.value,
            key: this.llmKeyInput.value
        };
    }

    setLLMConfig(url, key, model) {
        if (url) this.llmUrlInput.value = url;
        if (key) this.llmKeyInput.value = key;
    }

    showNetCreated(roomId) {
        this.netStep1.style.display = 'none';
        this.netStep3.style.display = 'flex';
        this.displayRoomId.innerText = roomId;
        this.netStatus.innerText = "Waiting for player...";
    }

    showNetGameStart(myColor) {
        this.netStatus.innerText = `Game Started! You are ${myColor.toUpperCase()}`;
        this.netStatus.style.color = "#4CAF50";
        this.netStep1.style.display = 'none';
        this.netStep2.style.display = 'none';
        this.netStep3.style.display = 'none';
    }

    updateNetStatus(msg) {
        this.netStatus.innerText = msg;
    }
}