import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

api_keys = (os.getenv("GOOGLE_API_KEYS") or os.getenv("GOOGLE_API_KEY", "")).split(",")
if not api_keys or not api_keys[0]:
    print("No API keys found in .env")
    exit(1)

# Try with default api_version (v1)
client = genai.Client(api_key=api_keys[0])

print("Listing available models (default version)...")
try:
    for m in client.models.list():
        if 'generateContent' in m.supported_actions:
            print(f" - {m.name}")
except Exception as e:
    print(f"Error (v1): {e}")

# Try with v1alpha
print("\nListing available models (v1alpha)...")
client_alpha = genai.Client(api_key=api_keys[0], http_options={'api_version': 'v1alpha'})
try:
    for m in client_alpha.models.list():
        if 'generateContent' in m.supported_actions:
            print(f" - {m.name}")
except Exception as e:
    print(f"Error (v1alpha): {e}")
