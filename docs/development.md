# Development and qualification

[Documentation](README.md) · [SDK overview](../README.md)

From this package:

```sh
npm ci
npm test
npm run test:bun
npm run format:check
npm run audit:dependencies
npm pack
```

To detect wake words in a local recording, run the packaged example after
building:

```sh
node examples/detect-wav.mjs alexa recording.wav
node examples/detect-wav.mjs hey-siri recording.wav
bun examples/detect-wav.mjs alexa recording.wav
```

Pass a built-in model name or a signed model path, followed by the recording
path. The example decodes local audio through FFmpeg, prints detections as
JSON, and closes the detector when decoding finishes or fails.

Source uses tabs with a four-column tab width, enforced by Prettier and
EditorConfig. Tests exercise actual native ONNX and local WASM inference,
Python-generated signatures, byte-by-byte tampering, real FFmpeg stereo
resampling, PCM fragmentation, cancellation, cleanup, detector lifecycle, and
loading and inference with every built-in model.
A tiny constant-score signed fixture is for SDK tests only; it is not a trained
wake-word model. Tests need FFmpeg but no network or microphone hardware.

Release verification records the actual runtime/platform checks separately.
Windows x64 is the locally exercised platform. Application-owned capture
needs qualification on its target platforms. Model recall and false-alarm performance must
be evaluated on real voices and target microphones before making production
accuracy claims. The existing Hey Nudge model retains its experimental quality
status; packaging and signatures do not change its predictions.

## Runtime dependency policy

The native CPU adapter pins `onnxruntime-node` to 1.21.1. Newer releases through
1.29.0 depend on `adm-zip`, affected by
[GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9).
Version 1.21.1 uses a different installer dependency tree and removes `adm-zip`
from both development and consumer installations. The browser adapter and
shared type definitions remain on 1.29.0. The adapters share only the session
operations used by the SDK.

This is a native runtime downgrade, not an upstream patch. Test custom models
against the pinned runtime before distribution; models needing newer ONNX
operators or runtime features may not load. The three bundled models use IR 8
and opset 13 and are covered by the native inference tests. Browser deployments
must continue serving the WASM assets from `onnxruntime-web` 1.29.0.

Avoid loading different native `onnxruntime-node` versions in the same process.
On Windows, comparing 1.21.1 and 1.29.0 in one process caused a native API-version
conflict. Use separate processes when comparing releases or when another
application component requires a different native runtime. Separate-process
checks of all three bundled models produced identical scores on the fixed
four-second synthetic input in Node and Bun; this is a compatibility check,
not an accuracy evaluation on speech.

Reassess the native pin when an upstream release removes or fixes the affected
dependency. Run both runtime suites and a clean tarball consumer installation
when changing it. `prepublishOnly` runs the production dependency audit and
rejects moderate-or-higher findings; a successful audit does not certify the
absence of unknown vulnerabilities in native binaries.
