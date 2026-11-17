"""Fits a narration recording to the script: where each line and each caption starts.

Every start is placed on a pause measured in the recording where one exists near
the expected position. A speech transcriber is used only to know roughly where in
the recording each phrase is; its absolute times are not trusted.
"""
import difflib, json, math, re, struct, subprocess, tempfile
from pathlib import Path
from .common import EngineError, run

HOP = 0.01

def envelope(wav):
    """Loudness of the recording in dB, one value per 10 ms."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], capture_output=True).stdout
    d = struct.unpack("<%dh" % (len(raw) // 2), raw)
    return [20 * math.log10(max(math.sqrt(sum(x * x for x in d[i:i + 320]) / 320), 1) / 32768) for i in range(0, len(d) - 320, 160)]

def find_pauses(env, thr, min_len):
    runs, st = [], None
    for k, e in enumerate(list(env) + [0.0]):
        if e < thr and st is None: st = k
        elif e >= thr and st is not None:
            if (k - st) * HOP >= min_len - 1e-9: runs.append((round(st * HOP, 2), round(k * HOP, 2)))
            st = None
    return runs

def merge_bursts(pauses, max_burst=0.12):
    """A final stop consonant leaves a short burst between two gaps; join them."""
    out = []
    for p in pauses:
        if out and p[0] - out[-1][1] < max_burst: out[-1] = (out[-1][0], p[1])
        else: out.append(p)
    return out

def tokens(text):
    return re.findall(r"[a-z0-9]+", text.lower().replace("'", ""))

def transcribe(wav, cfg):
    """[(seconds, word)] from whisper.cpp, or None if the tool or model is missing."""
    cli, model = cfg["tools"]["whisper_cli"], cfg["tools"]["whisper_model"]
    if not Path(cli).exists() or not Path(model).exists(): return None
    with tempfile.TemporaryDirectory() as td:
        w16 = Path(td) / "a.wav"
        run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ar", "16000", "-ac", "1", w16])
        run([cli, "-m", model, "-f", w16, "-l", "en", "-np", "-ojf", "-of", Path(td) / "t"])
        d = json.loads((Path(td) / "t.json").read_text())
    words = []
    for s in d["transcription"]:
        for t in s["tokens"]:
            tx = t["text"]
            if tx.startswith("[_"): continue
            if tx.startswith(" ") or not words: words.append([t["offsets"]["from"] / 1000, tx.strip()])
            else: words[-1][1] += tx
    return [(t, w) for t, w in words if w]

def _heard_tokens(words, episode):
    """Transcript as (time, token); known mis-hearings are folded back to the script word."""
    out = []
    for t, w in words:
        for tok in tokens(w): out.append([t, tok])
    for word, spec in (episode.get("pronunciation") or {}).items():
        if not isinstance(spec, dict): continue
        for variant in spec.get("heard_as", []):
            v = tokens(variant); n = len(v); i = 0
            while n and i <= len(out) - n:
                if [x[1] for x in out[i:i + n]] == v: out[i:i + n] = [[out[i][0], tokens(word)[0]]]
                i += 1
    return out

def align(wav, episode, cfg, words="auto", line_times=None):
    A, T, C = cfg["alignment"], cfg["timing"], cfg["captions"]
    env = envelope(wav)
    if len(env) < 300: raise EngineError("the recording is too short to align")
    ref = sorted(env)[int(len(env) * 0.95)]; thr = ref - A["silence_below_speech_db"]
    raw = find_pauses(env, thr, A["min_pause_sec"]); merged = merge_bursts(raw)
    voiced = [k for k, e in enumerate(env) if e >= thr]
    speech_start, speech_end = voiced[0] * HOP, (voiced[-1] + 1) * HOP
    if words == "auto": words = transcribe(wav, cfg)
    warnings = []
    beats = episode["beats"]
    # script as a flat token list; where each phrase begins; running character count
    stoks, starts_at, cum = [], [], []
    for bi, b in enumerate(beats):
        for pi, ph in enumerate(b["phrases"]):
            starts_at.append((bi, pi, len(stoks)))
            for tok in tokens(ph): cum.append((cum[-1] if cum else 0) + len(tok)); stoks.append(tok)
    total_chars = cum[-1]
    if words:
        heard = _heard_tokens(words, episode)
        sm = difflib.SequenceMatcher(None, stoks, [h[1] for h in heard], autojunk=False)
        pts = []
        for blk in sm.get_matching_blocks():
            for j in range(blk.size): pts.append((cum[blk.a + j] - len(stoks[blk.a + j]), heard[blk.b + j][0]))
        match = len(pts) / len(stoks)
        if match < A["min_script_match"]:
            raise EngineError(f"the recording does not match the script: only {match:.0%} of the script's words were heard in order "
                              f"(need {A['min_script_match']:.0%}). Check that the whole script was read, in order.")
        mono = []
        for c, t in sorted(pts):
            if not mono or t >= mono[-1][1]: mono.append((c, t))
        pts = mono
    else:
        match = None
        warnings.append("no transcriber available: phrase positions were estimated from text length only")
        pts = [(0, speech_start), (total_chars, speech_end)]
    def expected(tok_index):
        c = cum[tok_index] - len(stoks[tok_index])
        lo = max((p for p in pts if p[0] <= c), default=None, key=lambda p: p[0])
        hi = min((p for p in pts if p[0] >= c), default=None, key=lambda p: p[0])
        rate = (speech_end - speech_start) / total_chars
        if lo and hi: return lo[1] if hi[0] == lo[0] else lo[1] + (hi[1] - lo[1]) * (c - lo[0]) / (hi[0] - lo[0])
        if lo: return lo[1] + (c - lo[0]) * rate
        return hi[1] - (hi[0] - c) * rate
    first_tok = {(bi, pi): k for bi, pi, k in starts_at}
    # 1. where each line starts and ends: the long pause nearest the expected position
    on, off, on_basis = [speech_start], [], ["MEASURED start of speech"]
    if line_times is not None:
        # The caller made the recording line by line and knows where each line sits.
        if len(line_times) != len(beats): raise EngineError(f"line times were given for {len(line_times)} lines but the script has {len(beats)}")
        on = [float(a) for a, _ in line_times]; off = [float(b) for _, b in line_times]
        on_basis = ["KNOWN line start from the Studio narration"] * len(beats)
        for a_, b_ in zip(on, off):
            if not 0 <= a_ < b_ <= len(env) * HOP + 0.5: raise EngineError("line times do not fit inside the recording")
    for bi in (range(1, len(beats)) if line_times is None else []):
        e = expected(first_tok[(bi, 0)])
        cands = [p for p in merged if abs(p[1] - e) <= 1.5 and p[1] > on[-1] + 1.0 and p[1] - p[0] >= 0.2]
        if cands:
            p = max(cands, key=lambda p: (p[1] - p[0]) - 0.3 * abs(p[1] - e))
            on.append(p[1]); off.append(p[0]); on_basis.append(f"MEASURED pause {p[1]-p[0]:.2f}s before the line")
        else:
            on.append(max(e, on[-1] + 1.0)); off.append(on[-1] - 0.05); on_basis.append("ESTIMATED: no pause of 0.2s near the line start")
            warnings.append(f"{beats[bi]['id']}: no clear pause before this line; its start is an estimate")
    if line_times is None: off.append(speech_end)
    # 2. captions inside each line
    cues = []
    for bi, b in enumerate(beats):
        ph = b["phrases"]; n = len(ph)
        e0 = expected(first_tok[(bi, 0)])
        ex = [on[bi] + (expected(first_tok[(bi, i)]) - e0) for i in range(n)]
        # The transcriber sometimes bunches a whole stretch of words into a fraction of a
        # second. Where its position disagrees badly with the position implied by text
        # length, the text-length position is used instead.
        size = [sum(len(t) for t in tokens(x)) for x in ph]; span = off[bi] - on[bi]
        by_text = [on[bi] + span * sum(size[:i]) / sum(size) for i in range(n)]
        distrusted = [abs(ex[i] - by_text[i]) > max(0.8, 0.25 * span) for i in range(n)]
        ex = [by_text[i] if distrusted[i] else ex[i] for i in range(n)]
        st = [on[bi]] + [None] * (n - 1); basis = [on_basis[bi]] + [None] * (n - 1)
        for i in range(1, n):                       # after punctuation a pause is expected
            if ph[i - 1].rstrip('"” ')[-1] in ",.:;!?":
                cands = [p for p in merged if abs(p[1] - ex[i]) <= 0.6 and on[bi] + 0.4 < p[1] < off[bi] - 0.3 and p[1] - p[0] >= 0.12]
                if cands:
                    p = max(cands, key=lambda p: (p[1] - p[0]) - 0.3 * abs(p[1] - ex[i]))
                    st[i] = p[1]; basis[i] = f"MEASURED pause {p[1]-p[0]:.2f}s"
        for i in range(1, n):                       # elsewhere: between the nearest measured points
            if st[i] is not None: continue
            ia = max(k for k in range(i) if st[k] is not None)
            later = [k for k in range(i + 1, n) if st[k] is not None]
            ib, tb, eb = (later[0], st[later[0]], ex[later[0]]) if later else (n, off[bi], ex[0] + (off[bi] - on[bi]))
            est = st[ia] + (ex[i] - ex[ia]) * (tb - st[ia]) / (eb - ex[ia]) if eb > ex[ia] else st[ia] + (tb - st[ia]) * (i - ia) / (ib - ia)
            text_est = st[ia] + (tb - st[ia]) * sum(size[ia:i]) / sum(size[ia:ib])
            if abs(est - text_est) > max(0.5, 0.2 * (tb - st[ia])): est = text_est
            near = [p for p in raw if abs(p[1] - est) <= (0.25 if p[1] - p[0] >= 0.12 else 0.15) and st[ia] + 0.3 < p[1] < tb - 0.3]
            if near:
                p = min(near, key=lambda p: abs(p[1] - est))
                st[i] = p[1]; basis[i] = f"MEASURED word gap {p[1]-p[0]:.2f}s"
            else:
                st[i] = min(max(est, st[ia] + 0.3), tb - 0.3); basis[i] = "ESTIMATED: no pause near this caption break"
        for i in range(1, n):
            if st[i] <= st[i - 1] + 0.25:
                raise EngineError(f"{b['id']}: could not place caption {i+1} after caption {i}; the recording may not follow the script here")
        for i in range(n):
            nxt = on[bi + 1] - 0.05 if bi + 1 < len(beats) else off[bi] + 0.30
            end = st[i + 1] if i + 1 < n else min(off[bi] + 0.30, nxt)
            cues.append({"beat": b["id"], "start": st[i], "end": end, "text": ph[i], "basis": basis[i]})
    # 3. scene timing: scenes follow the recording; nothing is stretched
    head = max(0.0, on[0] - T["lead_sec"])
    total = off[-1] + T["tail_sec"] - head
    out_beats, t0 = [], 0.0
    for bi, b in enumerate(beats):
        nxt = (on[bi + 1] - min(T["lead_sec"], (on[bi + 1] - off[bi]) / 2) - head) if bi + 1 < len(beats) else total
        out_beats.append({"id": b["id"], "startSec": round(t0, 3), "durationSec": round(nxt - t0, 3),
                          "narrationStartSec": round(on[bi] - head, 3), "narrationEndSec": round(off[bi] - head, 3)})
        t0 = nxt
    for c in cues: c["start"] = round(c["start"] - head, 3); c["end"] = round(c["end"] - head, 3)
    # 4. does the picture still work at these lengths?
    errors = []
    for b in out_beats:
        if b["durationSec"] < T["min_beat_sec"]: errors.append(f"{b['id']} lasts {b['durationSec']:.1f}s; scenes need at least {T['min_beat_sec']}s for the title and the in-scene transition")
        if b["durationSec"] > T["max_beat_sec"]: errors.append(f"{b['id']} lasts {b['durationSec']:.1f}s; the scene's camera move is designed for at most {T['max_beat_sec']}s")
    if not T["min_total_sec"] <= total <= T["max_total_sec"]: errors.append(f"total length {total:.1f}s is outside {T['min_total_sec']}-{T['max_total_sec']}s")
    for c in cues:
        d = c["end"] - c["start"]
        if d < C["min_cue_sec"]: warnings.append(f"caption \"{c['text'][:30]}\" is on screen for only {d:.2f}s")
        elif len(c["text"]) / d > C["max_chars_per_sec"]: warnings.append(f"caption \"{c['text'][:30]}\" reads fast ({len(c['text'])/d:.0f} characters per second)")
    measured = sum(c["basis"].startswith(("MEASURED", "KNOWN")) for c in cues)
    return {"beats": out_beats, "cues": cues, "total_sec": round(total, 3), "audio_trim_start": round(head, 3),
            "report": {"script_words_matched": None if match is None else round(match, 3), "cues": len(cues), "cues_on_measured_pauses": measured,
                       "cues_estimated": len(cues) - measured, "length_errors": errors, "warnings": warnings,
                       "silence_threshold_db": round(thr, 1), "pauses_found": len(raw)}}

def srt(cues):
    def ts(x):
        ms = round(x * 1000); return f"{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}"
    return "".join(f"{n}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n\n" for n, c in enumerate(cues, 1))
