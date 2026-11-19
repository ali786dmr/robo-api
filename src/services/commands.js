// Robot movement commands.
// Detected from the transcript BEFORE the LLM runs: instant, and the model
// can never invent a movement.
//
// Examples:
//   "move 10 meter forward"        -> MOVE_FORWARD_10M
//   "20 meter peeche jao"          -> MOVE_BACKWARD_20M
//   "turn left 90 degrees"         -> TURN_LEFT_90
//   "bayen 5 meter chalo"          -> MOVE_LEFT_5M

const MAX_DISTANCE_M = 50;
const MAX_DEGREES = 360;

const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50
};

const NUMBER_PATTERN =
    "\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty";

const DISTANCE_RE = new RegExp(`\\b(${NUMBER_PATTERN})\\s*(?:meters?|metres?|mtrs?|m)\\b`, "i");
const DEGREE_RE = /\b(\d+(?:\.\d+)?)\s*(?:degrees?|deg\b|°)/i;

const DIRECTIONS = [
    { name: "forward", re: /\b(forward|forwards|ahead|aage|aagey|aagay)\b/i },
    { name: "backward", re: /\b(backward|backwards|back|reverse|peeche|pichhe|piche)\b/i },
    { name: "left", re: /\b(left|bayen|baayen|bayein)\b/i },
    { name: "right", re: /\b(right|daayen|dayen|daayein)\b/i }
];

const TURN_VERB = /\b(turn|rotate|ghoomo|ghumo|mudo|mudiye|ghoom)\b/i;

function parseNumber(token) {
    if (/^\d/.test(token)) return parseFloat(token);
    return NUMBER_WORDS[token.toLowerCase()] ?? NaN;
}

function codeNumber(value) {
    return String(value).replace(".", "_");
}

// Returns null when the sentence is not a movement command.
export function parseCommand(transcript) {
    const text = (transcript || "").trim();
    if (!text) return null;

    const direction = DIRECTIONS.find(d => d.re.test(text));
    if (!direction) return null;

    // Turn: "turn left 90 degrees"
    if (TURN_VERB.test(text)) {
        if (direction.name !== "left" && direction.name !== "right") return null;

        const deg = text.match(DEGREE_RE);
        if (!deg) return null;

        const value = parseFloat(deg[1]);
        if (!(value > 0 && value <= MAX_DEGREES)) {
            return { action: "invalid", code: "INVALID_ANGLE", value, unit: "deg" };
        }

        return {
            action: "turn",
            direction: direction.name,
            value,
            unit: "deg",
            code: `TURN_${direction.name.toUpperCase()}_${codeNumber(value)}`
        };
    }

    // Move: "move 10 meter forward", "20 meter peeche"
    const dist = text.match(DISTANCE_RE);
    if (!dist) return null;

    const value = parseNumber(dist[1]);
    if (!(value > 0 && value <= MAX_DISTANCE_M)) {
        return { action: "invalid", code: "INVALID_DISTANCE", value, unit: "m" };
    }

    return {
        action: "move",
        direction: direction.name,
        value,
        unit: "m",
        code: `MOVE_${direction.name.toUpperCase()}_${codeNumber(value)}M`
    };
}