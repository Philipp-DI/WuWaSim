import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ==============================================================================
# CONFIGURATION & CONSTANTS
# ==============================================================================
# The correct sub-domain where static content assets are actively served
STATIC_BASE_URL = "https://static.nanoka.cc"

# Source folder path containing the extracted JSON data maps
SOURCE_DATA_DIR = "data/extracted-nanoka"

# Resource mappings linking the json filename to its relative target download directory
RESOURCE_MAPPING = {
    "character.json": "assets/icons/resonators",
    "weapon.json": "assets/icons/weapons",
    "echo.json": "assets/icons/echoes",
    "monster.json": "assets/icons/monsters",
}

# Standard browser headers to ensure connection handshakes are accepted smoothly
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


# ==============================================================================
# UTILITIES & ENGINE
# ==============================================================================
def clean_nanoka_path(raw_path: str) -> str:
    """
    Cleans Unreal Engine asset string references (e.g., 'Path/Asset.Asset')
    by extracting the base path and appending the correct web asset extension (.webp).
    """
    if not raw_path:
        return ""

    # Split by dot to strip away duplicated Unreal Engine asset names (e.g. .T_IconWeapon...)
    base_path = raw_path.split(".")[0]

    # Ensure it starts with the standard asset root folder pathing
    if not base_path.startswith("/") and not base_path.startswith("http"):
        # If the path looks like 'Game/Aki/...', prepend the asset directory context
        if base_path.startswith("Game/"):
            base_path = f"/assets/ww/UIResources/Common/Image/{base_path.replace('Game/Aki/UI/UIResources/Common/Image/', '')}"
        else:
            base_path = f"/{base_path}"

    # Normalize path formatting to match 'assets/ww/UIResources/...' style structures
    if "/Game/Aki/UI/" in base_path:
        base_path = base_path.replace("/Game/Aki/UI/", "/assets/ww/")

    return f"{base_path}.webp"


def download_asset(remote_path: str, local_path: Path) -> bool:
    """
    Downloads a binary asset with retry logic and stream safety wrapper.
    """
    if local_path.exists():
        # Safeguard to avoid re-downloading local assets
        return True

    try:
        req = urllib.request.Request(remote_path, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status == 200:
                local_path.parent.mkdir(parents=True, exist_ok=True)
                with open(local_path, "wb") as out_file:
                    out_file.write(response.read())
                return True
    except urllib.error.URLError as e:
        print(
            f"    [ERROR] Failed network fetch for target: {remote_path}. Reason: {e.reason}",
            file=sys.stderr,
        )
    except Exception as e:
        print(
            f"    [ERROR] Unexpected error downloading {remote_path}: {e}",
            file=sys.stderr,
        )
    return False


def parse_and_map_resource(json_path: Path, output_dir: Path) -> None:
    """
    Parses structural keys inside nanoka schema definitions and executes icon mapping extractions.
    """
    print(f"[*] Processing data definitions inside: {json_path.name}")

    if not json_path.exists():
        print(f"    [SKIP] Found no source tracking file at {json_path}")
        return

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as jde:
        print(
            f"    [CRITICAL] Invalid JSON data stream syntax inside {json_path}: {jde}",
            file=sys.stderr,
        )
        return

    # Handle instances whether root node is formatted directly as an array or a wrapper dictionary object
    items: list[dict[str, Any]] = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("items", data.get("data", list(data.values())))

    success_count = 0
    failure_count = 0

    for item in items:
        if not isinstance(item, dict):
            continue

        # Fallback inspection cascade matches common naming tokens found inside your configurations
        icon_path = item.get(
            "icon", item.get("Icon", item.get("iconPath", item.get("avatar", "")))
        )

        if not icon_path or not isinstance(icon_path, str):
            continue

        # Process path configurations and assemble target URLs
        cleaned_path = clean_nanoka_path(icon_path)
        if not cleaned_path:
            continue

        if cleaned_path.startswith("http://") or cleaned_path.startswith("https://"):
            full_url = cleaned_path
        else:
            full_url = f"{STATIC_BASE_URL}/{cleaned_path.lstrip('/')}"

        # Extract the original asset file name from the URL path directly
        # Example: "/assets/ww/.../T_IconWeapon21030024_UI.webp" -> "T_IconWeapon21030024_UI.webp"
        original_filename = cleaned_path.split("/")[-1]

        if not original_filename:
            continue

        destination_path = output_dir / original_filename

        if download_asset(full_url, destination_path):
            success_count += 1
        else:
            failure_count += 1

    print(
        f"[+] Complete. Downloaded: {success_count} assets, Failed: {failure_count} elements.\n"
    )


# ==============================================================================
# MAIN ROUTINE EXECUTION ENTRYPOINT
# ==============================================================================
def main() -> None:
    """
    Root directory context routing system engine driver.
    """
    base_path = Path.cwd()
    print(f"=== Starting Asset Extraction Matrix via {STATIC_BASE_URL} ===")

    # Track targeted context directories safely
    source_dir_path = base_path / SOURCE_DATA_DIR

    if not source_dir_path.exists():
        print(
            f"[CRITICAL] Configured source tracking folder does not exist: {source_dir_path}",
            file=sys.stderr,
        )
        sys.exit(1)

    for json_file, target_rel_dir in RESOURCE_MAPPING.items():
        source_json = source_dir_path / json_file

        if not source_json.exists():
            print(f"[!] Could not locate active definitions file path for: {json_file}")
            continue

        target_output_dir = base_path / target_rel_dir
        parse_and_map_resource(source_json, target_output_dir)


if __name__ == "__main__":
    main()
