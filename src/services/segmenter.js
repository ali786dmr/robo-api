// Splits a live 16-bit mono PCM stream into phrases at pauses.
// Each phrase is sent to Whisper as soon as the user pauses, so a long question
// is already mostly transcribed by the time the user finishes speaking.

const FRAME_MS = 20;
const MIN_VOICED_FRAMES = 5;     // 100 ms of speech, anything shorter is noise
const PREROLL_FRAMES = 10;       // keep 200 ms before speech starts

function frameRms(buffer) {
    const samples = buffer.length >> 1;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const v = buffer.readInt16LE(i * 2);
        sum += v * v;
    }
    return Math.sqrt(sum / samples);
}

export class PauseSegmenter {
    constructor({
        sampleRate = 16000,
        silenceMs = 450,
        maxPhraseMs = 12000,
        energy = Number(process.env.SEGMENT_ENERGY) || 400
    } = {}) {
        this.frameBytes = (sampleRate * FRAME_MS / 1000) * 2;
        this.silenceFrames = Math.ceil(silenceMs / FRAME_MS);
        this.maxFrames = Math.ceil(maxPhraseMs / FRAME_MS);
        this.energy = energy;
        this.leftover = Buffer.alloc(0);
        this.reset();
    }

    reset() {
        this.frames = [];
        this.voicedFrames = 0;
        this.silentRun = 0;
    }

    // Returns an array of completed phrase buffers (possibly empty).
    push(chunk) {
        const data = this.leftover.length ? Buffer.concat([this.leftover, chunk]) : chunk;
        const phrases = [];
        let offset = 0;

        while (data.length - offset >= this.frameBytes) {
            const frame = data.subarray(offset, offset + this.frameBytes);
            offset += this.frameBytes;

            const voiced = frameRms(frame) > this.energy;
            this.frames.push(frame);

            if (voiced) {
                this.voicedFrames++;
                this.silentRun = 0;
            } else {
                this.silentRun++;
                if (this.voicedFrames === 0 && this.frames.length > PREROLL_FRAMES) {
                    this.frames.shift();     // silence before speech is not kept
                }
            }

            const pauseEnded = this.voicedFrames > 0 && this.silentRun >= this.silenceFrames;
            const tooLong = this.frames.length >= this.maxFrames;

            if (pauseEnded || tooLong) {
                const phrase = this.takePhrase();
                if (phrase) phrases.push(phrase);
            }
        }

        this.leftover = Buffer.from(data.subarray(offset));
        return phrases;
    }

    takePhrase() {
        const phrase = this.voicedFrames >= MIN_VOICED_FRAMES ? Buffer.concat(this.frames) : null;
        this.reset();
        return phrase;
    }

    flush() {
        return this.takePhrase();
    }
}