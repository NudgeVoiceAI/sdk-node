import * as ort from 'onnxruntime-web/wasm';
import { attach } from './model.js';
import type { DetectorOptions } from './core.js';
import { verifySignedModel } from './signature.js';
export * from './core.js';
export { ModelVerificationError } from './signature.js';

export class WakeWordDetector {
	static async create(model: Uint8Array, options: DetectorOptions & { wasmPath?: string } = {}) {
		const bytes = await verifySignedModel(model, undefined, undefined, {
			verifySignature: options.verifySignature,
		});
		ort.env.wasm.wasmPaths = options.wasmPath ?? '/ort/';
		ort.env.wasm.numThreads = 1;
		const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
		return attach(session, ort.Tensor, options);
	}
}
