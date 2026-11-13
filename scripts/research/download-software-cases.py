"""Re-download the pinned corpus sources into a NEW directory; never run them.

Normal CI uses checked-in files and does not invoke this opt-in command:
  python3 scripts/research/download-software-cases.py --output-dir /tmp/waveworld-cases
Generated numerical reference snapshots remain in public/datasets; this command
does not regenerate references, install programs or resolve input-file includes.
"""
import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

MAX_FILE_BYTES = 64 * 1024
MAX_TOTAL_BYTES = 512 * 1024
CORPUS = Path(__file__).resolve().parent / "software-cases"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((CORPUS / "manifest.json").read_text())
    if manifest["schemaVersion"] != 1:
        raise ValueError("Unsupported corpus manifest")
    sources = [(p["license"]["file"], p) for p in manifest["projects"].values()]
    sources += [(f, manifest["projects"][c["project"]])
                for c in manifest["cases"] for f in c["files"]]
    if sum(f["bytes"] for f, _ in sources) > MAX_TOTAL_BYTES:
        raise ValueError("Corpus exceeds total byte limit")
    seen = set()
    for item, project in sources:
        local = PurePosixPath(item["path"])
        if local.is_absolute() or ".." in local.parts or item["path"] in seen:
            raise ValueError("Unsafe or duplicate corpus path")
        seen.add(item["path"])
        prefix = "https://github.com/"
        if not project["repository"].startswith(prefix):
            raise ValueError("Expected a reviewed GitHub repository")
        expected = ("https://raw.githubusercontent.com/" + project["repository"][len(prefix):]
                    + "/" + project["commit"] + "/" + item["sourcePath"])
        if item["url"] != expected or len(project["commit"]) != 40:
            raise ValueError("Source must match the pinned repository commit")
        if not 0 < item["bytes"] <= MAX_FILE_BYTES:
            raise ValueError("Source exceeds file byte limit")

    # A new directory prevents accidental replacement of reviewed fixtures.
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    total = 0
    for item, _ in sources:
        for attempt in range(3):  # Initial request plus at most two retries.
            try:
                request = urllib.request.Request(item["url"], headers={"User-Agent": "WaveWorld-fixture-audit"})
                with urllib.request.urlopen(request, timeout=20) as response:
                    data = response.read(MAX_FILE_BYTES + 1)
                break
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise
            time.sleep(0.25 * (attempt + 1))
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Source size or SHA-256 mismatch: " + item["path"])
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise ValueError("Corpus exceeds total byte limit")
        target = output / item["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (output / "manifest.json").write_bytes((CORPUS / "manifest.json").read_bytes())
    print(f"Verified {len(sources)} upstream files / {total} bytes; no programs executed")


if __name__ == "__main__":
    main()
