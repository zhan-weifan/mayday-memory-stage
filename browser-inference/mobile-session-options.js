// These options apply to the Lite ONNX model on the WASM CPU backend only.
// Experimental: less initialization work is not a measured memory guarantee.
// Keep memory-pattern reuse for inference; disable_prepacking was already set
// in the standard path. ORT-format zero-copy flags do not apply to this ONNX file.
export function mobileSessionOptions(weightName, weights, lean = false) {
  return {
    executionProviders: ['wasm'],
    externalData: [{path: weightName, data: weights}],
    graphOptimizationLevel: lean === true ? 'disabled' : 'all',
    enableCpuMemArena: lean !== true,
    enableMemPattern: true,
    executionMode: 'sequential',
    extra: {session: {disable_prepacking: '1'}}
  };
}
