# Audio input and file decoding

[Documentation](README.md) · [SDK overview](../README.md)

## Application-owned audio

The SDK accepts mono 16 kHz `Int16Array` or normalized `Float32Array` PCM through
`detector.process()`. Your application handles microphone permissions, device
selection, capture, and stopping the stream. There is no microphone capture or
device discovery API in the SDK. See the [PCM API](api.md) for resampling and
the [getting started example](getting-started.md) for a processing loop.

## Try your microphone in Node.js

The standalone [detect-mic.mjs example](../examples/detect-mic.mjs) uses a
separately installed FFmpeg executable to capture the microphone and feed PCM
to the SDK. FFmpeg must be on PATH, or set `FFMPEG_PATH`:

```sh
node examples/detect-mic.mjs alexa
node examples/detect-mic.mjs hey-siri --sensitivity 0.6 --scores
```

On Windows, FFmpeg uses DirectShow (first listed audio device, or `--device`
with the dshow name). On macOS it uses AVFoundation (`--device` is an index,
default `0`). On Linux it uses ALSA (`--device` is the device name, default
`default`). Allow microphone access for your terminal/Node.js in OS settings.

With no model argument, the example uses Alexa. `--help` shows options.
Ctrl+C stops capture and releases the detector. Capture stays in the example;
the SDK still has no microphone API.

## Decode local audio files

`AudioSource.file()` uses a separately installed FFmpeg executable to decode,
downmix, and resample local files into mono 16 kHz PCM:

```js
import { WakeWordDetector, AudioSource } from '@nudgeai/sdk';

const detector = await WakeWordDetector.create('alexa', {
	onDetection: console.log,
});
try {
	for await (const pcm of AudioSource.file('./recording.mp3')) {
		await detector.process(pcm);
	}
	// Advance the final phrase through the model window.
	await detector.process(new Float32Array(16000));
} finally {
	await detector.close();
}
```

WAV, FLAC, MP3, and other formats supported by the installed FFmpeg are decoded
locally. Supply a local file path; network protocols are disabled.

`AudioOptions` accepts `ffmpegPath` (defaults to `FFMPEG_PATH` or `ffmpeg` on
PATH), `signal`, and `startupTimeoutMs` (default 15000, range 1–120000).
The decoder yields `Int16Array` chunks of at most 1280 samples with
backpressure. Decoder failures and truncated PCM raise `AudioCaptureError`;
this existing error name is retained for file decoding compatibility.
Abort or exit the `for await` loop to stop decoding and release its FFmpeg
child process. Await processing and close the detector separately.
