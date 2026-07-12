# Local document intelligence service

The document intelligence runtime is isolated from the Node app in:

```powershell
.venv-document-intelligence
```

Run the full local setup and real smoke tests:

```powershell
npm run setup:document-intelligence
```

Run smoke tests again without reinstalling packages:

```powershell
npm run smoke:document-intelligence
```

The setup script:

- creates/verifies the project-local Python 3.10 venv
- installs CUDA PyTorch from the official cu126 index
- installs PaddlePaddle GPU 3.2.1 from the official cu126 Paddle index
- installs PaddleOCR-VL document parser dependencies
- installs Qwen3-VL Transformers dependencies
- inspects the machine/runtime
- runs real PaddleOCR-VL inference on the saved page image
- runs real Qwen3-VL image inference on the same image
- writes diagnostics under `data/document-intelligence-diagnostics`
- writes a tested `services/requirements-document-intelligence-lock.txt` only after smoke succeeds

The service itself remains localhost-bound:

```powershell
.venv-document-intelligence\Scripts\python.exe services\document_intelligence_service.py
```

Endpoints:

- `GET /health`
- `GET /environment`
- `POST /analyze-page`
- `POST /analyze-region`

Readiness rule:

`available: true` is reported only after dependencies import, the requested device is usable, the model loads, and a real smoke inference succeeds in the running process. Package presence alone is not enough.

Default cache roots are project-local and ignored by Git:

- `.cache/document-intelligence/huggingface`
- `.cache/document-intelligence/paddle`
- `.cache/document-intelligence/paddleocr`
- `.cache/document-intelligence/torch`

Normal app startup:

The Node server checks `http://127.0.0.1:8765`. If the service is unavailable and `DOCUMENT_UNDERSTANDING_AUTO_START` is not `0`, it starts `.venv-document-intelligence\Scripts\python.exe services\document_intelligence_service.py`, waits for health, and then continues. It does not spawn duplicate services. If startup fails, the app keeps heuristic fallback and returns structured startup diagnostics.

Current boundaries:

- no A4LayoutResolver
- no visible rendering change
- no `page-layout.js` change
- no Tesseract removal
- no mirror fallback removal
- no paid external API
