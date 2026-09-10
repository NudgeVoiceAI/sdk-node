import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HOP_SAMPLES, SAMPLE_RATE } from './core.js';

export interface AudioOptions {
	/** FFmpeg executable, otherwise FFMPEG_PATH or ffmpeg on PATH. */
	ffmpegPath?: string;
	signal?: AbortSignal;
	/** Maximum wait for the first decoded samples. Default: 15 seconds. */
	startupTimeoutMs?: number;
}

export class AudioCaptureError extends Error {
	override readonly name = 'AudioCaptureError';
}

function executable(options: AudioOptions): string {
	const path = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
	if (typeof path !== 'string' || !path.trim() || path.includes('\0')) {
		throw new TypeError('ffmpegPath must be a nonempty executable path.');
	}
	return path;
}

function timeoutMs(options: AudioOptions): number {
	const value = options.startupTimeoutMs ?? 15000;
	if (!Number.isFinite(value) || value < 1 || value > 120000) {
		throw new RangeError('startupTimeoutMs must be between 1 and 120000.');
	}
	return value;
}

function spawnError(error: Error): AudioCaptureError {
	return new AudioCaptureError(
		'Could not start FFmpeg. Install FFmpeg or set ffmpegPath / FFMPEG_PATH.',
		{ cause: error },
	);
}

function terminate(child: ChildProcess): ReturnType<typeof setTimeout> {
	child.kill('SIGTERM');
	const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
	timer.unref();
	return timer;
}

/** Convert byte-aligned or split s16le chunks into bounded mono PCM frames. */
export async function* decodePCM(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Int16Array> {
	let lowByte: number | undefined;
	let frame = new Int16Array(HOP_SAMPLES);
	let used = 0;
	for await (const chunk of chunks) {
		for (const byte of chunk) {
			if (lowByte === undefined) {
				lowByte = byte;
				continue;
			}
			frame[used++] = lowByte | (byte << 8);
			lowByte = undefined;
			if (used === frame.length) {
				yield frame;
				frame = new Int16Array(HOP_SAMPLES);
				used = 0;
			}
		}
	}
	if (lowByte !== undefined)
		throw new AudioCaptureError('Audio ended with a truncated PCM sample.');
	if (used) yield frame.slice(0, used);
}

/** Shell-free, bounded streaming process with cancellation and deterministic teardown. */
export async function* ffmpegPCM(
	input: string[],
	options: AudioOptions,
): AsyncGenerator<Int16Array> {
	const path = executable(options);
	const startup = timeoutMs(options);
	if (options.signal?.aborted) return;
	const child = spawn(
		path,
		[
			'-nostdin',
			'-hide_banner',
			'-loglevel',
			'error',
			...input,
			'-vn',
			'-ac',
			'1',
			'-ar',
			String(SAMPLE_RATE),
			'-acodec',
			'pcm_s16le',
			'-f',
			's16le',
			'pipe:1',
		],
		{ windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let diagnostics = '';
	let failure: Error | undefined;
	let finished = false;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	const completion = new Promise<number | null>((resolveExit) => {
		child.on('error', (error) => {
			failure = spawnError(error);
		});
		child.once('close', (code) => {
			finished = true;
			resolveExit(code);
		});
	});
	child.stderr.on('data', (data: Buffer) => {
		diagnostics = (diagnostics + data.toString()).slice(-4096);
	});
	const stop = () => {
		if (!finished && !killTimer) killTimer = terminate(child);
		child.stdout.destroy();
	};
	options.signal?.addEventListener('abort', stop, { once: true });
	const timer = setTimeout(() => {
		failure = new AudioCaptureError(
			'FFmpeg did not produce audio before startupTimeoutMs. Check the input device, file, and decoder.',
		);
		stop();
	}, startup);
	// A data listener would put stdout into flowing mode and defeat backpressure.
	async function* bytes(): AsyncGenerator<Uint8Array> {
		for await (const chunk of child.stdout) {
			clearTimeout(timer);
			yield chunk as Buffer;
		}
	}
	try {
		if (options.signal?.aborted) stop();
		for await (const frame of decodePCM(bytes())) {
			if (options.signal?.aborted) return;
			yield frame;
		}
		const code = await completion;
		if (options.signal?.aborted) return;
		if (failure) throw failure;
		if (code !== 0) {
			throw new AudioCaptureError(
				diagnostics.trim() || `FFmpeg decoding failed (exit ${code}).`,
			);
		}
	} catch (error) {
		if (!options.signal?.aborted) throw failure ?? error;
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', stop);
		stop();
		await completion;
		clearTimeout(killTimer);
	}
}

export class AudioSource {
	/** Local file decoding and downmixing. No network protocols are permitted. */
	static async *file(path: string, options: AudioOptions = {}): AsyncGenerator<Int16Array> {
		if (typeof path !== 'string' || !path.trim())
			throw new TypeError('Expected a local audio file path.');
		if (options.signal?.aborted) return;
		const localPath = resolve(path);
		if (!(await stat(localPath)).isFile())
			throw new AudioCaptureError('Audio path must identify a regular file.');
		yield* ffmpegPCM(['-protocol_whitelist', 'file,pipe', '-i', localPath], options);
	}
}
