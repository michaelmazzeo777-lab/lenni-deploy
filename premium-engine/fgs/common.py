"""Shared pieces: errors, tool calls, and loading/validating the two config files."""
import json, os, subprocess
from pathlib import Path

GRAPHIC_KEYS = {"lens": [], "date_dial": ["big", "small"], "pair": ["left", "right"], "route": ["label"],
                "network": ["label"], "ticks": ["big", "label"], "progress": ["top", "bottom"], "versus": ["left", "right"]}

class EngineError(Exception):
    """A problem the operator must fix. The message says what and where."""

def run(cmd, check=True):
    p = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if check and p.returncode:
        raise EngineError(f"{cmd[0]} failed (exit {p.returncode}): {p.stderr.strip()[-600:]}")
    return p

def load_export(path):
    path = Path(path).resolve()
    if not path.exists(): raise EngineError(f"export config not found: {path}")
    cfg = json.loads(path.read_text()); cfg["_dir"] = str(path.parent)
    for k in ("python_with_pillow", "whisper_cli"):
        cfg["tools"][k] = os.path.expanduser(cfg["tools"][k])
    m = Path(os.path.expanduser(cfg["tools"]["whisper_model"]))
    # relative paths are relative to the engine's root folder (the parent of config/)
    cfg["tools"]["whisper_model"] = str(m if m.is_absolute() else (path.parent / m).resolve())
    return cfg

def load_episode(path):
    path = Path(path).resolve()
    if not path.exists(): raise EngineError(f"episode file not found: {path}")
    try: ep = json.loads(path.read_text())
    except json.JSONDecodeError as e: raise EngineError(f"episode file is not valid JSON: {e}")
    base = path.parent
    problems = []
    if not ep.get("beats"): problems.append("no beats")
    assets = (base / ep.get("assets_dir", ".")).resolve(); ep["_assets_dir"] = str(assets)
    if not assets.is_dir(): problems.append(f"assets_dir does not exist: {assets}")
    ep["_sound_bed"] = str((base / ep["sound_bed"]).resolve()) if ep.get("sound_bed") else None
    if ep["_sound_bed"] and not Path(ep["_sound_bed"]).exists(): problems.append(f"sound_bed does not exist: {ep['_sound_bed']}")
    for k in ("brand", "top_right", "footer"):
        if k not in ep.get("labels", {}): problems.append(f"labels.{k} missing")
    for n, b in enumerate(ep.get("beats", []), 1):
        tag = b.get("id", f"beat {n}")
        ph = b.get("phrases")
        if not ph or not all(isinstance(x, str) and x.strip() for x in ph): problems.append(f"{tag}: phrases must be a non-empty list of text"); continue
        pic = b.get("picture", {})
        if len(pic.get("title", [])) != 2: problems.append(f"{tag}: picture.title needs exactly two lines")
        for k in ("eyebrow", "detail"):
            if not isinstance(pic.get(k), str): problems.append(f"{tag}: picture.{k} missing")
        if len(pic.get("accent", [])) != 3: problems.append(f"{tag}: picture.accent needs three numbers")
        art = pic.get("art", [])
        if len(art) != 2: problems.append(f"{tag}: picture.art needs two image files")
        for a in art:
            if not (assets / a).exists(): problems.append(f"{tag}: art file not found: {a}")
        g = pic.get("graphic", {})
        if g.get("type") not in GRAPHIC_KEYS: problems.append(f"{tag}: graphic.type must be one of {sorted(GRAPHIC_KEYS)}")
        else:
            for k in GRAPHIC_KEYS[g["type"]]:
                if not isinstance(g.get(k), str): problems.append(f"{tag}: graphic.{k} missing for type {g['type']}")
    if problems: raise EngineError("episode file has problems:\n  - " + "\n  - ".join(problems))
    return ep

def probe_audio(path):
    p = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,sample_rate,channels:format=format_name,duration", "-of", "json", path], check=False)
    if p.returncode: return None
    d = json.loads(p.stdout or "{}"); a = [s for s in d.get("streams", []) if s.get("codec_type") == "audio"]
    if not a: return None
    return {"format": d["format"].get("format_name"), "duration": float(d["format"].get("duration", 0)), "codec": a[0]["codec_name"],
            "sample_rate": int(a[0]["sample_rate"]), "channels": int(a[0]["channels"])}

def validate_voice(path):
    """The narration must be a readable WAV with real sound in it."""
    path = Path(path)
    if not path.exists(): raise EngineError(f"voice file not found: {path}")
    info = probe_audio(path)
    if info is None: raise EngineError(f"voice file is not readable audio: {path}")
    if "wav" not in (info["format"] or ""): raise EngineError(f"voice file must be a WAV (got {info['format']}): {path}")
    if info["duration"] < 5: raise EngineError(f"voice file is only {info['duration']:.1f}s long")
    if info["sample_rate"] < 16000: raise EngineError(f"voice file sample rate is {info['sample_rate']} Hz; at least 16000 is needed")
    vol = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "volumedetect", "-f", "null", "-"], check=False).stderr
    mean = float(vol.split("mean_volume:")[1].split("dB")[0]) if "mean_volume:" in vol else -91.0
    if mean < -60: raise EngineError(f"voice file is silent (mean level {mean:.0f} dB)")
    info["mean_volume_db"] = mean
    return info
