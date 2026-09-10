import test from './runner.mjs';
import assert from 'node:assert/strict';
import {
	AudioResampler,
	StreamingDetector,
	SAMPLE_RATE,
	WINDOW_SAMPLES,
	HOP_SAMPLES,
} from '../dist/core.js';
const model = { phrase: 'Hey Nudge', threshold: 0.6, version: 1 };
const pcm = (n) => new Float32Array(n).fill(0.1);

test('chunk boundaries do not alter scores, windows or detection times', async () => {
	async function run(chunks) {
		const windows = [],
			events = [];
		const detector = new StreamingDetector(
			model,
			async (audio) => {
				windows.push(audio.slice());
				return 0.9;
			},
			async () => {},
		);
		const audio = Float32Array.from({ length: 90000 }, (_, i) => Math.sin(i / 100) * 0.4);
		let position = 0;
		for (const size of chunks) {
			events.push(...(await detector.process(audio.subarray(position, position + size))));
			position += size;
		}
		if (position < audio.length)
			events.push(...(await detector.process(audio.subarray(position))));
		await detector.close();
		return { windows, events };
	}
	const whole = await run([90000]);
	const split = await run([1, 77, 2031, 40000, 8, 16384, 3]);
	assert.deepEqual(split, whole);
	assert.equal(whole.events.length, 1);
});

test('debounce and cooldown permit a new utterance but not repeated triggers', async () => {
	let index = 0;
	const detector = new StreamingDetector(
		model,
		async () => (index++ < 25 || index > 30 ? 0.9 : 0.1),
		async () => {},
	);
	assert.equal((await detector.process(pcm(WINDOW_SAMPLES + HOP_SAMPLES * 80))).length, 2);
});

test('silence does not invoke inference; lifecycle and input errors are explicit', async () => {
	let calls = 0,
		closed = 0;
	const detector = new StreamingDetector(
		model,
		async () => {
			calls++;
			return 0.9;
		},
		async () => {
			closed++;
		},
	);
	assert.deepEqual(await detector.process(new Float32Array(80000)), []);
	assert.equal(calls, 0);
	await assert.rejects(detector.process(new Float32Array([NaN])), /finite/);
	await assert.rejects(detector.process(new Float32Array([2])), /normalized/);
	await assert.rejects(detector.process([0]), /PCM/);
	assert.throws(() => {
		detector.sensitivity = 2;
	}, /Sensitivity/);
	detector.reset();
	await detector.close();
	await detector.close();
	assert.equal(closed, 1);
	await assert.rejects(detector.process(pcm(10)), /closed/);
});

test('concurrent calls cannot silently reorder the audio stream', async () => {
	let resolve;
	const detector = new StreamingDetector(
		model,
		() =>
			new Promise((r) => {
				resolve = r;
			}),
		async () => {},
	);
	const pending = detector.process(pcm(1280));
	await assert.rejects(detector.process(pcm(1280)), /Await/);
	await assert.rejects(detector.close(), /finish/);
	resolve(0.1);
	await pending;
	await detector.close();
});

test('resampling is invariant to input chunking at 48 kHz and 44.1 kHz', () => {
	for (const rate of [48000, 44100]) {
		const audio = Float32Array.from({ length: rate }, (_, i) =>
			Math.sin((2 * Math.PI * 1000 * i) / rate),
		);
		const whole = new AudioResampler(rate).process(audio);
		const resampler = new AudioResampler(rate);
		const split = [];
		for (let i = 0; i < audio.length; i += 127)
			split.push(...resampler.process(audio.subarray(i, i + 127)));
		assert.equal(whole.length, split.length);
		let error = 0;
		for (let i = 0; i < whole.length; i++)
			error = Math.max(error, Math.abs(whole[i] - split[i]));
		assert.ok(error < 1e-5, `${rate} Hz boundary error ${error}`);
		assert.ok(Math.abs(whole.length - SAMPLE_RATE) < 15);
	}
});

test('resampling suppresses out-of-band energy rather than aliasing it', () => {
	const tone = (hz) =>
		Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 48000));
	const rms = (audio) =>
		Math.sqrt(audio.slice(100).reduce((sum, x) => sum + x * x, 0) / (audio.length - 100));
	const pass = rms(new AudioResampler(48000).process(tone(1000)));
	const stop = rms(new AudioResampler(48000).process(tone(12000)));
	assert.ok(pass > 0.65);
	assert.ok(stop / pass < 0.01, `Alias suppression ${stop / pass}`);
});
