# Browser integration

[Documentation](README.md) · [SDK overview](../README.md)

`@nudgeai/sdk/browser` accepts `.nudge` bytes and `wasmPath` pointing to
self-hosted assets from exactly the installed `onnxruntime-web` version.
It uses Web Crypto Ed25519 in a secure context (HTTPS or localhost). Browsers
without Ed25519 support cannot load signed models. The browser adapter owns
inference; browser microphone capture remains application-owned. Nudge Studio
supplies an AudioWorklet. `@nudgeai/sdk/core` exposes streaming PCM utilities.
Both server runtimes use the main `@nudgeai/sdk` entry.

To use a built-in model, copy its file from the package's `models/` directory
to your application's static assets, then pass its bytes to the browser loader:

```js
import { WakeWordDetector } from '@nudgeai/sdk/browser';

const response = await fetch('/models/alexa.nudge');
if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
const detector = await WakeWordDetector.create(
    new Uint8Array(await response.arrayBuffer()),
    { wasmPath: '/ort/' },
);
// Await detector.process(pcm) for each application-supplied mono 16 kHz frame.
// Await detector.close() when processing finishes.
```

Serve the matching ONNX Runtime WASM assets at `/ort/`. The browser entry does
not export the Node.js model path map or resolve built-in names.

The package is ESM. CommonJS can use
`const { WakeWordDetector } = await import('@nudgeai/sdk')` in an async function.
