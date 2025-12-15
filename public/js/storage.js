// VERSION: 5.0.0
class GameStorage {
    constructor() {
        this.KEYS = {
            URL: 'chess_llm_url',
            KEY: 'chess_llm_key',
            MODEL: 'chess_llm_model',
            MODE: 'chess_opponent_mode',
            SESSION: 'chess_active_session',
            DIFFICULTY: 'chess_cpu_difficulty'
        };
    }

    saveSettings(ui) {
        const config = ui.getLLMConfig();
        localStorage.setItem(this.KEYS.URL, config.url);
        localStorage.setItem(this.KEYS.KEY, config.key);
        localStorage.setItem(this.KEYS.MODEL, config.model);
        localStorage.setItem(this.KEYS.MODE, ui.getOpponentMode());

        // Save Difficulty
        localStorage.setItem(this.KEYS.DIFFICULTY, ui.getDifficulty());
    }

    loadSettings(ui) {
        const savedUrl = localStorage.getItem(this.KEYS.URL);
        const savedKey = localStorage.getItem(this.KEYS.KEY);
        const savedModel = localStorage.getItem(this.KEYS.MODEL);
        const savedMode = localStorage.getItem(this.KEYS.MODE);
        const savedDiff = localStorage.getItem(this.KEYS.DIFFICULTY);

        ui.setLLMConfig(savedUrl, savedKey, null);

        if (savedModel) {
            const option = document.createElement('option');
            option.value = savedModel;
            option.text = savedModel;
            ui.llmModelSelect.add(option);
            ui.llmModelSelect.value = savedModel;
        }

        ui.setOpponentMode(savedMode || 'human');

        // Restore Difficulty
        if (savedDiff) {
            ui.setDifficulty(savedDiff);
        }
    }

    saveSession(game, clock, opponentMode) {
        if (game.gameOver) {
            this.clearSession();
            return;
        }
        const session = {
            game: game.toJSON(),
            whiteTime: clock.whiteTime,
            blackTime: clock.blackTime,
            opponentMode: opponentMode
        };
        localStorage.setItem(this.KEYS.SESSION, JSON.stringify(session));
    }

    loadSession() {
        const raw = localStorage.getItem(this.KEYS.SESSION);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    clearSession() {
        localStorage.removeItem(this.KEYS.SESSION);
    }

    hasSavedSession() {
        const session = this.loadSession();
        return session && session.game && !session.game.gameOver;
    }
}