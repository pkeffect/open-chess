// VERSION: 4.0.0
class NetworkGame {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.socket = null;
        this.roomId = null;
        this.myColor = null;
        this.userId = this.getOrCreateUserId();
    }

    getOrCreateUserId() {
        let id = localStorage.getItem('chess_p2p_userid');
        if (!id) {
            id = Date.now().toString(36) + Math.random().toString(36).substring(2);
            localStorage.setItem('chess_p2p_userid', id);
        }
        return id;
    }

    connect() {
        if (this.socket && this.socket.connected) return;

        this.socket = io();

        this.socket.on('connect', () => {
            if (this.callbacks.onStatus) this.callbacks.onStatus('connected');
        });

        this.socket.on('room_created', (data) => {
            this.roomId = data.roomId;
            this.myColor = data.color;
            this.saveRoomId(data.roomId);
            if (this.callbacks.onRoomCreated) this.callbacks.onRoomCreated(data.roomId);
        });

        this.socket.on('game_joined', (data) => {
            this.roomId = data.roomId;
            this.myColor = data.color;
            this.saveRoomId(data.roomId);

            let msg = `Joined Room: ${this.roomId}`;
            if (data.isReconnect) msg += " (Reconnected)";
            if (this.callbacks.onStatus) this.callbacks.onStatus(msg);

            if (this.myColor === 'spectator' && this.callbacks.onSpectatorMode) {
                this.callbacks.onSpectatorMode();
            }
        });

        this.socket.on('game_start', (data) => {
            if (this.callbacks.onGameStart) this.callbacks.onGameStart(data.color);
        });

        this.socket.on('sync_state', (gameState) => {
            if (this.callbacks.onSync) this.callbacks.onSync(gameState);
        });

        this.socket.on('opponent_move', (move) => {
            if (this.callbacks.onMove) this.callbacks.onMove(move);
        });

        this.socket.on('player_resigned', (color) => {
            if (this.callbacks.onResign) this.callbacks.onResign(color);
        });

        // --- DRAW EVENTS ---
        this.socket.on('draw_offered', () => {
            if (this.callbacks.onDrawOffered) this.callbacks.onDrawOffered();
        });

        this.socket.on('draw_declined', () => {
            if (this.callbacks.onDrawDeclined) this.callbacks.onDrawDeclined();
        });

        // --- DISCONNECTS ---
        this.socket.on('opponent_status', (data) => {
            if (this.callbacks.onOpponentStatus) this.callbacks.onOpponentStatus(data);
        });

        this.socket.on('game_abandoned', (data) => {
            if (this.callbacks.onGameAbandoned) this.callbacks.onGameAbandoned(data);
        });

        this.socket.on('error_message', (msg) => {
            alert(msg);
        });
    }

    createRoom() {
        this.connect();
        this.socket.emit('create_room', { userId: this.userId });
    }

    joinRoom(roomId) {
        this.connect();
        this.socket.emit('join_room', { roomId: roomId, userId: this.userId });
    }

    sendMove(move) {
        if (this.socket && this.roomId) {
            this.socket.emit('make_move', { roomId: this.roomId, move: move });
        }
    }

    sendResign() {
        if (this.socket && this.roomId) {
            this.socket.emit('resign', { roomId: this.roomId });
        }
    }

    sendDrawOffer() {
        if (this.socket && this.roomId) {
            this.socket.emit('offer_draw', { roomId: this.roomId });
        }
    }

    sendDrawResponse(accepted) {
        if (this.socket && this.roomId) {
            this.socket.emit('draw_response', { roomId: this.roomId, accepted });
        }
    }

    saveRoomId(id) {
        localStorage.setItem('chess_last_room', id);
    }
}