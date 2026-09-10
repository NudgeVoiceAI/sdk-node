import type { InferenceSession, Tensor } from 'onnxruntime-common';
import { WINDOW_SAMPLES, StreamingDetector, type DetectorOptions } from './core.js';
type TensorFactory = new (type: 'float32', data: Float32Array, dims: number[]) => Tensor;
// Both runtime adapters supply these operations; newer metadata APIs are unused.
type RuntimeSession = Pick<InferenceSession, 'inputNames' | 'outputNames' | 'run' | 'release'>;
export async function attach(
	session: RuntimeSession,
	TensorClass: TensorFactory,
	options: DetectorOptions,
) {
	try {
		if (
			session.inputNames.length !== 1 ||
			session.inputNames[0] !== 'audio' ||
			!['score', 'threshold', 'label', 'version'].every((x) =>
				session.outputNames.includes(x),
			)
		) {
			throw new Error('Expected a Nudge ONNX model with embedded audio preprocessing.');
		}
		const result = await session.run({
			audio: new TensorClass('float32', new Float32Array(WINDOW_SAMPLES), [
				1,
				WINDOW_SAMPLES,
			]),
		});
		if (
			result.label.type !== 'int32' ||
			result.label.data.length < 1 ||
			result.label.data.length > 160 ||
			Array.from(result.label.data as Int32Array).some((value) => value < 0 || value > 255) ||
			result.threshold.data.length !== 1 ||
			result.version.data.length !== 1 ||
			result.score.data.length !== 1 ||
			result.threshold.type !== 'float32' ||
			result.version.type !== 'int32' ||
			result.score.type !== 'float32'
		) {
			throw new Error('Invalid Nudge model metadata tensors.');
		}
		const phrase = new TextDecoder('utf-8', { fatal: true }).decode(
			Uint8Array.from(result.label.data as Int32Array),
		);
		const model = {
			phrase,
			threshold: Number(result.threshold.data[0]),
			version: Number(result.version.data[0]),
		};
		return new StreamingDetector(
			model,
			async (audio) => {
				const result = await session.run({
					audio: new TensorClass('float32', audio, [1, WINDOW_SAMPLES]),
				});
				return Number(result.score.data[0]);
			},
			() => session.release(),
			options,
		);
	} catch (error) {
		await session.release();
		throw error;
	}
}
