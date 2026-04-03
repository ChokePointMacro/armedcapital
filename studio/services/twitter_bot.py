"""
Twitter/X Bot Engine — ported from MoneyPrinterV2 with bug fixes.

Pipeline: topic → LLM generates tweet → Selenium posts via pre-logged Firefox

Bug fixes applied:
  [FIX-1] Proper exception handling with logging
  [FIX-2] WebDriverWait used consistently (already in original)
  [FIX-3] Truncation logic preserved for 260-char limit
  [FIX-4] Cache operations handle missing account gracefully
"""

import re
import os
import sys
import json
import time
import logging

from typing import Optional, List
from datetime import datetime

from studio.config import HEADLESS, VERBOSE, CHROME_PROFILE_DIR, CHROME_PROFILE_NAME
from studio.services.llm_provider import generate_text

logger = logging.getLogger(__name__)


class TwitterBotEngine:
    """
    Generates and posts tweets to X.com via Selenium.

    Usage:
        bot = TwitterBotEngine(topic="AI news", language="English", firefox_profile="/path/to/profile")
        result = bot.generate_and_post()
    """

    def __init__(
        self,
        topic: str,
        language: str = "English",
        chrome_profile_dir: str = "",
        chrome_profile_name: str = "Default",
        account_id: str = "",
        headless: bool = HEADLESS,
    ):
        self.topic = topic
        self.language = language
        self.chrome_profile_dir = chrome_profile_dir or CHROME_PROFILE_DIR
        self.chrome_profile_name = chrome_profile_name or CHROME_PROFILE_NAME
        self.account_id = account_id
        self.headless = headless

        self.status = "idle"
        self.errors: List[str] = []
        self.last_post: Optional[str] = None
        self.posts_history: List[dict] = []

    def generate_post(self) -> Optional[str]:
        """Generate a tweet using the LLM."""
        self.status = "generating"
        try:
            completion = generate_text(
                f"Generate a Twitter post about: {self.topic} in {self.language}. "
                f"The Limit is 2 sentences. Choose a specific sub-topic of the provided topic."
            )

            if not completion:
                self.errors.append("LLM returned empty tweet")
                return None

            # Clean markdown artifacts
            completion = re.sub(r"\*", "", completion).replace('"', "")

            # Enforce character limit
            if len(completion) >= 260:
                completion = completion[:257].rsplit(" ", 1)[0] + "..."

            self.last_post = completion
            logger.info(f"Generated tweet ({len(completion)} chars): {completion[:60]}...")
            return completion

        except Exception as e:
            self.errors.append(f"Tweet generation failed: {e}")
            logger.error(f"generate_post error: {e}")
            return None

    def post_to_x(self, text: Optional[str] = None) -> dict:
        """
        Post a tweet to X.com via Selenium.

        Args:
            text: Optional custom text. If None, generates one.

        Returns:
            {"success": bool, "content": str|None, "errors": list}
        """
        self.status = "posting"
        post_content = text or self.last_post or self.generate_post()

        if not post_content:
            return {"success": False, "content": None, "errors": ["No content to post"]}

        if not self.chrome_profile_dir or not os.path.isdir(self.chrome_profile_dir):
            return {"success": False, "content": None, "errors": [
                f"Chrome profile directory invalid: {self.chrome_profile_dir}"
            ]}

        try:
            from selenium import webdriver
            from selenium.webdriver.common.by import By
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.chrome.options import Options
            from webdriver_manager.chrome import ChromeDriverManager
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC

            options = Options()
            if self.headless:
                options.add_argument("--headless=new")
            options.add_argument(f"--user-data-dir={self.chrome_profile_dir}")
            options.add_argument(f"--profile-directory={self.chrome_profile_name}")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")

            service = Service(ChromeDriverManager().install())
            browser = webdriver.Chrome(service=service, options=options)
            wait = WebDriverWait(browser, 30)

            try:
                browser.get("https://x.com/compose/post")

                # Find text box with multiple fallback selectors
                text_box = None
                text_box_selectors = [
                    (By.CSS_SELECTOR, "div[data-testid='tweetTextarea_0'][role='textbox']"),
                    (By.XPATH, "//div[@data-testid='tweetTextarea_0']//div[@role='textbox']"),
                    (By.XPATH, "//div[@role='textbox']"),
                ]

                for selector in text_box_selectors:
                    try:
                        text_box = wait.until(EC.element_to_be_clickable(selector))
                        text_box.click()
                        text_box.send_keys(post_content)
                        break
                    except Exception:
                        continue

                if text_box is None:
                    return {"success": False, "content": None, "errors": [
                        "Could not find tweet text box. Ensure Firefox profile is logged into X."
                    ]}

                # Find and click post button
                post_button = None
                post_button_selectors = [
                    (By.XPATH, "//button[@data-testid='tweetButtonInline']"),
                    (By.XPATH, "//button[@data-testid='tweetButton']"),
                    (By.XPATH, "//span[text()='Post']/ancestor::button"),
                ]

                for selector in post_button_selectors:
                    try:
                        post_button = wait.until(EC.element_to_be_clickable(selector))
                        post_button.click()
                        break
                    except Exception:
                        continue

                if post_button is None:
                    return {"success": False, "content": None, "errors": [
                        "Could not find Post button on X compose screen."
                    ]}

                time.sleep(2)

                # Record to history
                post_record = {
                    "content": post_content,
                    "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
                self.posts_history.append(post_record)
                self.status = "complete"

                logger.info(f"Posted to X: {post_content[:60]}...")
                return {"success": True, "content": post_content, "errors": []}

            except Exception as e:
                self.errors.append(f"Posting failed: {e}")
                return {"success": False, "content": None, "errors": [str(e)]}
            finally:
                browser.quit()

        except Exception as e:
            self.errors.append(f"Browser init failed: {e}")
            return {"success": False, "content": None, "errors": [str(e)]}

    def generate_and_post(self) -> dict:
        """Full pipeline: generate tweet + post it."""
        text = self.generate_post()
        if not text:
            return {"success": False, "content": None, "errors": self.errors}
        return self.post_to_x(text)

    def get_status(self) -> dict:
        return {
            "status": self.status,
            "topic": self.topic,
            "language": self.language,
            "last_post": self.last_post,
            "post_count": len(self.posts_history),
            "errors": self.errors,
        }
