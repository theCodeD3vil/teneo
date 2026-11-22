// The catalog ships with Teneo, not from a URL supplied by the webview.
const modelReleaseBase =
  "https://github.com/theCodeD3vil/teneo-models/releases/download/q12-v1";

export const classifierModel = {
  id: "teneo-minilm-q12-classifier",
  name: "Credential Classifier (MiniLM Q12)",
  role: "classification",
  description: "Classifies possible credentials in copied and synced text",
  bytes: 172_112_443 + 5_568_950,
  cutoff: 1.6076157228851318,
  weights: {
    filename: "teneo-minilm-q12.onnx",
    bytes: 172_112_443,
    sha256: "3896b0eac21fcb5544e80c10e300ec2df3137b14dda25b4de0aa9baf4920eff7",
    url: `${modelReleaseBase}/teneo-minilm-q12.onnx`,
  },
  tokenizer: {
    filename: "teneo-minilm-q12.spm",
    bytes: 5_568_950,
    sha256: "1c497b6f500a6760878983fc6d5b32b5d0db78efb3d57fce085c0fb2fe1230a2",
    url: `${modelReleaseBase}/teneo-minilm-q12.spm`,
  },
} as const;

export const gemmaModel = {
  id: "gemma-3-270m-it-qat-q4",
  name: "Gemma 3 270M Instruct",
  role: "general",
  description: "Preview action checks and general local tasks",
  bytes: 241_410_624,
  filename: "gemma-3-270m-it-qat-Q4_0.gguf",
  url: "https://huggingface.co/ggml-org/gemma-3-270m-it-qat-GGUF/resolve/7dba9faa7cdb58c7dc44b238c7dbb00e391fbf65/gemma-3-270m-it-qat-Q4_0.gguf",
  sha256: "3626e245220ca4a1c5911eb4010b3ecb7bdbf5bc53c79403c21355354d1e2dc6",
} as const;

export const developmentModel = gemmaModel;

export const maxInferenceBytes = 4096;
