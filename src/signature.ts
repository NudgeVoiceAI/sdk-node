import trustedKeys from './trusted-keys.js';

const MAGIC = new Uint8Array([78, 85, 68, 71, 69, 0, 1, 0]);
const HEADER_SIZE = 44;
const SIGNATURE_SIZE = 64;
export const MAX_MODEL_BYTES = 32 * 1024 * 1024 + HEADER_SIZE + SIGNATURE_SIZE;

export class ModelVerificationError extends Error {
	override readonly name = 'ModelVerificationError';
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
	if (!/^[0-9a-f]{64}$/.test(hex)) {
		throw new ModelVerificationError('Invalid Nudge public key.');
	}
	return Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

function hasMagic(bytes: Uint8Array): boolean {
	return MAGIC.every((value, index) => bytes[index] === value);
}

function envelopePayload(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
	if (bytes.length <= HEADER_SIZE + SIGNATURE_SIZE) {
		throw new ModelVerificationError('Invalid .nudge file size (maximum payload: 32 MiB).');
	}
	const size = new DataView(bytes.buffer).getUint32(40, false);
	if (size === 0 || size + HEADER_SIZE + SIGNATURE_SIZE !== bytes.length) {
		throw new ModelVerificationError('Invalid .nudge payload length.');
	}
	return bytes.slice(HEADER_SIZE, -SIGNATURE_SIZE);
}

/** Verify a private snapshot before any model bytes reach the inference runtime. */
export async function verifySignedModel(
	input: Uint8Array,
	keys: Readonly<Record<string, string>> = trustedKeys,
	verify?: (
		key: Uint8Array<ArrayBuffer>,
		message: Uint8Array<ArrayBuffer>,
		signature: Uint8Array<ArrayBuffer>,
	) => boolean,
	options: { verifySignature?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
	if (!(input instanceof Uint8Array)) {
		throw new TypeError('Expected a signed .nudge file as Uint8Array.');
	}
	if (options.verifySignature !== undefined && typeof options.verifySignature !== 'boolean') {
		throw new TypeError('verifySignature must be a boolean.');
	}
	if (input.length < 1 || input.length > MAX_MODEL_BYTES) {
		throw new ModelVerificationError('Invalid .nudge file size (maximum payload: 32 MiB).');
	}
	// Uint8Array.from also copies Buffer and SharedArrayBuffer-backed views.
	const bytes = Uint8Array.from(input);
	if (options.verifySignature === false) {
		console.warn(
			'[nudge] Signature verification is off. Unverified models are not authenticated and often detect less accurately than official signed Nudge models.',
		);
		return hasMagic(bytes) ? envelopePayload(bytes) : bytes;
	}
	if (!hasMagic(bytes)) {
		throw new ModelVerificationError(
			'Expected a signed Nudge v1 .nudge file; unsigned ONNX is not supported.',
		);
	}
	const payload = envelopePayload(bytes);
	const keyId = Array.from(bytes.subarray(8, 40), (value) =>
		value.toString(16).padStart(2, '0'),
	).join('');
	const publicHex = Object.hasOwn(keys, keyId) ? keys[keyId] : undefined;
	if (!publicHex) {
		throw new ModelVerificationError('Model signing key is not trusted by Nudge.');
	}
	if (!verify && !globalThis.crypto?.subtle) {
		throw new ModelVerificationError(
			'Offline Ed25519 verification requires Web Crypto (a secure context in browsers).',
		);
	}
	const publicKey = fromHex(publicHex);
	const valid = verify
		? verify(publicKey, bytes.subarray(0, -SIGNATURE_SIZE), bytes.subarray(-SIGNATURE_SIZE))
		: await crypto.subtle.verify(
				'Ed25519',
				await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']),
				bytes.subarray(-SIGNATURE_SIZE),
				bytes.subarray(0, -SIGNATURE_SIZE),
			);
	if (!valid) {
		throw new ModelVerificationError(
			'Invalid Nudge model signature; the file may have been modified.',
		);
	}
	return payload;
}
