import test from './runner.mjs';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifySignedModel, ModelVerificationError, MAX_MODEL_BYTES } from '../dist/signature.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = createHash('sha256').update(raw).digest();
const keys = { [keyId.toString('hex')]: raw.toString('hex') };
const payload = Buffer.from('An authenticated payload, not an inference graph');
function envelope() {
	const header = Buffer.alloc(44);
	header.set([78, 85, 68, 71, 69, 0, 1, 0]);
	header.set(keyId, 8);
	header.writeUInt32BE(payload.length, 40);
	const message = Buffer.concat([header, payload]);
	return Buffer.concat([message, sign(null, message, privateKey)]);
}

test('offline Ed25519 verification returns the exact authenticated payload', async () => {
	assert.deepEqual(Buffer.from(await verifySignedModel(envelope(), keys)), payload);
});

test('Python-signed fixture verifies with the embedded company public key', async () => {
	const bytes = await readFile(new URL('fixtures/detector.nudge', import.meta.url));
	const verified = await verifySignedModel(bytes);
	assert.deepEqual(Buffer.from(verified), bytes.subarray(44, -64));
});

test('caller mutations during verification cannot change the loaded payload', async () => {
	const input = envelope();
	const result = verifySignedModel(input, keys);
	input.fill(0);
	assert.deepEqual(Buffer.from(await result), payload);
});

test('nonzero-offset views are verified without surrounding bytes', async () => {
	const original = envelope();
	const padded = Buffer.concat([Buffer.alloc(7), original, Buffer.alloc(19)]);
	assert.deepEqual(
		Buffer.from(await verifySignedModel(padded.subarray(7, 7 + original.length), keys)),
		payload,
	);
});

test('all header, payload and signature bytes are authenticated', async () => {
	const original = envelope();
	for (let index = 0; index < original.length; index++) {
		const altered = Buffer.from(original);
		altered[index] ^= 1;
		await assert.rejects(verifySignedModel(altered, keys), ModelVerificationError);
	}
});

test('truncation, append, zero/oversize lengths and unsigned ONNX fail closed', async () => {
	const original = envelope();
	const zero = Buffer.from(original);
	zero.writeUInt32BE(0, 40);
	const huge = Buffer.from(original);
	huge.writeUInt32BE(0xffffffff, 40);
	for (const input of [
		original.subarray(0, -1),
		Buffer.concat([original, Buffer.of(0)]),
		zero,
		huge,
		Buffer.alloc(200),
		new Uint8Array(MAX_MODEL_BYTES + 1),
	]) {
		await assert.rejects(verifySignedModel(input, keys), ModelVerificationError);
	}
	await assert.rejects(verifySignedModel('not bytes'), TypeError);
});

test('an attacker-signed envelope is not accepted by the company trust store', async () => {
	await assert.rejects(verifySignedModel(envelope()), /not trusted/);
	await assert.rejects(verifySignedModel(envelope(), {}), /not trusted/);
});

test('verifySignature: false unwraps envelopes without a trusted key and accepts unsigned bytes', async () => {
	const skip = { verifySignature: false };
	const unsigned = Buffer.from('not-a-nudge-envelope');
	assert.deepEqual(Buffer.from(await verifySignedModel(unsigned, {}, undefined, skip)), unsigned);
	assert.deepEqual(
		Buffer.from(await verifySignedModel(envelope(), {}, undefined, skip)),
		payload,
	);
	const flipped = Buffer.from(envelope());
	flipped[flipped.length - 1] ^= 1;
	assert.deepEqual(Buffer.from(await verifySignedModel(flipped, {}, undefined, skip)), payload);
	await assert.rejects(
		verifySignedModel(new Uint8Array(MAX_MODEL_BYTES + 1), {}, undefined, skip),
		ModelVerificationError,
	);
});
