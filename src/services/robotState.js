// Remembers the last turn per conversation so the ESP32 can fetch the reply
// text and robot commands after it finishes speaking. In memory only (2 minute life).
const TTL_MS = 2 * 60 * 1000;
const turns = new Map();

export function setLastTurn(conversationId, turn) {
    const now = Date.now();
    for (const [id, saved] of turns) {
        if (now - saved.at > TTL_MS) turns.delete(id);
    }
    turns.set(conversationId, { ...turn, at: now });
}

// Returns the turn once, then forgets it so commands are never repeated.
export function takeLastTurn(conversationId) {
    const turn = turns.get(conversationId);
    if (!turn) return null;

    turns.delete(conversationId);
    return Date.now() - turn.at > TTL_MS ? null : turn;
}