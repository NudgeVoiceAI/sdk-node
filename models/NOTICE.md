# Third-party components

Nudge's current models include Google's speech_embedding feature extractor,
converted to ONNX by openWakeWord. The feature extractor is Apache-2.0,
as documented in openWakeWord's Model Architecture section:
https://github.com/dscripka/openWakeWord#model-architecture
Original model: https://tfhub.dev/google/speech_embedding/1
Google's original model authors and David Scripka retain their respective rights.
openWakeWord code: Copyright 2022 David Scripka. All rights reserved.
License: ../licenses/Apache-2.0.txt.

Nudge uses only embedding_model.onnx and melspectrogram.onnx from the
openWakeWord v0.5.1 release. It does not use the project's pretrained
wake-phrase classifiers, which have a separate noncommercial license.
Nudge combines the feature graphs, normalizes input audio, and attaches its
own trained phrase classifier. The mel decibel floor is made per recording
to match batched training and individual inference. Original feature weights
are frozen.
Feature assets (openWakeWord v0.5.1):
- https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx
  SHA-256: 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
- https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx
  SHA-256: ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f
This notice and the Apache license are embedded in each exported ONNX model.

Training uses Kokoro-82M (hexgrad), licensed under Apache-2.0:
https://huggingface.co/hexgrad/Kokoro-82M
Kokoro is not included in the exported detector.

Training and development evaluation use LibriSpeech dev-clean, by Vassil
Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur:
https://www.openslr.org/12/ — CC BY 4.0:
https://creativecommons.org/licenses/by/4.0/
Audio is resampled, cropped, mixed and augmented for training. This attribution
does not claim that generated detector weights inherit the dataset license.

ONNX Runtime and other installed dependencies retain their own licenses,
provided in their distributions. This file does not relicense Nudge's own code.

This notice applies to alexa.nudge, hey-google.nudge, and hey-siri.nudge in
this directory. Nudge-owned portions are licensed under ../LICENSE.
Third-party components retain the rights granted by their own licenses.
