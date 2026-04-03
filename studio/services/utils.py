"""Studio utility functions — song management, temp file cleanup."""

import os
import random
import logging
import zipfile
import requests
import platform

from studio.config import STUDIO_ROOT, DATA_DIR, SONGS_DIR

logger = logging.getLogger(__name__)

SAFE_AUDIO_EXTENSIONS = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac")


def ensure_dirs():
    """Create required directories."""
    DATA_DIR.mkdir(exist_ok=True)
    SONGS_DIR.mkdir(exist_ok=True)


def cleanup_temp_files():
    """Remove non-JSON temp files from the data directory."""
    if not DATA_DIR.exists():
        return
    for f in DATA_DIR.iterdir():
        if f.is_file() and f.suffix != ".json":
            f.unlink()
            logger.debug(f"Removed temp file: {f}")


def fetch_songs(zip_url: str = "") -> bool:
    """Download background music from a zip URL into Songs/ directory."""
    ensure_dirs()

    # Skip if songs already exist
    existing = [f for f in SONGS_DIR.iterdir() if f.suffix.lower() in SAFE_AUDIO_EXTENSIONS]
    if existing:
        logger.info(f"Songs directory already has {len(existing)} tracks")
        return True

    if not zip_url:
        logger.warning("No songs zip URL configured")
        return False

    try:
        archive_path = SONGS_DIR / "songs.zip"
        resp = requests.get(zip_url, timeout=60)
        resp.raise_for_status()

        with open(archive_path, "wb") as f:
            f.write(resp.content)

        with zipfile.ZipFile(archive_path, "r") as zf:
            for member in zf.namelist():
                basename = os.path.basename(member)
                if not basename or not basename.lower().endswith(SAFE_AUDIO_EXTENSIONS):
                    continue
                if ".." in member or member.startswith("/"):
                    continue
                zf.extract(member, str(SONGS_DIR))

        archive_path.unlink(missing_ok=True)
        logger.info("Songs downloaded successfully")
        return True

    except Exception as e:
        logger.error(f"Failed to fetch songs: {e}")
        return False


def choose_random_song() -> str | None:
    """Pick a random background song. Returns path or None."""
    if not SONGS_DIR.exists():
        return None

    songs = [f for f in SONGS_DIR.iterdir() if f.suffix.lower() in SAFE_AUDIO_EXTENSIONS]
    if not songs:
        return None

    chosen = random.choice(songs)
    logger.info(f"Chose background song: {chosen.name}")
    return str(chosen)


def close_selenium_instances():
    """Kill any running Firefox processes."""
    try:
        if platform.system() == "Windows":
            os.system("taskkill /f /im firefox.exe")
        else:
            os.system("pkill -f firefox 2>/dev/null")
    except Exception:
        pass
