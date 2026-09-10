export const SAMPLE_RATE = 16000;
export const WINDOW_SAMPLES = 40000;
export const HOP_SAMPLES = 1280;

export interface Detection {
	phrase: string;
	score: number;
	timestamp: number;
}
export interface DetectorOptions {
	sensitivity?: number;
	cooldownMs?: number;
	onDetection?: (event: Detection) => void;
	onScore?: (score: number) => void;
	/** Default true. Set false to skip Ed25519; unverified models often detect less accurately. */
	verifySignature?: boolean;
}
export interface ModelInfo {
	readonly phrase: string;
	readonly threshold: number;
	readonly version: number;
}
export type Infer = (audio: Float32Array) => Promise<number>;

/** Stateful, band-limited resampling. Keep one instance for the entire stream. */
export class AudioResampler {
	private buffer = new Float32Array(24);
	private position = 24;
	constructor(
		readonly sourceRate: number,
		readonly targetRate = SAMPLE_RATE,
	) {
		if (
			![sourceRate, targetRate].every((n) => Number.isFinite(n) && n >= 8000 && n <= 192000)
		) {
			throw new Error('Sample rates must be between 8,000 and 192,000 Hz.');
		}
	}
	process(input: Float32Array): Float32Array {
		if (
			!(input instanceof Float32Array) ||
			input.some((value) => !Number.isFinite(value) || Math.abs(value) > 1)
		) {
			throw new TypeError('Resampler expects finite Float32Array PCM normalized to [-1, 1].');
		}
		if (input.length > this.sourceRate * 60)
			throw new RangeError('Resample chunks of at most 60 seconds.');
		if (this.sourceRate === this.targetRate) return input.slice();
		const joined = new Float32Array(this.buffer.length + input.length);
		joined.set(this.buffer);
		joined.set(input, this.buffer.length);
		const output: number[] = [];
		const step = this.sourceRate / this.targetRate;
		const cutoff = 0.45 * Math.min(1, 1 / step);
		while (this.position + 24 < joined.length) {
			const center = Math.floor(this.position);
			let value = 0,
				weight = 0;
			for (let i = center - 23; i <= center + 24; i++) {
				const distance = i - this.position;
				const x = 2 * Math.PI * cutoff * distance;
				const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x;
				const w = sinc * (0.5 + 0.5 * Math.cos((Math.PI * distance) / 24));
				value += joined[i] * w;
				weight += w;
			}
			// Band-limited interpolation can overshoot full-scale input at transients.
			output.push(Math.max(-1, Math.min(1, value / weight)));
			this.position += step;
		}
		const drop = Math.max(0, Math.floor(this.position) - 24);
		this.buffer = joined.slice(drop);
		this.position -= drop;
		return Float32Array.from(output);
	}
}

/** Feed mono PCM in chronological order. Await each process() call. */
export class StreamingDetector {
	readonly sampleRate = SAMPLE_RATE;
	readonly frameLength = HOP_SAMPLES;
	private ring = new Float32Array(WINDOW_SAMPLES);
	private cursor = 0;
	private received = 0;
	private untilHop = HOP_SAMPLES;
	private above = 0;
	private below = 0;
	private latched = false;
	private lastDetection = -Infinity;
	private busy = false;
	private closed = false;
	private closing?: Promise<void>;
	private sensitivityValue: number;
	private cooldown: number;
	constructor(
		readonly model: ModelInfo,
		private infer: Infer,
		private release: () => Promise<void>,
		private options: DetectorOptions = {},
	) {
		if (
			model.version !== 1 ||
			!model.phrase ||
			!Number.isFinite(model.threshold) ||
			model.threshold <= 0 ||
			model.threshold >= 1
		) {
			throw new Error('This is not a supported Nudge v1 model.');
		}
		this.model = Object.freeze({ ...model });
		this.options = { ...options };
		if (
			(options.onDetection !== undefined && typeof options.onDetection !== 'function') ||
			(options.onScore !== undefined && typeof options.onScore !== 'function')
		) {
			throw new TypeError('onDetection and onScore must be functions.');
		}
		this.sensitivityValue = 0.5;
		this.sensitivity = options.sensitivity ?? 0.5;
		this.cooldown = options.cooldownMs ?? 1500;
		if (!Number.isFinite(this.cooldown) || this.cooldown < 0)
			throw new Error('cooldownMs must be nonnegative.');
	}
	get sensitivity() {
		return this.sensitivityValue;
	}
	set sensitivity(value: number) {
		if (!Number.isFinite(value) || value < 0 || value > 1)
			throw new Error('Sensitivity must be between 0 and 1.');
		this.sensitivityValue = value;
	}
	get threshold() {
		return Math.max(
			0.05,
			Math.min(0.99, this.model.threshold + (0.5 - this.sensitivity) * 0.6),
		);
	}
	async process(pcm: Int16Array | Float32Array): Promise<Detection[]> {
		if (this.closed) throw new Error('Detector is closed.');
		if (this.busy) throw new Error('Await process() before feeding more audio.');
		if (!(pcm instanceof Int16Array) && !(pcm instanceof Float32Array))
			throw new TypeError('Expected mono Int16Array or Float32Array PCM.');
		if (pcm.length > SAMPLE_RATE * 60)
			throw new Error('Feed audio in chunks of at most 60 seconds.');
		if (pcm instanceof Float32Array && pcm.some((x) => !Number.isFinite(x) || Math.abs(x) > 1))
			throw new Error('Float PCM must be finite and normalized to [-1, 1].');
		this.busy = true;
		const detections: Detection[] = [];
		try {
			for (let i = 0; i < pcm.length; i++) {
				this.ring[this.cursor] = pcm instanceof Int16Array ? pcm[i] / 32768 : pcm[i];
				this.cursor = (this.cursor + 1) % WINDOW_SAMPLES;
				this.received++;
				if (--this.untilHop > 0) continue;
				this.untilHop = HOP_SAMPLES;
				// The untouched part of the ring is zero-padding. Score from the first
				// hop so a phrase spoken immediately after create() is not discarded.
				const window = new Float32Array(WINDOW_SAMPLES);
				window.set(this.ring.subarray(this.cursor));
				window.set(this.ring.subarray(0, this.cursor), WINDOW_SAMPLES - this.cursor);
				let energy = 0;
				for (const value of window) energy += value * value;
				const score = energy / WINDOW_SAMPLES < 1e-7 ? 0 : await this.infer(window);
				if (!Number.isFinite(score) || score < 0 || score > 1)
					throw new Error('Invalid model score.');
				this.options.onScore?.(score);
				if (score >= this.threshold) {
					this.above++;
					this.below = 0;
				} else {
					this.above = 0;
					this.below++;
					if (this.below >= 3) this.latched = false;
				}
				const timestamp = this.received / SAMPLE_RATE;
				if (
					this.above >= 2 &&
					!this.latched &&
					(timestamp - this.lastDetection) * 1000 >= this.cooldown
				) {
					const event = { phrase: this.model.phrase, score, timestamp };
					this.latched = true;
					this.lastDetection = timestamp;
					detections.push(event);
					this.options.onDetection?.(event);
				}
			}
			return detections;
		} finally {
			this.busy = false;
		}
	}
	reset() {
		if (this.closed) throw new Error('Detector is closed.');
		if (this.busy) throw new Error('Cannot reset while processing.');
		this.ring.fill(0);
		this.cursor = 0;
		this.received = 0;
		this.untilHop = HOP_SAMPLES;
		this.above = 0;
		this.below = 0;
		this.latched = false;
		this.lastDetection = -Infinity;
	}
	async close() {
		if (this.busy) throw new Error('Wait for process() to finish before closing.');
		if (!this.closed) {
			this.closed = true;
			this.closing = Promise.resolve().then(() => this.release());
		}
		await this.closing;
	}
}
