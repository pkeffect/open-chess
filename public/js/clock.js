// VERSION: 5.3.0
class ChessClock {
    constructor(minutes, onTimeOutCallback, unlimited = false) {
        this.unlimited = !!unlimited;
        this.initialSeconds = minutes * 60;
        this.whiteTime = this.initialSeconds;
        this.blackTime = this.initialSeconds;
        this.activeColor = null; // 'white', 'black', or null (paused)
        this.intervalId = null;
        this.lastTimestamp = null;
        this.onTimeOut = onTimeOutCallback;
    }

    /** Change the base time (e.g. when the user edits the time control). */
    setMinutes(minutes, unlimited = this.unlimited) {
        this.unlimited = !!unlimited;
        this.initialSeconds = minutes * 60;
    }

    start(color) {
        // If we are switching sides, ensure we calculate the final chunk of time for the previous player
        if (this.activeColor && this.activeColor !== color) {
            this.tick();
        }

        this.stop(); // Clear existing interval/state
        this.activeColor = color;
        this.lastTimestamp = Date.now();

        if (this.unlimited) return; // nothing to count down

        // We tick frequently (100ms) to keep the UI smooth, but the math relies on timestamps,
        // not the interval count, so lag doesn't affect accuracy.
        this.intervalId = setInterval(() => {
            this.tick();
        }, 100);
    }

    stop() {
        if (this.activeColor) {
            this.tick(); // capture final moment
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.activeColor = null;
        this.lastTimestamp = null;
    }

    tick() {
        if (this.unlimited) return;
        if (!this.activeColor || !this.lastTimestamp) return;

        const now = Date.now();
        const deltaSeconds = (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;

        if (this.activeColor === 'white') {
            this.whiteTime -= deltaSeconds;
            if (this.whiteTime <= 0) {
                this.whiteTime = 0;
                this.triggerTimeOut('white');
            }
        } else if (this.activeColor === 'black') {
            this.blackTime -= deltaSeconds;
            if (this.blackTime <= 0) {
                this.blackTime = 0;
                this.triggerTimeOut('black');
            }
        }
    }

    triggerTimeOut(loserColor) {
        this.stop();
        this.whiteTime = Math.max(0, this.whiteTime);
        this.blackTime = Math.max(0, this.blackTime);
        if (this.onTimeOut) this.onTimeOut(loserColor);
    }

    reset() {
        this.stop();
        this.whiteTime = this.unlimited ? 0 : this.initialSeconds;
        this.blackTime = this.unlimited ? 0 : this.initialSeconds;
    }

    // Helper to return "10:00" string (or ∞ without a time control)
    getTimeString(color) {
        if (this.unlimited) return '∞';
        // Math.ceil so it shows "0:01" until strictly 0
        const totalSecondsRaw = (color === 'white') ? this.whiteTime : this.blackTime;
        const totalSeconds = Math.ceil(Math.max(0, totalSecondsRaw));

        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}
