// VERSION: 4.1.0
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// IMPORT SHARED LOGIC
const ChessGame = require('./public/js/game.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- STARTUP CHECKS ---
const requiredFiles = [
    'public/index.html',
    'public/js/game.js',
    'public/js/main.js'
];

console.log("--- Checking File System ---");
requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        console.log(`[OK] Found ${file}`);
    } else {
        console.error(`[MISSING] ${file} not found! Did you rebuild Docker?`);
    }
});
console.log("----------------------------");

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// --- SOCKET LOGIC ---
const rooms = new Map();
const DISCONNECT_GRACE_PERIOD = 30000;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- CREATE ROOM ---
    socket.on('create_room', ({ userId }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const game = new ChessGame();

        rooms.set(roomId, {
            game: game,
            white: { userId, socketId: socket.id },
            black: null,
            spectators: [],
            timers: { white: null, black: null }
        });

        socket.join(roomId);
        socket.emit('room_created', { roomId, color: 'white' });
        console.log(`Room ${roomId} created by ${userId} (${socket.id})`);
    });

    // --- JOIN / RECONNECT ROOM ---
    socket.on('join_room', ({ roomId, userId }) => {
        roomId = roomId.toUpperCase();
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error_message', 'Room not found');
            return;
        }

        socket.join(roomId);

        // 1. Reconnect White
        if (room.white && room.white.userId === userId) {
            clearDisconnectTimer(room, 'white');
            room.white.socketId = socket.id;
            socket.emit('game_joined', { roomId, color: 'white', isReconnect: true });
            socket.emit('sync_state', room.game.toJSON());
            io.to(roomId).emit('opponent_status', { status: 'connected', color: 'white' });
            return;
        }

        // 2. Reconnect Black
        if (room.black && room.black.userId === userId) {
            clearDisconnectTimer(room, 'black');
            room.black.socketId = socket.id;
            socket.emit('game_joined', { roomId, color: 'black', isReconnect: true });
            socket.emit('sync_state', room.game.toJSON());
            io.to(roomId).emit('opponent_status', { status: 'connected', color: 'black' });
            return;
        }

        // 3. New Player Black
        if (!room.black) {
            room.black = { userId, socketId: socket.id };
            socket.emit('game_joined', { roomId, color: 'black' });
            io.to(room.white.socketId).emit('game_start', { color: 'white' });
            socket.emit('game_start', { color: 'black' });
            io.to(roomId).emit('sync_state', room.game.toJSON());
        }
        // 4. Spectator
        else {
            room.spectators.push(socket.id);
            socket.emit('game_joined', { roomId, color: 'spectator' });
            socket.emit('sync_state', room.game.toJSON());
        }
    });

    // --- MOVE ---
    socket.on('make_move', ({ roomId, move }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const isWhite = room.white && socket.id === room.white.socketId;
        const isBlack = room.black && socket.id === room.black.socketId;
        const currentTurn = room.game.turn;

        if ((isWhite && currentTurn !== 'white') || (isBlack && currentTurn !== 'black')) {
            return;
        }

        const success = room.game.movePiece(
            move.fromRow, move.fromCol,
            move.toRow, move.toCol,
            move.promoteTo
        );

        if (success) {
            // Attach the server's Ply count to the move object for client validation
            move.ply = room.game.ply;

            io.to(roomId).emit('opponent_move', move);

            if (room.game.gameOver) {
                io.to(roomId).emit('sync_state', room.game.toJSON());
            }
        }
    });

    // --- DRAW LOGIC ---
    socket.on('offer_draw', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room || room.game.gameOver) return;

        if (socket.id === room.white.socketId && room.black) {
            io.to(room.black.socketId).emit('draw_offered');
        } else if (room.black && socket.id === room.black.socketId) {
            io.to(room.white.socketId).emit('draw_offered');
        }
    });

    socket.on('draw_response', ({ roomId, accepted }) => {
        const room = rooms.get(roomId);
        if (!room || room.game.gameOver) return;

        if (accepted) {
            room.game.gameOver = true;
            room.game.status = 'stalemate';
            room.game.winner = 'draw (agreement)';
            io.to(roomId).emit('sync_state', room.game.toJSON());
        } else {
            const target = (socket.id === room.white.socketId) ? room.black.socketId : room.white.socketId;
            if (target) io.to(target).emit('draw_declined');
        }
    });

    socket.on('resign', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        let resigningColor = null;
        if (room.white && socket.id === room.white.socketId) resigningColor = 'white';
        else if (room.black && socket.id === room.black.socketId) resigningColor = 'black';

        if (resigningColor) {
            room.game.resign(resigningColor);
            io.to(roomId).emit('player_resigned', resigningColor);
        }
    });

    // --- DISCONNECT HANDLING ---
    socket.on('disconnect', () => {
        rooms.forEach((room, roomId) => {
            let color = null;
            if (room.white && socket.id === room.white.socketId) color = 'white';
            else if (room.black && socket.id === room.black.socketId) color = 'black';

            if (color) {
                if (room.game.gameOver) return;

                console.log(`Player ${color} disconnected from ${roomId}.`);
                io.to(roomId).emit('opponent_status', { status: 'disconnected', color: color, timeout: DISCONNECT_GRACE_PERIOD });

                room.timers[color] = setTimeout(() => {
                    console.log(`Room ${roomId}: ${color} timed out.`);
                    const winner = (color === 'white') ? 'black' : 'white';

                    room.game.gameOver = true;
                    room.game.status = 'timeout (disconnect)';
                    room.game.winner = winner;

                    io.to(roomId).emit('game_abandoned', { winner, reason: 'disconnect' });
                    rooms.delete(roomId);
                }, DISCONNECT_GRACE_PERIOD);
            } else {
                const index = room.spectators.indexOf(socket.id);
                if (index !== -1) room.spectators.splice(index, 1);
            }
        });
        console.log('User disconnected:', socket.id);
    });
});

function clearDisconnectTimer(room, color) {
    if (room.timers[color]) {
        clearTimeout(room.timers[color]);
        room.timers[color] = null;
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});