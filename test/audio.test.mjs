import test from './runner.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioSource, decodePCM, ffmpegPCM } from '../dist/audio.js';

async function* chunks(bytes, sizes) {
	let offset = 0;
	for (const size of sizes) {
		yield bytes.subarray(offset, offset + size);
		offset += size;
	}
	yield bytes.subarray(offset);
}
async function collect(source) {
	const frames = [];
	for await (const frame of source) frames.push(...frame);
	return frames;
}
function wave(rate, channels, seconds = 1) {
	const samples = Math.round(rate * seconds);
	const data = Buffer.alloc(44 + samples * channels * 2);
	data.write('RIFF');
	data.writeUInt32LE(data.length - 8, 4);
	data.write('WAVEfmt ', 8);
	data.writeUInt32LE(16, 16);
	data.writeUInt16LE(1, 20);
	data.writeUInt16LE(channels, 22);
	data.writeUInt32LE(rate, 24);
	data.writeUInt32LE(rate * channels * 2, 28);
	data.writeUInt16LE(channels * 2, 32);
	data.writeUInt16LE(16, 34);
	data.write('data', 36);
	data.writeUInt32LE(data.length - 44, 40);
	for (let sample = 0; sample < samples; sample++) {
		for (let channel = 0; channel < channels; channel++) {
			data.writeInt16LE(
				Math.round(Math.sin((2 * Math.PI * 440 * sample) / rate) * 8000),
				44 + (sample * channels + channel) * 2,
			);
		}
	}
	return data;
}

test('PCM byte fragments preserve signed values and yield bounded frames', async () => {
	const expected = Array.from({ length: 4001 }, (_, index) => (index % 3 ? -32768 : 32767));
	const bytes = Buffer.alloc(expected.length * 2);
	expected.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
	const frames = [];
	for await (const frame of decodePCM(chunks(bytes, [1, 2, 3, 2559, 1, 11]))) {
		assert.ok(frame.length <= 1280);
		frames.push(...frame);
	}
	assert.deepEqual(frames, expected);
	await assert.rejects(collect(decodePCM(chunks(Buffer.of(1), []))), /truncated/);
});

test('real FFmpeg automatically decodes and resamples stereo 48 kHz WAV', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'nudge-audio-'));
	try {
		const file = join(dir, 'audio with spaces.wav');
		await writeFile(file, wave(48000, 2));
		const pcm = await collect(AudioSource.file(file));
		assert.equal(pcm.length, 16000);
		const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
		assert.ok(rms > 5000 && rms < 6500, `Unexpected decoded RMS: ${rms}`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('audio errors, missing executable, invalid files and invalid options reject', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'nudge-audio-'));
	try {
		const file = join(dir, 'bad.wav');
		await writeFile(file, 'not encoded audio');
		await assert.rejects(collect(AudioSource.file(file)), /Invalid|invalid|Error|error/);
		await assert.rejects(
			collect(AudioSource.file(file, { ffmpegPath: join(dir, 'absent-ffmpeg') })),
			/FFmpeg/,
		);
		await assert.rejects(
			collect(AudioSource.file(file, { startupTimeoutMs: 0 })),
			/startupTimeoutMs/,
		);
		await assert.rejects(collect(AudioSource.file(dir)), /regular file/);
		await assert.rejects(collect(AudioSource.file('https://example.com/a.wav')), /ENOENT/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('abort and early consumer exit stop decoding without stranded child processes', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'nudge-audio-'));
	try {
		const file = join(dir, 'long.wav');
		await writeFile(file, wave(16000, 1, 10));
		const controller = new AbortController();
		let count = 0;
		for await (const frame of AudioSource.file(file, { signal: controller.signal })) {
			count += frame.length;
			controller.abort();
		}
		assert.equal(count, 1280);
		for await (const frame of AudioSource.file(file)) {
			assert.equal(frame.length, 1280);
			break;
		}
		assert.deepEqual(await collect(AudioSource.file(file, { signal: controller.signal })), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('FFmpeg decoding supports cancellation and finite sources', async () => {
	const controller = new AbortController();
	const input = ['-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'];
	let samples = 0;
	for await (const pcm of ffmpegPCM(input, { signal: controller.signal })) {
		samples += pcm.length;
		controller.abort();
	}
	assert.equal(samples, 1280);
	const decoded = await collect(ffmpegPCM(['-f', 'lavfi', '-i', 'sine=duration=0.1'], {}));
	assert.equal(decoded.length, 1600);
});

test('startup timeout stops a real FFmpeg process', async () => {
	await assert.rejects(
		collect(
			ffmpegPCM(['-re', '-f', 'lavfi', '-i', 'sine', '-af', 'atrim=start=2'], {
				startupTimeoutMs: 50,
			}),
		),
		/startupTimeoutMs/,
	);
});
