import * as ort from 'onnxruntime-node';
import { open } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { attach } from './model.js';
import { resolveModel } from './models.js';
import { MAX_MODEL_BYTES, verifySignedModel } from './signature.js';
import type { DetectorOptions, StreamingDetector } from './core.js';
export * from './core.js';
export { AudioSource, AudioCaptureError, ffmpegPCM } from './audio.js';
export type { AudioOptions } from './audio.js';
export { models, resolveModel } from './models.js';
export type { BuiltinModel } from './models.js';
export { ModelVerificationError } from './signature.js';

async function readModel(path: string): Promise<Uint8Array> {
	const file = await open(path, 'r');
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size < 1 || info.size > MAX_MODEL_BYTES) {
			throw new Error('Expected a regular .nudge file with a payload no larger than 32 MiB.');
		}
		const bytes = new Uint8Array(info.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) throw new Error('Model file was truncated while reading.');
			offset += bytesRead;
		}
		if ((await file.read(new Uint8Array(1), 0, 1, offset)).bytesRead) {
			throw new Error('Model file changed while reading.');
		}
		return bytes;
	} finally {
		await file.close();
	}
}

export class WakeWordDetector {
	/** Verify Nudge's offline signature (unless verifySignature is false), then open a local CPU session. */
	static async create(
		model: string | Uint8Array,
		options: DetectorOptions = {},
	): Promise<StreamingDetector> {
		const resolved = resolveModel(model);
		const bytes = await verifySignedModel(
			typeof resolved === 'string' ? await readModel(resolved) : resolved,
			undefined,
			(key, message, signature) => {
				const publicKey = createPublicKey({
					key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]),
					format: 'der',
					type: 'spki',
				});
				return verify(null, message, publicKey, signature);
			},
			{ verifySignature: options.verifySignature },
		);
		const session = await ort.InferenceSession.create(bytes, {
			executionProviders: ['cpu'],
			intraOpNumThreads: 2,
			interOpNumThreads: 1,
		});
		return attach(session, ort.Tensor, options);
	}
}
