# Studio Integration — Issues Report

Generated: 2026-03-26
Source: MoneyPrinterV2 → ArmedCapital Studio

This report tracks all issues discovered during the port of YouTube Shorts and
Twitter/X Bot features from MoneyPrinterV2 into ArmedCapital. Items are
categorized as **RESOLVED** (fixed during port), **WORKAROUND** (functional
but not ideal), or **UNRESOLVED** (needs your action before the feature works).

---

## Successful Integrations

The following tools, credentials, and dependencies have been fully configured
and are ready for use. This section serves as a reference for future sessions
and alternate recommendations.

### Gemini API (AI Image Generation)
- **Status:** Configured
- **Key:** Set in `studio/.env` as `GEMINI_API_KEY`
- **Used by:** YouTube Shorts pipeline — generates scene images from script prompts
- **API console:** https://aistudio.google.com/apikey
- **Alternative:** Swap for OpenAI DALL-E or Stability AI by replacing `_generate_image()` in `studio/services/youtube_shorts.py`

### ImageMagick (Subtitle/Text Overlay)
- **Status:** Installed via Homebrew
- **Path:** `/opt/homebrew/bin/magick` (set in `studio/.env` as `IMAGEMAGICK_PATH`)
- **Used by:** MoviePy — renders subtitle text overlays on generated video clips
- **Install command:** `brew install imagemagick`
- **Alternative:** FFmpeg drawtext filter (built-in, no extra dependency) — would require rewriting the subtitle compositing in `youtube_shorts.py`

### Chrome Browser Automation (Selenium)
- **Status:** Configured (switched from Firefox)
- **Config:** `CHROME_PROFILE_DIR` and `CHROME_PROFILE_NAME` in `studio/.env`
- **Used by:** YouTube upload (`youtube_shorts.py`) and Twitter/X posting (`twitter_bot.py`)
- **Driver:** `webdriver_manager` auto-installs matching ChromeDriver
- **Requirement:** Chrome profile must be pre-logged into YouTube Studio and X.com
- **Alternative:** Replace Selenium with official APIs (YouTube Data API v3, X API v2) — see Workarounds section

### STUDIO_API_URL (Next.js ↔ Python Bridge)
- **Status:** Configured in `.env.local`
- **Value:** `http://localhost:8100`
- **Used by:** All Next.js API routes under `src/app/api/studio/` to proxy requests to the FastAPI service

### Font Files (Subtitle Rendering)
- **Status:** Installed in `studio/fonts/`
- **Used by:** MoviePy text clip generation for video subtitles
- **Fallback:** System Arial if font file is missing

### Python Dependencies
- **Status:** Installed via `pip install -r requirements.txt`
- **Key packages:** FastAPI, uvicorn, moviepy, selenium, webdriver-manager, google-generativeai, anthropic, faster-whisper, Pillow
- **Runtime:** Python 3.10+ required

### Dual LLM Provider
- **Status:** Architecture complete, ready for either provider
- **Config:** `LLM_PROVIDER=ollama` or `LLM_PROVIDER=claude` in `studio/.env`
- **Ollama:** Free/local, requires `ollama pull <model>` — default model: `llama3`
- **Claude:** Requires `ANTHROPIC_API_KEY` in `studio/.env`
- **Code:** `studio/services/llm_provider.py` — single `generate_text()` function with provider override

---

## UNRESOLVED — Requires Your Action

### 1. Chrome profile path not set
- **Impact:** Both YouTube upload and Twitter posting will fail — Selenium needs a pre-logged browser session
- **Category:** Missing configuration
- **Fix:**
  1. Open Chrome, log into YouTube Studio AND X.com
  2. Navigate to `chrome://version` and copy the **Profile Path**
  3. Split it into directory + profile name and set in `studio/.env`:
     ```bash
     # Example (macOS):
     CHROME_PROFILE_DIR=/Users/wissencapital/Library/Application Support/Google/Chrome
     CHROME_PROFILE_NAME=Default
     ```

### 2. Ollama model not pulled (if using Ollama provider)
- **Impact:** All LLM text generation will fail if `LLM_PROVIDER=ollama`
- **Category:** Missing configuration
- **Fix:**
  ```bash
  # Install Ollama: https://ollama.com
  ollama pull llama3
  # Verify: ollama list
  # Already set in studio/.env: OLLAMA_MODEL=llama3
  ```
- **Alternative:** Switch to Claude provider — set `LLM_PROVIDER=claude` and `ANTHROPIC_API_KEY=your_key` in `studio/.env`

### 3. Background music (Songs) not downloaded
- **Impact:** Videos will generate without background music (non-fatal)
- **Category:** Missing asset
- **Fix:** Either set `SONGS_ZIP_URL` in `.env` to a zip of MP3/WAV files, or manually place audio files in `studio/Songs/`

---

## WORKAROUNDS — Functional But Not Ideal

### 4. Selenium-based YouTube upload (fragile)
- **Original bug:** YouTube frequently changes their DOM — selectors may go stale
- **Workaround:** Multiple fallback selectors are used. If upload fails, the video is still generated locally and can be manually uploaded.
- **Better fix:** Replace Selenium with YouTube Data API v3 (requires OAuth setup). Prompt to address:
  > "Replace the Selenium-based YouTube upload in `studio/services/youtube_shorts.py` with YouTube Data API v3. Use OAuth2 credentials and the `google-api-python-client` library."

### 5. Selenium-based Twitter/X posting (fragile)
- **Original bug:** X.com changes DOM constantly — all selectors can go stale
- **Workaround:** Three fallback selectors for both text box and post button. If all fail, RuntimeError is raised with a clear message.
- **Better fix:** Replace Selenium with X API v2 (requires developer account). Prompt to address:
  > "Replace the Selenium-based Twitter posting in `studio/services/twitter_bot.py` with the X API v2 using tweepy. Use OAuth 2.0 PKCE flow."

### 6. No CRON/scheduling built into Studio yet
- **Original feature:** MPV2 had a `schedule` library-based CRON for auto-posting
- **Workaround:** Not ported — the ArmedCapital dashboard provides manual trigger buttons. You can add scheduling later.
- **Prompt to address:**
  > "Add a CRON scheduling feature to the Studio API. Use APScheduler to let users set recurring YouTube Short generation and Twitter posting intervals via the `/studio/schedule` endpoint."

---

## RESOLVED — Fixed During Port

### 7. Bare `except:` in YouTube upload (FIXED)
- **Original:** `except:` swallowed all errors including KeyboardInterrupt
- **Fix:** Changed to `except Exception as e:` with proper logging — [FIX-1]

### 8. No null check after image generation (FIXED)
- **Original:** If Gemini failed for a prompt, `None` was appended to images list, crashing MoviePy
- **Fix:** Images are now filtered — only non-None paths are used — [FIX-2]

### 9. ZeroDivisionError on zero-height images (FIXED)
- **Original:** `clip.w / clip.h` would crash if image had zero dimensions
- **Fix:** Added explicit `clip.h == 0` guard — [FIX-3]

### 10. No null check after LLM calls (FIXED)
- **Original:** `generate_topic()` and `generate_script()` logged error but continued with None
- **Fix:** All LLM calls return None on failure, and the pipeline halts with error details — [FIX-4]

### 11. Cache structure mismatch (FIXED)
- **Original:** `get_videos()` created `{"videos": []}` but `add_video()` expected `{"accounts": [...]}`
- **Fix:** Cache management moved to in-memory lists on the engine instances — [FIX-5]

### 12. Config re-read on every call (FIXED)
- **Original:** Every getter in `config.py` opened and parsed `config.json`
- **Fix:** All config loaded once from env vars at import time — [FIX-6]

### 13. print() everywhere replaced with logging (FIXED)
- **Original:** All output went through `print()` — no log levels, no rotation
- **Fix:** Proper Python `logging` module throughout all Studio services — [FIX-7]

### 14. Firefox → Chrome migration (FIXED)
- **Original:** MoneyPrinterV2 used Firefox/geckodriver for Selenium automation
- **Fix:** Switched to Chrome with `--user-data-dir` + `--profile-directory` flags. Updated across all files: config, YouTube engine, Twitter bot, FastAPI server, Next.js dashboard component, env files, and requirements.

---

## Quick Start Checklist

After setting up all credentials above, run Studio with:

```bash
# Terminal 1: Start Studio Python API
cd studio
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your values
uvicorn studio.api.server:app --host 0.0.0.0 --port 8100 --reload

# Terminal 2: Start Next.js (if not already running)
cd ..
npm run dev
```

Then navigate to the Studio tab in your ArmedCapital dashboard.
