import test from './runner.mjs';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { attach } from '../dist/model.js';
import { models, resolveModel } from '../dist/models.js';
import { StreamingDetector, AudioResampler } from '../dist/core.js';

const model = { phrase: 'Hey Nudge', threshold: 0.6, version: 1 };
test('builtin models resolve to packaged signed files', async () => {
	assert.deepEqual(Object.keys(models).sort(), ['alexa', 'hey-google', 'hey-siri']);
	for (const [name, path] of Object.entries(models)) {
		assert.equal(resolveModel(name), path);
		await access(path);
	}
	assert.equal(resolveModel('./custom.nudge'), './custom.nudge');
});

test('concurrent close callers await the same runtime release', async () => {
	let complete,
		calls = 0;
	const detector = new StreamingDetector(
		model,
		async () => 0,
		() => {
			calls++;
			return new Promise((resolve) => {
				complete = resolve;
			});
		},
	);
	const a = detector.close(),
		b = detector.close();
	await Promise.resolve();
	assert.equal(calls, 1);
	let closed = false;
	void b.then(() => {
		closed = true;
	});
	await Promise.resolve();
	assert.equal(closed, false);
	complete();
	await Promise.all([a, b]);
	assert.throws(() => detector.reset(), /closed/);
});

test('model and options snapshots cannot be changed by the caller', () => {
	const info = { ...model },
		options = { cooldownMs: 0 };
	const detector = new StreamingDetector(
		info,
		async () => 0,
		async () => {},
		options,
	);
	info.threshold = 0.99;
	options.onScore = 'invalid';
	assert.equal(detector.threshold, 0.6);
	assert.throws(() => {
		detector.model.threshold = 0.1;
	}, TypeError);
});

test('invalid callbacks and resampler data are rejected explicitly', () => {
	assert.throws(
		() =>
			new StreamingDetector(
				model,
				async () => 0,
				async () => {},
				{ onScore: 1 },
			),
		/functions/,
	);
	const resampler = new AudioResampler(48000);
	for (const data of [new Float32Array([NaN]), new Float32Array([2]), new Int16Array(1)]) {
		assert.throws(() => resampler.process(data), /Float32Array/);
	}
});

test('resampling full-scale transitions remains valid normalized detector input', () => {
	const input = Float32Array.from({ length: 48000 }, (_, index) =>
		Math.floor(index / 37) % 2 ? -1 : 1,
	);
	const output = new AudioResampler(48000).process(input);
	assert.ok(output.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
});

test('invalid model schemas release inference sessions', async () => {
	let releases = 0;
	const session = {
		inputNames: ['wrong'],
		outputNames: [],
		release: async () => {
			releases++;
		},
	};
	await assert.rejects(attach(session, class {}, {}), /Nudge/);
	assert.equal(releases, 1);
});

test('inference and callback failures unlock processing for explicit reset', async () => {
	let fail = true;
	const detector = new StreamingDetector(
		model,
		async () => {
			if (fail) throw new Error('runtime failure');
			return 0.9;
		},
		async () => {},
	);
	const pcm = new Float32Array(2560).fill(0.1);
	await assert.rejects(detector.process(pcm), /runtime failure/);
	detector.reset();
	fail = false;
	assert.equal((await detector.process(pcm)).length, 1);
	await detector.close();
});
