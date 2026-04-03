"""
Studio API Server — FastAPI service that exposes YouTube Shorts + Twitter bot
to the ArmedCapital Next.js frontend via HTTP.

Run: uvicorn studio.api.server:app --host 0.0.0.0 --port 8100
"""

import logging
import asyncio
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from studio.config import API_HOST, API_PORT, LLM_PROVIDER, OLLAMA_MODEL
from studio.services.llm_provider import (
    generate_text, select_model, get_active_model, list_ollama_models,
)
from studio.services.youtube_shorts import YouTubeShortsEngine
from studio.services.twitter_bot import TwitterBotEngine
from studio.services.utils import cleanup_temp_files, close_selenium_instances

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("studio.api")

# ── Active engine instances ──────────────────────────────────────────

_youtube_engine: Optional[YouTubeShortsEngine] = None
_twitter_engine: Optional[TwitterBotEngine] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks."""
    logger.info(f"Studio API starting — LLM provider: {LLM_PROVIDER}")
    if OLLAMA_MODEL:
        select_model(OLLAMA_MODEL)
    yield
    cleanup_temp_files()
    close_selenium_instances()
    logger.info("Studio API shutting down")


app = FastAPI(
    title="ArmedCapital Studio API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ────────────────────────────────────────

class YouTubeRequest(BaseModel):
    niche: str
    language: str = "English"
    chrome_profile_dir: str = ""
    chrome_profile_name: str = "Default"
    upload: bool = False

class TwitterRequest(BaseModel):
    topic: str
    language: str = "English"
    chrome_profile_dir: str = ""
    chrome_profile_name: str = "Default"
    custom_text: Optional[str] = None

class LLMRequest(BaseModel):
    prompt: str
    provider: Optional[str] = None
    model: Optional[str] = None

class ModelSelectRequest(BaseModel):
    model: str


# ── Health ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "llm_provider": LLM_PROVIDER,
        "active_model": get_active_model(),
    }


# ── LLM Routes ──────────────────────────────────────────────────────

@app.get("/llm/models")
async def llm_models():
    """List available Ollama models."""
    models = list_ollama_models()
    return {"models": models, "active": get_active_model()}


@app.post("/llm/select")
async def llm_select(req: ModelSelectRequest):
    select_model(req.model)
    return {"active_model": req.model}


@app.post("/llm/generate")
async def llm_generate(req: LLMRequest):
    """Direct LLM text generation."""
    try:
        result = generate_text(req.prompt, model_name=req.model, provider=req.provider)
        return {"text": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── YouTube Shorts Routes ───────────────────────────────────────────

@app.post("/youtube/generate")
async def youtube_generate(req: YouTubeRequest):
    """Generate a YouTube Short (video pipeline). Long-running — returns when done."""
    global _youtube_engine

    _youtube_engine = YouTubeShortsEngine(
        niche=req.niche,
        language=req.language,
        chrome_profile_dir=req.chrome_profile_dir,
        chrome_profile_name=req.chrome_profile_name,
    )

    # Run the blocking pipeline in a thread
    result = await asyncio.to_thread(_youtube_engine.generate_video)

    if req.upload and result["success"]:
        upload_result = await asyncio.to_thread(_youtube_engine.upload_video)
        result["upload"] = upload_result

    return result


@app.get("/youtube/status")
async def youtube_status():
    """Get current YouTube pipeline status."""
    if _youtube_engine is None:
        return {"status": "idle", "message": "No active YouTube generation"}
    return _youtube_engine.get_status()


@app.post("/youtube/upload")
async def youtube_upload():
    """Upload the last generated video."""
    if _youtube_engine is None or not _youtube_engine.video_path:
        raise HTTPException(status_code=400, detail="No video to upload. Run /youtube/generate first.")

    result = await asyncio.to_thread(_youtube_engine.upload_video)
    return result


# ── Twitter/X Routes ────────────────────────────────────────────────

@app.post("/twitter/generate")
async def twitter_generate(req: TwitterRequest):
    """Generate a tweet (preview, don't post)."""
    global _twitter_engine

    _twitter_engine = TwitterBotEngine(
        topic=req.topic,
        language=req.language,
        chrome_profile_dir=req.chrome_profile_dir,
        chrome_profile_name=req.chrome_profile_name,
    )

    text = await asyncio.to_thread(_twitter_engine.generate_post)
    if not text:
        raise HTTPException(status_code=500, detail="Failed to generate tweet")

    return {"text": text, "char_count": len(text)}


@app.post("/twitter/post")
async def twitter_post(req: TwitterRequest):
    """Generate and post a tweet to X.com."""
    global _twitter_engine

    _twitter_engine = TwitterBotEngine(
        topic=req.topic,
        language=req.language,
        chrome_profile_dir=req.chrome_profile_dir,
        chrome_profile_name=req.chrome_profile_name,
    )

    result = await asyncio.to_thread(
        _twitter_engine.post_to_x, req.custom_text
    )
    return result


@app.get("/twitter/status")
async def twitter_status():
    """Get current Twitter bot status."""
    if _twitter_engine is None:
        return {"status": "idle", "message": "No active Twitter session"}
    return _twitter_engine.get_status()


# ── Entry Point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=API_HOST, port=API_PORT)
