// VERSION: 0.0.1
class ChessClock {
    constructor(minutes, onTimeOutCallback) {
        this.initialSeconds = minutes * 60;
        this.whiteTime = this.initialSeconds;
        this.blackTime = this.initialSeconds;
        this.activeColor = null; // 'white', 'black', or null (paused)
        this.intervalId = null;
        this.onTimeOut = onTimeOutCallback;
    }

    start(color) {
        this.stop(); // Clear existing interval
        this.activeColor = color;

        this.intervalId = setInterval(() => {
            this.tick();
        }, 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.activeColor = null;
    }

    tick() {
        if (this.activeColor === 'white') {
            this.whiteTime--;
            if (this.whiteTime <= 0) this.triggerTimeOut('white');
        } else if (this.activeColor === 'black') {
            this.blackTime--;
            if (this.blackTime <= 0) this.triggerTimeOut('black');
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
        this.whiteTime = this.initialSeconds;
        this.blackTime = this.initialSeconds;
    }

    // Helper to return "10:00" string
    getTimeString(color) {
        const totalSeconds = (color === 'white') ? this.whiteTime : this.blackTime;
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}