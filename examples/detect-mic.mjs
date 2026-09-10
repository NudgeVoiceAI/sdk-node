// Requires FFmpeg on PATH (or FFMPEG_PATH). Then:
// node examples/detect-mic.mjs alexa
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { WakeWordDetector, models, ffmpegPCM } from '@nudgeai/sdk';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		device: { type: 'string' },
		sensitivity: { type: 'string', default: '0.5' },
		scores: { type: 'boolean', default: false },
		help: { type: 'boolean' },
	},
});
if (values.help || positionals.length > 1) {
	console.log(
		`Usage: node examples/detect-mic.mjs [${Object.keys(models).join('|')}|path.nudge] [--device NAME] [--sensitivity 0.5] [--scores]`,
	);
	console.log('Defaults to Alexa and the default microphone. Requires FFmpeg on PATH.');
	process.exit(values.help ? 0 : 1);
}

async function defaultDevice(ffmpegPath) {
	if (process.platform === 'linux') return 'default';
	if (process.platform !== 'win32' && process.platform !== 'darwin') {
		throw new Error(`Microphone capture is unsupported on ${process.platform}.`);
	}
	const args =
		process.platform === 'win32'
			? ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']
			: ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''];
	const child = spawn(ffmpegPath, args, {
		windowsHide: true,
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let output = '';
	child.stderr.on('data', (chunk) => {
		output = (output + chunk.toString()).slice(-65536);
	});
	await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.once('close', resolve);
	});
	if (process.platform === 'win32') {
		const match = /"([^"]+)" \(audio\)/.exec(output);
		if (!match) {
			throw new Error(
				'No microphone found. Pass --device NAME or check Windows microphone permissions.',
			);
		}
		return match[1];
	}
	const audioSection = output.split('AVFoundation audio devices:')[1] ?? '';
	return /\]\s+\[(\d+)\]\s+/.exec(audioSection)?.[1] ?? '0';
}

function captureArgs(device) {
	if (process.platform === 'win32') return ['-f', 'dshow', '-i', `audio=${device}`];
	if (process.platform === 'darwin') return ['-f', 'avfoundation', '-i', `:${device}`];
	return ['-f', 'alsa', '-i', device];
}

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const controller = new AbortController();
const stop = () => controller.abort();
let detector;
try {
	detector = await WakeWordDetector.create(positionals[0] ?? 'alexa', {
		sensitivity: Number(values.sensitivity),
		onDetection: (event) => {
			console.log(
				`\nDetected "${event.phrase}" — score ${event.score.toFixed(3)}, ${event.timestamp.toFixed(2)}s`,
			);
		},
		onScore: values.scores
			? (score) => process.stdout.write(`\rScore: ${score.toFixed(3)}   `)
			: undefined,
	});
	const device = values.device ?? (await defaultDevice(ffmpegPath));
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	console.log(`Listening for "${detector.model.phrase}". Ctrl+C to stop.`);
	for await (const pcm of ffmpegPCM(captureArgs(device), {
		ffmpegPath,
		signal: controller.signal,
	})) {
		await detector.process(pcm);
	}
} catch (error) {
	if (!controller.signal.aborted) {
		console.error(`\n${error instanceof Error ? error.message : error}`);
		console.error('Check that FFmpeg is on PATH and microphone access is allowed.');
		process.exitCode = 1;
	}
} finally {
	stop();
	process.removeListener('SIGINT', stop);
	process.removeListener('SIGTERM', stop);
	await detector?.close();
	if (values.scores) process.stdout.write('\n');
}
