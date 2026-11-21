// services/commands.js
// Motor commands are extracted ONLY from the user's transcript.

const MAX_DISTANCE_M = 15;
const MAX_DEGREES = 360;

const DEFAULT_DISTANCE_M = 2;
const DEFAULT_TURN_DEG = 90;

const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    fifteen: 15, twenty: 20, thirty: 30,
    forty: 40, fifty: 50, sixty: 60, ninety: 90
};

const NUMBER_PATTERN =
    "\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety";

const DISTANCE_RE = new RegExp(
    `\\b(${NUMBER_PATTERN})\\s*(?:meters?|metres?|mtrs?|m)\\b`,
    "i"
);

const DEGREE_RE = new RegExp(
    `\\b(${NUMBER_PATTERN})\\s*(?:degrees?|deg)\\b|(\\d+(?:\\.\\d+)?)\\s*°`,
    "i"
);

const BARE_DISTANCE_RE = new RegExp(
    `\\b(?:forward|forwards|ahead|aage|aagey|aagay|samne|backward|backwards|back|reverse|peeche|pichhe|piche)\\s+(${NUMBER_PATTERN})\\b`,
    "i"
);

const BARE_ANGLE_RE = new RegExp(
    `\\b(?:left|right|bayen|baayen|bayein|baen|daayen|dayen|daayein|dayein)\\s+(${NUMBER_PATTERN})\\b`,
    "i"
);

const DIRECT_DIRECTION_RE =
    /^(?:(?:hey|hi|please|vijay|robot)\s+){0,3}(forward|forwards|ahead|aage|aagey|aagay|samne|backward|backwards|back|reverse|peeche|pichhe|piche|left|right|bayen|baayen|bayein|baen|daayen|dayen|daayein|dayein)(?:\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety))?(?:\s*(?:meters?|metres?|mtrs?|m|degrees?|deg|°))?$/i;

const FORWARD_RE =
    /\b(forward|forwards|ahead|aage|aagey|aagay|samne)\b/i;

const BACKWARD_RE =
    /\b(backward|backwards|back|reverse|peeche|pichhe|piche)\b/i;

const LEFT_RE =
    /\b(left|bayen|baayen|bayein|baen)\b/i;

const RIGHT_RE =
    /\b(right|daayen|dayen|daayein|dayein)\b/i;

const TURN_RE =
    /\b(turn|rotate|rotation|ghoomo|ghumo|mudo|mudiye|ghoom)\b/i;

const MOVEMENT_RE =
    /\b(move|moving|go|going|drive|driving|walk|step|chalo|jao|jaana|chalna|karna|karo|badho|barho)\b/i;

const STOP_RE =
    /\b(stop|halt|freeze|ruko|ruk\s+jao|roko|bas)\b/i;

const NEGATED_STOP_RE =
    /\b(?:don't|do not|never)\s+(?:ever\s+)?(?:stop|halt)\b/i;


// ============================================================================
// HELPERS
// ============================================================================

function parseNumber(token) {
    if (!token) return NaN;

    if (/^\d/.test(token)) {
        return parseFloat(token);
    }

    return NUMBER_WORDS[token.toLowerCase()] ?? NaN;
}

function codeNumber(value) {
    return String(value).replace(".", "_");
}

function resultInvalid(code, value, unit, reason) {
    return {
        action: "invalid",
        code,
        value,
        unit,
        reason
    };
}


// ============================================================================
// STOP COMMAND
// ============================================================================

function isStopCommand(text) {
    if (!STOP_RE.test(text)) return false;
    if (NEGATED_STOP_RE.test(text)) return false;

    const standalone =
        /^(?:(?:hey|hi|vijay|robot|please)\s+){0,3}(?:stop|halt|freeze|ruko|ruk\s+jao|roko|bas)(?:\s+now)?(?:\s+please)?$/i.test(text);

    const robotContext =
        /\b(vijay|robot|motor|motors|car|moving|movement|drive|driving)\b/i.test(text);

    return standalone || robotContext;
}


// ============================================================================
// MAIN COMMAND PARSER
// ============================================================================

export function parseCommand(transcript) {

    let text = String(transcript || "")
        .toLowerCase()
        .trim();

    if (!text) return null;

    text = text
        .replace(/\bmoo\s+(left|right)\b/g, "move $1")
        .replace(/\bmoveleft\b/g, "move left")
        .replace(/\bmoveright\b/g, "move right")
        .replace(/[,.!?](?!\d)/g, " ")
        .replace(/\s+/g, " ")
        .trim();


    // STOP takes priority.

    if (isStopCommand(text)) {
        return {
            action: "stop",
            direction: "stop",
            value: 0,
            unit: "",
            code: "STOP"
        };
    }


    // Detect directions.

    const directMatch = text.match(DIRECT_DIRECTION_RE);

    const isForward = FORWARD_RE.test(text);
    const isBackward = BACKWARD_RE.test(text);

    const isLeft = LEFT_RE.test(text);
    const isRight = RIGHT_RE.test(text);

    if ((isForward && isBackward) || (isLeft && isRight)) {
        return null;
    }

    const directIsTurn =
        Boolean(directMatch && (isLeft || isRight));

    const directIsMove =
        Boolean(directMatch && (isForward || isBackward));

    const isTurn =
        TURN_RE.test(text) || directIsTurn;

    const isMovement =
        MOVEMENT_RE.test(text) || directIsMove;

    if (!isTurn && !isMovement) {
        return null;
    }


    // TURN LEFT / TURN RIGHT

    if (isTurn) {

        if (isLeft === isRight) return null;

        const degreeMatch = text.match(DEGREE_RE);
        const bareAngleMatch = text.match(BARE_ANGLE_RE);

        const directAngle = directMatch
            ? parseNumber(directMatch[2])
            : NaN;

        const value = degreeMatch
            ? parseNumber(degreeMatch[1] || degreeMatch[2])
            : bareAngleMatch
                ? parseNumber(bareAngleMatch[1])
                : Number.isFinite(directAngle)
                    ? directAngle
                    : DEFAULT_TURN_DEG;

        if (!(value > 0 && value <= MAX_DEGREES)) {
            return resultInvalid(
                "INVALID_ANGLE",
                value,
                "deg",
                "Angle must be between 1 and 360 degrees."
            );
        }

        const direction = isLeft ? "left" : "right";

        return {
            action: "turn",
            direction,
            value,
            unit: "deg",
            code: `TURN_${direction.toUpperCase()}_${codeNumber(value)}`
        };
    }


    // SIDEWAYS MOVEMENT IS NOT SUPPORTED.

    if (isLeft || isRight) {
        return resultInvalid(
            "UNSUPPORTED_DIRECTION",
            0,
            "m",
            "The robot cannot move sideways. Ask it to turn left or right."
        );
    }


    // FORWARD / BACKWARD

    if (!isForward && !isBackward) {
        return null;
    }

    const distanceMatch = text.match(DISTANCE_RE);
    const bareDistanceMatch = text.match(BARE_DISTANCE_RE);

    const directDistance = directMatch
        ? parseNumber(directMatch[2])
        : NaN;

    const value = distanceMatch
        ? parseNumber(distanceMatch[1])
        : bareDistanceMatch
            ? parseNumber(bareDistanceMatch[1])
            : Number.isFinite(directDistance)
                ? directDistance
                : DEFAULT_DISTANCE_M;

    if (!(value > 0 && value <= MAX_DISTANCE_M)) {
        return resultInvalid(
            "INVALID_DISTANCE",
            value,
            "m",
            "Distance must be between 0 and 15 metres."
        );
    }

    const direction = isForward ? "forward" : "backward";

    return {
        action: "move",
        direction,
        value,
        unit: "m",
        code: `MOVE_${direction.toUpperCase()}_${codeNumber(value)}M`
    };
}


// ============================================================================
// HUMAN-READABLE RESPONSE
// ============================================================================

export function describeCommand(command) {

    if (!command) {
        return "Sorry, I could not understand that movement command.";
    }

    if (command.action === "stop") {
        return "Stopping now.";
    }

    if (command.action === "invalid") {
        return command.reason ||
            "Sorry, that movement is not supported.";
    }

    if (command.action === "turn") {
        return `Turning ${command.direction} ${command.value} degrees.`;
    }

    return `Moving ${command.direction} ${command.value} metres.`;
}