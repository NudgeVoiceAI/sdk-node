import { WakeWordDetector, AudioSource } from '@nudgeai/sdk';

const [modelPath, audioPath] = process.argv.slice(2);
if (!modelPath || !audioPath) {
	throw new Error(
		'Usage: node detect-wav.mjs [alexa|hey-google|hey-siri|path.nudge] recording.wav (also supports Bun and local MP3/FLAC files)',
	);
}
const detector = await WakeWordDetector.create(modelPath, {
	onDetection: (event) => console.log(JSON.stringify(event)),
});
try {
	for await (const pcm of AudioSource.file(audioPath)) {
		await detector.process(pcm);
	}
	// Advance the final phrase through the model window.
	await detector.process(new Float32Array(16000));
} finally {
	await detector.close();
}
