// VERSION: 5.1.0
document.addEventListener('DOMContentLoaded', () => {

    const ui = new ChessUI();
    const storage = new GameStorage();
    const game = new ChessGame();

    // Sub-modules
    let basicAI;
    let llmAI;
    let netGame;
    let opponentMode = 'human';
    let isGameStarted = false;
    let myNetColor = 'white';
    let isProcessingMove = false;
    let selectedSquare = null;

    // --- INITIALIZATION ---
    try { basicAI = new ChessAI(); } catch (e) { console.error("Basic AI missing"); }

    const clock = new ChessClock(10, (loserColor) => {
        game.timeoutLoss(loserColor);
        storage.saveSession(game, clock, opponentMode);
        triggerSound('gameOver');
        updateAll();
    });

    // --- AUDIO HELPER ---
    function triggerSound(type) {
        if (!type) {
            if (game.gameOver) type = 'gameOver';
            else if (game.lastMove.check) type = 'check';
            else if (game.lastMove.captured) type = 'capture';
            else type = 'move';
        }
        ui.playSound(type);
    }

    // --- NETWORK SETUP ---
    try {
        netGame = new NetworkGame({
            onMove: (move) => {
                if (move.ply <= game.ply) {
                    console.warn("Ignored duplicate/old move packet", move.ply, game.ply);
                    return;
                }
                game.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol, move.promoteTo || 'q');
                triggerSound();
                handleTurnSwitch(false);
            },
            onSync: (state) => {
                game.fromJSON(state);
                ui.createBoard(game, selectedSquare, onSquareClick);
                if (game.gameOver) updateAll();
            },
            onGameStart: (myColor) => {
                isGameStarted = true;
                netGame.myColor = myColor;
                myNetColor = myColor;
                game.initBoard();
                clock.reset();
                clock.start('white');
                ui.createBoard(game, selectedSquare, onSquareClick);
                ui.showNetGameStart(myColor);
                ui.setGameActive(true);
                ui.playSound('gameStart');
            },
            onRoomCreated: (roomId) => {
                ui.showNetCreated(roomId);
            },
            onResign: (color) => {
                alert(`Opponent (${color}) Resigned!`);
                game.resign(color);
                clock.stop();
                updateAll();
                ui.playSound('gameOver');
            },
            onDrawOffered: () => {
                ui.showDrawModal();
            },
            onDrawDeclined: () => {
                alert("Opponent declined the draw.");
            },
            onOpponentStatus: (data) => {
                if (data.status === 'disconnected') {
                    ui.startDisconnectTimer(data.timeout);
                } else if (data.status === 'connected') {
                    ui.clearDisconnectTimer();
                }
            },
            onGameAbandoned: (data) => {
                game.gameOver = true;
                game.winner = data.winner;
                game.status = `timeout (${data.reason})`;
                clock.stop();
                updateAll();
                ui.playSound('gameOver');
            },
            onSpectatorMode: () => {
                isGameStarted = true;
                myNetColor = 'spectator';
                ui.setSpectatorMode();
                ui.createBoard(game, selectedSquare, onSquareClick);
            },
            onStatus: (msg) => {
                ui.updateNetStatus(msg);
            }
        });
    } catch (e) { console.error("Network module missing"); }

    // --- EVENT BINDINGS ---
    ui.bindCopyFen(game);
    ui.bindFlipBoard(() => {
        ui.createBoard(game, selectedSquare, onSquareClick);
    });

    // NEW: README
    ui.bindShowReadme();

    ui.bindStart(() => {
        if (opponentMode === 'p2p') {
            alert("For Online Play, use the connection panel above.");
            return;
        }
        game.initBoard();
        clock.reset();
        selectedSquare = null;
        storage.clearSession();

        if (opponentMode === 'llm') {
            const config = ui.getLLMConfig();
            llmAI = new LLMPlayer(config.url || 'http://localhost:3000/api/chat/completions', config.model, config.key);
        }

        isGameStarted = true;
        ui.setGameActive(true);
        clock.start('white');
        updateAll();
        storage.saveSession(game, clock, opponentMode);
        ui.playSound('gameStart');
    });

    ui.bindResign(() => {
        if (isGameStarted && !game.gameOver) {
            let colorToResign = game.turn;
            if (opponentMode === 'cpu' || opponentMode === 'llm') colorToResign = 'white';
            if (opponentMode === 'p2p') colorToResign = myNetColor;

            game.resign(colorToResign);
            if (opponentMode === 'p2p' && netGame) netGame.sendResign();

            clock.stop();
            updateAll();
            ui.playSound('gameOver');
        }
    });

    ui.bindDraw(() => {
        if (!isGameStarted || game.gameOver) return;

        if (opponentMode === 'p2p') {
            netGame.sendDrawOffer();
            ui.drawBtn.disabled = true;
            ui.drawBtn.innerText = "Sent...";
            setTimeout(() => {
                ui.drawBtn.disabled = false;
                ui.drawBtn.innerText = "Draw";
            }, 3000);
        } else {
            alert("Draws not yet supported against AI.");
        }
    });

    ui.bindDrawResponses(
        () => { // Accept
            netGame.sendDrawResponse(true);
        },
        () => { // Decline
            netGame.sendDrawResponse(false);
        }
    );

    ui.bindOpponentChange(() => {
        ui.updateSettingsVisibility();
        opponentMode = ui.getOpponentMode();
        storage.saveSettings(ui);
    });

    ui.bindSettingsChange(() => {
        storage.saveSettings(ui);
    });

    // P2P Events
    ui.bindNetCreate(() => netGame.createRoom());
    ui.bindNetJoinMode(() => { });
    ui.bindNetConnect((roomId) => {
        if (roomId) netGame.joinRoom(roomId);
    });

    // Models Refresh
    ui.bindRefreshModels(async () => {
        const config = ui.getLLMConfig();
        const fullUrl = config.url;
        ui.refreshModelsBtn.innerText = '...';

        try {
            const urlObj = new URL(fullUrl);
            const modelsUrl = `${urlObj.origin}/api/models`;
            const headers = {};
            if (config.key) headers['Authorization'] = `Bearer ${config.key}`;

            const res = await fetch(modelsUrl, { headers });
            if (!res.ok) throw new Error('Failed to fetch');
            const json = await res.json();
            const models = json.data || [];

            ui.populateModels(models, localStorage.getItem('chess_llm_model'));
            storage.saveSettings(ui);

            ui.refreshModelsBtn.innerText = '✓';
            setTimeout(() => ui.refreshModelsBtn.innerText = '↻', 2000);
        } catch (e) {
            console.error(e);
            ui.refreshModelsBtn.innerText = '❌';
            setTimeout(() => ui.refreshModelsBtn.innerText = '↻', 2000);
        }
    });

    // Restore Session Events
    ui.bindRestore(
        () => { // Yes
            const session = storage.loadSession();
            game.fromJSON(session.game);
            clock.whiteTime = session.whiteTime;
            clock.blackTime = session.blackTime;
            opponentMode = session.opponentMode;

            ui.setOpponentMode(opponentMode);
            if (opponentMode === 'llm') {
                const config = ui.getLLMConfig();
                llmAI = new LLMPlayer(config.url, config.model, config.key);
            }

            isGameStarted = true;
            ui.setGameActive(true);
            updateAll();

            if (!game.gameOver) {
                clock.start(game.turn);
                if (game.turn === 'black' && (opponentMode === 'cpu' || opponentMode === 'llm')) {
                    handleTurnSwitch();
                }
            }
        },
        () => { // No
            storage.clearSession();
        }
    );

    // --- GAME LOGIC ---

    function onSquareClick(row, col) {
        if (!isGameStarted || game.gameOver || isProcessingMove) return;

        // Spectator Block
        if (myNetColor === 'spectator') return;

        // Turn Block
        if ((opponentMode === 'cpu' || opponentMode === 'llm') && game.turn === 'black') return;
        if (opponentMode === 'p2p' && game.turn !== myNetColor) return;

        if (!selectedSquare) {
            const piece = game.getPieceAt(row, col);
            if (piece !== '') {
                const pieceColor = (piece === piece.toUpperCase()) ? 'white' : 'black';
                if (pieceColor === game.turn) {
                    selectedSquare = { row, col };
                    ui.createBoard(game, selectedSquare, onSquareClick);
                }
            }
        } else {
            if (selectedSquare.row === row && selectedSquare.col === col) {
                selectedSquare = null; // Deselect
                ui.createBoard(game, selectedSquare, onSquareClick);
            } else {
                // Attempt Move
                const moveData = { fromRow: selectedSquare.row, fromCol: selectedSquare.col, toRow: row, toCol: col };

                // Check for Promotion
                const piece = game.getPieceAt(moveData.fromRow, moveData.fromCol);
                const isPawn = piece.toLowerCase() === 'p';
                const isLastRank = (game.turn === 'white' && row === 0) || (game.turn === 'black' && row === 7);

                if (isPawn && isLastRank) {
                    ui.showPromotionModal(game.turn, (chosenPiece) => {
                        executeMove(moveData, chosenPiece);
                    });
                } else {
                    executeMove(moveData, 'q');
                }
            }
        }
    }

    function executeMove(moveData, promoteTo) {
        const success = game.movePiece(moveData.fromRow, moveData.fromCol, moveData.toRow, moveData.toCol, promoteTo);

        if (success) {
            selectedSquare = null;

            if (moveData.toRow === 0 || moveData.toRow === 7) {
                const piece = game.getPieceAt(moveData.toRow, moveData.toCol);
                if (piece.toLowerCase() !== 'p') ui.playSound('promote');
                else triggerSound();
            } else {
                triggerSound();
            }

            if (opponentMode === 'p2p' && netGame) {
                moveData.promoteTo = promoteTo;
                netGame.sendMove(moveData);
            }
            handleTurnSwitch(true);
        } else {
            const targetPiece = game.getPieceAt(moveData.toRow, moveData.toCol);
            if (targetPiece) {
                const pieceColor = (targetPiece === targetPiece.toUpperCase()) ? 'white' : 'black';
                if (pieceColor === game.turn) {
                    selectedSquare = { row: moveData.toRow, col: moveData.toCol };
                }
            }
            ui.createBoard(game, selectedSquare, onSquareClick);
        }
    }

    function handleTurnSwitch(triggerAI = true) {
        ui.createBoard(game, selectedSquare, onSquareClick);
        storage.saveSession(game, clock, opponentMode);

        if (game.gameOver) {
            clock.stop();
            ui.updateStatus(game);
            return;
        }

        clock.start(game.turn);

        if (triggerAI && game.turn === 'black') {
            if (opponentMode === 'cpu') {
                isProcessingMove = true;

                // If expert, we might want to show loading to indicate it's thinking harder
                const difficulty = ui.getDifficulty();
                if (difficulty === 'expert') {
                    ui.setBoardLocked(true);
                    ui.setLoading(true);
                }

                setTimeout(runBasicCPU, 100);
            }
            else if (opponentMode === 'llm') {
                isProcessingMove = true;
                ui.setBoardLocked(true);
                ui.setLoading(true);
                setTimeout(runLLMAgent, 100);
            }
        }
    }

    function runBasicCPU() {
        if (game.gameOver) return;

        const difficulty = ui.getDifficulty();
        const move = basicAI.calculateBestMove(game, difficulty);

        if (move) {
            game.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');
            triggerSound();
        }

        // Unblock if expert mode locked it
        ui.setBoardLocked(false);
        ui.setLoading(false);

        isProcessingMove = false;
        handleTurnSwitch();
    }

    async function runLLMAgent() {
        if (game.gameOver) return;
        const move = await llmAI.getBestMove(game);
        if (move) {
            const success = game.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');
            if (success) triggerSound();
            else runBasicCPU();
        } else {
            runBasicCPU();
        }
        ui.setBoardLocked(false);
        ui.setLoading(false);
        isProcessingMove = false;
        handleTurnSwitch();
    }

    function updateAll() {
        ui.updateTimers(clock, isGameStarted, game.gameOver, game.turn);
        ui.updateStatus(game);
        ui.createBoard(game, selectedSquare, onSquareClick);
    }

    // --- STARTUP ---
    storage.loadSettings(ui);
    opponentMode = ui.getOpponentMode();
    ui.createBoard(game, selectedSquare, onSquareClick);

    // UI Update Loop
    setInterval(() => {
        ui.updateTimers(clock, isGameStarted, game.gameOver, game.turn);
    }, 100);

    // AUTO REJOIN LOGIC
    if (opponentMode === 'p2p') {
        const lastRoom = localStorage.getItem('chess_last_room');
        if (lastRoom) {
            console.log("Attempting auto-reconnect to room:", lastRoom);
            ui.netRoomInput.value = lastRoom;
            netGame.joinRoom(lastRoom);
            ui.netStep1.style.display = 'none';
            ui.netStep2.style.display = 'flex';
        }
    } else if (storage.hasSavedSession()) {
        ui.restoreModal.style.display = 'flex';
    }
});