// VERSION: 2.0.0
class LLMPlayer {
    constructor(apiUrl, modelName, apiKey) {
        this.apiUrl = apiUrl;
        this.modelName = modelName;
        this.apiKey = apiKey;
        this.maxRetries = 3;
    }

    async getBestMove(game) {
        const fen = game.toFEN();
        const legalMoves = game.getAllLegalMoves(game.turn);
        const uciMoves = legalMoves.map(m => this.coordsToUCI(m));

        // Base System Prompt
        const systemPrompt = `You are a UCI Chess Engine. 
        You will receive a FEN string and a list of legal moves.
        You must pick the best move for the active color.
        IMPORTANT:
        1. Reply with ONLY the move in UCI format (e.g., "e2e4").
        2. Do not use markdown, bold, or explanations.
        3. Do not output multiple moves.`;

        // Initial User Prompt
        const userPrompt = `FEN: ${fen}
        Legal Moves: ${uciMoves.join(', ')}
        What is the best move?`;

        // Conversation History for Context Window
        let messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            console.log(`LLM Attempt ${attempt + 1}/${this.maxRetries + 1}`);

            try {
                const responseContent = await this.callApi(messages);
                const move = this.extractUCI(responseContent, uciMoves);

                if (move) {
                    console.log("LLM Valid Move:", responseContent);
                    return move;
                }

                console.warn("LLM Invalid Move:", responseContent);

                // Add error feedback for retry
                messages.push({ role: 'assistant', content: responseContent });
                messages.push({ role: 'user', content: `Invalid move. Please choose one of the Legal Moves listed above. Reply ONLY with the UCI string.` });

            } catch (error) {
                console.error("LLM API Error:", error);
                return null; // Network error usually fatal, fallback to CPU
            }
        }

        console.error("LLM Failed after max retries.");
        return null;
    }

    async callApi(messages) {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey && this.apiKey.trim() !== '') {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: this.modelName,
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        // Handle different API response structures (Ollama vs OpenAI)
        if (data.message) return data.message.content; // Ollama native
        if (data.choices && data.choices[0].message) return data.choices[0].message.content; // OpenAI Standard

        throw new Error("Unknown API Response Format");
    }

    coordsToUCI(move) {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        // Handle Promotion
        let promo = '';
        // If it's a promotion move, the standard game logic usually defaults to Queen, 
        // but for UCI strictly we might need to be specific. 
        // However, our game.js auto-promotes to Queen if unspecified, so basic UCI is fine.
        return `${files[move.fromCol]}${8 - move.fromRow}${files[move.toCol]}${8 - move.toRow}${promo}`;
    }

    uciToCoords(uci) {
        if (!uci || uci.length < 4) return null;
        const files = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4, 'f': 5, 'g': 6, 'h': 7 };
        return {
            fromRow: 8 - parseInt(uci[1]),
            fromCol: files[uci[0]],
            toRow: 8 - parseInt(uci[3]),
            toCol: files[uci[2]]
        };
    }

    extractUCI(text, legalMovesUCI) {
        // Regex to find 4-5 char move strings (e.g. e2e4, a7a8q)
        const matches = text.match(/[a-h][1-8][a-h][1-8][qrbn]?/gi);
        if (matches) {
            for (const match of matches) {
                const cleanMove = match.toLowerCase();
                // Check if strict match or starts with (ignoring promo suffix for validation if needed)
                if (legalMovesUCI.includes(cleanMove)) {
                    return this.uciToCoords(cleanMove);
                }
            }
        }
        return null;
    }
}