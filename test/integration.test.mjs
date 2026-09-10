import test from './runner.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WakeWordDetector, models, resolveModel } from '../dist/node.js';
import { WakeWordDetector as BrowserDetector } from '../dist/browser.js';

const path = fileURLToPath(new URL('fixtures/detector.nudge', import.meta.url));
const pcm = new Float32Array(2560).fill(0.1);

test('native runtime loads Python-signed .nudge paths and bytes and produces detections', async () => {
	for (const input of [path, await readFile(path)]) {
		const detector = await WakeWordDetector.create(input);
		try {
			assert.equal(detector.model.phrase, 'SDK fixture');
			const events = await detector.process(pcm);
			assert.equal(events.length, 1);
			assert.equal(events[0].timestamp, 0.16);
			assert.ok(Math.abs(events[0].score - 0.9) < 1e-6);
		} finally {
			await detector.close();
		}
	}
});

test('both public model loaders reject unsigned and tampered models', async () => {
	const bytes = await readFile(path);
	const altered = Buffer.from(bytes);
	altered[50] ^= 1;
	for (const Detector of [WakeWordDetector, BrowserDetector]) {
		await assert.rejects(Detector.create(bytes.subarray(44, -64)), /signed/);
		await assert.rejects(Detector.create(altered), /signature/);
	}
});

test('verifySignature: false loads unsigned ONNX and signature-flipped envelopes', async () => {
	const bytes = await readFile(path);
	const unsigned = bytes.subarray(44, -64);
	const flipped = Buffer.from(bytes);
	flipped[flipped.length - 1] ^= 1;
	const localWasmPath = new URL('./', import.meta.resolve('onnxruntime-web/wasm')).href;
	for (const Detector of [WakeWordDetector, BrowserDetector]) {
		const options =
			Detector === BrowserDetector
				? { verifySignature: false, wasmPath: localWasmPath }
				: { verifySignature: false };
		for (const input of [unsigned, flipped]) {
			const detector = await Detector.create(input, options);
			try {
				assert.equal(detector.model.phrase, 'SDK fixture');
			} finally {
				await detector.close();
			}
		}
	}
});

test('signed models work through the browser WASM adapter without network assets', async () => {
	// Resolve from the workspace rather than a CDN.
	const localWasmPath = new URL('./', import.meta.resolve('onnxruntime-web/wasm')).href;
	const detector = await BrowserDetector.create(await readFile(path), {
		wasmPath: localWasmPath,
	});
	try {
		assert.equal((await detector.process(pcm)).length, 1);
	} finally {
		await detector.close();
	}
});

test('built-in models resolve offline, verify and run native inference', async () => {
	assert.deepEqual(Object.keys(models), ['alexa', 'hey-google', 'hey-siri']);
	for (const [name, phrase] of Object.entries({
		alexa: 'Alexa',
		'hey-google': 'Hey Google',
		'hey-siri': 'Hey Siri',
	})) {
		assert.equal(resolveModel(name), models[name]);
		const detector = await WakeWordDetector.create(name);
		try {
			assert.equal(detector.model.phrase.toLowerCase(), phrase.toLowerCase());
			assert.deepEqual(await detector.process(pcm), []);
		} finally {
			await detector.close();
		}
	}
	assert.equal(resolveModel(path), path);
	assert.equal(resolveModel('toString'), 'toString');
	const bytes = await readFile(path);
	assert.equal(resolveModel(bytes), bytes);
});
