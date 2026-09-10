import { createHash } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';

const keys = JSON.parse(
	await readFile(new URL('../src/trusted-keys.json', import.meta.url), 'utf8'),
);
if (!keys || Array.isArray(keys) || Object.keys(keys).length === 0)
	throw new Error('No Nudge public signing keys are provisioned.');
for (const [id, publicHex] of Object.entries(keys)) {
	if (
		!/^[a-f0-9]{64}$/.test(id) ||
		typeof publicHex !== 'string' ||
		!/^[a-f0-9]{64}$/.test(publicHex) ||
		createHash('sha256').update(Buffer.from(publicHex, 'hex')).digest('hex') !== id
	) {
		throw new Error('Invalid Nudge public trust store.');
	}
}
const entries = Object.entries(keys)
	.map(([id, publicHex]) => `\t'${id}':\n\t\t'${publicHex}',`)
	.join('\n');
await writeFile(
	new URL('../src/trusted-keys.ts', import.meta.url),
	`// Generated from trusted-keys.json by scripts/build-keys.mjs. Public keys only.\nexport default Object.freeze({\n${entries}\n});\n`,
);
// Fixed package-local output only. Prevent stale files from entering a release tarball.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
