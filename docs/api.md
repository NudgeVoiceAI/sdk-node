# API reference

[Documentation](README.md) · [SDK overview](../README.md)

`WakeWordDetector.create(nameOrPathOrUint8Array, options)` returns a
`StreamingDetector`. `process()` accepts mono 16 kHz signed `Int16Array` or
finite, normalized `Float32Array` in `[-1, 1]`, with arbitrary chunk sizes up
to 60 seconds. It returns `Detection[]`; always await it before the next call.
Encoded WAV/MP3 buffers are not PCM. For an existing mono Float32 stream at
another sample rate, keep one `AudioResampler(sourceRate)` for that continuous
stream. Downmix multichannel PCM first. The resampler filters before
downsampling and introduces a short filter delay.

- `sampleRate`: 16000; `frameLength`: 1280 (80 ms).
- `model`: immutable phrase, trained threshold, and model version.
- `sensitivity`: writable 0–1, default 0.5; higher values lower the threshold.
- `cooldownMs`: nonnegative, default 1500.
- `verifySignature`: default true. Set false to load unsigned ONNX or a `.nudge`
  file without Ed25519; the loader warns that unverified models often detect
  less accurately.
- `onDetection(event)` and `onScore(score)`: synchronous callbacks. Exceptions
  propagate to `process()`. Await asynchronous work
  outside these callbacks and handle its errors in your application.
- Events contain `phrase`, `score`, and `timestamp` in seconds relative to audio
  fed to this detector. Scores are network outputs, not calibrated probabilities.
- `reset()`: clears context, timestamps, and debounce history after a stream
  discontinuity or processing error. Create a new resampler for a new stream.
- `close()`: releases inference resources; repeated callers await the same
  cleanup. Await active processing before closing the detector.

The Node.js/Bun entry accepts built-in names (`alexa`, `hey-google`, `hey-siri`),
local `.nudge` paths, or signed bytes. It also exports `models`, `resolveModel`,
and the `BuiltinModel` type; see [Models](models.md). The browser entry accepts
signed bytes only, or unsigned ONNX when `verifySignature` is false.

See [Getting started](getting-started.md) for an application-owned processing
loop and [Audio input and file decoding](audio.md) for `AudioSource.file()`
options. Microphone capture and device discovery are application responsibilities.
