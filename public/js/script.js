// VERSION: 0.3.0
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM ELEMENTS ---
    const gameBoard = document.getElementById('chessboard');
    const statusText = document.getElementById('status-text');
    const winnerDisplay = document.getElementById('winner-display');
    const startBtn = document.getElementById('start-btn');
    const resignBtn = document.getElementById('resign-btn');
    const timerWhite = document.getElementById('timer-white');
    const timerBlack = document.getElementById('timer-black');
    const loadingIndicator = document.getElementById('loading-indicator');

    // Graveyard Elements
    const graveyardTop = document.getElementById('graveyard-top');
    const graveyardBottom = document.getElementById('graveyard-bottom');

    // Modal Elements
    const restoreModal = document.getElementById('restore-modal');
    const restoreYesBtn = document.getElementById('restore-yes');
    const restoreNoBtn = document.getElementById('restore-no');

    // Settings Inputs (Radios)
    const radioHuman = document.getElementById('vs-human');
    const radioCpu = document.getElementById('vs-cpu');
    const radioLlm = document.getElementById('vs-llm');
    const radioP2P = document.getElementById('vs-p2p');

    const llmSettingsDiv = document.getElementById('llm-settings');
    const p2pPanel = document.getElementById('p2p-panel');

    // LLM Inputs
    const llmUrlInput = document.getElementById('llm-url');
    const llmModelSelect = document.getElementById('llm-model');
    const refreshModelsBtn = document.getElementById('refresh-models-btn');
    const llmKeyInput = document.getElementById('llm-key');

    // Network / Socket Inputs
    const netCreateBtn = document.getElementById('net-create-btn');
    const netJoinModeBtn = document.getElementById('net-join-mode-btn');
    const netRoomInput = document.getElementById('net-room-input');
    const netJoinBtn = document.getElementById('net-join-btn');
    const netStatus = document.getElementById('net-status');
    const netStep1 = document.getElementById('net-step-1');
    const netStep2 = document.getElementById('net-step-2');
    const netStep3 = document.getElementById('net-step-3');
    const displayRoomId = document.getElementById('display-room-id');

    // --- GAME LOGIC OBJECTS ---
    const game = new ChessGame();
    let basicAI;
    let llmAI;
    let netGame;

    // Initialize Sub-modules safely
    try {
        basicAI = new ChessAI();
    } catch (e) {
        console.error("Basic AI missing");
    }

    // Initialize Network Game with Callbacks
    try {
        netGame = new NetworkGame({
            onMove: (move) => {
                // Opponent moved (Network -> Local)
                game.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol);
                handleTurnSwitch(false); // false = do not send back to network
            },
            onSync: (state) => {
                game.fromJSON(state);
                createBoard();
                if (netGame.myColor === 'black' && !isGameStarted) {
                    // Initial sync for guest
                }
            },
            onGameStart: (myColor) => {
                isGameStarted = true;
                netGame.myColor = myColor;
                myNetColor = myColor;

                game.initBoard(); // Ensure fresh board
                clock.reset();
                clock.start('white');
                createBoard();

                netStatus.innerText = `Game Started! You are ${myNetColor.toUpperCase()}`;
                netStatus.style.color = "#4CAF50";

                // Hide Setup UI
                netStep1.style.display = 'none';
                netStep2.style.display = 'none';
                netStep3.style.display = 'none';
            },
            onRoomCreated: (roomId) => {
                netStep1.style.display = 'none';
                netStep3.style.display = 'flex';
                displayRoomId.innerText = roomId;
                netStatus.innerText = "Waiting for player...";
            },
            onResign: (color) => {
                alert(`Opponent (${color}) Resigned!`);
                game.resign(color);
                clock.stop();
                createBoard();
            },
            onStatus: (msg) => {
                netStatus.innerText = msg;
            }
        });
    } catch (e) {
        console.error("Network module missing", e);
    }

    const clock = new ChessClock(10, (loserColor) => {
        game.timeoutLoss(loserColor);
        saveGameSession();
        updateUI();
    });

    // --- GLOBAL STATE ---
    let isGameStarted = false;
    let opponentMode = 'human'; // 'human', 'cpu', 'llm', 'p2p'
    let selectedSquare = null;
    let isProcessingMove = false;
    let myNetColor = 'white'; // Default, changes in P2P

    const pieceSymbols = {
        'r': '♜\uFE0E', 'n': '♞\uFE0E', 'b': '♝\uFE0E', 'q': '♛\uFE0E', 'k': '♚\uFE0E', 'p': '♟\uFE0E',
        'R': '♜\uFE0E', 'N': '♞\uFE0E', 'B': '♝\uFE0E', 'Q': '♛\uFE0E', 'K': '♚\uFE0E', 'P': '♟\uFE0E'
    };

    // --- SETTINGS & VISIBILITY ---

    function updateSettingsVisibility() {
        llmSettingsDiv.style.display = 'none';
        p2pPanel.style.display = 'none';

        if (radioLlm.checked) llmSettingsDiv.style.display = 'flex';
        if (radioP2P.checked) p2pPanel.style.display = 'flex';
    }

    // Attach Listeners
    if (radioHuman) radioHuman.addEventListener('change', () => { updateSettingsVisibility(); opponentMode = 'human'; saveSettings(); });
    if (radioCpu) radioCpu.addEventListener('change', () => { updateSettingsVisibility(); opponentMode = 'cpu'; saveSettings(); });
    if (radioLlm) radioLlm.addEventListener('change', () => { updateSettingsVisibility(); opponentMode = 'llm'; saveSettings(); });
    if (radioP2P) radioP2P.addEventListener('change', () => { updateSettingsVisibility(); opponentMode = 'p2p'; saveSettings(); });

    llmUrlInput.addEventListener('input', saveSettings);
    llmKeyInput.addEventListener('input', saveSettings);
    llmModelSelect.addEventListener('change', saveSettings);

    // --- NETWORK UI HANDLERS ---

    if (netCreateBtn) {
        netCreateBtn.addEventListener('click', () => {
            netGame.createRoom();
        });
    }

    if (netJoinModeBtn) {
        netJoinModeBtn.addEventListener('click', () => {
            netStep1.style.display = 'none';
            netStep2.style.display = 'flex';
        });
    }

    if (netJoinBtn) {
        netJoinBtn.addEventListener('click', () => {
            const roomId = netRoomInput.value.trim();
            if (roomId) {
                netGame.joinRoom(roomId);
            }
        });
    }

    // --- BOARD INTERACTION ---

    function onSquareClick(row, col) {
        if (!isGameStarted || game.gameOver || isProcessingMove) return;

        // BLOCKING LOGIC
        // 1. CPU/LLM: Block Black inputs
        if ((opponentMode === 'cpu' || opponentMode === 'llm') && game.turn === 'black') return;

        // 2. P2P: Block if turn doesn't match our color
        if (opponentMode === 'p2p') {
            if (game.turn !== myNetColor) return;
        }

        if (!selectedSquare) {
            // Select Piece
            const piece = game.getPieceAt(row, col);
            if (piece !== '') {
                const pieceColor = (piece === piece.toUpperCase()) ? 'white' : 'black';
                if (pieceColor === game.turn) {
                    selectedSquare = { row, col };
                    createBoard();
                }
            }
        } else {
            // Move Piece
            if (selectedSquare.row === row && selectedSquare.col === col) {
                selectedSquare = null; // Deselect
            } else {
                const moveData = { fromRow: selectedSquare.row, fromCol: selectedSquare.col, toRow: row, toCol: col };
                const success = game.movePiece(moveData.fromRow, moveData.fromCol, moveData.toRow, moveData.toCol);

                if (success) {
                    selectedSquare = null;

                    // If P2P, broadcast move
                    if (opponentMode === 'p2p' && netGame) {
                        netGame.sendMove(moveData);
                    }

                    handleTurnSwitch(true); // true = trigger AI if applicable
                } else {
                    // Invalid move, check if switching selection
                    const piece = game.getPieceAt(row, col);
                    if (piece) {
                        const pieceColor = (piece === piece.toUpperCase()) ? 'white' : 'black';
                        if (pieceColor === game.turn) selectedSquare = { row, col };
                    }
                }
            }
            createBoard();
        }
    }

    // --- GAME LOOP & AI ---

    function handleTurnSwitch(triggerAI = true) {
        createBoard();
        saveGameSession(); // Autosave

        if (game.gameOver) { clock.stop(); return; }
        clock.start(game.turn);

        // AI Triggers
        if (triggerAI && game.turn === 'black') {
            if (opponentMode === 'cpu') {
                isProcessingMove = true;
                setTimeout(runBasicCPU, 500);
            }
            else if (opponentMode === 'llm') {
                isProcessingMove = true;
                loadingIndicator.style.display = 'block';
                setTimeout(runLLMAgent, 100);
            }
        }
    }

    function runBasicCPU() {
        if (game.gameOver) return;
        const move = basicAI.calculateBestMove(game);
        if (move) {
            game.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol);
        }
        isProcessingMove = false;
        handleTurnSwitch();
    }

    async function runLLMAgent() {
        if (game.gameOver) return;

        const move = await llmAI.getBestMove(game);

        if (move) {
            const success = game.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol);
            if (!success) {
                console.warn("LLM illegal move, fallback to CPU.");
                runBasicCPU();
                return;
            }
        } else {
            console.warn("LLM API failed, fallback to CPU.");
            runBasicCPU();
            return;
        }

        loadingIndicator.style.display = 'none';
        isProcessingMove = false;
        handleTurnSwitch();
    }

    // --- BUTTONS ---

    startBtn.addEventListener('click', () => {
        if (opponentMode === 'p2p') {
            alert("For Online Play, use the connection panel above.");
            return;
        }

        game.initBoard();
        clock.reset();
        selectedSquare = null;
        localStorage.removeItem('chess_active_session'); // Clear old session

        // Init LLM if needed
        if (opponentMode === 'llm') {
            try {
                const url = llmUrlInput.value || 'http://localhost:3000/api/chat/completions';
                const model = llmModelSelect.value || 'llama3:latest';
                const key = llmKeyInput.value || '';
                llmAI = new LLMPlayer(url, model, key);
            } catch (e) {
                alert("LLM Player script missing!");
                opponentMode = 'cpu';
            }
        }

        isGameStarted = true;
        startBtn.disabled = true;
        resignBtn.disabled = false;

        clock.start('white');
        createBoard();
        saveGameSession();
    });

    resignBtn.addEventListener('click', () => {
        if (isGameStarted && !game.gameOver) {
            let colorToResign = game.turn;
            // In Single/AI modes, button is always White
            if (opponentMode === 'cpu' || opponentMode === 'llm') colorToResign = 'white';
            // In P2P, button is My Color
            if (opponentMode === 'p2p') colorToResign = myNetColor;

            game.resign(colorToResign);

            if (opponentMode === 'p2p' && netGame) {
                netGame.sendResign();
            }

            clock.stop();
            createBoard();
        }
    });

    // --- RENDERERS ---

    function createBoard() {
        gameBoard.innerHTML = '';
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.classList.add('square');

                if ((row + col) % 2 === 0) square.classList.add('white-marble');
                else square.classList.add('black-marble');

                square.dataset.row = row;
                square.dataset.col = col;

                const pieceCode = game.getPieceAt(row, col);
                if (pieceCode !== '') {
                    const pieceElement = document.createElement('div');
                    pieceElement.classList.add('piece');
                    pieceElement.innerText = pieceSymbols[pieceCode];

                    if (pieceCode === pieceCode.toUpperCase()) pieceElement.classList.add('white');
                    else pieceElement.classList.add('black');
                    square.appendChild(pieceElement);
                }

                if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
                    square.classList.add('selected');
                }

                square.addEventListener('click', () => onSquareClick(row, col));
                gameBoard.appendChild(square);
            }
        }
        updateUI();
        updateGraveyards();
    }

    function updateGraveyards() {
        graveyardTop.innerHTML = '';
        graveyardBottom.innerHTML = '';

        game.capturedWhite.forEach(p => {
            const el = document.createElement('div');
            el.className = 'piece white';
            el.innerText = pieceSymbols[p];
            graveyardTop.appendChild(el);
        });

        game.capturedBlack.forEach(p => {
            const el = document.createElement('div');
            el.className = 'piece black';
            el.innerText = pieceSymbols[p];
            graveyardBottom.appendChild(el);
        });
    }

    // --- UI LOOP ---
    setInterval(updateUI, 100);

    function updateUI() {
        timerWhite.innerText = clock.getTimeString('white');
        timerBlack.innerText = clock.getTimeString('black');

        if (isGameStarted && !game.gameOver) {
            if (game.turn === 'white') {
                timerWhite.classList.add('active');
                timerBlack.classList.remove('active');
            } else {
                timerWhite.classList.remove('active');
                timerBlack.classList.add('active');
            }
        } else {
            timerWhite.classList.remove('active');
            timerBlack.classList.remove('active');
        }

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

            statusText.innerText = "Game Over";
            winnerDisplay.innerText = msg;

            startBtn.innerText = "New Game";
            startBtn.disabled = false;
            resignBtn.disabled = true;
            isGameStarted = false;
            isProcessingMove = false;
            loadingIndicator.style.display = 'none';
            localStorage.removeItem('chess_active_session');
        } else {
            if (isGameStarted) {
                const turnColor = game.turn.charAt(0).toUpperCase() + game.turn.slice(1);
                statusText.innerText = `${turnColor}'s Turn`;
            } else {
                statusText.innerText = "Ready to Play";
            }
            if (game.isKingInCheck(game.turn)) winnerDisplay.innerText = "CHECK!";
            else winnerDisplay.innerText = "";
        }
    }

    // --- STORAGE ---

    function saveSettings() {
        localStorage.setItem('chess_llm_url', llmUrlInput.value);
        localStorage.setItem('chess_llm_key', llmKeyInput.value);
        localStorage.setItem('chess_llm_model', llmModelSelect.value);

        let mode = 'human';
        if (radioCpu.checked) mode = 'cpu';
        if (radioLlm.checked) mode = 'llm';
        if (radioP2P.checked) mode = 'p2p';
        localStorage.setItem('chess_opponent_mode', mode);
    }

    function loadSettings() {
        const savedUrl = localStorage.getItem('chess_llm_url');
        const savedKey = localStorage.getItem('chess_llm_key');
        if (savedUrl) llmUrlInput.value = savedUrl;
        if (savedKey) llmKeyInput.value = savedKey;

        const savedModel = localStorage.getItem('chess_llm_model');
        if (savedModel) {
            let exists = false;
            for (let i = 0; i < llmModelSelect.options.length; i++) {
                if (llmModelSelect.options[i].value === savedModel) exists = true;
            }
            if (!exists) {
                const option = document.createElement('option');
                option.value = savedModel;
                option.text = savedModel;
                llmModelSelect.add(option);
            }
            llmModelSelect.value = savedModel;
        }

        const savedMode = localStorage.getItem('chess_opponent_mode');
        if (savedMode === 'cpu') radioCpu.checked = true;
        else if (savedMode === 'llm') radioLlm.checked = true;
        else if (savedMode === 'p2p') radioP2P.checked = true;
        else radioHuman.checked = true;

        // Update local var from loaded value
        opponentMode = savedMode || 'human';
        updateSettingsVisibility();
    }

    function saveGameSession() {
        if (!isGameStarted) return;
        const session = {
            game: game.toJSON(),
            whiteTime: clock.whiteTime,
            blackTime: clock.blackTime,
            opponentMode: opponentMode
        };
        localStorage.setItem('chess_active_session', JSON.stringify(session));
    }

    function checkSavedSession() {
        const raw = localStorage.getItem('chess_active_session');
        if (!raw) return;

        const session = JSON.parse(raw);
        if (session.game && !session.game.gameOver) {
            restoreModal.style.display = 'flex';
        } else {
            localStorage.removeItem('chess_active_session');
        }
    }

    function restoreSession() {
        const raw = localStorage.getItem('chess_active_session');
        if (!raw) return;
        const session = JSON.parse(raw);

        game.fromJSON(session.game);
        clock.whiteTime = session.whiteTime;
        clock.blackTime = session.blackTime;
        opponentMode = session.opponentMode;

        // Restore UI Radio
        if (opponentMode === 'cpu') radioCpu.checked = true;
        else if (opponentMode === 'llm') radioLlm.checked = true;
        else if (opponentMode === 'p2p') radioP2P.checked = true;
        else radioHuman.checked = true;

        // Restore LLM instance
        if (opponentMode === 'llm') {
            try {
                const url = llmUrlInput.value;
                const model = llmModelSelect.value;
                const key = llmKeyInput.value;
                llmAI = new LLMPlayer(url, model, key);
            } catch (e) { }
        }

        isGameStarted = true;
        startBtn.disabled = true;
        resignBtn.disabled = false;

        createBoard();
        updateSettingsVisibility();

        if (!game.gameOver) {
            clock.start(game.turn);
            // Trigger AI if it was their turn
            if (game.turn === 'black' && (opponentMode === 'cpu' || opponentMode === 'llm')) {
                handleTurnSwitch();
            }
        }
    }

    // --- MODAL EVENTS ---
    if (restoreYesBtn) {
        restoreYesBtn.addEventListener('click', () => {
            restoreModal.style.display = 'none';
            restoreSession();
        });
    }

    if (restoreNoBtn) {
        restoreNoBtn.addEventListener('click', () => {
            restoreModal.style.display = 'none';
            localStorage.removeItem('chess_active_session');
        });
    }

    // --- FETCH MODELS ---
    if (refreshModelsBtn) {
        refreshModelsBtn.addEventListener('click', async () => {
            const fullUrl = llmUrlInput.value;
            const apiKey = llmKeyInput.value;
            let modelsUrl = '';
            try {
                const urlObj = new URL(fullUrl);
                if (fullUrl.includes('/chat/completions')) {
                    modelsUrl = `${urlObj.origin}/api/models`;
                } else {
                    modelsUrl = `${urlObj.origin}/api/models`;
                }

                refreshModelsBtn.innerText = '...';

                const headers = {};
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

                const res = await fetch(modelsUrl, { headers });
                if (!res.ok) throw new Error('Failed to fetch');

                const json = await res.json();
                const models = json.data || [];

                llmModelSelect.innerHTML = '';

                if (models.length === 0) {
                    const option = document.createElement('option');
                    option.text = "No models found";
                    llmModelSelect.add(option);
                } else {
                    models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id;
                        option.text = model.id;
                        option.title = model.id; // Tooltip
                        llmModelSelect.add(option);
                    });
                }

                // Restore previous selection if exists
                const savedModel = localStorage.getItem('chess_llm_model');
                if (savedModel && Array.from(llmModelSelect.options).some(o => o.value === savedModel)) {
                    llmModelSelect.value = savedModel;
                } else {
                    if (models.length > 0) saveSettings();
                }

                refreshModelsBtn.innerText = '✓';
                setTimeout(() => refreshModelsBtn.innerText = '↻', 2000);

            } catch (e) {
                console.error(e);
                refreshModelsBtn.innerText = '❌';
                alert("Could not fetch models.");
                setTimeout(() => refreshModelsBtn.innerText = '↻', 2000);
            }
        });
    }

    // INIT
    loadSettings();
    createBoard();
    checkSavedSession();
});