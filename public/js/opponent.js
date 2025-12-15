// VERSION: 5.0.0
// Improved CPU with Minimax and Alpha-Beta Pruning
class ChessAI {
    constructor() {
        // Material Weights
        this.pieceValues = {
            'p': 100, 'n': 320, 'b': 330, 'r': 500, 'q': 900, 'k': 20000
        };

        // --- PIECE SQUARE TABLES (PST) ---
        const pawnTable = [
            0, 0, 0, 0, 0, 0, 0, 0,
            50, 50, 50, 50, 50, 50, 50, 50,
            10, 10, 20, 30, 30, 20, 10, 10,
            5, 5, 10, 25, 25, 10, 5, 5,
            0, 0, 0, 20, 20, 0, 0, 0,
            5, -5, -10, 0, 0, -10, -5, 5,
            5, 10, 10, -20, -20, 10, 10, 5,
            0, 0, 0, 0, 0, 0, 0, 0
        ];

        const knightTable = [
            -50, -40, -30, -30, -30, -30, -40, -50,
            -40, -20, 0, 0, 0, 0, -20, -40,
            -30, 0, 10, 15, 15, 10, 0, -30,
            -30, 5, 15, 20, 20, 15, 5, -30,
            -30, 0, 15, 20, 20, 15, 0, -30,
            -30, 5, 10, 15, 15, 10, 5, -30,
            -40, -20, 0, 5, 5, 0, -20, -40,
            -50, -40, -30, -30, -30, -30, -40, -50
        ];

        const bishopTable = [
            -20, -10, -10, -10, -10, -10, -10, -20,
            -10, 0, 0, 0, 0, 0, 0, -10,
            -10, 0, 5, 10, 10, 5, 0, -10,
            -10, 5, 5, 10, 10, 5, 5, -10,
            -10, 0, 10, 10, 10, 10, 0, -10,
            -10, 10, 10, 10, 10, 10, 10, -10,
            -10, 5, 0, 0, 0, 0, 5, -10,
            -20, -10, -10, -10, -10, -10, -10, -20
        ];

        this.pst = {
            'p': pawnTable,
            'n': knightTable,
            'b': bishopTable
        };
    }

    calculateBestMove(game, difficulty = 'hard') {
        let depth = 3;

        switch (difficulty) {
            case 'easy': depth = 1; break;   // Very shallow, greedy
            case 'normal': depth = 2; break; // Looks 1 turn ahead
            case 'hard': depth = 3; break;   // Looks 1.5 turns ahead
            case 'expert': depth = 4; break; // Looks 2 full turns ahead (slow)
            default: depth = 3;
        }

        const isMaximizing = (game.turn === 'white');

        const result = this.minimaxRoot(game, depth, isMaximizing);
        return result;
    }

    minimaxRoot(game, depth, isMaximizing) {
        const newGameMoves = game.getAllLegalMoves(game.turn);

        newGameMoves.sort(() => Math.random() - 0.5); // Shuffle

        let bestMove = null;
        let bestValue = isMaximizing ? -Infinity : Infinity;

        for (const move of newGameMoves) {
            const gameClone = game.clone();
            gameClone.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');

            const value = this.minimax(gameClone, depth - 1, -Infinity, Infinity, !isMaximizing);

            if (isMaximizing) {
                if (value > bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            } else {
                if (value < bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            }
        }
        return bestMove;
    }

    minimax(game, depth, alpha, beta, isMaximizing) {
        if (depth === 0 || game.gameOver) {
            return this.evaluateBoard(game);
        }

        const newGameMoves = game.getAllLegalMoves(game.turn);

        if (isMaximizing) {
            let maxEval = -Infinity;
            for (const move of newGameMoves) {
                const gameClone = game.clone();
                gameClone.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');

                const evalScore = this.minimax(gameClone, depth - 1, alpha, beta, false);
                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);

                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of newGameMoves) {
                const gameClone = game.clone();
                gameClone.movePiece(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');

                const evalScore = this.minimax(gameClone, depth - 1, alpha, beta, true);
                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);

                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    evaluateBoard(game) {
        if (game.gameOver) {
            if (game.status === 'checkmate') {
                return (game.winner === 'white') ? 100000 : -100000;
            }
            return 0; // Draw
        }

        let score = 0;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = game.board[r][c];
                if (piece !== '') {
                    const type = piece.toLowerCase();
                    const isWhite = (piece === piece.toUpperCase());

                    // Material Value
                    let value = this.pieceValues[type] || 0;

                    // Positional Value (PST)
                    if (this.pst[type]) {
                        const index = isWhite ? (r * 8 + c) : ((7 - r) * 8 + c);
                        value += this.pst[type][index];
                    }

                    score += isWhite ? value : -value;
                }
            }
        }
        return score;
    }
}