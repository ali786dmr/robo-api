
// services/robotPlan.js
//
// IMPORTANT:
// Movement commands must come from the user's transcript.
// Never extract executable commands from the AI's conversational reply.

export function planReplyCommands() {
    return [];
}

export function describeCommand(command) {
    if (!command || command.action === "invalid") {
        return command?.reason || "Sorry, that movement is not supported.";
    }

    if (command.action === "turn") {
        return `Turning ${command.direction} ${command.value} degrees.`;
    }

    return `Moving ${command.direction} ${command.value} metres.`;
}
