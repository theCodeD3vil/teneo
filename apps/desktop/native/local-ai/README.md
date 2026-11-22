# Local AI on macOS

MiniLMv2 Q12 classifies possible credentials in copied and synced text. Gemma
3 270M Instruct adds preview checks and can serve as a fallback classifier. The
[Gemma Terms](https://ai.google.dev/gemma/terms) apply to its weights. Neither
model is included in the app.

The XPC service runs in App Sandbox with no network or file-read entitlements
and links only Apple dynamic libraries. The native client verifies local model
files against app-pinned byte lengths and SHA-256 hashes before passing
read-only descriptors to the service. Inference text travels only over stdin
and private XPC. Local AI is opt-in.

From `apps/desktop` on a Mac with Xcode command-line tools and CMake:

```sh
bun run local-ai:build
bun run local-ai:smoke
```

The smoke test requires both models. Install them from Settings in Teneo Debug,
or place the pinned artifacts in its dev model folder. Q12 artifacts can also
be supplied in `.local-ai-build/benchmarks/minilm-finetune/lookup-quant/artifact-lean/`
as `model.onnx` and `tokenizer.model`. With Gemma installed, run the real
backend integration tests:

```sh
weights="$HOME/Library/Application Support/com.michael.teneo.debug/dev/models/gemma-3-270m-it-qat-Q4_0.gguf"
TINYJS_ICON=test bun scripts/run-on-tjs.ts backend/local-ai.tjs.ts "$weights"
TINYJS_ICON=test bun scripts/run-on-tjs.ts backend/local-ai-bts.tjs.ts "$weights"
```

The release packager stages and signs the helper for each Mac architecture
before creating the DMG and ZIP. See the
[release process](../../../../docs/release-process.md). The Q12 artifacts are
published separately in
[`theCodeD3vil/teneo-models@q12-v1`](https://github.com/theCodeD3vil/teneo-models/releases/tag/q12-v1);
`bun run local-ai:publish-models` verifies local files against the app's
catalog and will not overwrite existing pinned assets.
