# Getting started

[Documentation](README.md) · [SDK overview](../README.md)

## Install

```sh
npm install @nudgeai/sdk
# or
bun add @nudgeai/sdk
```

The package is prepared for publication; until it is published, install the
release tarball using `npm install ./nudgeai-sdk-0.1.0.tgz` or
`bun add ./nudgeai-sdk-0.1.0.tgz`.

Requires Node.js 20+ or Bun 1.3.3+ on an ONNX Runtime-supported platform.
The package includes signed Alexa, Hey Google, and Hey Siri models. PCM input
needs no FFmpeg. The optional `AudioSource.file()` decoder requires a local
FFmpeg installation; set `ffmpegPath` or `FFMPEG_PATH` if it isn't on PATH.
FFmpeg binaries and private signing keys are not included.

## Feed your application's audio

The same code works in Node.js and Bun. Pass an async iterable of mono 16 kHz
PCM frames from your application's audio source to this function:

```js
import { WakeWordDetector } from '@nudgeai/sdk';

export async function detectWakeWords(pcmFrames) {
    const detector = await WakeWordDetector.create('hey-siri', {
        onDetection: ({ phrase, score, timestamp }) => {
            console.log(phrase, score, timestamp);
        },
    });

    try {
        for await (const pcm of pcmFrames) {
            await detector.process(pcm);
        }
    } finally {
        await detector.close();
    }
}
```

Use `Int16Array` or normalized `Float32Array` frames. Await each `process()`
call before feeding the next frame. Your application selects the microphone,
requests permissions, captures audio, and stops its audio source. Downmix and
resample to mono 16 kHz before processing. The SDK does not start a microphone
or install process-wide signal handlers.

`WakeWordDetector.listen()`, `AudioSource.microphone()`, `AudioSource.devices()`,
`ListenOptions`, `ListeningSession`, `MicrophoneOptions`, and `AudioDevice` have
been removed. Replace the listening session with `create()`, the loop above,
and `close()`. Stopping your source and closing the detector are separate
application responsibilities.

Next: [built-in models](models.md), [decode a local file](audio.md), or
[PCM input and detector options](api.md).
