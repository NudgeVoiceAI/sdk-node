import { fileURLToPath } from 'node:url';

export const models = {
	alexa: fileURLToPath(new URL('../models/alexa.nudge', import.meta.url)),
	'hey-google': fileURLToPath(new URL('../models/hey-google.nudge', import.meta.url)),
	'hey-siri': fileURLToPath(new URL('../models/hey-siri.nudge', import.meta.url)),
} as const;

export type BuiltinModel = keyof typeof models;

export function resolveModel(model: string | Uint8Array): string | Uint8Array {
	return typeof model === 'string' && Object.hasOwn(models, model)
		? models[model as BuiltinModel]
		: model;
}
