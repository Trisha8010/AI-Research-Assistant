# backend/key_manager.py
"""KeyManager module with validation, rotation, and diagnostics.
Provides:
- load_keys(): read GOOGLE_API_KEYS or GOOGLE_API_KEY from env (comma-separated)
- KeyManager class with:
  * validate_keys(): test each key via a lightweight request
  * client property: returns a configured genai Client for the current valid key
  * periodic validation loop to refresh keys
  * exhaustion handling to avoid reusing failing keys for a cooldown period
  * call_gemini(): call a Gemini API method on a client with rotation/retry logic
  * call_gemini_with_failover(): failover across multiple models
- Exported singleton `key_manager` for easy import.
"""

import os
import time
import threading
from typing import Optional, List, Dict, Any, Tuple
from google import genai

def _load_keys_from_env() -> List[str]:
    """Read GOOGLE_API_KEYS or GOOGLE_API_KEY and return a list of keys.
    Supports comma-separated lists. Empty entries are ignored.
    """
    raw = os.getenv("GOOGLE_API_KEYS") or os.getenv("GOOGLE_API_KEY", "")
    return [k.strip() for k in raw.split(",") if k.strip()]

class KeyManager:
    """Manage multiple Gemini API keys with validation, rotation, and cooldown handling.
    Uses the modern google-genai SDK.
    """

    def __init__(self):
        self.all_keys: List[str] = _load_keys_from_env()
        self.valid_keys: List[str] = []
        self.invalid_keys: Dict[str, str] = {}
        self.current_index: int = 0
        self._client: Optional[genai.Client] = None
        # (key, model) -> unix timestamp when it becomes usable again
        self.exhausted_until: Dict[Tuple[str, Optional[str]], float] = {}
        self._lock = threading.Lock()

        # Validate immediately on startup
        self.validate_keys()

    def _load_keys(self) -> None:
        """Refresh key list from the environment."""
        self.all_keys = _load_keys_from_env()

    def _create_client(self, key: str) -> genai.Client:
        """Create a genai.Client instance with the given API key."""
        return genai.Client(api_key=key)

    @property
    def client(self) -> Optional[genai.Client]:
        """Public accessor for the current active Gemini client.
        If the current client is None or invalid, returns None.
        """
        if not self._client and self.valid_keys:
            self._client = self._create_client(self.valid_keys[self.current_index])
        return self._client

    def validate_keys(self) -> None:
        """Validate all keys by list_models request.
        Successful keys go to self.valid_keys; failures go to self.invalid_keys.
        """
        self.valid_keys.clear()
        self.invalid_keys.clear()
        # Do not clear exhausted_until here — keep cooldowns across revalidation

        for key in self.all_keys:
            try:
                client = self._create_client(key)
                # Consume list of models to force a call
                list(client.models.list())
                self.valid_keys.append(key)
                print(f"[KeyManager] [OK] Valid key: ***{key[-4:]}")
            except Exception as e:
                self.invalid_keys[key] = str(e)
                print(f"[KeyManager] [ERROR] Invalid key: ***{key[-4:]} - {e}")

        self.current_index = 0
        if self.valid_keys:
            self._client = self._create_client(self.valid_keys[0])
        else:
            self._client = None

    def get_client(self) -> Optional[genai.Client]:
        """Return a genai.Client for the next valid, non-exhausted key, rotating."""
        self._load_keys()
        if not self.valid_keys:
            self.validate_keys()

        if not self.valid_keys:
            print("[KeyManager] No valid keys available.")
            return None

        # Clean expired
        now = time.time()
        expired = [k for k, ts in self.exhausted_until.items() if ts <= now]
        for k in expired:
            del self.exhausted_until[k]

        start_idx = self.current_index
        for _ in range(len(self.valid_keys)):
            key = self.valid_keys[self.current_index]
            # If key is not exhausted for general/any model, return it
            if (key, None) not in self.exhausted_until:
                self._client = self._create_client(key)
                self.current_index = (self.current_index + 1) % len(self.valid_keys)
                return self._client

            self.current_index = (self.current_index + 1) % len(self.valid_keys)
            if self.current_index == start_idx:
                break

        print("[KeyManager] All valid keys are currently exhausted.")
        return None

    def refresh_keys(self) -> None:
        """Force reload and re-validation of all keys."""
        self._load_keys()
        self.validate_keys()

    def start_periodic_validation(self, interval_seconds: int = 21600) -> None:
        """Start background daemon thread to periodically refresh keys."""
        def _loop():
            while True:
                time.sleep(interval_seconds)
                print("[KeyManager] Periodic validation triggered.")
                self.refresh_keys()
        thread = threading.Thread(target=_loop, daemon=True)
        thread.start()

    def reset_exhaustion(self) -> None:
        """Clear all exhaustion tracking."""
        self.exhausted_until.clear()
        print("[KeyManager] Exhaustion state reset.")

    def status(self) -> Dict[str, Any]:
        """Return a diagnostics-friendly snapshot of key health."""
        now = time.time()
        active = []
        cooling = []
        for k in self.valid_keys:
            still_cooling = any(
                (key == k and ts > now) for (key, _), ts in self.exhausted_until.items()
            )
            if still_cooling:
                cooling.append(f"***{k[-4:]}")
            else:
                active.append(f"***{k[-4:]}")
        return {
            "total_configured": len(self.all_keys),
            "valid": len(self.valid_keys),
            "active_keys": active,
            "cooling_keys": cooling,
            "invalid_keys": {f"***{k[-4:]}": v for k, v in self.invalid_keys.items()},
            "exhausted_entries": {
                f"***{k[-4:]}_{model or 'any'}": int(ts - now)
                for (k, model), ts in self.exhausted_until.items()
                if ts > now
            },
        }

    def call_gemini(self, operation: str, **kwargs) -> Any:
        """Call a Gemini API method (upload_file or generate_content) with automatic
        rotation of keys, short backoff retries, and exhaustion cooldown tracking.
        """
        model = kwargs.get("model")
        max_rounds = 2  # one full rotation + one retry round after short sleeps

        for round_num in range(max_rounds):
            # Clean expired exhaustion entries
            now = time.time()
            expired = [k for k, ts in self.exhausted_until.items() if ts <= now]
            for k in expired:
                del self.exhausted_until[k]

            self._load_keys()
            if not self.valid_keys:
                self.validate_keys()

            if not self.valid_keys:
                raise Exception(
                    "No valid API keys configured. Set GOOGLE_API_KEY or GOOGLE_API_KEYS "
                    "(comma-separated) in your environment / .env file."
                )

            for _ in range(len(self.valid_keys)):
                key = self.valid_keys[self.current_index]

                # Skip if this key+model (or key-wide) is still exhausted
                if (key, model) in self.exhausted_until or (key, None) in self.exhausted_until:
                    self.current_index = (self.current_index + 1) % len(self.valid_keys)
                    continue

                try:
                    client = self._create_client(key)
                    self._client = client

                    if operation == "upload_file":
                        res = client.files.upload(**kwargs)
                    elif operation == "generate_content":
                        res = client.models.generate_content(**kwargs)
                    else:
                        raise ValueError(f"Unsupported operation: {operation}")

                    # Success — rotate for load balancing
                    self.current_index = (self.current_index + 1) % len(self.valid_keys)
                    return res
                except Exception as e:
                    err_str = str(e).upper()
                    print(
                        f"[KeyManager] Operation '{operation}' failed using key ***{key[-4:]} "
                        f"for model {model}: {e}"
                    )

                    # Rate-limit / quota → put this key+model on cooldown
                    if any(x in err_str for x in ["429", "LIMIT", "QUOTA", "RESOURCE_EXHAUSTED"]):
                        cooldown_seconds = 300  # 5 minutes
                        self.exhausted_until[(key, model)] = time.time() + cooldown_seconds
                        print(
                            f"[KeyManager] Key ***{key[-4:]} marked exhausted for model {model} "
                            f"until {time.strftime('%H:%M:%S', time.localtime(time.time() + cooldown_seconds))}"
                        )

                    # Rotate and try next key
                    self.current_index = (self.current_index + 1) % len(self.valid_keys)

            # All keys failed or were cooling in this round
            if round_num < max_rounds - 1:
                sleep_for = 8
                print(f"[KeyManager] All keys exhausted or failed. Backing off {sleep_for}s before retry...")
                time.sleep(sleep_for)
            else:
                status = self.status()
                raise Exception(
                    f"All available API keys failed or were exhausted for '{operation}' "
                    f"with model '{model}'. "
                    f"Configured: {status['total_configured']}, "
                    f"valid: {status['valid']}, "
                    f"currently cooling: {status['cooling_keys'] or 'none'}. "
                    f"Add more keys via GOOGLE_API_KEYS or wait for cooldowns to expire."
                )

    def call_gemini_with_failover(self, operation: str, models: List[str], **kwargs) -> Any:
        """Call operation using a priority list of models. If a model fails, try the next."""
        last_error = None
        for model in models:
            try:
                kwargs["model"] = model
                return self.call_gemini(operation, **kwargs)
            except Exception as e:
                print(f"[KeyManager] Model {model} failed in failover: {e}")
                last_error = e
                continue

        raise last_error or Exception("Failover failed for all models.")

# Export a singleton for easy import throughout the project
key_manager = KeyManager()
