# Built-in and signed models

[Documentation](README.md) · [SDK overview](../README.md)

## Built-in models

The package includes these signed models for offline use in Node.js and Bun:

| Name passed to `create()` | Wake phrase | Packaged file |
| --- | --- | --- |
| `alexa` | Alexa | `models/alexa.nudge` |
| `hey-google` | Hey Google | `models/hey-google.nudge` |
| `hey-siri` | Hey Siri | `models/hey-siri.nudge` |

```js
import { WakeWordDetector, models, resolveModel } from '@nudgeai/sdk';

const detector = await WakeWordDetector.create('hey-google');
try {
    console.log(detector.model); // Phrase, trained threshold, and version.
    // Feed your application's mono 16 kHz PCM with await detector.process(pcm).
} finally {
    await detector.close();
}

console.log(models.alexa); // Absolute path inside the installed package.
console.log(resolveModel('hey-siri')); // Absolute path to hey-siri.nudge.
```

`BuiltinModel` is the TypeScript union `'alexa' | 'hey-google' | 'hey-siri'`.
`models` maps these names to paths relative to the installed SDK, independently
of your working directory. `resolveModel()` expands exact built-in names and
passes other strings and `Uint8Array` values through unchanged. `create()`
resolves names automatically and verifies every built-in model's signature
unless `verifySignature: false` is set. No model downloads or online
verification are needed.

These three example models are included for personal, noncommercial use under
the [SDK and Example Models license](../LICENSE); company and commercial use
require a separate paid written license. Third-party components retain their
own terms; see [model notices](../models/NOTICE.md).

Custom signed files and bytes remain supported via
`WakeWordDetector.create('./custom.nudge')` or `WakeWordDetector.create(bytes)`.
Use an explicit path such as `./alexa` to address a file whose name matches an
alias. Hey Nudge is not included in the built-in set.

The browser entry accepts bytes, not these names or filesystem paths. To use
a bundled model in a browser, copy its `.nudge` file into your application's
static assets and load its bytes as described in [Browser integration](browser.md).

## Signature verification

Only `.nudge` envelopes signed by a key embedded in this SDK are accepted
unless `create(..., { verifySignature: false })`. That opt-out unwraps a
`.nudge` payload without checking the key or signature, or loads unsigned
ONNX, and prints a console warning that unverified models often detect less
accurately. Renaming an `.onnx` file does not convert it. The loader
authenticates the entire header and graph with Ed25519 **before** starting
ONNX Runtime when verification is on.
Unknown keys, invalid signatures, malformed lengths, truncation, unsupported
versions, and appended bytes fail closed. The graph is limited to 32 MiB.
`ModelVerificationError` identifies format and authentication failures;
`AudioCaptureError` identifies file decoder failures.

A signature proves the model was authorized by a holder of a trusted Nudge
private key. It does not encrypt the graph, measure model quality, prevent
replay of an older signed model, or prevent someone modifying their own SDK.
Offline revocation requires distributing a new SDK trust store. Customers
never need the private key, an account, or an online verification service.
