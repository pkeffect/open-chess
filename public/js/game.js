// VERSION: 4.1.0
class ChessGame {
    constructor() {
        this.initBoard();
    }

    initBoard() {
        this.board = [
            ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
            ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
            ['', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', ''],
            ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
            ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ];
        this.turn = 'white';
        this.gameOver = false;
        this.status = 'active';
        this.winner = null;
        this.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
        this.enPassantTarget = null;
        this.halfMoveClock = 0;
        this.fullMoveNumber = 1;
        this.ply = 0; // Total half-moves played (0-indexed)

        this.moveHistory = [];
        this.pgnHistory = [];
        this.lastMove = null;

        this.capturedWhite = [];
        this.capturedBlack = [];

        this.recordBoardState();
    }

    // --- DEEP COPY FOR AI ---
    clone() {
        const newGame = new ChessGame();
        newGame.board = this.board.map(row => [...row]);
        newGame.turn = this.turn;
        newGame.gameOver = this.gameOver;
        newGame.status = this.status;
        newGame.winner = this.winner;
        newGame.castling = {
            w: { k: this.castling.w.k, q: this.castling.w.q },
            b: { k: this.castling.b.k, q: this.castling.b.q }
        };
        newGame.enPassantTarget = this.enPassantTarget ? { ...this.enPassantTarget } : null;
        newGame.halfMoveClock = this.halfMoveClock;
        newGame.fullMoveNumber = this.fullMoveNumber;
        newGame.ply = this.ply;
        return newGame;
    }

    toJSON() {
        return {
            board: this.board,
            turn: this.turn,
            gameOver: this.gameOver,
            status: this.status,
            winner: this.winner,
            castling: this.castling,
            enPassantTarget: this.enPassantTarget,
            halfMoveClock: this.halfMoveClock,
            fullMoveNumber: this.fullMoveNumber,
            ply: this.ply,
            moveHistory: this.moveHistory,
            pgnHistory: this.pgnHistory,
            capturedWhite: this.capturedWhite,
            capturedBlack: this.capturedBlack,
            lastMove: this.lastMove
        };
    }

    fromJSON(data) {
        this.board = data.board;
        this.turn = data.turn;
        this.gameOver = data.gameOver;
        this.status = data.status;
        this.winner = data.winner;
        this.castling = data.castling;
        this.enPassantTarget = data.enPassantTarget;
        this.halfMoveClock = data.halfMoveClock;
        this.fullMoveNumber = data.fullMoveNumber;
        this.ply = data.ply || 0;
        this.moveHistory = data.moveHistory;
        this.pgnHistory = data.pgnHistory || [];
        this.capturedWhite = data.capturedWhite || [];
        this.capturedBlack = data.capturedBlack || [];
        this.lastMove = data.lastMove || null;
    }

    getPieceAt(row, col) { return this.board[row][col]; }

    movePiece(fromRow, fromCol, toRow, toCol, promoteTo = 'q') {
        if (this.gameOver) return false;

        const piece = this.board[fromRow][fromCol];
        if (!piece) return false;
        const pieceType = piece.toLowerCase();
        const pieceColor = (piece === piece.toUpperCase()) ? 'white' : 'black';

        if (pieceColor !== this.turn) return false;

        const moveType = this.getMoveType(piece, fromRow, fromCol, toRow, toCol);
        if (moveType === 'invalid') return false;

        if (this.wouldCauseCheck(fromRow, fromCol, toRow, toCol, moveType, pieceColor)) {
            return false;
        }

        const target = this.board[toRow][toCol];
        let captured = false;

        const notation = this.getNotation(piece, fromRow, fromCol, toRow, toCol, target !== '', moveType);

        if (target !== '') {
            captured = true;
            if (this.getPieceColor(target) === 'white') this.capturedWhite.push(target);
            else this.capturedBlack.push(target);
        }

        if (pieceType === 'p' || target !== '') this.halfMoveClock = 0;
        else this.halfMoveClock++;

        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = '';

        if (moveType === 'castling-king') {
            this.board[fromRow][5] = this.board[fromRow][7];
            this.board[fromRow][7] = '';
        } else if (moveType === 'castling-queen') {
            this.board[fromRow][3] = this.board[fromRow][0];
            this.board[fromRow][0] = '';
        } else if (moveType === 'en-passant') {
            const captureRow = fromRow;
            const epPawn = this.board[captureRow][toCol];
            if (epPawn) {
                captured = true;
                if (this.getPieceColor(epPawn) === 'white') this.capturedWhite.push(epPawn);
                else this.capturedBlack.push(epPawn);
            }
            this.board[captureRow][toCol] = '';
        }

        this.updateCastlingRights(piece, fromRow, fromCol);

        if (pieceType === 'p' && Math.abs(toRow - fromRow) === 2) {
            this.enPassantTarget = { row: (fromRow + toRow) / 2, col: fromCol };
        } else {
            this.enPassantTarget = null;
        }

        if (pieceType === 'p') {
            const endRow = (pieceColor === 'white') ? 0 : 7;
            if (toRow === endRow) {
                let newPiece = promoteTo.toLowerCase();
                const validPromotions = ['q', 'r', 'b', 'n'];
                if (!validPromotions.includes(newPiece)) newPiece = 'q';
                this.board[toRow][toCol] = (pieceColor === 'white') ? newPiece.toUpperCase() : newPiece;
            }
        }

        if (this.turn === 'black') this.fullMoveNumber++;
        this.turn = (this.turn === 'white') ? 'black' : 'white';
        this.ply++; // Increment ply

        this.recordBoardState();
        this.pgnHistory.push(notation);

        this.checkGameState();

        this.lastMove = {
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol },
            captured: captured,
            check: this.isKingInCheck(this.turn),
            moveType: moveType
        };

        if (this.status === 'checkmate') this.pgnHistory[this.pgnHistory.length - 1] += '#';
        else if (this.isKingInCheck(this.turn)) this.pgnHistory[this.pgnHistory.length - 1] += '+';

        return true;
    }

    getNotation(piece, r1, c1, r2, c2, isCapture, moveType) {
        if (moveType === 'castling-king') return "O-O";
        if (moveType === 'castling-queen') return "O-O-O";

        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        const pType = piece.toLowerCase();

        let str = "";

        if (pType !== 'p') {
            str += pType.toUpperCase();
        }

        if (isCapture) {
            if (pType === 'p') str += files[c1];
            str += "x";
        }

        str += files[c2] + ranks[r2];
        return str;
    }

    hasLegalMoves(color) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && this.getPieceColor(p) === color) {
                    for (let tr = 0; tr < 8; tr++) {
                        for (let tc = 0; tc < 8; tc++) {
                            const type = this.getMoveType(p, r, c, tr, tc);
                            if (type !== 'invalid') {
                                if (!this.wouldCauseCheck(r, c, tr, tc, type, color)) return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    getAllLegalMoves(color) {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && this.getPieceColor(p) === color) {
                    for (let tr = 0; tr < 8; tr++) {
                        for (let tc = 0; tc < 8; tc++) {
                            const type = this.getMoveType(p, r, c, tr, tc);
                            if (type !== 'invalid') {
                                if (!this.wouldCauseCheck(r, c, tr, tc, type, color)) {
                                    moves.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc });
                                }
                            }
                        }
                    }
                }
            }
        }
        return moves;
    }

    toFEN() {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let emptyCount = 0;
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece === '') {
                    emptyCount++;
                } else {
                    if (emptyCount > 0) { fen += emptyCount; emptyCount = 0; }
                    fen += piece;
                }
            }
            if (emptyCount > 0) fen += emptyCount;
            if (r < 7) fen += '/';
        }
        fen += ` ${this.turn.charAt(0)}`;
        let castling = '';
        if (this.castling.w.k) castling += 'K';
        if (this.castling.w.q) castling += 'Q';
        if (this.castling.b.k) castling += 'k';
        if (this.castling.b.q) castling += 'q';
        fen += ` ${castling || '-'}`;
        if (this.enPassantTarget) {
            const file = String.fromCharCode('a'.charCodeAt(0) + this.enPassantTarget.col);
            const rank = 8 - this.enPassantTarget.row;
            fen += ` ${file}${rank}`;
        } else { fen += ' -'; }
        fen += ` ${this.halfMoveClock} ${this.fullMoveNumber}`;
        return fen;
    }

    getMoveType(piece, r1, c1, r2, c2) {
        const target = this.board[r2][c2];
        const pieceColor = (piece === piece.toUpperCase()) ? 'white' : 'black';

        if (target !== '') {
            const targetColor = (target === target.toUpperCase()) ? 'white' : 'black';
            if (pieceColor === targetColor) return 'invalid';
        }

        const type = piece.toLowerCase();
        const dr = r2 - r1;
        const dc = c2 - c1;
        const absDr = Math.abs(dr);
        const absDc = Math.abs(dc);

        if (type === 'p') {
            const direction = (pieceColor === 'white') ? -1 : 1;
            const startRow = (pieceColor === 'white') ? 6 : 1;
            if (dc === 0 && dr === direction && target === '') return 'normal';
            if (dc === 0 && dr === direction * 2 && r1 === startRow && target === '' && this.board[r1 + direction][c1] === '') return 'normal';
            if (absDc === 1 && dr === direction && target !== '') return 'normal';
            if (absDc === 1 && dr === direction && target === '' && this.enPassantTarget) {
                if (this.enPassantTarget.row === r2 && this.enPassantTarget.col === c2) return 'en-passant';
            }
            return 'invalid';
        }

        if (type === 'k') {
            if (absDr <= 1 && absDc <= 1) return 'normal';
            if (dr === 0 && absDc === 2) {
                if (this.isKingInCheck(pieceColor)) return 'invalid';
                const rights = (pieceColor === 'white') ? this.castling.w : this.castling.b;
                if (dc === 2) {
                    if (!rights.k) return 'invalid';
                    if (this.board[r1][5] !== '' || this.board[r1][6] !== '') return 'invalid';
                    if (this.isSquareAttacked(r1, 5, pieceColor)) return 'invalid';
                    return 'castling-king';
                }
                if (dc === -2) {
                    if (!rights.q) return 'invalid';
                    if (this.board[r1][1] !== '' || this.board[r1][2] !== '' || this.board[r1][3] !== '') return 'invalid';
                    if (this.isSquareAttacked(r1, 3, pieceColor)) return 'invalid';
                    return 'castling-queen';
                }
            }
            return 'invalid';
        }

        if (type === 'n') {
            if ((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2)) return 'normal';
            return 'invalid';
        }

        if (type === 'r' || type === 'b' || type === 'q') {
            const isStraight = (dr === 0 || dc === 0);
            const isDiagonal = (absDr === absDc);
            if (type === 'r' && !isStraight) return 'invalid';
            if (type === 'b' && !isDiagonal) return 'invalid';
            if (type === 'q' && !isStraight && !isDiagonal) return 'invalid';
            return this.isPathClear(r1, c1, r2, c2) ? 'normal' : 'invalid';
        }
        return 'invalid';
    }

    wouldCauseCheck(r1, c1, r2, c2, moveType, color) {
        const originalSource = this.board[r1][c1];
        const originalTarget = this.board[r2][c2];
        this.board[r2][c2] = originalSource;
        this.board[r1][c1] = '';
        let capturedEpPiece = null, epRow = r1, epCol = c2;
        if (moveType === 'en-passant') {
            capturedEpPiece = this.board[epRow][epCol];
            this.board[epRow][epCol] = '';
        }

        const isCheck = this.isKingInCheck(color);

        this.board[r1][c1] = originalSource;
        this.board[r2][c2] = originalTarget;
        if (moveType === 'en-passant') this.board[epRow][epCol] = capturedEpPiece;

        return isCheck;
    }

    isSquareAttacked(r, c, defendingColor) {
        const attackerColor = (defendingColor === 'white') ? 'black' : 'white';
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const p = this.board[row][col];
                if (p && this.getPieceColor(p) === attackerColor) {
                    if (p.toLowerCase() === 'k') {
                        if (Math.abs(row - r) <= 1 && Math.abs(col - c) <= 1) return true;
                        continue;
                    }
                    const type = this.getMoveType(p, row, col, r, c);
                    if (type === 'normal' || type === 'en-passant') return true;
                }
            }
        }
        return false;
    }

    isKingInCheck(color) {
        let kRow, kCol;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && this.getPieceColor(p) === color && p.toLowerCase() === 'k') {
                    kRow = r; kCol = c;
                    break;
                }
            }
        }
        if (kRow === undefined) return false;
        return this.isSquareAttacked(kRow, kCol, color);
    }

    checkGameState() {
        const hasMoves = this.hasLegalMoves(this.turn);
        const inCheck = this.isKingInCheck(this.turn);
        if (!hasMoves) {
            this.gameOver = true;
            if (inCheck) {
                this.status = 'checkmate';
                this.winner = (this.turn === 'white') ? 'black' : 'white';
            } else {
                this.status = 'stalemate';
                this.winner = 'draw';
            }
            return;
        }
        if (this.halfMoveClock >= 100) { this.gameOver = true; this.status = 'draw'; this.winner = 'draw (50-move rule)'; return; }
        if (this.isInsufficientMaterial()) { this.gameOver = true; this.status = 'draw'; this.winner = 'draw (insufficient material)'; return; }
        if (this.isThreeFoldRepetition()) { this.gameOver = true; this.status = 'draw'; this.winner = 'draw (repetition)'; }
    }

    isPathClear(r1, c1, r2, c2) {
        const dr = Math.sign(r2 - r1);
        const dc = Math.sign(c2 - c1);
        let currentRow = r1 + dr;
        let currentCol = c1 + dc;
        while (currentRow !== r2 || currentCol !== c2) {
            if (this.board[currentRow][currentCol] !== '') return false;
            currentRow += dr;
            currentCol += dc;
        }
        return true;
    }

    updateCastlingRights(piece, r, c) {
        const type = piece.toLowerCase();
        const color = (piece === piece.toUpperCase()) ? 'w' : 'b';
        if (type === 'k') { this.castling[color].k = false; this.castling[color].q = false; }
        if (type === 'r') {
            if (c === 0) this.castling[color].q = false;
            if (c === 7) this.castling[color].k = false;
        }
    }

    getPieceColor(piece) { return (piece === piece.toUpperCase()) ? 'white' : 'black'; }

    isInsufficientMaterial() {
        const pieces = this.board.flat().filter(p => p !== '');
        if (pieces.length === 2) return true;
        if (pieces.length === 3) {
            const small = pieces.find(p => ['n', 'b', 'N', 'B'].includes(p));
            if (small) return true;
        }
        return false;
    }

    recordBoardState() {
        const state = JSON.stringify({ b: this.board, t: this.turn, c: this.castling, e: this.enPassantTarget });
        this.moveHistory.push(state);
    }

    isThreeFoldRepetition() {
        const current = this.moveHistory[this.moveHistory.length - 1];
        const count = this.moveHistory.filter(s => s === current).length;
        return count >= 3;
    }

    timeoutLoss(loserColor) {
        this.gameOver = true; this.status = 'timeout'; this.winner = (loserColor === 'white') ? 'black' : 'white';
    }

    resign(color) {
        this.gameOver = true; this.status = 'resign'; this.winner = (color === 'white') ? 'black' : 'white';
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChessGame;
}