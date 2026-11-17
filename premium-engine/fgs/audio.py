"""Narration preparation, sound bed, mix, and loudness normalisation with a measured check."""
import json, re
from pathlib import Path
from .common import EngineError, run

def measure(path):
    """Integrated loudness (LUFS), loudness range (LU) and true peak (dBTP, oversampled meter)."""
    e = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    tail = e[e.rfind("Integrated loudness:"):]
    g = lambda pat: float(re.search(pat, tail).group(1))
    return {"integrated_lufs": g(r"I:\s+(-?[\d.]+) LUFS"), "range_lu": g(r"LRA:\s+(-?[\d.]+) LU"), "true_peak_dbtp": g(r"Peak:\s+(-?[\d.]+) dBFS")}

def prepare_narration(voice, trim_start, total, out, sample_rate):
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{trim_start:.3f}", "-i", voice, "-af", f"apad=whole_dur={total:.3f}", "-t", f"{total:.3f}", "-ar", sample_rate, "-ac", "1", out])

def build_bed(bed, total, out, crossfade, sample_rate):
    """Repeats a short bed, cross-fading each repeat into the next, to cover `total` seconds."""
    d = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", bed]).stdout)
    if d <= 2 * crossfade: raise EngineError(f"sound bed is too short ({d:.1f}s) to loop")
    n = int(total // (d - crossfade)) + 2
    ins = sum((["-i", str(bed)] for _ in range(n)), [])
    if n == 1: fc = "[0:a]anull[x0];"; last = "x0"
    else:
        fc = f"[0:a][1:a]acrossfade=d={crossfade}:c1=tri:c2=tri[x1];" + "".join(f"[x{i}][{i+1}:a]acrossfade=d={crossfade}:c1=tri:c2=tri[x{i+1}];" for i in range(1, n - 1)); last = f"x{n-1}"
    fc += f"[{last}]atrim=0:{total:.3f},afade=t=in:d=0.4,afade=t=out:st={max(0,total-0.8):.3f}:d=0.8[b]"
    run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", fc, "-map", "[b]", "-ar", sample_rate, "-ac", "1", out])

def mix(narration, bed, under_lu, out, sample_rate):
    ln, lb = measure(narration)["integrated_lufs"], measure(bed)["integrated_lufs"]
    gain = round((ln - under_lu) - lb, 2)
    run(["ffmpeg", "-v", "error", "-y", "-i", narration, "-i", bed, "-filter_complex", f"[1:a]volume={gain}dB[b];[0:a][b]amix=inputs=2:normalize=0[m]", "-map", "[m]", "-ar", sample_rate, "-ac", "1", out])
    return {"narration_lufs": ln, "bed_lufs": lb, "bed_gain_db": gain}

def normalize(src, out, A):
    """Two-pass loudnorm, AAC encode, then measure the encoded file; if it misses the
    loudness window or the peak goal, encode again with a gain trim behind a limiter."""
    T, TP = A["target_lufs"], A["true_peak_goal_dbtp"] - 0.2
    e = run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-af", f"loudnorm=I={T}:TP={TP}:LRA=11:print_format=json", "-f", "null", "-"]).stderr
    j = json.loads(e[e.rindex("{"):e.rindex("}") + 1])
    chain = (f"loudnorm=I={T}:TP={TP}:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:"
             f"measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
    gain, limit_db, lim, log = 0.0, TP, "", []
    for attempt in range(1, 5):
        run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", f"{chain},volume={gain}dB{lim}", "-ar", A["sample_rate"], "-ac", "1", "-c:a", "aac", "-b:a", A["bitrate"], out])
        m = measure(out); log.append({"attempt": attempt, "gain_db": gain, "limiter": lim.lstrip(","), **m})
        miss = T - m["integrated_lufs"]; over = max(0.0, m["true_peak_dbtp"] - A["true_peak_goal_dbtp"])
        if abs(miss) <= A["tolerance_lu"] and over == 0: break
        if abs(miss) > A["tolerance_lu"]: gain = round(gain + miss, 2)
        limit_db = round(limit_db - over - 0.2, 2); lim = f",alimiter=limit={10 ** (limit_db / 20):.3f}:level=false"
    return {"final": m, "attempts": log}
