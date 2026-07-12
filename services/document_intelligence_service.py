#!/usr/bin/env python3
"""
Local document intelligence service.

This service is intentionally localhost-only and local-model-only. Provider
readiness is strict: a provider reports available=true only after dependencies
import, the requested device is usable, the model loads, and a real smoke
inference succeeds inside the current process.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
import traceback
import site
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
PAGE_IMAGE_DIR = DATA_DIR / "national-test-page-images"
DIAGNOSTIC_DIR = DATA_DIR / "document-intelligence-diagnostics"
DEFAULT_PAGE4_IMAGE = PAGE_IMAGE_DIR / "1783748747200-3c600909-7451-4de1-b0a0-76288da5720d.jpg"

HOST = os.environ.get("DOCUMENT_INTELLIGENCE_HOST", "127.0.0.1")
PORT = int(os.environ.get("DOCUMENT_INTELLIGENCE_PORT", "8765"))
MAX_BODY_BYTES = int(os.environ.get("DOCUMENT_INTELLIGENCE_MAX_BODY_BYTES", str(8 * 1024 * 1024)))

DOCUMENT_PARSER_MODEL = os.environ.get("DOCUMENT_PARSER_MODEL", "PaddleOCR-VL-1.6")
VISION_REASONER_MODEL = os.environ.get("VISION_REASONER_MODEL", "Qwen/Qwen3-VL-8B-Instruct")
PARSER_DEVICE_REQUEST = os.environ.get("DOCUMENT_PARSER_DEVICE", "cuda").lower()
VISION_DEVICE_REQUEST = os.environ.get("VISION_REASONER_DEVICE", "cuda").lower()
ENABLE_PADDLEOCR_VL = os.environ.get("ENABLE_PADDLEOCR_VL", "1") == "1"
ENABLE_QWEN_VL = os.environ.get("ENABLE_QWEN_VL", "1") == "1"
HEALTH_RUNS_SMOKE = os.environ.get("DOCUMENT_INTELLIGENCE_HEALTH_SMOKE", "0") == "1"
VISION_MAX_NEW_TOKENS = int(os.environ.get("VISION_REASONER_MAX_NEW_TOKENS", "900"))
VISION_QUANTIZATION = os.environ.get("VISION_REASONER_QUANTIZATION", "none")
PROVIDER_SUBPROCESSES_ENABLED = os.environ.get("DOCUMENT_INTELLIGENCE_PROVIDER_SUBPROCESSES", "1") == "1"
PROVIDER_WORKER_TIMEOUT_SECONDS = int(os.environ.get("DOCUMENT_INTELLIGENCE_PROVIDER_TIMEOUT_SECONDS", "1200"))

SCHEMA_DOCUMENT_PROVIDER = "document-provider-analysis/v1"
SCHEMA_VISION_PROVIDER = "vision-document-analysis/v1"
SCHEMA_HYBRID = "hybrid-document-analysis/v1"

FAILURE_CODES = {
    "dependency-missing",
    "model-download-failed",
    "model-load-failed",
    "cuda-unavailable",
    "cuda-out-of-memory",
    "inference-timeout",
    "invalid-model-output",
    "unsupported-runtime",
    "image-not-found",
    "provider-disabled",
    "smoke-inference-failed",
}

DLL_DIRECTORY_HANDLES: list[Any] = []
TORCH_IMPORT_GUARD_INSTALLED = False


def register_packaged_cuda_dll_directories() -> list[str]:
    """Register CUDA DLL directories shipped inside Python wheels on Windows.

    Paddle's Windows GPU wheel depends on CUDA/cuDNN DLLs installed under
    site-packages/nvidia/*/bin. Those directories are not always visible to the
    Windows loader when importing paddle from a venv, so provider readiness must
    register them before any paddle import/probe.
    """

    if platform.system().lower() != "windows":
        return []
    roots: list[Path] = []
    try:
        roots.extend(Path(path) for path in site.getsitepackages())
    except Exception:
        pass
    roots.append(Path(sys.prefix) / "Lib" / "site-packages")

    registered: list[str] = []
    seen: set[str] = set()
    for root in roots:
        nvidia_root = root / "nvidia"
        if not nvidia_root.exists():
            continue
        for bin_dir in sorted(nvidia_root.glob("*\\bin")):
            if not bin_dir.is_dir():
                continue
            normalized = str(bin_dir.resolve())
            if normalized.lower() in seen:
                continue
            seen.add(normalized.lower())
            try:
                if hasattr(os, "add_dll_directory"):
                    DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(normalized))
                os.environ["PATH"] = normalized + os.pathsep + os.environ.get("PATH", "")
                registered.append(normalized)
            except OSError:
                continue
    return registered


PACKAGED_CUDA_DLL_DIRECTORIES = register_packaged_cuda_dll_directories()


def disable_torch_imports_for_parser_process() -> None:
    """Hide Torch from optional parser imports after Paddle has loaded.

    PaddleOCR's import graph may check for Torch and import optional Torch
    modules. In the combined project environment that conflicts with Paddle's
    cuDNN DLLs on Windows. Parser workers do not use Torch, so we report it as
    unavailable only inside the parser process.
    """

    global TORCH_IMPORT_GUARD_INSTALLED
    if TORCH_IMPORT_GUARD_INSTALLED:
        return
    import builtins
    import importlib.util

    real_import = builtins.__import__
    real_find_spec = importlib.util.find_spec

    def guarded_import(name: str, globals: Any = None, locals: Any = None, fromlist: Any = (), level: int = 0) -> Any:
        if name == "torch" or name.startswith("torch."):
            raise ImportError("torch is disabled in the PaddleOCR-VL parser process")
        return real_import(name, globals, locals, fromlist, level)

    def guarded_find_spec(name: str, package: str | None = None) -> Any:
        if name == "torch" or name.startswith("torch."):
            return None
        return real_find_spec(name, package)

    builtins.__import__ = guarded_import
    importlib.util.find_spec = guarded_find_spec
    TORCH_IMPORT_GUARD_INSTALLED = True


@dataclass
class ProviderState:
    available: bool = False
    state: str = "not-loaded"
    failureReason: str | None = None
    failureDetail: str | None = None
    runtime: str | None = None
    device: str = "unknown"
    modelLoaded: bool = False
    smokeTestPassed: bool = False
    lastSmokeTest: dict[str, Any] | None = None
    lastInference: dict[str, Any] | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


class ProviderFailure(RuntimeError):
    def __init__(self, reason: str, detail: str = "", diagnostics: dict[str, Any] | None = None):
        super().__init__(detail or reason)
        self.reason = reason if reason in FAILURE_CODES else "unsupported-runtime"
        self.detail = detail or reason
        self.diagnostics = diagnostics or {}


def module_version(module_name: str) -> dict[str, Any]:
    try:
        module = __import__(module_name)
        return {"installed": True, "version": str(getattr(module, "__version__", "") or "")}
    except Exception as exc:
        return {"installed": False, "version": None, "error": f"{type(exc).__name__}: {exc}"}


def run_command(args: list[str], timeout: int = 12) -> tuple[int, str, str]:
    try:
        completed = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return completed.returncode, completed.stdout.strip(), completed.stderr.strip()
    except Exception as exc:
        return 1, "", f"{type(exc).__name__}: {exc}"


def inspect_environment() -> dict[str, Any]:
    nvidia = inspect_nvidia()
    torch_state = inspect_runtime_isolated("torch")
    paddle_state = inspect_runtime_isolated("paddle")
    return {
        "schemaVersion": "document-intelligence-environment/v1",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "windows": inspect_windows(),
        "python": {
            "executable": sys.executable,
            "version": sys.version.replace("\n", " "),
            "prefix": sys.prefix,
            "basePrefix": getattr(sys, "base_prefix", sys.prefix),
            "virtualEnv": os.environ.get("VIRTUAL_ENV"),
            "isVirtualEnv": sys.prefix != getattr(sys, "base_prefix", sys.prefix),
        },
        "pip": inspect_pip(),
        "conda": {"prefix": os.environ.get("CONDA_PREFIX"), "defaultEnv": os.environ.get("CONDA_DEFAULT_ENV")},
        "hardware": {
            "gpuDetected": bool(nvidia.get("gpuDetected")),
            "gpuName": nvidia.get("gpuName"),
            "driverVersion": nvidia.get("driverVersion"),
            "cudaCompatibilityVersion": nvidia.get("cudaCompatibilityVersion"),
            "totalVramMb": nvidia.get("totalVramMb"),
            "freeVramMb": nvidia.get("freeVramMb"),
        },
        "cudaToolkits": list_cuda_toolkits(),
        "packagedCudaDllDirectories": PACKAGED_CUDA_DLL_DIRECTORIES,
        "runtimes": {
            "pytorch": torch_state,
            "paddle": paddle_state,
            "transformers": module_version("transformers"),
            "paddleocr": module_version("paddleocr"),
            "qwen_vl_utils": module_version("qwen_vl_utils"),
        },
        "modelCaches": model_cache_locations(),
    }


def json_from_stdout(stdout: str) -> dict[str, Any] | None:
    text = stdout.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def inspect_runtime_isolated(runtime: str) -> dict[str, Any]:
    """Probe a GPU runtime in a child process to avoid CUDA DLL conflicts."""

    if os.environ.get("DOCUMENT_INTELLIGENCE_RUNTIME_PROBE_CHILD") == "1":
        return inspect_torch() if runtime == "torch" else inspect_paddle()
    env = os.environ.copy()
    env["DOCUMENT_INTELLIGENCE_RUNTIME_PROBE_CHILD"] = "1"
    try:
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--probe-runtime", runtime],
            cwd=str(ROOT_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=int(os.environ.get("DOCUMENT_INTELLIGENCE_RUNTIME_PROBE_TIMEOUT_SECONDS", "90")),
            check=False,
        )
    except Exception as exc:
        return {"installed": False, "error": f"{type(exc).__name__}: {exc}", "cudaAvailable": False}
    parsed = json_from_stdout(completed.stdout)
    if completed.returncode == 0 and isinstance(parsed, dict):
        if completed.stderr.strip():
            parsed.setdefault("warnings", completed.stderr.strip())
        parsed["isolatedProcess"] = True
        return parsed
    detail = completed.stderr.strip() or completed.stdout.strip() or f"exit code {completed.returncode}"
    return {"installed": False, "error": detail, "cudaAvailable": False, "isolatedProcess": True}


def inspect_windows() -> dict[str, Any]:
    if platform.system().lower() != "windows":
        return {"system": platform.system(), "release": platform.release(), "version": platform.version()}
    code, stdout, stderr = run_command(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture | ConvertTo-Json -Compress",
        ]
    )
    if code == 0 and stdout:
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            pass
    return {"system": platform.system(), "release": platform.release(), "version": platform.version(), "error": stderr}


def inspect_pip() -> dict[str, Any]:
    code, stdout, stderr = run_command([sys.executable, "-m", "pip", "--version"])
    return {"available": code == 0, "version": stdout if code == 0 else None, "error": stderr if code else None}


def inspect_nvidia() -> dict[str, Any]:
    code, stdout, stderr = run_command(
        ["nvidia-smi", "--query-gpu=name,driver_version,memory.total,memory.free", "--format=csv,noheader,nounits"]
    )
    result: dict[str, Any] = {"gpuDetected": False, "error": stderr if code else None}
    if code == 0 and stdout:
        first = stdout.splitlines()[0]
        parts = [part.strip() for part in first.split(",")]
        result.update(
            {
                "gpuDetected": True,
                "gpuName": parts[0] if len(parts) > 0 else None,
                "driverVersion": parts[1] if len(parts) > 1 else None,
                "totalVramMb": int(float(parts[2])) if len(parts) > 2 and parts[2] else None,
                "freeVramMb": int(float(parts[3])) if len(parts) > 3 and parts[3] else None,
            }
        )
    code_full, stdout_full, _stderr_full = run_command(["nvidia-smi"])
    if code_full == 0:
        match = re.search(r"CUDA (?:UMD )?Version:\s*([0-9.]+)", stdout_full)
        if match:
            result["cudaCompatibilityVersion"] = match.group(1)
    return result


def list_cuda_toolkits() -> list[dict[str, Any]]:
    root = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA")
    if not root.exists():
        return []
    toolkits = []
    for child in sorted(root.iterdir()):
        if child.is_dir() and child.name.lower().startswith("v"):
            nvcc = child / "bin" / "nvcc.exe"
            version = None
            if nvcc.exists():
                code, stdout, _stderr = run_command([str(nvcc), "--version"])
                if code == 0:
                    match = re.search(r"release\s+([0-9.]+)", stdout)
                    version = match.group(1) if match else None
            toolkits.append({"path": str(child), "name": child.name, "nvccVersion": version})
    return toolkits


def inspect_torch() -> dict[str, Any]:
    state = module_version("torch")
    if not state["installed"]:
        return state | {"cudaAvailable": False, "cudaRuntime": None}
    try:
        import torch  # type: ignore

        cuda_available = bool(torch.cuda.is_available())
        state.update(
            {
                "cudaAvailable": cuda_available,
                "cudaRuntime": str(getattr(torch.version, "cuda", None) or ""),
                "deviceCount": torch.cuda.device_count() if cuda_available else 0,
                "deviceName": torch.cuda.get_device_name(0) if cuda_available else None,
            }
        )
    except Exception as exc:
        state.update({"cudaAvailable": False, "cudaRuntime": None, "error": f"{type(exc).__name__}: {exc}"})
    return state


def inspect_paddle() -> dict[str, Any]:
    state = module_version("paddle")
    if not state["installed"]:
        return state | {"cudaAvailable": False}
    try:
        import paddle  # type: ignore

        cuda_available = bool(paddle.is_compiled_with_cuda())
        device = None
        try:
            device = paddle.device.get_device()
        except Exception:
            device = None
        state.update({"cudaAvailable": cuda_available, "device": device})
    except Exception as exc:
        state.update({"cudaAvailable": False, "error": f"{type(exc).__name__}: {exc}"})
    return state


def model_cache_locations() -> dict[str, Any]:
    default_hf = Path.home() / ".cache" / "huggingface"
    default_paddle = Path.home() / ".paddleocr"
    return {
        "HF_HOME": os.environ.get("HF_HOME") or str(default_hf),
        "TRANSFORMERS_CACHE": os.environ.get("TRANSFORMERS_CACHE"),
        "HUGGINGFACE_HUB_CACHE": os.environ.get("HUGGINGFACE_HUB_CACHE"),
        "TORCH_HOME": os.environ.get("TORCH_HOME"),
        "PADDLE_HOME": os.environ.get("PADDLE_HOME"),
        "PADDLEOCR_HOME": os.environ.get("PADDLEOCR_HOME") or str(default_paddle),
        "XDG_CACHE_HOME": os.environ.get("XDG_CACHE_HOME"),
    }


def directory_size(path: str | Path | None) -> int | None:
    if not path:
        return None
    root = Path(path).expanduser()
    if not root.exists():
        return 0
    total = 0
    for file in root.rglob("*"):
        try:
            if file.is_file():
                total += file.stat().st_size
        except OSError:
            pass
    return total


def peak_gpu_memory_mb() -> int | None:
    code, stdout, _stderr = run_command(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], timeout=5)
    if code != 0 or not stdout:
        return None
    try:
        return int(float(stdout.splitlines()[0].strip()))
    except ValueError:
        return None


def image_dimensions(image_path: Path) -> dict[str, int]:
    try:
        from PIL import Image  # type: ignore

        with Image.open(image_path) as image:
            return {"width": int(image.width), "height": int(image.height)}
    except Exception:
        return {"width": 0, "height": 0}


def normalize_bbox_from_xyxy(value: Any, width: int, height: int) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        if {"x", "y", "width", "height"}.issubset(value.keys()):
            x = safe_float(value.get("x"))
            y = safe_float(value.get("y"))
            w = safe_float(value.get("width"))
            h = safe_float(value.get("height"))
            if max(x, y, w, h) > 1.5 and width > 0 and height > 0:
                x, w = x / width, w / width
                y, h = y / height, h / height
            return clamp_bbox({"x": x, "y": y, "width": w, "height": h})
        if {"x1", "y1", "x2", "y2"}.issubset(value.keys()):
            return normalize_bbox_from_xyxy([value["x1"], value["y1"], value["x2"], value["y2"]], width, height)
    if isinstance(value, (list, tuple)):
        flat = flatten_numbers(value)
        if len(flat) >= 4:
            xs = flat[0::2]
            ys = flat[1::2]
            x1, x2 = min(xs), max(xs)
            y1, y2 = min(ys), max(ys)
            if max(x2, y2) > 1.5 and width > 0 and height > 0:
                x1, x2 = x1 / width, x2 / width
                y1, y2 = y1 / height, y2 / height
            return clamp_bbox({"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1})
    return None


def flatten_numbers(value: Any) -> list[float]:
    numbers: list[float] = []
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numbers.append(float(value))
    elif isinstance(value, (list, tuple)):
        for item in value:
            numbers.extend(flatten_numbers(item))
    return numbers


def clamp_bbox(box: dict[str, float]) -> dict[str, Any] | None:
    x = max(0.0, min(1.0, safe_float(box.get("x"))))
    y = max(0.0, min(1.0, safe_float(box.get("y"))))
    width = max(0.0, min(1.0 - x, safe_float(box.get("width"))))
    height = max(0.0, min(1.0 - y, safe_float(box.get("height"))))
    if width <= 0 or height <= 0:
        return None
    return {
        "x": round(x, 6),
        "y": round(y, 6),
        "width": round(width, 6),
        "height": round(height, 6),
        "coordinateSpace": "source-document-plane-normalized",
    }


def safe_float(value: Any) -> float:
    try:
        number = float(value)
        return number if number == number else 0.0
    except Exception:
        return 0.0


def optional_confidence(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except Exception:
        return None
    if not number == number:
        return None
    if number > 1:
        number = number / 100
    return round(max(0.0, min(1.0, number)), 4)


def to_plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): to_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(v) for v in value]
    if hasattr(value, "tolist"):
        try:
            return to_plain(value.tolist())
        except Exception:
            pass
    if hasattr(value, "json"):
        try:
            return to_plain(value.json)
        except Exception:
            pass
    return str(value)


def extract_json_object(text: str) -> dict[str, Any]:
    candidate = str(text or "").strip()
    if not candidate:
        raise ProviderFailure("invalid-model-output", "Vision model returned empty output.")
    candidate = re.sub(r"^```(?:json)?\s*", "", candidate, flags=re.IGNORECASE).strip()
    candidate = re.sub(r"\s*```$", "", candidate).strip()
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start >= 0 and end > start:
        candidate = candidate[start : end + 1]
    attempts = unique_strings(
        [
            candidate,
            re.sub(r",\s*([}\]])", r"\1", candidate),
            repair_common_json_commas(candidate),
            repair_common_json_commas(re.sub(r",\s*([}\]])", r"\1", candidate)),
            repair_truncated_json(candidate),
            repair_truncated_json(repair_common_json_commas(candidate)),
        ]
    )
    last_error: Exception | None = None
    for index, attempt in enumerate(attempts):
        try:
            parsed = json.loads(attempt)
            if isinstance(parsed, dict):
                parsed["_jsonRepairAttempts"] = index
                return parsed
        except Exception as exc:
            last_error = exc
    raw_path = write_diagnostic_text("qwen-invalid-json", candidate)
    raise ProviderFailure(
        "invalid-model-output",
        f"Unable to parse model JSON: {last_error}",
        {"rawModelOutputPath": str(raw_path), "rawModelOutputPreview": candidate[:1200]},
    )


def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def repair_common_json_commas(value: str) -> str:
    repaired = str(value or "")
    repaired = re.sub(r'(?<=[}\]"])\s*\n\s*(?="[^"]+"\s*:)', ",\n", repaired)
    repaired = re.sub(r'(?<=[0-9eE])\s*\n\s*(?="[^"]+"\s*:)', ",\n", repaired)
    repaired = re.sub(r'(?<=true)\s*\n\s*(?="[^"]+"\s*:)', ",\n", repaired)
    repaired = re.sub(r'(?<=false)\s*\n\s*(?="[^"]+"\s*:)', ",\n", repaired)
    repaired = re.sub(r'(?<=null)\s*\n\s*(?="[^"]+"\s*:)', ",\n", repaired)
    repaired = re.sub(r'(?<=[}\]"])\s*\n\s*(?=[{\[])', ",\n", repaired)
    return repaired


def repair_truncated_json(value: str) -> str:
    """Close a valid JSON prefix that was truncated before container endings.

    Observed Qwen failure: the response contains a syntactically valid prefix
    ending inside page.readingOrder after a completed object. The model stopped
    before emitting the closing array/object delimiters. This repair does not
    invent fields; it only balances still-open strings/arrays/objects so the
    prefix can be normalized and validated.
    """

    text = str(value or "").rstrip()
    stack: list[str] = []
    in_string = False
    escape = False
    for char in text:
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            stack.append("}")
        elif char == "[":
            stack.append("]")
        elif char in "}]":
            if stack and stack[-1] == char:
                stack.pop()
    if in_string:
        text += '"'
    text = re.sub(r",\s*$", "", text)
    if stack:
        text += "".join(reversed(stack))
    return text


def write_diagnostic_text(prefix: str, content: str) -> Path:
    DIAGNOSTIC_DIR.mkdir(parents=True, exist_ok=True)
    path = DIAGNOSTIC_DIR / f"{prefix}-{int(time.time() * 1000)}.txt"
    path.write_text(str(content or ""), encoding="utf-8", errors="replace")
    return path


def resolve_image_reference(reference: str | None) -> Path | None:
    if not reference:
        return None
    text = str(reference)
    if text.startswith("/national-test-page-images/"):
        candidate = PAGE_IMAGE_DIR / Path(text).name
        return candidate if candidate.exists() else None
    path = Path(text)
    if path.is_absolute():
        return path if path.exists() else None
    candidate = (ROOT_DIR / path).resolve()
    return candidate if candidate.exists() else None


def image_path_from_payload(payload: dict[str, Any]) -> Path:
    candidates = [
        payload.get("source", {}).get("normalizedPageImage"),
        payload.get("source", {}).get("sourcePageImage"),
        payload.get("page", {}).get("normalizedPage", {}).get("url"),
        payload.get("page", {}).get("sourcePage", {}).get("url"),
        payload.get("page", {}).get("sourceContainer", {}).get("source", {}).get("normalized", {}).get("url"),
        payload.get("page", {}).get("sourceContainer", {}).get("source", {}).get("original", {}).get("url"),
    ]
    for candidate in candidates:
        resolved = resolve_image_reference(candidate)
        if resolved:
            return resolved
    raise ProviderFailure("image-not-found", f"No readable page image found in payload. Checked: {candidates!r}")


def crop_region_image(image_path: Path, region: dict[str, Any] | None) -> Path:
    bbox = region.get("bbox") if isinstance(region, dict) else None
    normalized = clamp_bbox(bbox) if isinstance(bbox, dict) else None
    if not normalized:
        return image_path
    from PIL import Image  # type: ignore

    DIAGNOSTIC_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(image_path) as image:
        x1 = int(normalized["x"] * image.width)
        y1 = int(normalized["y"] * image.height)
        x2 = int((normalized["x"] + normalized["width"]) * image.width)
        y2 = int((normalized["y"] + normalized["height"]) * image.height)
        x1 = max(0, min(image.width - 1, x1))
        y1 = max(0, min(image.height - 1, y1))
        x2 = max(x1 + 1, min(image.width, x2))
        y2 = max(y1 + 1, min(image.height, y2))
        crop = image.crop((x1, y1, x2, y2))
        output = DIAGNOSTIC_DIR / f"target-region-{int(time.time() * 1000)}.jpg"
        crop.save(output, "JPEG", quality=95)
        return output


class PaddleOCRVLProvider:
    name = "paddleocr-vl-adapter"
    provider_type = "document-parser"

    def __init__(self) -> None:
        self.model_id = DOCUMENT_PARSER_MODEL
        self.requested_device = PARSER_DEVICE_REQUEST
        self.pipeline: Any = None
        self.state = ProviderState(runtime="paddleocr", device="unknown")

    def health(self, image_path: Path | None = None, run_smoke: bool = False) -> dict[str, Any]:
        if ENABLE_PADDLEOCR_VL and run_smoke and image_path:
            try:
                self.ensure_ready(image_path)
            except ProviderFailure:
                pass
        return {
            "available": self.state.available,
            "type": self.provider_type,
            "name": self.name,
            "model": self.model_id,
            "state": self.state.state,
            "runtime": self.state.runtime,
            "device": self.state.device,
            "modelLoaded": self.state.modelLoaded,
            "smokeTestPassed": self.state.smokeTestPassed,
            "failureReason": self.state.failureReason,
            "failureDetail": self.state.failureDetail,
            "lastSmokeTest": self.state.lastSmokeTest,
            "lastInference": self.state.lastInference,
            "diagnostics": self.state.diagnostics,
        }

    def ensure_ready(self, image_path: Path) -> None:
        if self.state.available:
            return
        if not ENABLE_PADDLEOCR_VL:
            self.fail("provider-disabled", "PaddleOCR-VL provider is disabled.")
        self.check_dependencies()
        self.check_device()
        self.load_model()
        self.smoke_test(image_path)
        self.state.available = True
        self.state.state = "ready"

    def fail(self, reason: str, detail: str, diagnostics: dict[str, Any] | None = None) -> None:
        self.state.available = False
        self.state.state = reason
        self.state.failureReason = reason
        self.state.failureDetail = detail
        if diagnostics:
            self.state.diagnostics.update(diagnostics)
        raise ProviderFailure(reason, detail, diagnostics)

    def check_dependencies(self) -> None:
        missing = [name for name in ("paddle", "paddleocr") if not module_version(name)["installed"]]
        if missing:
            self.fail("dependency-missing", f"Missing required modules: {', '.join(missing)}")

    def check_device(self) -> None:
        import paddle  # type: ignore

        cuda_available = bool(paddle.is_compiled_with_cuda())
        if self.requested_device.startswith("cuda") and not cuda_available:
            self.fail("cuda-unavailable", "PaddlePaddle is installed but is not compiled with CUDA.")
        self.state.device = "cuda" if self.requested_device.startswith("cuda") else "cpu"

    def load_model(self) -> None:
        if self.pipeline is not None:
            self.state.modelLoaded = True
            return
        start = time.perf_counter()
        try:
            from paddleocr import PaddleOCRVL  # type: ignore

            device = "gpu:0" if self.requested_device.startswith("cuda") else "cpu"
            self.pipeline = PaddleOCRVL(
                pipeline_version=os.environ.get("PADDLEOCR_VL_PIPELINE_VERSION", "v1.6"),
                device=device,
                use_doc_orientation_classify=True,
                use_doc_unwarping=True,
                use_layout_detection=True,
                use_queues=False,
            )
            self.state.modelLoaded = True
            self.state.runtime = "paddleocr-python"
            self.state.device = "cuda" if device.startswith("gpu") else "cpu"
            self.state.diagnostics["modelLoadSeconds"] = round(time.perf_counter() - start, 3)
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            reason = "cuda-out-of-memory" if "out of memory" in detail.lower() else "model-load-failed"
            self.fail(reason, detail)

    def smoke_test(self, image_path: Path) -> None:
        start_gpu = peak_gpu_memory_mb()
        start = time.perf_counter()
        try:
            raw_pages = self.predict_raw(image_path, max_new_tokens=256)
            analysis = map_paddle_raw_to_analysis(raw_pages, image_path, self.model_id, self.state.device)
            duration = time.perf_counter() - start
            element_count = len(analysis.get("elements", []))
            if element_count <= 0:
                self.fail("smoke-inference-failed", "PaddleOCR-VL returned no parser elements.", {"rawPageCount": len(raw_pages)})
            self.state.smokeTestPassed = True
            self.state.lastSmokeTest = {
                "imagePath": str(image_path),
                "imageDimensions": image_dimensions(image_path),
                "durationSeconds": round(duration, 3),
                "peakGpuMemoryMb": peak_gpu_memory_mb(),
                "startGpuMemoryMb": start_gpu,
                "elementCount": element_count,
                "typeCounts": type_counts(analysis.get("elements", []), "providerType"),
            }
        except ProviderFailure:
            raise
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            reason = "cuda-out-of-memory" if "out of memory" in detail.lower() else "smoke-inference-failed"
            self.fail(reason, detail)

    def predict_raw(self, image_path: Path, max_new_tokens: int | None = None) -> list[Any]:
        kwargs: dict[str, Any] = {
            "input": str(image_path),
            "use_doc_orientation_classify": True,
            "use_doc_unwarping": True,
            "use_layout_detection": True,
            "layout_shape_mode": "auto",
            "merge_layout_blocks": True,
        }
        if max_new_tokens:
            kwargs["max_new_tokens"] = max_new_tokens
        try:
            output = self.pipeline.predict(**kwargs)
        except TypeError:
            output = self.pipeline.predict(str(image_path))
        return [to_plain(item) for item in list(output)]

    def analyze(self, payload: dict[str, Any], image_path: Path) -> dict[str, Any]:
        self.ensure_ready(image_path)
        start_gpu = peak_gpu_memory_mb()
        start = time.perf_counter()
        raw_pages = self.predict_raw(image_path)
        analysis = map_paddle_raw_to_analysis(raw_pages, image_path, self.model_id, self.state.device)
        analysis["diagnostics"].update(
            {
                "imagePath": str(image_path),
                "imageDimensions": image_dimensions(image_path),
                "inferenceSeconds": round(time.perf_counter() - start, 3),
                "startGpuMemoryMb": start_gpu,
                "peakGpuMemoryMb": peak_gpu_memory_mb(),
                "providerState": self.state.state,
            }
        )
        self.state.lastInference = analysis["diagnostics"]
        return analysis


def map_paddle_raw_to_analysis(raw_pages: list[Any], image_path: Path, model_id: str, device: str) -> dict[str, Any]:
    dims = image_dimensions(image_path)
    width = dims["width"]
    height = dims["height"]
    elements: list[dict[str, Any]] = []
    reading_order: list[str] = []
    page_type_candidates: list[dict[str, Any]] = []
    visual_classifications: list[dict[str, Any]] = []

    for page_index, raw_page in enumerate(raw_pages):
        page_json = raw_page.get("json", raw_page) if isinstance(raw_page, dict) else {}
        page_json = page_json if isinstance(page_json, dict) else {}
        width = int(page_json.get("width") or width or dims["width"])
        height = int(page_json.get("height") or height or dims["height"])
        parsing = (
            page_json.get("parsing_res_list")
            or page_json.get("parsingResList")
            or page_json.get("layoutParsingResults")
            or page_json.get("layout_res_list")
            or []
        )
        if isinstance(parsing, dict):
            parsing = parsing.get("parsing_res_list") or parsing.get("blocks") or []
        if not isinstance(parsing, list):
            parsing = []
        layout_boxes = []
        layout_det_res = page_json.get("layout_det_res") if isinstance(page_json.get("layout_det_res"), dict) else {}
        if isinstance(layout_det_res, dict) and isinstance(layout_det_res.get("boxes"), list):
            layout_boxes = layout_det_res.get("boxes") or []
        if not parsing and layout_boxes:
            parsing = layout_boxes
        for index, block in enumerate(parsing):
            layout_block = layout_boxes[index] if index < len(layout_boxes) and isinstance(layout_boxes[index], dict) else None
            block = coerce_paddle_block(block, layout_block)
            if not isinstance(block, dict):
                continue
            label = str(block.get("block_label") or block.get("label") or block.get("type") or "unknown")
            text = block.get("block_content")
            if text is None:
                text = block.get("text") or block.get("content")
            bbox = (
                block.get("block_bbox")
                or block.get("bbox")
                or block.get("box")
                or block.get("poly")
                or block.get("polygon")
            )
            source_bbox = normalize_bbox_from_xyxy(bbox, width, height)
            element_id = f"paddle-page-{page_index + 1}-element-{index + 1}"
            confidence = optional_confidence(block.get("confidence") or block.get("score") or block.get("block_score"))
            element = {
                "id": element_id,
                "providerType": label,
                "text": str(text).strip() if text is not None and str(text).strip() else None,
                "sourceBBox": source_bbox,
                "confidence": confidence,
                "sourceEvidenceIds": [],
                "attributes": {
                    "rawTypeName": label,
                    "blockId": block.get("block_id") or block.get("id"),
                    "blockOrder": block.get("block_order") if block.get("block_order") is not None else block.get("order"),
                    "pageIndex": page_index,
                },
            }
            elements.append(element)
            reading_order.append(element_id)
            if label.lower() in {"image", "figure", "chart", "table"} and source_bbox:
                visual_classifications.append(
                    {
                        "sourceRegionId": element_id,
                        "classification": "table" if "table" in label.lower() else "document-image",
                        "confidence": confidence,
                        "attributes": {"rawTypeName": label},
                    }
                )
    if elements:
        page_type_candidates.append({"value": infer_page_type_from_provider_elements(elements), "confidence": 0.78})
    return {
        "schemaVersion": SCHEMA_DOCUMENT_PROVIDER,
        "provider": {
            "type": "document-parser",
            "name": "paddleocr-vl-adapter",
            "model": model_id,
            "device": device,
            "runtime": "paddleocr-python",
        },
        "pageAnalysis": {
            "pageTypeCandidates": page_type_candidates,
            "columnCountCandidates": [{"value": infer_column_count(elements), "confidence": 0.74}] if elements else [],
            "layoutDescription": "PaddleOCR-VL structured parser output mapped as source evidence.",
        },
        "elements": elements,
        "readingOrder": reading_order,
        "relationships": [],
        "visualClassifications": visual_classifications,
        "diagnostics": {
            "rawPageCount": len(raw_pages),
            "elementCount": len(elements),
            "typeCounts": type_counts(elements, "providerType"),
            "detectedTextRegionCount": sum(1 for item in elements if item.get("text")),
            "detectedImageRegionCount": sum(1 for item in elements if is_image_like_type(item.get("providerType"))),
            "detectedTableGraphicRegionCount": sum(1 for item in elements if is_table_or_graphic_type(item.get("providerType"))),
            "confidencePolicy": "Missing provider confidence is represented as null, not fabricated.",
        },
    }


def coerce_paddle_block(block: Any, layout_block: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if isinstance(block, dict):
        merged = dict(block)
        if layout_block:
            merged.setdefault("label", layout_block.get("label"))
            merged.setdefault("bbox", layout_block.get("coordinate") or layout_block.get("bbox"))
            merged.setdefault("score", layout_block.get("score"))
            merged.setdefault("order", layout_block.get("order"))
            merged.setdefault("polygon", layout_block.get("polygon_points"))
        return merged
    if not isinstance(block, str):
        return None
    label_match = re.search(r"(?im)^\s*label:\s*(.+?)\s*$", block)
    bbox_match = re.search(r"(?im)^\s*bbox:\s*\[([^\]]+)\]\s*$", block)
    content_match = re.search(r"(?ims)^\s*content:[ \t]*(.*?)(?:\n#+\s*$|$)", block)
    bbox = None
    if bbox_match:
        bbox = [safe_float(part) for part in re.split(r"\s*,\s*", bbox_match.group(1).strip()) if part.strip()]
    parsed: dict[str, Any] = {
        "label": label_match.group(1).strip() if label_match else (layout_block or {}).get("label") or "unknown",
        "bbox": bbox or (layout_block or {}).get("coordinate") or (layout_block or {}).get("bbox"),
        "content": clean_paddle_block_content(content_match.group(1)) if content_match else None,
        "score": (layout_block or {}).get("score"),
        "order": (layout_block or {}).get("order"),
        "polygon": (layout_block or {}).get("polygon_points"),
        "rawParsingFormat": "paddleocr-vl-string-block",
    }
    return parsed


def clean_paddle_block_content(value: str | None) -> str | None:
    if value is None:
        return None
    lines = [line for line in str(value).splitlines() if not re.match(r"^\s*#+\s*$", line)]
    text = "\n".join(lines).strip()
    return text or None


def infer_page_type_from_provider_elements(elements: list[dict[str, Any]]) -> str:
    labels = " ".join(str(item.get("providerType") or "").lower() for item in elements)
    if "table" in labels:
        return "table"
    if "image" in labels or "figure" in labels:
        return "mixed"
    return "article"


def infer_column_count(elements: list[dict[str, Any]]) -> int:
    text_boxes = [item.get("sourceBBox") for item in elements if item.get("text") and item.get("sourceBBox")]
    if len(text_boxes) < 4:
        return 1
    starts = sorted(float(box["x"]) for box in text_boxes)
    gaps = [starts[index + 1] - starts[index] for index in range(len(starts) - 1)]
    return 2 if gaps and max(gaps) > 0.14 else 1


def is_image_like_type(value: Any) -> bool:
    return bool(re.search(r"image|figure|photo|picture", str(value or ""), re.IGNORECASE))


def is_table_or_graphic_type(value: Any) -> bool:
    return bool(re.search(r"table|chart|graphic|formula|line|separator", str(value or ""), re.IGNORECASE))


class QwenVisionProvider:
    name = "qwen3-vl-adapter"
    provider_type = "vision-reasoner"

    def __init__(self) -> None:
        self.model_id = VISION_REASONER_MODEL
        self.requested_device = VISION_DEVICE_REQUEST
        self.quantization = VISION_QUANTIZATION
        self.model: Any = None
        self.processor: Any = None
        self.process_vision_info: Any = None
        self.state = ProviderState(runtime="transformers", device="unknown")

    def health(self, image_path: Path | None = None, run_smoke: bool = False) -> dict[str, Any]:
        if ENABLE_QWEN_VL and run_smoke and image_path:
            try:
                self.ensure_ready(image_path)
            except ProviderFailure:
                pass
        return {
            "available": self.state.available,
            "type": self.provider_type,
            "name": self.name,
            "model": self.model_id,
            "state": self.state.state,
            "runtime": self.state.runtime,
            "device": self.state.device,
            "quantization": self.quantization,
            "modelLoaded": self.state.modelLoaded,
            "smokeTestPassed": self.state.smokeTestPassed,
            "failureReason": self.state.failureReason,
            "failureDetail": self.state.failureDetail,
            "lastSmokeTest": self.state.lastSmokeTest,
            "lastInference": self.state.lastInference,
            "diagnostics": self.state.diagnostics,
        }

    def ensure_ready(self, image_path: Path) -> None:
        if self.state.available:
            return
        if not ENABLE_QWEN_VL:
            self.fail("provider-disabled", "Qwen vision provider is disabled.")
        self.check_dependencies()
        self.check_device()
        self.load_model()
        self.smoke_test(image_path)
        self.state.available = True
        self.state.state = "ready"

    def fail(self, reason: str, detail: str, diagnostics: dict[str, Any] | None = None) -> None:
        self.state.available = False
        self.state.state = reason
        self.state.failureReason = reason
        self.state.failureDetail = detail
        if diagnostics:
            self.state.diagnostics.update(diagnostics)
        raise ProviderFailure(reason, detail, diagnostics)

    def check_dependencies(self) -> None:
        missing = [name for name in ("torch", "transformers", "PIL") if not module_version(name)["installed"]]
        if missing:
            self.fail("dependency-missing", f"Missing required modules: {', '.join(missing)}")

    def check_device(self) -> None:
        import torch  # type: ignore

        cuda_available = bool(torch.cuda.is_available())
        if self.requested_device.startswith("cuda") and not cuda_available:
            self.fail("cuda-unavailable", "PyTorch CUDA is not available.")
        self.state.device = "cuda" if self.requested_device.startswith("cuda") else "cpu"

    def load_model(self) -> None:
        if self.model is not None and self.processor is not None:
            self.state.modelLoaded = True
            return
        if not is_vision_model_identifier(self.model_id):
            self.fail("unsupported-runtime", f"Configured model is not a vision-capable Qwen VL model: {self.model_id}")
        start = time.perf_counter()
        try:
            import torch  # type: ignore
            from transformers import AutoConfig, AutoProcessor  # type: ignore

            config = AutoConfig.from_pretrained(self.model_id, trust_remote_code=True)
            if not config_looks_vision_capable(config, self.model_id):
                self.fail("unsupported-runtime", f"Model config is not image-capable: {self.model_id}")

            model_class = transformers_vision_model_class()
            kwargs: dict[str, Any] = {"trust_remote_code": True, "device_map": "auto"}
            if self.requested_device.startswith("cuda"):
                kwargs["torch_dtype"] = torch.bfloat16
            if self.quantization not in {"", "none", "false"}:
                kwargs["quantization_config"] = quantization_config(self.quantization)
            try:
                self.model = model_class.from_pretrained(self.model_id, **kwargs)
            except TypeError:
                kwargs["dtype"] = kwargs.pop("torch_dtype", "auto")
                self.model = model_class.from_pretrained(self.model_id, **kwargs)
            self.processor = AutoProcessor.from_pretrained(self.model_id, trust_remote_code=True)
            try:
                from qwen_vl_utils import process_vision_info  # type: ignore

                self.process_vision_info = process_vision_info
            except Exception:
                self.process_vision_info = None
            self.state.modelLoaded = True
            self.state.runtime = "transformers"
            self.state.device = "cuda" if self.requested_device.startswith("cuda") else "cpu"
            self.state.diagnostics["modelLoadSeconds"] = round(time.perf_counter() - start, 3)
        except ProviderFailure:
            raise
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            reason = "cuda-out-of-memory" if "out of memory" in detail.lower() else "model-load-failed"
            self.fail(reason, detail)

    def smoke_test(self, image_path: Path) -> None:
        start_gpu = peak_gpu_memory_mb()
        start = time.perf_counter()
        prompt = (
            "Analyze this document image as layout, not OCR transcription. Return only valid compact JSON. "
            "Do not include markdown. Do not transcribe full paragraphs. Use this exact shape: "
            "{\"schemaVersion\":\"vision-document-analysis/v1\","
            "\"page\":{\"orientation\":\"portrait|landscape|unknown\",\"pageType\":\"article|worksheet|mixed|unknown\","
            "\"columnCount\":0,\"confidence\":0.0},"
            "\"readingOrderEvidence\":[\"short structural notes only\"],"
            "\"visualClassifications\":[{\"region\":\"short name\",\"classification\":\"document-image|table|answer-line|separator|artifact\",\"confidence\":0.0}],"
            "\"disagreements\":[{\"type\":\"short issue\",\"verdict\":\"supported|rejected|uncertain\",\"reason\":\"short\"}],"
            "\"diagnostics\":{\"notes\":[\"short notes\"]}}"
        )
        try:
            result = self.run_visual_json(image_path, prompt, max_new_tokens=600)
            duration = time.perf_counter() - start
            normalized = normalize_vision_result(result, self.model_id, self.state.device, self.quantization)
            if normalized["schemaVersion"] != SCHEMA_VISION_PROVIDER:
                self.fail("invalid-model-output", "Vision smoke result did not normalize to vision-document-analysis/v1.")
            self.state.smokeTestPassed = True
            self.state.lastSmokeTest = {
                "imagePath": str(image_path),
                "imageDimensions": image_dimensions(image_path),
                "durationSeconds": round(duration, 3),
                "startGpuMemoryMb": start_gpu,
                "peakGpuMemoryMb": peak_gpu_memory_mb(),
                "jsonRepairAttempts": result.get("_jsonRepairAttempts", 0) if isinstance(result, dict) else 0,
            }
        except ProviderFailure:
            raise
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            reason = "cuda-out-of-memory" if "out of memory" in detail.lower() else "smoke-inference-failed"
            self.fail(reason, detail)

    def run_visual_json(self, image_path: Path, prompt: str, max_new_tokens: int | None = None) -> dict[str, Any]:
        import torch  # type: ignore
        from PIL import Image  # type: ignore

        max_tokens = max_new_tokens or VISION_MAX_NEW_TOKENS
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": str(image_path)},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        if self.process_vision_info:
            text = self.processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            image_inputs, video_inputs = self.process_vision_info(messages)
            inputs = self.processor(
                text=[text],
                images=image_inputs,
                videos=video_inputs,
                padding=True,
                return_tensors="pt",
            )
        else:
            image = Image.open(image_path).convert("RGB")
            fallback_messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "image"},
                        {"type": "text", "text": prompt},
                    ],
                }
            ]
            text = self.processor.apply_chat_template(fallback_messages, tokenize=False, add_generation_prompt=True)
            inputs = self.processor(text=[text], images=[image], padding=True, return_tensors="pt")
        if self.requested_device.startswith("cuda") and hasattr(inputs, "to"):
            inputs = inputs.to("cuda")
        with torch.inference_mode():
            output_ids = self.model.generate(**inputs, max_new_tokens=max_tokens, do_sample=False)
        input_length = inputs["input_ids"].shape[-1]
        generated = output_ids[:, input_length:]
        text_out = self.processor.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]
        parsed = extract_json_object(text_out)
        parsed.setdefault("diagnostics", {})
        parsed["diagnostics"]["rawModelOutputPreview"] = text_out[:500]
        return parsed

    def analyze(self, payload: dict[str, Any], image_path: Path, targeted: bool = False) -> dict[str, Any]:
        self.ensure_ready(image_path)
        analysis_image = crop_region_image(image_path, payload.get("region")) if targeted else image_path
        prompt = build_vision_prompt(payload, targeted=targeted)
        start_gpu = peak_gpu_memory_mb()
        start = time.perf_counter()
        result = self.run_visual_json(analysis_image, prompt)
        normalized = normalize_vision_result(result, self.model_id, self.state.device, self.quantization)
        normalized["diagnostics"].update(
            {
                "imagePath": str(image_path),
                "analysisImagePath": str(analysis_image),
                "targeted": targeted,
                "inferenceSeconds": round(time.perf_counter() - start, 3),
                "startGpuMemoryMb": start_gpu,
                "peakGpuMemoryMb": peak_gpu_memory_mb(),
            }
        )
        self.state.lastInference = normalized["diagnostics"]
        return normalized


def is_vision_model_identifier(model_id: str) -> bool:
    text = str(model_id or "").lower()
    return "vl" in text or "vision" in text or "multimodal" in text


def config_looks_vision_capable(config: Any, model_id: str) -> bool:
    config_dict = {}
    try:
        config_dict = config.to_dict()
    except Exception:
        config_dict = getattr(config, "__dict__", {}) or {}
    model_type = str(config_dict.get("model_type") or getattr(config, "model_type", "")).lower()
    if "vl" in model_type or "vision" in model_type:
        return True
    if any(key in config_dict for key in ("vision_config", "visual", "image_token_id", "video_token_id")):
        return True
    return is_vision_model_identifier(model_id)


def transformers_vision_model_class() -> Any:
    import transformers  # type: ignore

    for name in ("AutoModelForImageTextToText", "AutoModelForMultimodalLM", "AutoModelForVision2Seq"):
        model_class = getattr(transformers, name, None)
        if model_class is not None:
            return model_class
    raise ProviderFailure("unsupported-runtime", "Installed transformers does not expose a vision-language auto model class.")


def quantization_config(name: str) -> Any:
    lowered = str(name or "").lower()
    if lowered in {"4bit", "bitsandbytes-4bit", "bnb-4bit"}:
        from transformers import BitsAndBytesConfig  # type: ignore

        return BitsAndBytesConfig(load_in_4bit=True)
    if lowered in {"8bit", "bitsandbytes-8bit", "bnb-8bit"}:
        from transformers import BitsAndBytesConfig  # type: ignore

        return BitsAndBytesConfig(load_in_8bit=True)
    raise ProviderFailure("unsupported-runtime", f"Unsupported quantization setting: {name}")


def build_vision_prompt(payload: dict[str, Any], targeted: bool = False) -> str:
    compact_context = {
        "sourceEvidenceSummary": payload.get("sourceEvidenceSummary", {}),
        "semanticSummary": payload.get("semanticSummary", {}),
        "semanticValidationSummary": payload.get("semanticValidationSummary", {}),
        "issue": payload.get("issue") if targeted else None,
        "region": payload.get("region") if targeted else None,
    }
    return (
        "You are a local document understanding model. Inspect the image and the compact context. "
        "Return only valid JSON conforming to schemaVersion vision-document-analysis/v1. "
        "Do not include markdown. Do not transcribe full page text or long paragraphs. "
        "Keep the response compact: short ids, short notes, and at most 12 items per array. "
        "Include provider decisions for page.orientation, page.pageType, page.columnCount, "
        "paragraph grouping, paragraph continuation, reading order, visual region classification, "
        "image vs artifact, and separator or answer-line interpretation. "
        "Use source evidence ids when the context gives them. Do not invent final A4 coordinates. "
        "For targeted issues, state whether the issue is supported, rejected, or uncertain in disagreements. "
        "Required top-level keys: schemaVersion, page, elementInterpretations, groups, relationships, "
        "readingOrderEvidence, visualClassifications, disagreements, diagnostics. "
        f"Compact context JSON: {json.dumps(compact_context, ensure_ascii=False)[:9000]}"
    )


def normalize_vision_result(value: dict[str, Any], model_id: str, device: str, quantization: str) -> dict[str, Any]:
    page = value.get("page") if isinstance(value.get("page"), dict) else {}
    diagnostics = value.get("diagnostics") if isinstance(value.get("diagnostics"), dict) else {}
    groups = normalize_list(value.get("groups")) or normalize_list(page.get("paragraphGrouping"))
    reading_order = normalize_list(value.get("readingOrderEvidence"))
    if not reading_order:
        reading_order = compact_reading_order_evidence(page.get("readingOrder"))
    normalized = {
        "schemaVersion": SCHEMA_VISION_PROVIDER,
        "provider": {
            "type": "vision-reasoner",
            "name": "qwen3-vl-adapter",
            "model": model_id,
            "device": device,
            "runtime": "transformers",
            "quantization": quantization,
        },
        "page": {
            "orientation": str(page.get("orientation") or "unknown"),
            "pageType": str(page.get("pageType") or "unknown"),
            "columnCount": int(safe_float(page.get("columnCount"))),
            "confidence": optional_confidence(page.get("confidence")),
            **({"title": str(page.get("title"))} if page.get("title") else {}),
        },
        "elementInterpretations": normalize_list(value.get("elementInterpretations")),
        "groups": groups,
        "relationships": normalize_list(value.get("relationships")),
        "readingOrderEvidence": [str(item) for item in reading_order if str(item)],
        "visualClassifications": normalize_list(value.get("visualClassifications")),
        "disagreements": normalize_list(value.get("disagreements")),
        "diagnostics": diagnostics,
    }
    normalized["diagnostics"]["schemaValidation"] = validate_vision_document_analysis(normalized)
    return normalized


def normalize_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def compact_reading_order_evidence(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    evidence: list[str] = []
    for item in value:
        if isinstance(item, dict):
            element_id = str(item.get("elementId") or item.get("id") or "").strip()
            item_type = str(item.get("type") or "").strip()
            if element_id and item_type:
                evidence.append(f"{element_id}:{item_type}")
            elif element_id:
                evidence.append(element_id)
            elif item_type:
                evidence.append(item_type)
        elif item:
            evidence.append(str(item))
    return evidence


def validate_vision_document_analysis(value: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return {"valid": False, "errors": ["analysis is not an object"]}
    if value.get("schemaVersion") != SCHEMA_VISION_PROVIDER:
        errors.append("schemaVersion must be vision-document-analysis/v1")
    if not isinstance(value.get("provider"), dict):
        errors.append("provider must be an object")
    page = value.get("page")
    if not isinstance(page, dict):
        errors.append("page must be an object")
    else:
        if not isinstance(page.get("orientation"), str):
            errors.append("page.orientation must be a string")
        if not isinstance(page.get("pageType"), str):
            errors.append("page.pageType must be a string")
        if not isinstance(page.get("columnCount"), int):
            errors.append("page.columnCount must be an integer")
    for key in ("elementInterpretations", "groups", "relationships", "readingOrderEvidence", "visualClassifications", "disagreements"):
        if not isinstance(value.get(key), list):
            errors.append(f"{key} must be an array")
    if not isinstance(value.get("diagnostics"), dict):
        errors.append("diagnostics must be an object")
    return {"valid": not errors, "errors": errors}


def type_counts(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        value = str(item.get(key) or "unknown")
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def unavailable_document_analysis(provider: str, reason: str, detail: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_DOCUMENT_PROVIDER,
        "provider": {
            "type": "document-parser" if provider == "parser" else "local-service",
            "name": "paddleocr-vl-adapter" if provider == "parser" else "local-document-intelligence",
            "model": DOCUMENT_PARSER_MODEL,
            "device": "unknown",
        },
        "pageAnalysis": {"pageTypeCandidates": [], "columnCountCandidates": [], "layoutDescription": None},
        "elements": [],
        "readingOrder": [],
        "relationships": [],
        "visualClassifications": [],
        "diagnostics": {"available": False, "failureReason": reason, "failureDetail": detail, **(extra or {})},
    }


def unavailable_vision_analysis(reason: str, detail: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VISION_PROVIDER,
        "provider": {
            "type": "vision-reasoner",
            "name": "qwen3-vl-adapter",
            "model": VISION_REASONER_MODEL,
            "device": "unknown",
        },
        "page": {"orientation": "unknown", "pageType": "unknown", "columnCount": 0, "confidence": None},
        "elementInterpretations": [],
        "groups": [],
        "relationships": [],
        "readingOrderEvidence": [],
        "visualClassifications": [],
        "disagreements": [],
        "diagnostics": {"available": False, "failureReason": reason, "failureDetail": detail, **(extra or {})},
    }


def provider_worker_process_enabled() -> bool:
    return PROVIDER_SUBPROCESSES_ENABLED and os.environ.get("DOCUMENT_INTELLIGENCE_PROVIDER_WORKER") != "1"


def run_provider_worker(provider: str, payload: dict[str, Any], image_path: Path, targeted: bool = False) -> dict[str, Any]:
    DIAGNOSTIC_DIR.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)
    payload_file = DIAGNOSTIC_DIR / f"provider-worker-{provider}-{stamp}-input.json"
    output_file = DIAGNOSTIC_DIR / f"provider-worker-{provider}-{stamp}-output.json"
    payload_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    env = os.environ.copy()
    env["DOCUMENT_INTELLIGENCE_PROVIDER_WORKER"] = "1"
    if provider == "parser":
        env["ENABLE_QWEN_VL"] = "0"
    elif provider == "vision":
        env["ENABLE_PADDLEOCR_VL"] = "0"

    args = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--provider-worker",
        provider,
        "--payload-file",
        str(payload_file),
        "--image",
        str(image_path),
        "--output",
        str(output_file),
    ]
    if targeted:
        args.append("--targeted")
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            args,
            cwd=str(ROOT_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=PROVIDER_WORKER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ProviderFailure("inference-timeout", f"{provider} worker exceeded {PROVIDER_WORKER_TIMEOUT_SECONDS}s", {"timeout": str(exc)})
    except Exception as exc:
        raise ProviderFailure("unsupported-runtime", f"{type(exc).__name__}: {exc}")

    output: dict[str, Any] | None = None
    if output_file.exists():
        try:
            output = json.loads(output_file.read_text(encoding="utf-8"))
        except Exception:
            output = None

    if completed.returncode != 0:
        if isinstance(output, dict) and output.get("error"):
            raise ProviderFailure(
                str(output.get("failureReason") or "unsupported-runtime"),
                str(output.get("failureDetail") or output.get("error")),
                dict(output.get("diagnostics") or {}),
            )
        detail = completed.stderr.strip() or completed.stdout.strip() or f"worker exited with {completed.returncode}"
        reason = "cuda-out-of-memory" if "out of memory" in detail.lower() else "unsupported-runtime"
        raise ProviderFailure(reason, detail[-4000:], {"exitCode": completed.returncode})

    if not isinstance(output, dict):
        detail = completed.stderr.strip() or completed.stdout.strip() or "worker produced no JSON output"
        raise ProviderFailure("invalid-model-output", detail[-4000:], {"exitCode": completed.returncode})

    output.setdefault("diagnostics", {})
    if isinstance(output["diagnostics"], dict):
        output["diagnostics"].update(
            {
                "providerWorker": True,
                "workerProvider": provider,
                "workerSeconds": round(time.perf_counter() - started, 3),
                "workerStdoutTail": completed.stdout.strip()[-1000:] if completed.stdout.strip() else None,
                "workerStderrTail": completed.stderr.strip()[-1000:] if completed.stderr.strip() else None,
            }
        )
    return output


def run_provider_worker_command(provider: str, payload_file: Path, image_path: Path, output_file: Path, targeted: bool = False) -> int:
    try:
        payload = json.loads(payload_file.read_text(encoding="utf-8"))
        if provider == "parser":
            import paddle  # type: ignore  # noqa: F401

            disable_torch_imports_for_parser_process()
            result = PaddleOCRVLProvider().analyze(payload, image_path)
        elif provider == "vision":
            result = QwenVisionProvider().analyze(payload, image_path, targeted=targeted)
        else:
            raise ProviderFailure("unsupported-runtime", f"Unknown provider worker: {provider}")
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0
    except ProviderFailure as exc:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(
            json.dumps(
                {
                    "error": True,
                    "failureReason": exc.reason,
                    "failureDetail": exc.detail,
                    "diagnostics": exc.diagnostics,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return 2
    except Exception as exc:
        reason = "cuda-out-of-memory" if "out of memory" in str(exc).lower() else "unsupported-runtime"
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(
            json.dumps(
                {
                    "error": True,
                    "failureReason": reason,
                    "failureDetail": f"{type(exc).__name__}: {exc}",
                    "diagnostics": {"traceback": traceback.format_exc()[-4000:]},
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return 3


class DocumentIntelligenceRuntime:
    def __init__(self) -> None:
        self.parser = PaddleOCRVLProvider()
        self.vision = QwenVisionProvider()

    def health(self, image_path: Path | None = None, run_smoke: bool = False) -> dict[str, Any]:
        env = inspect_environment()
        parser_health = self.parser.health(image_path, run_smoke)
        vision_health = self.vision.health(image_path, run_smoke)
        any_ready = bool(parser_health["available"] or vision_health["available"])
        any_loading = parser_health["state"] == "loading" or vision_health["state"] == "loading"
        status = "ready" if any_ready else ("loading" if any_loading else "degraded")
        return {
            "status": status,
            "service": "local-document-intelligence",
            "serviceVersion": "local-document-intelligence/v2",
            "host": HOST,
            "port": PORT,
            "hardware": env["hardware"],
            "runtimes": env["runtimes"],
            "providers": {
                "documentParser": parser_health,
                "visionReasoner": vision_health,
            },
            "providerExecutionMode": "subprocess-isolated" if provider_worker_process_enabled() else "in-process",
            "modelCaches": env["modelCaches"],
            "security": {
                "bindsToLocalhost": HOST in {"127.0.0.1", "localhost", "::1"},
                "cloudApiRequired": False,
                "executesModelGeneratedCode": False,
                "maxBodyBytes": MAX_BODY_BYTES,
            },
        }

    def analyze_page(self, payload: dict[str, Any], targeted: bool = False) -> dict[str, Any]:
        try:
            image_path = crop_region_image(image_path_from_payload(payload), payload.get("region")) if targeted else image_path_from_payload(payload)
        except ProviderFailure as exc:
            health = self.health()
            return {
                "schemaVersion": SCHEMA_HYBRID,
                "provider": hybrid_provider_descriptor(),
                "mode": "heuristic-fallback",
                "health": health,
                "analyses": {
                    "parser": unavailable_document_analysis("parser", exc.reason, exc.detail),
                    "vision": unavailable_vision_analysis(exc.reason, exc.detail),
                },
                "region": payload.get("region") if targeted else None,
                "diagnostics": {"available": False, "failureReason": exc.reason, "failureDetail": exc.detail},
            }

        analyses: dict[str, Any] = {}
        failures: dict[str, Any] = {}
        try:
            analyses["parser"] = (
                run_provider_worker("parser", payload, image_path, targeted=targeted)
                if provider_worker_process_enabled()
                else self.parser.analyze(payload, image_path)
            )
        except ProviderFailure as exc:
            analyses["parser"] = unavailable_document_analysis("parser", exc.reason, exc.detail, exc.diagnostics)
            failures["parser"] = {"reason": exc.reason, "detail": exc.detail}
        except Exception as exc:
            reason = "cuda-out-of-memory" if "out of memory" in str(exc).lower() else "unsupported-runtime"
            analyses["parser"] = unavailable_document_analysis("parser", reason, f"{type(exc).__name__}: {exc}")
            failures["parser"] = {"reason": reason, "detail": str(exc)}

        try:
            analyses["vision"] = (
                run_provider_worker("vision", payload, image_path, targeted=targeted)
                if provider_worker_process_enabled()
                else self.vision.analyze(payload, image_path, targeted=targeted)
            )
        except ProviderFailure as exc:
            analyses["vision"] = unavailable_vision_analysis(exc.reason, exc.detail, exc.diagnostics)
            failures["vision"] = {"reason": exc.reason, "detail": exc.detail}
        except Exception as exc:
            reason = "cuda-out-of-memory" if "out of memory" in str(exc).lower() else "unsupported-runtime"
            analyses["vision"] = unavailable_vision_analysis(reason, f"{type(exc).__name__}: {exc}")
            failures["vision"] = {"reason": reason, "detail": str(exc)}

        provider_success = any(not analysis.get("diagnostics", {}).get("available") is False for analysis in analyses.values())
        health = self.health()
        return {
            "schemaVersion": SCHEMA_HYBRID,
            "provider": hybrid_provider_descriptor(),
            "mode": "hybrid-local" if provider_success else "heuristic-fallback",
            "health": health,
            "analyses": analyses,
            "region": payload.get("region") if targeted else None,
            "diagnostics": {
                "available": provider_success,
                "targeted": targeted,
                "imagePath": str(image_path),
                "providerExecutionMode": "subprocess-isolated" if provider_worker_process_enabled() else "in-process",
                "providerFailures": failures,
            },
        }


def hybrid_provider_descriptor() -> dict[str, str]:
    return {
        "type": "local-service",
        "name": "local-document-intelligence",
        "version": "document-understanding-provider/v1",
    }


RUNTIME = DocumentIntelligenceRuntime()


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalDocumentIntelligence/2.0"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            image = DEFAULT_PAGE4_IMAGE if HEALTH_RUNS_SMOKE and DEFAULT_PAGE4_IMAGE.exists() else None
            self.write_json(RUNTIME.health(image, run_smoke=HEALTH_RUNS_SMOKE))
            return
        if self.path == "/environment":
            self.write_json(inspect_environment())
            return
        self.write_json({"error": "not-found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in {"/analyze-page", "/analyze-region"}:
            self.write_json({"error": "not-found"}, status=404)
            return
        payload = self.read_json()
        if payload is None:
            return
        self.write_json(RUNTIME.analyze_page(payload, targeted=self.path == "/analyze-region"))

    def read_json(self) -> dict[str, Any] | None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > MAX_BODY_BYTES:
            self.write_json({"error": "payload-too-large", "maxBodyBytes": MAX_BODY_BYTES}, status=413)
            return None
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            self.write_json({"error": "invalid-json", "message": str(exc)}, status=400)
            return None
        if not isinstance(payload, dict):
            self.write_json({"error": "invalid-payload"}, status=400)
            return None
        return payload

    def write_json(self, value: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        sys.stderr.write(f"[{timestamp}] {self.address_string()} {fmt % args}\n")


def run_smoke_test(image_path: Path, providers: str = "all", output: Path | None = None) -> dict[str, Any]:
    if not image_path.exists():
        raise SystemExit(f"Smoke image does not exist: {image_path}")
    payload = smoke_payload_for_image(image_path)
    result = {
        "schemaVersion": "document-intelligence-smoke/v1",
        "imagePath": str(image_path),
        "imageDimensions": image_dimensions(image_path),
        "environment": inspect_environment(),
        "results": {},
        "healthBefore": RUNTIME.health(),
    }
    if providers in {"all", "parser", "paddle"}:
        started = time.perf_counter()
        result["results"]["paddle"] = (
            run_provider_worker("parser", payload, image_path)
            if provider_worker_process_enabled()
            else RUNTIME.parser.analyze(payload, image_path)
        )
        result["results"]["paddle"]["diagnostics"]["totalSmokeSeconds"] = round(time.perf_counter() - started, 3)
    if providers in {"all", "vision", "qwen"}:
        started = time.perf_counter()
        result["results"]["qwen"] = (
            run_provider_worker("vision", payload, image_path, targeted=False)
            if provider_worker_process_enabled()
            else RUNTIME.vision.analyze(payload, image_path, targeted=False)
        )
        result["results"]["qwen"]["diagnostics"]["totalSmokeSeconds"] = round(time.perf_counter() - started, 3)
        issue_payload = dict(payload)
        issue_payload["issue"] = {
            "type": "probable-paragraph-continuation-error",
            "message": "Check whether two adjacent semantic paragraphs should be one paragraph continuation.",
        }
        issue_payload["region"] = {"id": "page-4-continuation-check", "bbox": {"x": 0.05, "y": 0.08, "width": 0.9, "height": 0.48}}
        result["results"]["qwenTargetedParagraphContinuation"] = (
            run_provider_worker("vision", issue_payload, image_path, targeted=True)
            if provider_worker_process_enabled()
            else RUNTIME.vision.analyze(issue_payload, image_path, targeted=True)
        )
    result["healthAfter"] = RUNTIME.health()
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def smoke_payload_for_image(image_path: Path) -> dict[str, Any]:
    dims = image_dimensions(image_path)
    relative = f"/national-test-page-images/{image_path.name}" if image_path.parent == PAGE_IMAGE_DIR else str(image_path)
    return {
        "schemaVersion": "document-understanding-input/v1",
        "pageRef": {"testId": "", "pageId": "smoke-page-4", "pageNumber": 4},
        "source": {
            "normalizedPageImage": relative,
            "sourcePageImage": relative,
            "normalizedPixelSize": dims,
            "originalPixelSize": dims,
        },
        "sourceEvidenceSummary": {"counts": {}, "textUnits": [], "visualRegions": []},
        "semanticSummary": {"pageType": "article", "styleHints": {"columnCount": 2}, "elements": [], "relationships": [], "readingOrder": []},
        "semanticValidationSummary": {
            "status": "warning",
            "score": 0.994,
            "issues": [{"type": "probable-paragraph-continuation-error", "severity": "warning"}],
        },
    }


def serve() -> None:
    if HOST not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("Refusing to bind document intelligence service to a non-localhost host.")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({"status": "starting", "host": HOST, "port": PORT, "health": RUNTIME.health()}, indent=2))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local document intelligence service.")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Local document intelligence service")
    parser.add_argument("--inspect", action="store_true", help="Print environment inspection JSON and exit.")
    parser.add_argument("--probe-runtime", choices=["torch", "paddle"], default="", help="Probe one GPU runtime in this process and exit.")
    parser.add_argument("--provider-worker", choices=["parser", "vision"], default="", help="Run one provider analysis in this process and exit.")
    parser.add_argument("--payload-file", default="", help="Provider worker input payload JSON path.")
    parser.add_argument("--targeted", action="store_true", help="Provider worker should run targeted region analysis.")
    parser.add_argument("--smoke-test", action="store_true", help="Run real provider smoke tests and exit.")
    parser.add_argument("--image", default=str(DEFAULT_PAGE4_IMAGE), help="Image path for smoke tests.")
    parser.add_argument("--providers", default="all", choices=["all", "parser", "paddle", "vision", "qwen"], help="Providers to smoke test.")
    parser.add_argument("--output", default="", help="Optional JSON output path for diagnostics.")
    args = parser.parse_args()

    if args.probe_runtime:
        result = inspect_torch() if args.probe_runtime == "torch" else inspect_paddle()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    if args.provider_worker:
        if not args.payload_file:
            raise SystemExit("--payload-file is required with --provider-worker")
        output = Path(args.output) if args.output else DIAGNOSTIC_DIR / f"provider-worker-{args.provider_worker}-{int(time.time())}.json"
        exit_code = run_provider_worker_command(
            args.provider_worker,
            Path(args.payload_file).resolve(),
            Path(args.image).resolve(),
            output,
            targeted=args.targeted,
        )
        raise SystemExit(exit_code)
    if args.inspect:
        print(json.dumps(inspect_environment(), ensure_ascii=False, indent=2))
        return
    if args.smoke_test:
        output = Path(args.output) if args.output else DIAGNOSTIC_DIR / f"smoke-{int(time.time())}.json"
        result = run_smoke_test(Path(args.image).resolve(), args.providers, output)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    serve()


if __name__ == "__main__":
    main()
