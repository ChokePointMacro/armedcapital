"""
Studio configuration — env-var driven with sensible defaults.
Loaded once at import time, not re-read on every call.
"""

import os
from pathlib import Path

# Root of the studio service
STUDIO_ROOT = Path(__file__).resolve().parent.parent

# Data directory for temp files, cache, etc.
DATA_DIR = STUDIO_ROOT / ".studio-data"
DATA_DIR.mkdir(exist_ok=True)

CACHE_DIR = STUDIO_ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

FONTS_DIR = STUDIO_ROOT / "fonts"
SONGS_DIR = STUDIO_ROOT / "Songs"


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _env_bool(key: str, default: bool = False) -> bool:
    return _env(key, str(default)).lower() in ("true", "1", "yes")


def _env_int(key: str, default: int = 0) -> int:
    try:
        return int(_env(key, str(default)))
    except ValueError:
        return default


# --- LLM Provider ---
LLM_PROVIDER = _env("LLM_PROVIDER", "ollama")  # "ollama" or "claude"
OLLAMA_BASE_URL = _env("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = _env("OLLAMA_MODEL", "")
ANTHROPIC_API_KEY = _env("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = _env("CLAUDE_MODEL", "claude-sonnet-4-20250514")

# --- Image Generation (Gemini / Nano Banana 2) ---
GEMINI_API_KEY = _env("GEMINI_API_KEY", "")
GEMINI_API_BASE_URL = _env(
    "GEMINI_API_BASE_URL",
    "https://generativelanguage.googleapis.com/v1beta",
)
GEMINI_MODEL = _env("GEMINI_MODEL", "gemini-2.0-flash-preview-image-generation")
GEMINI_ASPECT_RATIO = _env("GEMINI_ASPECT_RATIO", "9:16")

# --- TTS ---
TTS_VOICE = _env("TTS_VOICE", "Jasper")

# --- STT ---
STT_PROVIDER = _env("STT_PROVIDER", "local_whisper")
ASSEMBLYAI_API_KEY = _env("ASSEMBLYAI_API_KEY", "")
WHISPER_MODEL = _env("WHISPER_MODEL", "base")
WHISPER_DEVICE = _env("WHISPER_DEVICE", "auto")
WHISPER_COMPUTE_TYPE = _env("WHISPER_COMPUTE_TYPE", "int8")

# --- Selenium / Chrome ---
CHROME_PROFILE_DIR = _env("CHROME_PROFILE_DIR", "")  # e.g. /Users/you/Library/Application Support/Google/Chrome
CHROME_PROFILE_NAME = _env("CHROME_PROFILE_NAME", "Default")  # e.g. "Default" or "Profile 1"
HEADLESS = _env_bool("HEADLESS", False)

# --- Video ---
IMAGEMAGICK_PATH = _env("IMAGEMAGICK_PATH", "/usr/bin/convert")
VIDEO_THREADS = _env_int("VIDEO_THREADS", 4)
IS_FOR_KIDS = _env_bool("IS_FOR_KIDS", False)
SCRIPT_SENTENCE_LENGTH = _env_int("SCRIPT_SENTENCE_LENGTH", 4)
FONT = _env("FONT", "bold_font.ttf")

# --- API Server ---
API_PORT = _env_int("STUDIO_API_PORT", 8100)
API_HOST = _env("STUDIO_API_HOST", "0.0.0.0")

# --- Post Bridge (optional) ---
POST_BRIDGE_ENABLED = _env_bool("POST_BRIDGE_ENABLED", False)
POST_BRIDGE_API_KEY = _env("POST_BRIDGE_API_KEY", "")

# --- Songs ---
SONGS_ZIP_URL = _env("SONGS_ZIP_URL", "")

VERBOSE = _env_bool("VERBOSE", True)
