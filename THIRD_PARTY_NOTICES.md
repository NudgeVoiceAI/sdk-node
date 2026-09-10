# Third-party notices

The SDK uses ONNX Runtime (Microsoft Corporation), distributed under the MIT
license. Its native and WebAssembly runtime packages include their respective
license notices. See https://github.com/microsoft/onnxruntime.

FFmpeg is an optional, separately installed audio file decoding executable.
It is not bundled or downloaded by this SDK. Its license depends on how it was
built; see https://ffmpeg.org/legal.html and your distribution's notices.

Nudge models can contain Google's speech_embedding feature extractor,
converted to ONNX by openWakeWord under Apache-2.0. Each company model embeds
its encoder attribution and license notices in the authenticated graph.
The package includes signed Alexa, Hey Google, and Hey Siri models. Additional
model files may be distributed separately.

Readable model attribution is included in models/NOTICE.md, and the full
Apache-2.0 license is included in licenses/Apache-2.0.txt. Nudge's portions of
the three example models are covered by LICENSE. Third-party rights remain
governed by their respective licenses.
