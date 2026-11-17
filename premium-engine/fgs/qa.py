"""Technical QA of a finished run. Reads files only. Every check is PASS, FAIL, WARN or UNRUN."""
import hashlib, json, math, re, struct, subprocess
from pathlib import Path
from .common import run

TAGS = {"land": "16x9", "vertical": "9x16"}

def _envelope(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-af", "highpass=f=300,lowpass=f=5000", "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], capture_output=True).stdout
    d = struct.unpack("<%dh" % (len(raw) // 2), raw)
    return [20 * math.log10(max(math.sqrt(sum(x * x for x in d[i:i + 320]) / 320), 1) / 32768) for i in range(0, len(d) - 320, 160)]

def verify(run_dir, cfg, masters, cues, beats, expect_sec):
    run_dir = Path(run_dir); A, C = cfg["audio"], cfg["captions"]; checks = []; files = {}
    def add(name, status, detail): checks.append({"check": name, "status": status, "detail": detail})
    for mode, f in masters.items():
        tag = TAGS[mode]; W, H = cfg["sizes"][mode]; f = Path(f)
        info = {"path": str(f), "bytes": f.stat().st_size, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
        p = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels,nb_frames:format=duration", "-of", "json", f]).stdout)
        v = next(s for s in p["streams"] if s["codec_type"] == "video"); a = next((s for s in p["streams"] if s["codec_type"] == "audio"), None)
        dur = float(p["format"]["duration"]); info.update({"duration": dur, "video": v, "audio": a})
        ok = (v["width"], v["height"]) == (W, H) and v["r_frame_rate"] == f"{cfg['fps']}/1" and v["codec_name"] == "h264" and a and a["codec_name"] == "aac"
        add(f"{tag} format", "PASS" if ok else "FAIL", f"{v['width']}x{v['height']} {v['r_frame_rate']} fps {v['codec_name']}/{a['codec_name'] if a else 'no audio'} {a['sample_rate'] if a else ''} Hz")
        add(f"{tag} duration", "PASS" if abs(dur - expect_sec) <= 0.2 else "FAIL", f"{dur:.2f}s (timeline {expect_sec:.2f}s)")
        d = run(["ffmpeg", "-v", "error", "-nostats", "-i", f, "-f", "null", "-"], check=False)
        errs = len([l for l in d.stderr.splitlines() if l.strip()])
        add(f"{tag} full decode", "PASS" if d.returncode == 0 and errs == 0 else "FAIL", f"exit {d.returncode}, {errs} error lines")
        e = run(["ffmpeg", "-hide_banner", "-nostats", "-i", f, "-af", "ebur128=peak=true", "-vf", "blackdetect=d=0.5:pix_th=0.10", "-f", "null", "-"]).stderr
        tail = e[e.rfind("Integrated loudness:"):]
        I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1)); TP = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail).group(1))
        info["loudness"] = {"integrated_lufs": I, "true_peak_dbtp": TP}
        add(f"{tag} loudness", "PASS" if abs(I - A["target_lufs"]) <= 0.5 else "FAIL", f"{I} LUFS (target {A['target_lufs']} ±0.5)")
        add(f"{tag} true peak", "PASS" if TP <= A["true_peak_ceiling_dbtp"] else "FAIL", f"{TP} dBTP (ceiling {A['true_peak_ceiling_dbtp']})")
        add(f"{tag} black frames", "PASS" if e.count("black_start") == 0 else "FAIL", f"{e.count('black_start')} stretches of 0.5s or more")
        st = run(["ffmpeg", "-hide_banner", "-nostats", "-i", f, "-af", "astats=metadata=0:measure_perchannel=none,silencedetect=noise=-45dB:d=1.5", "-f", "null", "-"]).stderr
        flat = float(re.search(r"Flat factor:\s+(-?[\d.inf]+)", st).group(1))
        add(f"{tag} clipping", "PASS" if flat == 0 else "FAIL", f"flat factor {flat}")
        add(f"{tag} silence", "PASS" if st.count("silence_start") == 0 else "WARN", f"{st.count('silence_start')} silences of 1.5s or more")
        # burned-in captions: when do pixels in the caption box flip?
        c = C[mode]; bx, by, bw, bh = int(W * c["left"]), int(H * c["top"]), int(W * (c["right"] - c["left"])), int(H * 0.085)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vf", f"crop={bw}:{bh}:{bx}:{by},scale=320:24,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        S = 320 * 24; n = len(raw) // S
        flips = [0] + [sum(1 for p_, q_ in zip(raw[i*S:(i+1)*S], raw[(i-1)*S:i*S]) if abs(p_ - q_) > 60) for i in range(1, n)]
        scene = {round(b["startSec"], 2) for b in beats}; inner, weak = [], 0
        for cu in cues:
            k = round(cu["start"] * cfg["fps"]); j = max(range(max(1, k - 9), min(n, k + 10)), key=lambda i: flips[i])
            if any(abs(cu["start"] - s) < 0.4 for s in scene): continue      # cannot be told apart from the scene change
            if flips[j] < 40: weak += 1
            inner.append(abs(j / cfg["fps"] - cu["start"]) * 1000)
        worst = max(inner) if inner else 0
        add(f"{tag} burned captions follow the caption file", "PASS" if worst <= 70 and weak == 0 else "FAIL", f"{len(inner)} captions checked, worst {worst:.0f} ms, {weak} not seen; {len(cues)-len(inner)} at scene changes not separable")
        info["frames"] = n; files[tag] = info
        # frames for a person to look at: an even spread, and the middle of every in-scene transition
        chk = run_dir / "checks"; chk.mkdir(exist_ok=True)
        tile = "scale=640:-1,tile=4x3" if mode == "land" else "scale=270:-1,tile=6x2"
        run(["ffmpeg", "-v", "error", "-y", "-i", f, "-vf", f"fps=12/{dur:.2f},{tile}", "-frames:v", "1", "-q:v", "3", chk / f"contact-{tag}.jpg"], check=False)
        ts = [b["startSec"] + b["durationSec"] * (cfg["timing"]["transition_start"] + cfg["timing"]["transition_len"] / 2) for b in beats]
        sel = "+".join(f"eq(n\\,{round(t * cfg['fps'])})" for t in ts); cols = len(ts)
        scale = "scale=480:-1" if mode == "land" else "scale=240:-1"
        run(["ffmpeg", "-v", "error", "-y", "-i", f, "-vf", f"select='{sel}',{scale},tile={cols}x1", "-frames:v", "1", "-fps_mode", "passthrough", "-q:v", "3", chk / f"transitions-{tag}.jpg"], check=False)
    # captions file
    prev, ok = 0.0, True
    for cu in cues: ok &= cu["end"] > cu["start"] and cu["start"] >= prev - 1e-6; prev = cu["end"]
    add("caption file valid", "PASS" if ok and prev <= expect_sec + 0.05 else "FAIL", f"{len(cues)} captions, last ends {prev:.2f}s")
    vs = C["vertical_safe"]; cv = C["vertical"]; W, H = cfg["sizes"]["vertical"]
    bottom = cv["top"] + (2 * round(H * cv["font_scale"]) * 1.34 + round(H * .019)) / H
    add("9:16 caption box inside the safe area", "PASS" if bottom <= vs["max_bottom"] and cv["right"] <= vs["max_right"] else "FAIL",
        f"box bottom at {bottom:.3f} of height (limit {vs['max_bottom']}), right edge at {cv['right']} of width (limit {vs['max_right']})")
    # caption starts against speech onsets measured in the final audio
    first = next(iter(masters.values())); env = _envelope(first)
    thr = sorted(env)[int(len(env) * 0.95)] - 20; off = []
    for cu in cues:
        k = int(cu["start"] / 0.01); best = None
        for j in range(max(1, k - 15), min(len(env) - 1, k + 15)):
            if env[j - 1] < thr <= env[j] and all(x < thr for x in env[max(0, j - 9):j]):
                if best is None or abs(j - k) < abs(best - k): best = j
        off.append(None if best is None else abs(cu["start"] - best * 0.01) * 1000)
    m = [o for o in off if o is not None]; lim = cfg["alignment"]["sync_fail_ms"]
    add("caption starts vs measured speech onset", "PASS" if m and max(m) <= lim else ("UNRUN" if not m else "FAIL"),
        f"{len(m)} of {len(cues)} measurable; median {sorted(m)[len(m)//2] if m else 0:.0f} ms, worst {max(m) if m else 0:.0f} ms; {len(cues)-len(m)} not measurable (no clear pause)")
    estimated = [cu["text"] for cu in cues if not cu["basis"].startswith(("MEASURED", "KNOWN"))]
    add("captions placed on measured pauses", "PASS" if not estimated else "WARN", f"{len(cues)-len(estimated)} of {len(cues)}" + (f"; estimated: {estimated}" if estimated else ""))
    add("human listening and viewing", "UNRUN", "PENDING MIKE - probes do not replace a person")
    result = {"overall": "FAIL" if any(c["status"] == "FAIL" for c in checks) else "PASS", "checks": checks, "files": files}
    (run_dir / "checks" / "acceptance.json").write_text(json.dumps(result, indent=1))
    return result
