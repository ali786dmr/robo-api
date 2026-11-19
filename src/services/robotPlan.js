import { parseCommand } from "./commands.js";

// Robot commands taken from the AI's own reply, e.g. "Turn left 90 degree. Move forward 5 meter."
// Only used when the user's request had movement words, so normal chat never moves the car.

const DEFAULT_MOVE_M = 2;
const DEFAULT_TURN_DEG = 90;

const INTENT = /\b(move|go|walk|step|drive|turn|rotate|chalo|jao|ghoomo|ghumo|mudo|aage|peeche|bayen|daayen|forward|backward|left|right)\b/i;
const MOVE_VERB = /\b(move|moving|moved|go|going|walk|walking|step|drive|driving|chalo|jao|aage|peeche|forward|backward|bayen|daayen)\b/i;
const TURN_VERB = /\b(turn|turning|turned|rotate|rotating|ghoomo|ghumo|mudo|ghoom)\b/i;

const DIRS = [
    { name: "forward", re: /\b(forward|forwards|ahead|aage|aagey|aagay)\b/i },
    { name: "backward", re: /\b(backward|backwards|back|reverse|peeche|pichhe|piche)\b/i },
    { name: "left", re: /\b(left|bayen|baayen|bayein)\b/i },
    { name: "right", re: /\b(right|daayen|dayen|daayein)\b/i }
];

// Fallback for AI sentences that omit the number: uses default distance or angle.
function parseLoose(sentence) {
    const dir = DIRS.find(d => d.re.test(sentence));
    if (!dir) return null;

    if (TURN_VERB.test(sentence)) {
        if (dir.name !== "left" && dir.name !== "right") return null;

        const deg = sentence.match(/(\d+(?:\.\d+)?)\s*(?:degrees?|deg)/i);
        const value = deg ? parseFloat(deg[1]) : DEFAULT_TURN_DEG;
        return {
            action: "turn",
            direction: dir.name,
            value,
            unit: "deg",
            code: `TURN_${dir.name.toUpperCase()}_${String(value).replace(".", "_")}`
        };
    }

    if (!MOVE_VERB.test(sentence)) return null;

    const dist = sentence.match(/(\d+(?:\.\d+)?)\s*(?:meters?|metres?|mtrs?|m)\b/i);
    const value = dist ? parseFloat(dist[1]) : DEFAULT_MOVE_M;
    return {
        action: "move",
        direction: dir.name,
        value,
        unit: "m",
        code: `MOVE_${dir.name.toUpperCase()}_${String(value).replace(".", "_")}M`
    };
}

export function planReplyCommands(transcript, reply) {
    if (!INTENT.test(transcript || "")) return [];

    const parts = String(reply || "").split(/[.!?;,]+|\b(?:and then|then|and)\b/i);
    const commands = [];

    for (const part of parts) {
        const text = part.trim();
        if (!text) continue;

        const command = parseCommand(text) || parseLoose(text);
        if (command && command.code && command.action !== "invalid") commands.push(command);
    }

    return commands;
}

export function describeCommand(command) {
    if (command.action === "invalid") {
        return "Sorry, that distance or angle is not allowed.";
    }
    if (command.action === "turn") {
        return `Turning ${command.direction} ${command.value} degrees.`;
    }
    return `Moving ${command.direction} ${command.value} meter.`;
}