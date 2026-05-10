Place optional voice runtime assets here.

`silero_vad.onnx` enables the direct ONNX Silero VAD strategy. When the model is
absent, the strategy keeps the same endpointing contract using calibrated energy
detection so voice sessions can still start.
