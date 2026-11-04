// VERSION: 5.2.0
class GameStorage {
    constructor() {
        this.KEYS = {
            URL: 'chess_llm_url',
            KEY: 'chess_llm_key',
            MODEL: 'chess_llm_model',
            MODE: 'chess_opponent_mode',
            SESSION: 'chess_active_session',
            DIFFICULTY: 'chess_cpu_difficulty',
            TIME_PRESET: 'chess_time_preset',
            TIME_CUSTOM: 'chess_time_custom_min',
            HERMES_URL: 'chess_hermes_url',
            HERMES_USER: 'chess_hermes_user',
            HERMES_KEY: 'chess_hermes_key',
            HERMES_TIMEOUT: 'chess_hermes_timeout'
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

        // Save time control
        const tc = ui.getTimeControl();
        localStorage.setItem(this.KEYS.TIME_PRESET, this.timePresetKey(tc, ui));
        if (tc.minutes && ui.timePresetSelect && ui.timePresetSelect.value === 'custom') {
            localStorage.setItem(this.KEYS.TIME_CUSTOM, String(tc.minutes));
        }

        // Save Hermes Agent settings (URL + credentials stay in the browser
        // only, same privacy model as the LLM API keys above; the gateway URL
        // is additionally registered with the server-side proxy, which is
        // what enables the connection)
        const hermes = ui.getHermesConfig();
        localStorage.setItem(this.KEYS.HERMES_URL, hermes.gatewayUrl);
        localStorage.setItem(this.KEYS.HERMES_USER, hermes.username);
        localStorage.setItem(this.KEYS.HERMES_KEY, hermes.password);
        localStorage.setItem(this.KEYS.HERMES_TIMEOUT, String(hermes.moveTimeoutMs));
    }

    timePresetKey(tc, ui) {
        if (tc.unlimited) return 'unlimited';
        if (ui.timePresetSelect && ui.timePresetSelect.value === 'custom') return 'custom';
        return String(tc.minutes);
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

        ui.setHermesConfig(
            localStorage.getItem(this.KEYS.HERMES_USER),
            localStorage.getItem(this.KEYS.HERMES_KEY),
            localStorage.getItem(this.KEYS.HERMES_URL),
            localStorage.getItem(this.KEYS.HERMES_TIMEOUT)
        );

        ui.setTimeControl(
            localStorage.getItem(this.KEYS.TIME_PRESET) || '10',
            localStorage.getItem(this.KEYS.TIME_CUSTOM)
        );

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