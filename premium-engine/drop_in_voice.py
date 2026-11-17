#!/usr/bin/env python3
"""Field Guide Studio - drop-in voice pipeline.

Give it a narration WAV and an episode file. It fits captions and scenes to the
recording, mixes and levels the sound, renders 16:9 and native 9:16, and runs
technical QA. Everything it writes goes into one new run folder.

The Studio calls this; see lib/premium/. Vendored from
fgs_premium_001_final_capability_20261116/engineering with three additions:
--runs-dir, --line-times, and required --episode/--export.

Exit codes: 0 all checks passed; 1 QA failed; 2 input or fit problem (nothing rendered).
Tested with two built-in Mac voices reading this episode. Other voices, accents,
noisy recordings and very different lengths are not proven.
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
HERE = Path(__file__).resolve().parent; ROOT = HERE
sys.path.insert(0, str(HERE))
from fgs import align, audio, qa
from fgs.common import EngineError, load_episode, load_export, run, validate_voice

VOICE_LABEL = {"synthetic": "SYNTHETIC VOICE", "human": "RECORDED VOICE"}
TAGS = {"land": "16x9", "vertical": "9x16"}

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--voice", required=True, help="narration WAV: the whole script, read in order")
    p.add_argument("--voice-kind", choices=["synthetic", "human"], default="synthetic", help="what the on-screen label says about the voice (default: synthetic)")
    p.add_argument("--voice-note", default="", help="who or what the voice is and what permission exists; recorded in the run")
    p.add_argument("--episode", required=True, help="episode file (JSON) written by the Studio")
    p.add_argument("--export", required=True, help="export settings file (JSON) written by the Studio")
    p.add_argument("--run-name", required=True, help="new folder name under the runs folder")
    p.add_argument("--runs-dir", default=str(ROOT / "runs"), help="folder that holds run folders (default: runs/ beside the engine)")
    p.add_argument("--line-times", help="JSON file: [[start,end],...] per script line, when the caller already knows where each line is in the recording")
    p.add_argument("--formats", default="land,vertical", help="land, vertical or both (default both)")
    p.add_argument("--no-bed", action="store_true", help="narration only, no sound bed")
    p.add_argument("--proof", type=float, metavar="SECONDS", help="render only the first SECONDS as a quick sample; QA is skipped")
    p.add_argument("--stop-after", choices=["align", "audio"], help="stop early (no rendering)")
    p.add_argument("--allow-length-problems", action="store_true", help="render even if a scene or the total length is outside the configured limits")
    a = p.parse_args(argv)
    try:
        return pipeline(a)
    except EngineError as e:
        print(f"STOPPED: {e}", file=sys.stderr); return 2

def pipeline(a):
    cfg, ep = load_export(a.export), load_episode(a.episode)
    modes = [m.strip() for m in a.formats.split(",") if m.strip()]
    if not modes or any(m not in TAGS for m in modes): raise EngineError("--formats must be land, vertical or land,vertical")
    info = validate_voice(a.voice)
    run_dir = Path(a.runs_dir).resolve() / a.run_name
    if run_dir.exists() and any(run_dir.iterdir()): raise EngineError(f"run folder already exists: {run_dir} (choose another --run-name; nothing is overwritten)")
    for d in ("audio", "video", "checks"): (run_dir / d).mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    # 1. fit the script to the recording
    line_times = json.loads(Path(a.line_times).read_text()) if a.line_times else None
    fit = align.align(a.voice, ep, cfg, line_times=line_times)
    (run_dir / "timing.json").write_text(json.dumps({"beats": fit["beats"], "total_sec": fit["total_sec"], "audio_trim_start": fit["audio_trim_start"]}, indent=1))
    (run_dir / "captions.srt").write_text(align.srt(fit["cues"]))
    (run_dir / "captions.timing.json").write_text(json.dumps(fit["cues"], indent=1))
    (run_dir / "alignment-report.json").write_text(json.dumps({"voice": {"path": str(Path(a.voice).resolve()), **info}, **fit["report"]}, indent=1))
    r = fit["report"]
    print(f"fit: {r['cues_on_measured_pauses']} of {r['cues']} captions on measured pauses, {r['cues_estimated']} estimated; total {fit['total_sec']:.1f}s")
    for w in r["warnings"]: print("  warning:", w)
    if r["length_errors"]:
        for e in r["length_errors"]: print("  length problem:", e)
        if not a.allow_length_problems: raise EngineError("the recording does not fit the picture (see length problems above). Nothing was rendered. Re-record, edit the episode, or pass --allow-length-problems.")
    if a.stop_after == "align": print("stopped after align:", run_dir); return 0
    # 2. sound
    A = cfg["audio"]; narr = run_dir / "audio/narration.wav"
    audio.prepare_narration(a.voice, fit["audio_trim_start"], fit["total_sec"], narr, A["sample_rate"])
    src, mixinfo = narr, None
    if ep["_sound_bed"] and not a.no_bed:
        audio.build_bed(ep["_sound_bed"], fit["total_sec"], run_dir / "audio/bed.wav", A["bed_crossfade_sec"], A["sample_rate"])
        mixinfo = audio.mix(narr, run_dir / "audio/bed.wav", A["bed_under_voice_lu"], run_dir / "audio/mix-prenormalize.wav", A["sample_rate"]); src = run_dir / "audio/mix-prenormalize.wav"
    norm = audio.normalize(src, run_dir / "audio/mix.m4a", A)
    (run_dir / "audio/levels.json").write_text(json.dumps({"mix": mixinfo, **norm}, indent=1))
    print(f"sound: {norm['final']['integrated_lufs']} LUFS, true peak {norm['final']['true_peak_dbtp']} dBTP ({len(norm['attempts'])} encode(s))")
    if a.stop_after == "audio": print("stopped after audio:", run_dir); return 0
    # 3. picture: the renderer reads only the run folder
    labels = {k: v.replace("{voice_label}", VOICE_LABEL[a.voice_kind]) for k, v in ep["labels"].items()}
    job = {"export": {k: v for k, v in cfg.items() if not k.startswith("_")}, "episode": {k: v for k, v in ep.items() if not k.startswith("_")},
           "assets_dir": ep["_assets_dir"], "labels": labels, "voice": {"kind": a.voice_kind, "note": a.voice_note, "source": str(Path(a.voice).resolve())}}
    (run_dir / "job.json").write_text(json.dumps(job, indent=1))
    py = cfg["tools"]["python_with_pillow"]
    if not Path(py).exists(): raise EngineError(f"python with Pillow not found: {py} (set tools.python_with_pillow in the export config)")
    procs = []
    for m in modes:
        cmd = [py, str(HERE / "fgs/render.py"), "--run", str(run_dir), "--mode", m] + (["--seconds", str(a.proof)] if a.proof else [])
        log = open(run_dir / f"checks/render-{TAGS[m]}.log", "w")
        procs.append((m, subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"}), log))
    for m, pr, log in procs:
        rc = pr.wait(); log.close()
        if rc: raise EngineError(f"render failed for {m}: see {run_dir}/checks/render-{TAGS[m]}.log")
    masters = {}
    for m in modes:
        out = run_dir / "video" / f"{ep['id']}-{a.run_name}-{TAGS[m]}{'-PROOF' if a.proof else ''}.mp4"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", run_dir / f"video/_picture-{TAGS[m]}.mp4", "-i", run_dir / "audio/mix.m4a", "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", "-movflags", "+faststart", out])
        (run_dir / f"video/_picture-{TAGS[m]}.mp4").unlink()
        masters[m] = out; print("rendered:", out)
    if a.proof: print(f"proof only ({a.proof}s); QA skipped. {time.time()-t0:.0f}s"); return 0
    # 4. QA
    res = qa.verify(run_dir, cfg, masters, fit["cues"], fit["beats"], fit["total_sec"])
    for c in res["checks"]:
        if c["status"] != "PASS": print(f"  {c['status']}: {c['check']} - {c['detail']}")
    n = sum(c["status"] == "PASS" for c in res["checks"])
    print(f"QA {res['overall']}: {n} of {len(res['checks'])} checks passed; details in {run_dir}/checks/acceptance.json. {time.time()-t0:.0f}s")
    return 0 if res["overall"] == "PASS" else 1

if __name__ == "__main__": sys.exit(main())
