param(
  [string]$VenvPath = "",
  [string]$SmokeImage = "",
  [switch]$SkipInstall,
  [switch]$ParserOnly,
  [switch]$VisionOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $VenvPath) {
  $VenvPath = Join-Path $ProjectRoot ".venv-document-intelligence"
}
if (-not $SmokeImage) {
  $SmokeImage = Join-Path $ProjectRoot "data\national-test-page-images\1783748747200-3c600909-7451-4de1-b0a0-76288da5720d.jpg"
}

$Python = Join-Path $VenvPath "Scripts\python.exe"
$DiagnosticsDir = Join-Path $ProjectRoot "data\document-intelligence-diagnostics"
$CacheDir = Join-Path $ProjectRoot ".cache\document-intelligence"
New-Item -ItemType Directory -Force -Path $DiagnosticsDir | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

$env:HF_HOME = if ($env:HF_HOME) { $env:HF_HOME } else { Join-Path $CacheDir "huggingface" }
$env:PADDLE_HOME = if ($env:PADDLE_HOME) { $env:PADDLE_HOME } else { Join-Path $CacheDir "paddle" }
$env:PADDLEOCR_HOME = if ($env:PADDLEOCR_HOME) { $env:PADDLEOCR_HOME } else { Join-Path $CacheDir "paddleocr" }
$env:TORCH_HOME = if ($env:TORCH_HOME) { $env:TORCH_HOME } else { Join-Path $CacheDir "torch" }
$env:ENABLE_PADDLEOCR_VL = if ($VisionOnly) { "0" } else { "1" }
$env:ENABLE_QWEN_VL = if ($ParserOnly) { "0" } else { "1" }

if (-not (Test-Path $Python)) {
  py -3.10 -m venv $VenvPath
}

if (-not $SkipInstall) {
  & $Python -m pip install --upgrade pip setuptools wheel
  & $Python -m pip install -r (Join-Path $ProjectRoot "services\requirements-document-intelligence-core.txt")
  if (-not $VisionOnly) {
    & $Python -m pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
    & $Python -m pip install -r (Join-Path $ProjectRoot "services\requirements-document-intelligence-parser.txt")
  }
  if (-not $ParserOnly) {
    & $Python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
    & $Python -m pip install -r (Join-Path $ProjectRoot "services\requirements-document-intelligence-vision.txt")
  }
}

& $Python (Join-Path $ProjectRoot "services\document_intelligence_service.py") --inspect | Tee-Object -FilePath (Join-Path $DiagnosticsDir "environment-inspection.json")

$Providers = "all"
if ($ParserOnly) { $Providers = "parser" }
if ($VisionOnly) { $Providers = "vision" }

& $Python (Join-Path $ProjectRoot "services\document_intelligence_service.py") --smoke-test --providers $Providers --image $SmokeImage --output (Join-Path $DiagnosticsDir "setup-smoke.json")
if ($LASTEXITCODE -ne 0) {
  throw "Document intelligence smoke tests failed. See data\document-intelligence-diagnostics."
}

& $Python -m pip freeze | Out-File -Encoding utf8 (Join-Path $ProjectRoot "services\requirements-document-intelligence-lock.txt")
Write-Host "Document intelligence setup ready."
Write-Host "Python: $Python"
Write-Host "Diagnostics: $DiagnosticsDir"
