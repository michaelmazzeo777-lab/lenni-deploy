import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  PS5_AUTOMATION,
  PhysicalPS5HardwareBridge,
  SANDBOX_ENABLED_ENV,
  SandboxSafetyController,
  runSeededSandboxEpisode,
  runSandboxEvaluationSuite,
  type SandboxModelAdapter,
} from "@/lib/sandbox";

// Experimental R&D sandbox: safety controls, isolation, and honest labelling.
// These are deterministic: every clock value is injected.

const greedy: SandboxModelAdapter = {
  modelName: "hand-written-rule-for-tests",
  isExternalPaidApi: false,
  selectAction: (obs) => ({
    action:
      (["MOVE_EAST", "MOVE_NORTH", "MOVE_WEST", "MOVE_SOUTH"] as const).find(
        (a) => !obs.blockedDirections.includes(a),
      ) ?? "HOLD_COVER",
    rationale: "first open direction",
  }),
};

describe("sandbox isolation and activation", () => {
  it("is disabled unless explicitly enabled", () => {
    delete process.env[SANDBOX_ENABLED_ENV];
    expect(() => runSeededSandboxEpisode({ seed: 1, policyMode: "LOOKAHEAD_PLANNER" })).toThrow(
      /sandbox is disabled/,
    );
    process.env[SANDBOX_ENABLED_ENV] = "1"; // only the exact value "true" enables it
    expect(() => runSandboxEvaluationSuite()).toThrow(/sandbox is disabled/);
    delete process.env[SANDBOX_ENABLED_ENV];
  });

  it("is not imported by the Studio, and imports nothing from it but the error helper", () => {
    let users = "";
    try {
      users = execFileSync(
        "grep",
        ["-rlE", "lib/sandbox|@/lib/sandbox", "app", "domain", "lib", "scripts", "prisma"],
        { encoding: "utf8" },
      );
    } catch {
      users = ""; // grep exits 1 when nothing matches
    }
    expect(users.split("\n").filter((f) => f && !f.startsWith("lib/sandbox/"))).toEqual([]);
    const imports = execFileSync("grep", ["-hE", "^import .* from ", "lib/sandbox/index.ts"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(imports).toEqual(['import { precondition } from "@/lib/errors";']);
    // No network, process, filesystem or credential access in the module.
    const src = execFileSync("cat", ["lib/sandbox/index.ts"], { encoding: "utf8" });
    expect(src).not.toMatch(
      /fetch\(|node:net|node:http|child_process|node:fs|NPSSO=|process\.env\.(?!\[SANDBOX)/,
    );
  });

  it("keeps physical console control disabled, including for arbitrary input", () => {
    expect(PS5_AUTOMATION).toBe("NOT_AUTHORIZED / NOT_CONNECTED / DISABLED");
    const bridge = new PhysicalPS5HardwareBridge();
    expect(bridge.enabled).toBe(false);
    for (const target of [undefined, "192.168.1.10", "localhost"]) {
      expect(bridge.connectConsole(target)).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    }
    expect(bridge.sendControllerInput("CROSS")).toMatchObject({
      ok: false,
      code: "NOT_AUTHORIZED",
    });
    expect(Object.keys(bridge).sort()).toEqual(["automationStatus", "enabled"]);
  });
});

describe("safety controller", () => {
  const running = (nowMs = 1000, deadmanTimeoutMs = 1000) => {
    const c = new SandboxSafetyController({ deadmanTimeoutMs, nowMs });
    c.transition("OBSERVING", nowMs);
    c.transition("PLANNING", nowMs);
    c.transition("RUNNING_SANDBOX", nowMs);
    return c;
  };

  it("pause clears the queue and releases inputs; resume continues", () => {
    const c = running();
    c.enqueueAction("MOVE_EAST", 1010);
    expect(c.areInputsReleased()).toBe(false);
    c.pause(1020);
    expect([c.getState(), c.getQueuedCount(), c.areInputsReleased()]).toEqual(["PAUSED", 0, true]);
    expect(() => c.enqueueAction("MOVE_EAST", 1030)).toThrow(/state PAUSED/);
    expect(c.popNextAction(1030)).toBeNull();
    c.resume(1040);
    c.enqueueAction("MOVE_NORTH", 1050);
    expect(c.popNextAction(1060)).toBe("MOVE_NORTH");
  });

  it("stop cancels queued commands, and nothing queued or delayed runs afterwards", () => {
    const c = running();
    c.enqueueAction("MOVE_EAST", 1010);
    c.enqueueAction("MOVE_NORTH", 1011);
    expect(c.stopImmediate(1020)).toEqual({ stoppedAtMs: 1020, clearedQueueCount: 2 });
    expect([c.getState(), c.areInputsReleased()]).toEqual(["STOPPED", true]);
    expect(c.popNextAction(1021)).toBeNull();
    expect(() => c.enqueueAction("MOVE_EAST", 1022)).toThrow(/state STOPPED/);
    expect(() => c.resume(1023)).toThrow(/Invalid controller state transition/);
    expect(() => c.transition("RUNNING_SANDBOX", 1024)).toThrow(/Invalid/);
    // Stop is idempotent and works from any state, including before a run.
    expect(c.stopImmediate(1025).clearedQueueCount).toBe(0);
    const idle = new SandboxSafetyController({ nowMs: 0 });
    idle.stopImmediate(1);
    expect(idle.getState()).toBe("STOPPED");
  });

  it("deadman: silence past the timeout stops the controller and rejects the late command", () => {
    const c = running(2000, 500);
    c.enqueueAction("MOVE_EAST", 2100);
    expect(c.checkDeadman(2500)).toBe(false); // exactly at the limit is still alive
    expect(() => c.enqueueAction("MOVE_NORTH", 2501)).toThrow(/Deadman watchdog triggered/);
    expect([c.getState(), c.getQueuedCount(), c.areInputsReleased()]).toEqual(["STOPPED", 0, true]);
    expect(c.popNextAction(2502)).toBeNull();
    // A heartbeat keeps a healthy run alive.
    const live = running(0, 500);
    live.heartbeat(400);
    expect(live.checkDeadman(800)).toBe(false);
    live.enqueueAction("MOVE_EAST", 800);
    expect(live.popNextAction(801)).toBe("MOVE_EAST");
  });

  it("refuses illegal transitions and records history", () => {
    const c = new SandboxSafetyController({ nowMs: 0 });
    expect(() => c.transition("COMPLETED", 1)).toThrow(/IDLE -> COMPLETED/);
    c.transition("BLOCKED", 2);
    expect(() => c.transition("RUNNING_SANDBOX", 3)).toThrow(/BLOCKED -> RUNNING_SANDBOX/);
    expect(c.getHistory()).toEqual([{ from: "IDLE", to: "BLOCKED", atMs: 2 }]);
  });
});

describe("episodes", () => {
  beforeAll(() => {
    process.env[SANDBOX_ENABLED_ENV] = "true";
  });
  afterAll(() => {
    delete process.env[SANDBOX_ENABLED_ENV];
  });

  it("an outside Stop during an action cancels it: the agent does not move again", () => {
    const controller = new SandboxSafetyController({ deadmanTimeoutMs: 5000, nowMs: 0 });
    const r = runSeededSandboxEpisode({
      seed: 101,
      policyMode: "LOOKAHEAD_PLANNER",
      controller,
      now: () => 0,
      onActionQueued: (c, step) => {
        if (step === 4) c.stopImmediate(0);
      },
    });
    expect(r.finalState).toBe("STOPPED");
    expect(r.stepsExecuted).toBe(3); // step 4's action never executed
    expect(r.reachedGoal).toBe(false);
    expect(r.successCriteriaMet).toBe(false);
    expect(controller.areInputsReleased()).toBe(true);
    expect(controller.getQueuedCount()).toBe(0);
    // The stopped controller cannot be reused without an explicit reset.
    expect(() =>
      runSeededSandboxEpisode({ seed: 101, policyMode: "LOOKAHEAD_PLANNER", controller }),
    ).toThrow(/needs an IDLE controller/);
  });

  it("an outside Pause halts the episode with inputs released", () => {
    const controller = new SandboxSafetyController({ deadmanTimeoutMs: 5000, nowMs: 0 });
    const r = runSeededSandboxEpisode({
      seed: 102,
      policyMode: "LOOKAHEAD_PLANNER",
      controller,
      now: () => 0,
      onActionQueued: (c, step) => {
        if (step === 2) c.pause(0);
      },
    });
    expect([r.finalState, r.stepsExecuted]).toEqual(["PAUSED", 1]);
    expect(controller.areInputsReleased()).toBe(true);
  });

  it("the watchdog ends an episode whose clock stalls between steps", () => {
    let t = 0;
    const controller = new SandboxSafetyController({ deadmanTimeoutMs: 100, nowMs: 0 });
    const r = runSeededSandboxEpisode({
      seed: 103,
      policyMode: "LOOKAHEAD_PLANNER",
      controller,
      now: () => t,
      onActionQueued: (_c, step) => {
        if (step === 3) t += 1000; // the loop hangs for a second mid-action
      },
    });
    expect(r.finalState).toBe("STOPPED");
    expect(r.stepsExecuted).toBe(2);
    expect(controller.areInputsReleased()).toBe(true);
  });

  it("is bounded: an episode never exceeds maxSteps, and fails closed", () => {
    const r = runSeededSandboxEpisode({ seed: 101, policyMode: "LOOKAHEAD_PLANNER", maxSteps: 3 });
    expect(r.stepsExecuted).toBeLessThanOrEqual(3);
    expect([r.reachedGoal, r.successCriteriaMet, r.finalState]).toEqual([false, false, "STOPPED"]);
    // An adapter that never makes progress is stopped by the step bound too.
    const stuck = runSeededSandboxEpisode({
      seed: 101,
      policyMode: "MODEL_ASSISTED",
      modelAdapter: { ...greedy, selectAction: () => ({ action: "HOLD_COVER", rationale: "" }) },
    });
    expect([stuck.reachedGoal, stuck.finalState, stuck.stepsExecuted]).toEqual([
      false,
      "STOPPED",
      32,
    ]);
  });

  it("recovers from failures through the safety queue, without hazard collisions", () => {
    const s = runSandboxEvaluationSuite();
    expect(s.totalEpisodesPerPolicy).toBe(12);
    expect(s.deterministicSuccessCount).toBe(6);
    expect(s.plannerSuccessCount).toBe(12);
    expect(s.totalPlannerRecoveries).toBeGreaterThan(0);
    for (const r of [...s.plannerRuns, ...s.deterministicRuns]) {
      expect(r.hazardCollisions).toBe(0);
      expect(r.stepsExecuted).toBeLessThanOrEqual(r.maxSteps);
      expect(["COMPLETED", "STOPPED"]).toContain(r.finalState);
    }
  });

  it("labels every policy for what it is and never reports model inference as verified", () => {
    const s = runSandboxEvaluationSuite();
    expect(s.deterministicRuns[0]!.policyCategory).toBe("DETERMINISTIC_SCRIPT_NOT_AI");
    expect(s.plannerRuns[0]!.policyCategory).toBe("ALGORITHMIC_BELIEF_PLANNER_NOT_LLM");
    expect(s.modelInferenceStatus).toBe("NOT_VERIFIED");
    expect(s.ps5AutomationStatus).toBe(PS5_AUTOMATION);
    // No adapter, or a paid external one: BLOCKED before any step runs.
    for (const modelAdapter of [undefined, { ...greedy, isExternalPaidApi: true }]) {
      const r = runSeededSandboxEpisode({ seed: 101, policyMode: "MODEL_ASSISTED", modelAdapter });
      expect([r.finalState, r.stepsExecuted, r.trace.length]).toEqual(["BLOCKED", 0, 0]);
    }
    // An injected function runs, but it is a hand-written rule, and is labelled so.
    const injected = runSeededSandboxEpisode({
      seed: 101,
      policyMode: "MODEL_ASSISTED",
      modelAdapter: greedy,
    });
    expect(injected.reachedGoal).toBe(true);
    expect(injected.policyCategory).toBe("INJECTED_ADAPTER_INFERENCE_NOT_VERIFIED");
    expect(injected.modelInferenceVerified).toBe(false);
    for (const r of [...s.plannerRuns, ...s.deterministicRuns]) {
      expect(r.modelInferenceVerified).toBe(false);
    }
  });
});
