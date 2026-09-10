// Run the same assertions using each runtime's native test harness.
const { test } = await import(globalThis.Bun ? 'bun:test' : 'node:test');
export default test;
