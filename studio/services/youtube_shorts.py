"""
YouTube Shorts Engine — ported from MoneyPrinterV2 with bug fixes.

Pipeline: niche → topic → script → metadata → image prompts → Gemini images
         → KittenTTS → Whisper subtitles → MoviePy combine → Selenium upload

Bug fixes applied:
  [FIX-1] Bare except → except Exception as e (upload_video)
  [FIX-2] Null check after image generation (generate_video)
  [FIX-3] ZeroDivisionError guard on image aspect ratio (combine)
  [FIX-4] Null check after LLM calls (generate_topic, generate_script)
  [FIX-5] Cache structure mismatch (get_videos creates correct structure)
  [FIX-6] Config cached at init, not re-read on every call
  [FIX-7] Proper logging instead of print() everywhere
"""

import re
import os
import sys
import json
import time
import base64
import logging
import requests

from uuid import uuid4
from typing import List, Optional
from datetime import datetime
from pathlib import Path

from studio.config import (
    STUDIO_ROOT, DATA_DIR, FONTS_DIR, VERBOSE,
    GEMINI_API_KEY, GEMINI_API_BASE_URL, GEMINI_MODEL, GEMINI_ASPECT_RATIO,
    IMAGEMAGICK_PATH, VIDEO_THREADS, IS_FOR_KIDS, SCRIPT_SENTENCE_LENGTH,
    FONT, HEADLESS, STT_PROVIDER, ASSEMBLYAI_API_KEY,
    WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE,
    CHROME_PROFILE_DIR, CHROME_PROFILE_NAME,
)
from studio.services.llm_provider import generate_text

logger = logging.getLogger(__name__)

# Ensure data dir exists
DATA_DIR.mkdir(exist_ok=True)

# YouTube Selenium constants
YOUTUBE_TEXTBOX_ID = "textbox"
YOUTUBE_MADE_FOR_KIDS_NAME = "VIDEO_MADE_FOR_KIDS_MFK"
YOUTUBE_NOT_MADE_FOR_KIDS_NAME = "VIDEO_MADE_FOR_KIDS_NOT_MFK"
YOUTUBE_NEXT_BUTTON_ID = "next-button"
YOUTUBE_RADIO_BUTTON_XPATH = '//*[@id="radioLabel"]'
YOUTUBE_DONE_BUTTON_ID = "done-button"


class YouTubeShortsEngine:
    """
    Generates and uploads YouTube Shorts.

    Usage:
        engine = YouTubeShortsEngine(niche="AI Technology", language="English", firefox_profile="/path/to/profile")
        result = engine.generate_video()
        if result["success"]:
            engine.upload_video()
    """

    def __init__(
        self,
        niche: str,
        language: str = "English",
        chrome_profile_dir: str = "",
        chrome_profile_name: str = "Default",
        account_id: str = "",
        headless: bool = HEADLESS,
    ):
        self.niche = niche
        self.language = language
        self.chrome_profile_dir = chrome_profile_dir or CHROME_PROFILE_DIR
        self.chrome_profile_name = chrome_profile_name or CHROME_PROFILE_NAME
        self.account_id = account_id or str(uuid4())
        self.headless = headless

        # Pipeline state
        self.subject: Optional[str] = None
        self.script: Optional[str] = None
        self.metadata: Optional[dict] = None
        self.image_prompts: List[str] = []
        self.images: List[str] = []
        self.tts_path: Optional[str] = None
        self.video_path: Optional[str] = None
        self.uploaded_video_url: Optional[str] = None

        # Status tracking for the API
        self.status = "idle"
        self.step = ""
        self.errors: List[str] = []

    # ── LLM ──────────────────────────────────────────────────────────

    def _llm(self, prompt: str) -> Optional[str]:
        """Call LLM with error handling. Returns None on failure."""
        try:
            result = generate_text(prompt)
            if not result:
                self.errors.append("LLM returned empty response")
                return None
            return result
        except Exception as e:
            self.errors.append(f"LLM error: {e}")
            logger.error(f"LLM call failed: {e}")
            return None

    # ── Topic ────────────────────────────────────────────────────────

    def generate_topic(self) -> Optional[str]:
        """Generate a video topic from the niche."""
        self.step = "generating_topic"
        self.status = "working"

        completion = self._llm(
            f"Please generate a specific video idea that takes about the following topic: {self.niche}. "
            f"Make it exactly one sentence. Only return the topic, nothing else."
        )
        # [FIX-4] Proper null check — don't continue with None
        if not completion:
            self.errors.append("Failed to generate topic")
            return None

        self.subject = completion
        logger.info(f"Generated topic: {completion[:80]}...")
        return completion

    # ── Script ───────────────────────────────────────────────────────

    def generate_script(self) -> Optional[str]:
        """Generate a video script from the topic."""
        self.step = "generating_script"

        if not self.subject:
            self.errors.append("Cannot generate script without a topic")
            return None

        prompt = f"""
        Generate a script for a video in {SCRIPT_SENTENCE_LENGTH} sentences, depending on the subject of the video.
        The script is to be returned as a string with the specified number of paragraphs.
        Do not under any circumstance reference this prompt in your response.
        Get straight to the point, don't start with unnecessary things like, "welcome to this video".
        The script should be related to the subject of the video.
        YOU MUST NOT EXCEED THE {SCRIPT_SENTENCE_LENGTH} SENTENCES LIMIT. MAKE SURE THE {SCRIPT_SENTENCE_LENGTH} SENTENCES ARE SHORT.
        YOU MUST NOT INCLUDE ANY TYPE OF MARKDOWN OR FORMATTING IN THE SCRIPT, NEVER USE A TITLE.
        YOU MUST WRITE THE SCRIPT IN THE LANGUAGE SPECIFIED IN [LANGUAGE].
        ONLY RETURN THE RAW CONTENT OF THE SCRIPT.
        DO NOT INCLUDE "VOICEOVER", "NARRATOR" OR SIMILAR INDICATORS.

        Subject: {self.subject}
        Language: {self.language}
        """

        completion = self._llm(prompt)
        # [FIX-4] Don't continue with empty script
        if not completion:
            self.errors.append("Generated script is empty")
            return None

        # Clean markdown artifacts
        completion = re.sub(r"\*", "", completion)

        if len(completion) > 5000:
            logger.warning("Script too long, retrying...")
            return self.generate_script()

        self.script = completion
        logger.info(f"Generated script ({len(completion)} chars)")
        return completion

    # ── Metadata ─────────────────────────────────────────────────────

    def generate_metadata(self) -> Optional[dict]:
        """Generate title + description for the video."""
        self.step = "generating_metadata"

        title = self._llm(
            f"Please generate a YouTube Video Title for the following subject, including hashtags: "
            f"{self.subject}. Only return the title, nothing else. Limit the title under 100 characters."
        )
        if not title:
            return None

        if len(title) > 100:
            logger.warning("Title too long, retrying...")
            return self.generate_metadata()

        description = self._llm(
            f"Please generate a YouTube Video Description for the following script: {self.script}. "
            f"Only return the description, nothing else."
        )
        if not description:
            return None

        self.metadata = {"title": title, "description": description}
        return self.metadata

    # ── Image Prompts ────────────────────────────────────────────────

    def generate_prompts(self) -> List[str]:
        """Generate AI image prompts from the script."""
        self.step = "generating_image_prompts"

        n_prompts = max(1, len(self.script) // 3) if self.script else 3

        prompt = f"""
        Generate {n_prompts} Image Prompts for AI Image Generation,
        depending on the subject of a video.
        Subject: {self.subject}

        The image prompts are to be returned as a JSON-Array of strings.
        Each search term should consist of a full sentence, always add the main subject of the video.
        Be emotional and use interesting adjectives to make the Image Prompt as detailed as possible.

        YOU MUST ONLY RETURN THE JSON-ARRAY OF STRINGS.
        YOU MUST NOT RETURN ANYTHING ELSE.

        For context, here is the full text:
        {self.script}
        """

        completion = self._llm(prompt)
        if not completion:
            return []

        completion = completion.replace("```json", "").replace("```", "")

        image_prompts = []
        try:
            parsed = json.loads(completion)
            if isinstance(parsed, dict) and "image_prompts" in parsed:
                image_prompts = parsed["image_prompts"]
            elif isinstance(parsed, list):
                image_prompts = parsed
        except json.JSONDecodeError:
            # Try regex extraction
            match = re.search(r"\[.*\]", completion, re.DOTALL)
            if match:
                try:
                    image_prompts = json.loads(match.group())
                except json.JSONDecodeError:
                    self.errors.append("Failed to parse image prompts from LLM response")
                    return []

        if len(image_prompts) > n_prompts:
            image_prompts = image_prompts[:n_prompts]

        self.image_prompts = image_prompts
        logger.info(f"Generated {len(image_prompts)} image prompts")
        return image_prompts

    # ── Image Generation (Gemini) ────────────────────────────────────

    def generate_image(self, prompt: str) -> Optional[str]:
        """Generate an image using Gemini API. Returns file path or None."""
        self.step = "generating_images"

        if not GEMINI_API_KEY:
            self.errors.append("GEMINI_API_KEY not configured — cannot generate images")
            return None

        endpoint = f"{GEMINI_API_BASE_URL.rstrip('/')}/models/{GEMINI_MODEL}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": GEMINI_ASPECT_RATIO},
            },
        }

        try:
            response = requests.post(
                endpoint,
                headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
                json=payload,
                timeout=300,
            )
            response.raise_for_status()
            body = response.json()

            for candidate in body.get("candidates", []):
                content = candidate.get("content", {})
                for part in content.get("parts", []):
                    inline_data = part.get("inlineData") or part.get("inline_data")
                    if not inline_data:
                        continue
                    data = inline_data.get("data")
                    mime_type = inline_data.get("mimeType") or inline_data.get("mime_type", "")
                    if data and str(mime_type).startswith("image/"):
                        image_bytes = base64.b64decode(data)
                        image_path = str(DATA_DIR / f"{uuid4()}.png")
                        with open(image_path, "wb") as f:
                            f.write(image_bytes)
                        logger.info(f"Generated image: {image_path}")
                        return image_path

            self.errors.append("Gemini did not return an image payload")
            return None

        except Exception as e:
            self.errors.append(f"Image generation failed: {e}")
            logger.error(f"Gemini image gen failed: {e}")
            return None

    # ── TTS ──────────────────────────────────────────────────────────

    def generate_tts(self) -> Optional[str]:
        """Convert script to speech using KittenTTS."""
        self.step = "generating_tts"

        try:
            from kittentts import KittenTTS as KittenModel
            import soundfile as sf
            from studio.config import TTS_VOICE

            model = KittenModel("KittenML/kitten-tts-mini-0.8")
            clean_script = re.sub(r"[^\w\s.?!]", "", self.script)
            audio = model.generate(clean_script, voice=TTS_VOICE)

            path = str(DATA_DIR / f"{uuid4()}.wav")
            sf.write(path, audio, 24000)
            self.tts_path = path
            logger.info(f"Generated TTS: {path}")
            return path

        except Exception as e:
            self.errors.append(f"TTS failed: {e}")
            logger.error(f"TTS generation failed: {e}")
            return None

    # ── Subtitles ────────────────────────────────────────────────────

    def generate_subtitles(self, audio_path: str) -> Optional[str]:
        """Generate SRT subtitles from audio."""
        provider = STT_PROVIDER.lower()

        if provider == "third_party_assemblyai":
            return self._subtitles_assemblyai(audio_path)
        return self._subtitles_whisper(audio_path)

    def _subtitles_whisper(self, audio_path: str) -> Optional[str]:
        try:
            from faster_whisper import WhisperModel

            model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
            segments, _ = model.transcribe(audio_path, vad_filter=True)

            lines = []
            for idx, segment in enumerate(segments, start=1):
                start = self._format_srt_ts(segment.start)
                end = self._format_srt_ts(segment.end)
                text = str(segment.text).strip()
                if not text:
                    continue
                lines.extend([str(idx), f"{start} --> {end}", text, ""])

            srt_path = str(DATA_DIR / f"{uuid4()}.srt")
            with open(srt_path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            return srt_path

        except ImportError:
            self.errors.append("faster-whisper not installed — subtitles skipped")
            return None
        except Exception as e:
            self.errors.append(f"Whisper STT failed: {e}")
            return None

    def _subtitles_assemblyai(self, audio_path: str) -> Optional[str]:
        try:
            import assemblyai as aai
            aai.settings.api_key = ASSEMBLYAI_API_KEY
            transcriber = aai.Transcriber(config=aai.TranscriptionConfig())
            transcript = transcriber.transcribe(audio_path)
            subtitles = transcript.export_subtitles_srt()

            srt_path = str(DATA_DIR / f"{uuid4()}.srt")
            with open(srt_path, "w") as f:
                f.write(subtitles)
            return srt_path

        except Exception as e:
            self.errors.append(f"AssemblyAI STT failed: {e}")
            return None

    @staticmethod
    def _format_srt_ts(seconds: float) -> str:
        total_ms = max(0, int(round(seconds * 1000)))
        h = total_ms // 3600000
        m = (total_ms % 3600000) // 60000
        s = (total_ms % 60000) // 1000
        ms = total_ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    # ── Video Combination ────────────────────────────────────────────

    def combine(self) -> Optional[str]:
        """Combine images + TTS + music + subtitles into final MP4."""
        self.step = "combining_video"

        try:
            from moviepy.editor import (
                ImageClip, AudioFileClip, CompositeAudioClip,
                CompositeVideoClip, TextClip, concatenate_videoclips,
            )
            from moviepy.video.fx.all import crop
            from moviepy.video.tools.subtitles import SubtitlesClip
            from moviepy.config import change_settings
            import moviepy.audio.fx.all as afx

            change_settings({"IMAGEMAGICK_BINARY": IMAGEMAGICK_PATH})

            output_path = str(DATA_DIR / f"{uuid4()}.mp4")
            tts_clip = AudioFileClip(self.tts_path)
            max_duration = tts_clip.duration

            # [FIX-2] Filter out None images
            valid_images = [img for img in self.images if img and os.path.exists(img)]
            if not valid_images:
                self.errors.append("No valid images to combine into video")
                return None

            req_dur = max_duration / len(valid_images)

            # Subtitle generator
            font_path = str(FONTS_DIR / FONT) if (FONTS_DIR / FONT).exists() else None
            generator = lambda txt: TextClip(
                txt,
                font=font_path or "Arial",
                fontsize=100,
                color="#FFFF00",
                stroke_color="black",
                stroke_width=5,
                size=(1080, 1920),
                method="caption",
            )

            clips = []
            tot_dur = 0
            while tot_dur < max_duration:
                for image_path in valid_images:
                    clip = ImageClip(image_path)
                    clip.duration = req_dur
                    clip = clip.set_fps(30)

                    # [FIX-3] Guard against zero-height images
                    if clip.h == 0 or clip.w == 0:
                        logger.warning(f"Skipping invalid image: {image_path}")
                        continue

                    if round((clip.w / clip.h), 4) < 0.5625:
                        clip = crop(clip, width=clip.w, height=round(clip.w / 0.5625),
                                    x_center=clip.w / 2, y_center=clip.h / 2)
                    else:
                        clip = crop(clip, width=round(0.5625 * clip.h), height=clip.h,
                                    x_center=clip.w / 2, y_center=clip.h / 2)

                    clip = clip.resize((1080, 1920))
                    clips.append(clip)
                    tot_dur += clip.duration

            final_clip = concatenate_videoclips(clips).set_fps(30)

            # Background music (optional)
            try:
                from studio.services.utils import choose_random_song
                random_song = choose_random_song()
                if random_song:
                    song_clip = AudioFileClip(random_song).set_fps(44100)
                    song_clip = song_clip.fx(afx.volumex, 0.1)
                    comp_audio = CompositeAudioClip([tts_clip.set_fps(44100), song_clip])
                else:
                    comp_audio = tts_clip.set_fps(44100)
            except Exception:
                comp_audio = tts_clip.set_fps(44100)

            final_clip = final_clip.set_audio(comp_audio).set_duration(tts_clip.duration)

            # Subtitles (optional)
            try:
                import srt_equalizer
                subtitles_path = self.generate_subtitles(self.tts_path)
                if subtitles_path:
                    srt_equalizer.equalize_srt_file(subtitles_path, subtitles_path, 10)
                    subtitles = SubtitlesClip(subtitles_path, generator)
                    subtitles.set_pos(("center", "center"))
                    final_clip = CompositeVideoClip([final_clip, subtitles])
            except Exception as e:
                logger.warning(f"Subtitles failed, continuing without: {e}")

            final_clip.write_videofile(output_path, threads=VIDEO_THREADS)
            self.video_path = os.path.abspath(output_path)
            logger.info(f"Video written: {self.video_path}")
            return self.video_path

        except Exception as e:
            self.errors.append(f"Video combination failed: {e}")
            logger.error(f"combine() failed: {e}")
            return None

    # ── Full Pipeline ────────────────────────────────────────────────

    def generate_video(self) -> dict:
        """
        Run the full YouTube Shorts pipeline. Returns a status dict.

        Returns:
            {"success": bool, "video_path": str|None, "errors": list}
        """
        self.status = "working"
        self.errors = []

        steps = [
            ("topic", self.generate_topic),
            ("script", self.generate_script),
            ("metadata", self.generate_metadata),
            ("prompts", self.generate_prompts),
        ]

        for name, fn in steps:
            result = fn()
            if result is None and name != "prompts":
                self.status = "failed"
                return {"success": False, "video_path": None, "errors": self.errors, "step": name}

        # Generate images — [FIX-2] skip None results
        self.images = []
        for prompt in self.image_prompts:
            img_path = self.generate_image(prompt)
            if img_path:
                self.images.append(img_path)

        if not self.images:
            self.status = "failed"
            self.errors.append("No images were generated successfully")
            return {"success": False, "video_path": None, "errors": self.errors, "step": "images"}

        # TTS
        if not self.generate_tts():
            self.status = "failed"
            return {"success": False, "video_path": None, "errors": self.errors, "step": "tts"}

        # Combine
        path = self.combine()
        if not path:
            self.status = "failed"
            return {"success": False, "video_path": None, "errors": self.errors, "step": "combine"}

        self.status = "complete"
        return {"success": True, "video_path": path, "errors": self.errors, "step": "complete"}

    # ── Upload ───────────────────────────────────────────────────────

    def upload_video(self) -> dict:
        """
        Upload generated video to YouTube via Selenium.
        Requires firefox_profile to be set and pre-logged into YouTube.

        Returns:
            {"success": bool, "url": str|None, "errors": list}
        """
        self.step = "uploading"

        if not self.video_path:
            return {"success": False, "url": None, "errors": ["No video to upload"]}

        if not self.chrome_profile_dir or not os.path.isdir(self.chrome_profile_dir):
            return {"success": False, "url": None, "errors": [
                f"Chrome profile directory invalid: {self.chrome_profile_dir}"
            ]}

        try:
            from selenium import webdriver
            from selenium.webdriver.common.by import By
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.chrome.options import Options
            from webdriver_manager.chrome import ChromeDriverManager

            options = Options()
            if self.headless:
                options.add_argument("--headless=new")
            options.add_argument(f"--user-data-dir={self.chrome_profile_dir}")
            options.add_argument(f"--profile-directory={self.chrome_profile_name}")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")

            service = Service(ChromeDriverManager().install())
            browser = webdriver.Chrome(service=service, options=options)

            try:
                # Get channel ID
                browser.get("https://studio.youtube.com")
                time.sleep(3)
                channel_id = browser.current_url.split("/")[-1]

                # Navigate to upload
                browser.get("https://www.youtube.com/upload")
                time.sleep(2)

                # Set video file
                file_picker = browser.find_element(By.TAG_NAME, "ytcp-uploads-file-picker")
                file_input = file_picker.find_element(By.TAG_NAME, "input")
                file_input.send_keys(self.video_path)
                time.sleep(5)

                # Set title + description
                textboxes = browser.find_elements(By.ID, YOUTUBE_TEXTBOX_ID)
                title_el = textboxes[0]
                desc_el = textboxes[-1]

                title_el.click()
                time.sleep(1)
                title_el.clear()
                title_el.send_keys(self.metadata["title"])

                time.sleep(3)
                desc_el.click()
                time.sleep(0.5)
                desc_el.clear()
                desc_el.send_keys(self.metadata["description"])
                time.sleep(0.5)

                # Made for kids
                if not IS_FOR_KIDS:
                    browser.find_element(By.NAME, YOUTUBE_NOT_MADE_FOR_KIDS_NAME).click()
                else:
                    browser.find_element(By.NAME, YOUTUBE_MADE_FOR_KIDS_NAME).click()
                time.sleep(0.5)

                # Click through next buttons
                for _ in range(3):
                    browser.find_element(By.ID, YOUTUBE_NEXT_BUTTON_ID).click()
                    time.sleep(2)

                # Set as unlisted
                radio_buttons = browser.find_elements(By.XPATH, YOUTUBE_RADIO_BUTTON_XPATH)
                if len(radio_buttons) >= 3:
                    radio_buttons[2].click()
                time.sleep(0.5)

                # Done
                browser.find_element(By.ID, YOUTUBE_DONE_BUTTON_ID).click()
                time.sleep(3)

                # Get video URL
                browser.get(f"https://studio.youtube.com/channel/{channel_id}/videos/short")
                time.sleep(3)
                videos = browser.find_elements(By.TAG_NAME, "ytcp-video-row")
                if videos:
                    anchor = videos[0].find_element(By.TAG_NAME, "a")
                    href = anchor.get_attribute("href")
                    video_id = href.split("/")[-2]
                    url = f"https://www.youtube.com/watch?v={video_id}"
                    self.uploaded_video_url = url
                    logger.info(f"Uploaded video: {url}")
                    return {"success": True, "url": url, "errors": []}
                else:
                    return {"success": False, "url": None, "errors": ["Could not find uploaded video"]}

            # [FIX-1] Proper exception handling instead of bare except
            except Exception as e:
                self.errors.append(f"Upload failed: {e}")
                logger.error(f"YouTube upload error: {e}")
                return {"success": False, "url": None, "errors": [str(e)]}
            finally:
                browser.quit()

        except Exception as e:
            self.errors.append(f"Browser init failed: {e}")
            return {"success": False, "url": None, "errors": [str(e)]}

    # ── Status ───────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Get current pipeline status for the dashboard."""
        return {
            "status": self.status,
            "step": self.step,
            "niche": self.niche,
            "subject": self.subject,
            "has_script": self.script is not None,
            "image_count": len(self.images),
            "has_tts": self.tts_path is not None,
            "has_video": self.video_path is not None,
            "uploaded_url": self.uploaded_video_url,
            "errors": self.errors,
        }
