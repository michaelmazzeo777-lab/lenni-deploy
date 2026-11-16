// EXPERIMENTAL local R&D module (from the Gemini v3.1 candidate, adapted).
//
// A toy grid-navigation simulation with a safety state machine. It is not part
// of the Studio: nothing under app/, domain/ or the rest of lib/ imports it
// (tests/unit/sandbox.test.ts enforces that), and it imports nothing from them
// except the error helper. It controls no console, opens no network connection
// and reads no credentials. Episodes refuse to run unless SANDBOX_RND_ENABLED
// is "true".
//
// What the policies are, so results are not over-read:
//   DETERMINISTIC_BASELINE  a fixed script
//   LOOKAHEAD_PLANNER       a hand-written scoring heuristic
//   MODEL_ASSISTED          whatever function the caller injects. The module
//                           cannot tell a trained model from an if-statement,
//                           so it never reports model inference as verified.
// None of these is evidence of autonomous gameplay.
import { precondition } from "@/lib/errors";

export const SANDBOX_ENABLED_ENV = "SANDBOX_RND_ENABLED";
export function isSandboxEnabled(): boolean {
  return process.env[SANDBOX_ENABLED_ENV] === "true";
}

/**
 * Nonnegotiable Safety & Governance Constant (Directive v3.1 §5):
 * All actual PS5 controller interfaces remain disabled.
 */
export const PS5_AUTOMATION = "NOT_AUTHORIZED / NOT_CONNECTED / DISABLED" as const;

export type ControllerState =
  | "IDLE"
  | "OBSERVING"
  | "PLANNING"
  | "RUNNING_SANDBOX"
  | "VERIFYING"
  | "RECOVERING"
  | "PAUSED"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

const ALLOWED_TRANSITIONS: Record<ControllerState, Set<ControllerState>> = {
  IDLE: new Set(["OBSERVING", "PLANNING", "RUNNING_SANDBOX", "STOPPING", "BLOCKED"]),
  OBSERVING: new Set(["PLANNING", "PAUSED", "STOPPING", "FAILED", "BLOCKED"]),
  PLANNING: new Set(["RUNNING_SANDBOX", "PAUSED", "STOPPING", "FAILED", "BLOCKED"]),
  RUNNING_SANDBOX: new Set([
    "OBSERVING",
    "PLANNING",
    "VERIFYING",
    "RECOVERING",
    "PAUSED",
    "STOPPING",
    "COMPLETED",
    "FAILED",
    "BLOCKED",
  ]),
  VERIFYING: new Set([
    "OBSERVING",
    "PLANNING",
    "RUNNING_SANDBOX",
    "RECOVERING",
    "PAUSED",
    "STOPPING",
    "COMPLETED",
    "FAILED",
    "BLOCKED",
  ]),
  RECOVERING: new Set([
    "OBSERVING",
    "PLANNING",
    "RUNNING_SANDBOX",
    "PAUSED",
    "STOPPING",
    "FAILED",
    "BLOCKED",
  ]),
  PAUSED: new Set(["OBSERVING", "PLANNING", "RUNNING_SANDBOX", "STOPPING", "STOPPED"]),
  STOPPING: new Set(["STOPPED"]),
  STOPPED: new Set(["IDLE"]),
  COMPLETED: new Set(["IDLE"]),
  FAILED: new Set(["IDLE"]),
  BLOCKED: new Set(["IDLE"]),
};

export type SandboxAction =
  | "MOVE_NORTH"
  | "MOVE_SOUTH"
  | "MOVE_EAST"
  | "MOVE_WEST"
  | "HOLD_COVER"
  | "BACKTRACK_AND_REROUTE"
  | "RELEASE_ALL_INPUTS";

export interface SandboxTaskGoal {
  goalId: string;
  description: string;
  targetX: number;
  targetY: number;
  maxSteps: number;
  maxHazardCollisions: number;
  maxRetriesPerStall: number;
}

export interface SandboxObservation {
  step: number;
  x: number;
  y: number;
  goalX: number;
  goalY: number;
  hazardLevel: number;
  blockedDirections: SandboxAction[];
  dynamicTrapTriggered: boolean;
  reachedGoal: boolean;
  collidedHazard: boolean;
}

export type LoopPhase = "OBSERVE" | "PLAN" | "ACT" | "VERIFY" | "RECOVER" | "COMPLETE_OR_STOP";

export type PolicyMode = "DETERMINISTIC_BASELINE" | "LOOKAHEAD_PLANNER" | "MODEL_ASSISTED";

export interface SandboxTraceStep {
  step: number;
  phasesExecuted: LoopPhase[];
  before: { x: number; y: number };
  observation: SandboxObservation;
  action: SandboxAction;
  after: { x: number; y: number };
  verifiedProgress: boolean;
  recoveryTriggered: boolean;
  recoveryReason?: string;
  stepLatencyMs: number;
  policySource: PolicyMode;
}

export interface SandboxEpisodeResult {
  episodeId: string;
  seed: number;
  heldOutScenario: boolean;
  policyMode: PolicyMode;
  policyCategory:
    | "DETERMINISTIC_SCRIPT_NOT_AI"
    | "ALGORITHMIC_BELIEF_PLANNER_NOT_LLM"
    | "INJECTED_ADAPTER_INFERENCE_NOT_VERIFIED";
  /** Always false: this module cannot verify that a trained model chose the actions. */
  modelInferenceVerified: false;
  goal: SandboxTaskGoal;
  successCriteriaMet: boolean;
  stepsExecuted: number;
  actionCount: number;
  recoveryCount: number;
  boundedRetriesUsed: number;
  humanInterventionCount: number;
  latencyMs: number;
  maxSteps: number;
  reachedGoal: boolean;
  hazardCollisions: number;
  finalState: ControllerState;
  blockedReason?: string;
  trace: SandboxTraceStep[];
}

export interface SandboxModelAdapter {
  readonly modelName: string;
  readonly isExternalPaidApi: boolean;
  selectAction(
    obs: SandboxObservation,
    memory: { visited: Map<string, number>; traps: Set<string> },
  ): { action: SandboxAction; rationale: string };
}

/**
 * Disabled abstract hardware bridge (Directive v3.1 §5).
 * Never connects to PS5 Remote Play, never reads PSN/NPSSO tokens, and always
 * fails closed with NOT_AUTHORIZED.
 */
export class PhysicalPS5HardwareBridge {
  readonly enabled = false as const;
  readonly automationStatus = PS5_AUTOMATION;

  connectConsole(_targetIp?: string): {
    ok: false;
    code: "NOT_AUTHORIZED";
    reason: string;
  } {
    return {
      ok: false,
      code: "NOT_AUTHORIZED",
      reason:
        "Physical PS5 Remote Play and PSN/NPSSO interfaces are disabled by governance policy (PlayStation §10.7 / 01_Project_Governance).",
    };
  }

  sendControllerInput(_button: string): {
    ok: false;
    code: "NOT_AUTHORIZED";
    reason: string;
  } {
    return {
      ok: false,
      code: "NOT_AUTHORIZED",
      reason: "Hardware controller injection is disabled; use isolated local sandbox only.",
    };
  }
}

/**
 * Safety controller with atomic state machine:
 * OBSERVE -> PLAN -> ACT -> VERIFY -> RECOVER -> COMPLETE/STOP
 * Includes queued action cancellation on Stop, input release, and monotonic deadman watchdog.
 */
export class SandboxSafetyController {
  private state: ControllerState = "IDLE";
  private queuedActions: SandboxAction[] = [];
  private inputsReleased = true;
  private lastHeartbeatMs: number;
  private readonly deadmanTimeoutMs: number;
  private readonly history: { from: ControllerState; to: ControllerState; atMs: number }[] = [];

  constructor(options?: { deadmanTimeoutMs?: number; nowMs?: number }) {
    this.deadmanTimeoutMs = options?.deadmanTimeoutMs ?? 2000;
    this.lastHeartbeatMs = options?.nowMs ?? Date.now();
  }

  getState(): ControllerState {
    return this.state;
  }

  getQueuedCount(): number {
    return this.queuedActions.length;
  }

  areInputsReleased(): boolean {
    return this.inputsReleased;
  }

  getHistory() {
    return [...this.history];
  }

  transition(next: ControllerState, nowMs = Date.now()): ControllerState {
    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (!allowed?.has(next)) {
      throw precondition(`Invalid controller state transition: ${this.state} -> ${next}`);
    }
    const prev = this.state;
    this.state = next;
    this.history.push({ from: prev, to: next, atMs: nowMs });
    if (
      next === "STOPPING" ||
      next === "STOPPED" ||
      next === "PAUSED" ||
      next === "BLOCKED" ||
      next === "COMPLETED" ||
      next === "FAILED"
    ) {
      this.queuedActions = [];
      this.inputsReleased = true;
    }
    return this.state;
  }

  heartbeat(nowMs = Date.now()): void {
    this.lastHeartbeatMs = nowMs;
  }

  checkDeadman(nowMs = Date.now()): boolean {
    if (nowMs - this.lastHeartbeatMs > this.deadmanTimeoutMs) {
      this.queuedActions = [];
      this.inputsReleased = true;
      if (this.state !== "STOPPED" && this.state !== "IDLE") {
        const prev = this.state;
        this.state = "STOPPED";
        this.history.push({ from: prev, to: "STOPPED", atMs: nowMs });
      }
      return true;
    }
    return false;
  }

  enqueueAction(action: SandboxAction, nowMs = Date.now()): void {
    if (this.checkDeadman(nowMs)) {
      throw precondition("Deadman watchdog triggered; action rejected and inputs released");
    }
    if (this.state !== "RUNNING_SANDBOX" && this.state !== "RECOVERING") {
      throw precondition(`Cannot enqueue action while controller is in state ${this.state}`);
    }
    this.inputsReleased = false;
    this.queuedActions.push(action);
  }

  popNextAction(nowMs = Date.now()): SandboxAction | null {
    if (this.checkDeadman(nowMs)) return null;
    if (this.state !== "RUNNING_SANDBOX" && this.state !== "RECOVERING") return null;
    return this.queuedActions.shift() ?? null;
  }

  pause(nowMs = Date.now()): void {
    this.transition("PAUSED", nowMs);
  }

  resume(nowMs = Date.now()): void {
    this.transition("RUNNING_SANDBOX", nowMs);
    this.heartbeat(nowMs);
  }

  stopImmediate(nowMs = Date.now()): { stoppedAtMs: number; clearedQueueCount: number } {
    const cleared = this.queuedActions.length;
    this.queuedActions = [];
    this.inputsReleased = true;
    if (this.state !== "STOPPED") {
      const prev = this.state;
      if (this.state !== "STOPPING") {
        this.state = "STOPPING";
        this.history.push({ from: prev, to: "STOPPING", atMs: nowMs });
      }
      this.transition("STOPPED", nowMs);
    }
    return { stoppedAtMs: nowMs, clearedQueueCount: cleared };
  }
}

const RUNNABLE: ReadonlySet<ControllerState> = new Set([
  "IDLE",
  "OBSERVING",
  "PLANNING",
  "RUNNING_SANDBOX",
  "VERIFYING",
  "RECOVERING",
]);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs a single seeded navigation + hazard avoidance sandbox episode implementing:
 * OBSERVE -> PLAN -> ACT -> VERIFY -> RECOVER -> COMPLETE/STOP (Directive v3.1 Priority C).
 *
 * Never conflates deterministic scripts or algorithmic lookahead with live LLM inference:
 * - `DETERMINISTIC_BASELINE` -> `DETERMINISTIC_SCRIPT_NOT_AI`
 * - `LOOKAHEAD_PLANNER` -> `ALGORITHMIC_BELIEF_PLANNER_NOT_LLM`
 * - `MODEL_ASSISTED` -> requires a non-paid/approved `modelAdapter`; if absent or if external
 *   paid API is marked true, transitions controller to `BLOCKED` and reports the blocker.
 */
export function runSeededSandboxEpisode(options: {
  seed: number;
  heldOutScenario?: boolean;
  policyMode: PolicyMode;
  modelAdapter?: SandboxModelAdapter;
  maxSteps?: number;
  /** Supply a controller to pause/stop the episode from outside (tests, an operator). */
  controller?: SandboxSafetyController;
  /** Clock for the watchdog; defaults to Date.now. Inject for deterministic tests. */
  now?: () => number;
  /** Called after an action is queued and before it executes ("during an action"). */
  onActionQueued?: (controller: SandboxSafetyController, step: number) => void;
}): SandboxEpisodeResult {
  if (!isSandboxEnabled()) {
    throw precondition(
      `The experimental sandbox is disabled. Set ${SANDBOX_ENABLED_ENV}=true for authorized local R&D.`,
    );
  }
  const now = options.now ?? Date.now;
  const episodeStart = performance.now();
  const rand = mulberry32(options.seed);
  const gridSize = options.heldOutScenario ? 10 : 8;
  const maxSteps = options.maxSteps ?? 32;

  const goalX = gridSize - 1;
  const goalY = gridSize - 1;

  const goal: SandboxTaskGoal = {
    goalId: `nav_goal_seed_${options.seed}`,
    description: `Navigate from (0,0) to (${goalX},${goalY}) within ${maxSteps} steps with 0 hazard collisions`,
    targetX: goalX,
    targetY: goalY,
    maxSteps,
    maxHazardCollisions: 0,
    maxRetriesPerStall: 3,
  };

  const policyCategory =
    options.policyMode === "DETERMINISTIC_BASELINE"
      ? "DETERMINISTIC_SCRIPT_NOT_AI"
      : options.policyMode === "LOOKAHEAD_PLANNER"
        ? "ALGORITHMIC_BELIEF_PLANNER_NOT_LLM"
        : "INJECTED_ADAPTER_INFERENCE_NOT_VERIFIED";

  const controller =
    options.controller ?? new SandboxSafetyController({ deadmanTimeoutMs: 5000, nowMs: now() });
  if (controller.getState() !== "IDLE") {
    throw precondition(`Episode needs an IDLE controller (got ${controller.getState()})`);
  }

  // Enforce Directive v3.1 Priority C governance rule for MODEL_ASSISTED mode:
  // If no approved local model adapter is provided, or if the adapter would invoke an
  // external paid API under the $0 spend boundary, transition to BLOCKED cleanly.
  if (options.policyMode === "MODEL_ASSISTED") {
    if (!options.modelAdapter || options.modelAdapter.isExternalPaidApi) {
      controller.transition("BLOCKED", now());
      return {
        episodeId: `ep_model_assisted_seed_${options.seed}`,
        seed: options.seed,
        heldOutScenario: Boolean(options.heldOutScenario),
        policyMode: "MODEL_ASSISTED",
        policyCategory,
        modelInferenceVerified: false,
        goal,
        successCriteriaMet: false,
        stepsExecuted: 0,
        actionCount: 0,
        recoveryCount: 0,
        boundedRetriesUsed: 0,
        humanInterventionCount: 0,
        latencyMs: Number((performance.now() - episodeStart).toFixed(3)),
        maxSteps,
        reachedGoal: false,
        hazardCollisions: 0,
        finalState: controller.getState(),
        blockedReason:
          "No model adapter was supplied, or it is marked as an external paid API. Paid model inference is not authorized.",
        trace: [],
      };
    }
  }

  const hazards = new Set<string>();
  const dynamicTraps = new Set<string>();
  const obstacleCount = options.heldOutScenario ? 14 : 9;
  for (let i = 0; i < obstacleCount; i++) {
    const hx = Math.floor(rand() * gridSize);
    const hy = Math.floor(rand() * gridSize);
    if ((hx === 0 && hy === 0) || (hx === goalX && hy === goalY)) continue;
    if (hx === 0 || hy === gridSize - 1) continue;
    if (i % 3 === 0) {
      dynamicTraps.add(`${hx},${hy}`);
    } else {
      hazards.add(`${hx},${hy}`);
    }
  }

  let x = 0;
  let y = 0;
  let prevX = 0;
  let prevY = 0;
  let hazardCollisions = 0;
  let recoveryCount = 0;
  let boundedRetriesUsed = 0;
  let consecutiveStalls = 0;
  const trace: SandboxTraceStep[] = [];
  const visitedCounts = new Map<string, number>();
  const discoveredTraps = new Set<string>();

  const deltaMap: Record<SandboxAction, [number, number]> = {
    MOVE_EAST: [1, 0],
    MOVE_NORTH: [0, 1],
    MOVE_WEST: [-1, 0],
    MOVE_SOUTH: [0, -1],
    HOLD_COVER: [0, 0],
    BACKTRACK_AND_REROUTE: [0, 0],
    RELEASE_ALL_INPUTS: [0, 0],
  };

  for (let step = 1; step <= maxSteps; step++) {
    const stepStart = performance.now();
    const phasesExecuted: LoopPhase[] = [];

    // An outside Stop, Pause or watchdog trip ends the episode: nothing further runs.
    if (controller.checkDeadman(now()) || !RUNNABLE.has(controller.getState())) break;

    // 1. OBSERVE
    controller.transition("OBSERVING", now());
    controller.heartbeat(now());
    phasesExecuted.push("OBSERVE");

    const posKey = `${x},${y}`;
    visitedCounts.set(posKey, (visitedCounts.get(posKey) ?? 0) + 1);

    const blockedDirections: SandboxAction[] = [];
    for (const act of ["MOVE_EAST", "MOVE_NORTH", "MOVE_WEST", "MOVE_SOUTH"] as const) {
      const [dx, dy] = deltaMap[act];
      const nx = x + dx;
      const ny = y + dy;
      const nKey = `${nx},${ny}`;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= gridSize ||
        ny >= gridSize ||
        hazards.has(nKey) ||
        discoveredTraps.has(nKey)
      ) {
        blockedDirections.push(act);
      }
    }

    const obs: SandboxObservation = {
      step,
      x,
      y,
      goalX,
      goalY,
      hazardLevel: blockedDirections.length / 4,
      blockedDirections,
      dynamicTrapTriggered: dynamicTraps.has(posKey),
      reachedGoal: x === goalX && y === goalY,
      collidedHazard: hazards.has(posKey),
    };

    if (obs.reachedGoal) {
      phasesExecuted.push("COMPLETE_OR_STOP");
      break;
    }

    // 2. PLAN
    controller.transition("PLANNING", now());
    phasesExecuted.push("PLAN");

    let chosenAction: SandboxAction = "HOLD_COVER";
    if (options.policyMode === "DETERMINISTIC_BASELINE") {
      const candidates: SandboxAction[] = ["MOVE_EAST", "MOVE_NORTH", "MOVE_SOUTH", "MOVE_WEST"];
      chosenAction =
        candidates.find((c) => {
          const [dx, dy] = deltaMap[c];
          const nx = x + dx;
          const ny = y + dy;
          return (
            nx >= 0 && ny >= 0 && nx < gridSize && ny < gridSize && !hazards.has(`${nx},${ny}`)
          );
        }) ?? "HOLD_COVER";
    } else if (options.policyMode === "MODEL_ASSISTED" && options.modelAdapter) {
      const decision = options.modelAdapter.selectAction(obs, {
        visited: visitedCounts,
        traps: discoveredTraps,
      });
      chosenAction = decision.action;
    } else {
      const candidates: SandboxAction[] = ["MOVE_EAST", "MOVE_NORTH", "MOVE_WEST", "MOVE_SOUTH"];
      let bestScore = -Infinity;
      for (const cand of candidates) {
        if (obs.blockedDirections.includes(cand)) continue;
        const [dx, dy] = deltaMap[cand];
        const nx = x + dx;
        const ny = y + dy;
        const nKey = `${nx},${ny}`;
        const dist = Math.abs(goalX - nx) + Math.abs(goalY - ny);
        const visits = visitedCounts.get(nKey) ?? 0;
        let openExits = 0;
        for (const nextAct of candidates) {
          const [dx2, dy2] = deltaMap[nextAct];
          const nnx = nx + dx2;
          const nny = ny + dy2;
          const nnKey = `${nnx},${nny}`;
          if (
            nnx >= 0 &&
            nny >= 0 &&
            nnx < gridSize &&
            nny < gridSize &&
            !hazards.has(nnKey) &&
            !discoveredTraps.has(nnKey)
          ) {
            openExits++;
          }
        }
        const score = -dist * 2.5 - visits * 4.5 + openExits * 0.6;
        if (score > bestScore) {
          bestScore = score;
          chosenAction = cand;
        }
      }
    }

    // 3. ACT
    controller.transition("RUNNING_SANDBOX", now());
    phasesExecuted.push("ACT");
    controller.enqueueAction(chosenAction, now());
    options.onActionQueued?.(controller, step);
    // A Stop/Pause/watchdog trip between queueing and executing cancels the
    // action: the queue is already empty, so nothing moves.
    const executed = controller.popNextAction(now());
    if (executed === null) break;
    const before = { x, y };
    const [dx, dy] = deltaMap[executed];
    const nextX = Math.max(0, Math.min(gridSize - 1, x + dx));
    const nextY = Math.max(0, Math.min(gridSize - 1, y + dy));
    const nextKey = `${nextX},${nextY}`;

    let hitDynamicTrap = false;
    if (hazards.has(nextKey)) {
      hazardCollisions++;
    } else if (dynamicTraps.has(nextKey)) {
      hitDynamicTrap = true;
      discoveredTraps.add(nextKey);
    } else {
      prevX = x;
      prevY = y;
      x = nextX;
      y = nextY;
    }

    // 4. VERIFY
    controller.transition("VERIFYING", now());
    phasesExecuted.push("VERIFY");
    const madeCoordinateProgress = x !== before.x || y !== before.y;
    const isOscillating = (visitedCounts.get(`${x},${y}`) ?? 0) > 2;
    const verifiedProgress = madeCoordinateProgress && !hitDynamicTrap && !isOscillating;

    // 5. RECOVER (Bounded retry & recovery when VERIFY detects trap or stall)
    let recoveryTriggered = false;
    let recoveryReason: string | undefined;

    if (!verifiedProgress) {
      consecutiveStalls++;
      if (
        options.policyMode !== "DETERMINISTIC_BASELINE" &&
        consecutiveStalls <= goal.maxRetriesPerStall
      ) {
        controller.transition("RECOVERING", now());
        phasesExecuted.push("RECOVER");
        recoveryTriggered = true;
        recoveryCount++;
        boundedRetriesUsed++;
        recoveryReason = hitDynamicTrap
          ? `Dynamic roadblock detected at (${nextX},${nextY}); recorded in belief map and rerouting`
          : `Oscillation/stall detected at (${x},${y}); executing perimeter recovery step`;

        // The recovery move is an action like any other: it goes through the
        // safety controller's queue, and an unseen trap still stops it.
        const open = (cx: number, cy: number) =>
          !hazards.has(`${cx},${cy}`) && !discoveredTraps.has(`${cx},${cy}`);
        const recoveryAction: SandboxAction =
          y < gridSize - 1 && open(x, y + 1)
            ? "MOVE_NORTH"
            : x > 0 && open(x - 1, y)
              ? "MOVE_WEST"
              : "BACKTRACK_AND_REROUTE";
        controller.enqueueAction(recoveryAction, now());
        const recovery = controller.popNextAction(now());
        if (recovery === null) break;
        if (recovery === "BACKTRACK_AND_REROUTE") {
          x = prevX;
          y = prevY;
        } else {
          const [rdx, rdy] = deltaMap[recovery];
          const rKey = `${x + rdx},${y + rdy}`;
          if (dynamicTraps.has(rKey)) discoveredTraps.add(rKey);
          else {
            x += rdx;
            y += rdy;
          }
        }
        consecutiveStalls = 0;
      }
    } else {
      consecutiveStalls = 0;
    }

    const stepLatencyMs = Number((performance.now() - stepStart).toFixed(3));
    trace.push({
      step,
      phasesExecuted,
      before,
      observation: obs,
      action: executed,
      after: { x, y },
      verifiedProgress,
      recoveryTriggered,
      recoveryReason,
      stepLatencyMs,
      policySource: options.policyMode,
    });

    if (x === goalX && y === goalY) {
      break;
    }
  }

  // 6. COMPLETE / STOP
  const reachedGoal = x === goalX && y === goalY;
  // If something outside already stopped or paused the episode, leave that state alone.
  if (RUNNABLE.has(controller.getState())) {
    controller.transition(reachedGoal ? "COMPLETED" : "STOPPING", now());
    if (!reachedGoal) controller.transition("STOPPED", now());
  }

  const latencyMs = Number((performance.now() - episodeStart).toFixed(3));
  const successCriteriaMet =
    reachedGoal &&
    hazardCollisions <= goal.maxHazardCollisions &&
    trace.length <= goal.maxSteps &&
    controller.areInputsReleased();

  return {
    episodeId: `ep_${options.policyMode.toLowerCase()}_seed_${options.seed}`,
    seed: options.seed,
    heldOutScenario: Boolean(options.heldOutScenario),
    policyMode: options.policyMode,
    policyCategory,
    modelInferenceVerified: false,
    goal,
    successCriteriaMet,
    stepsExecuted: trace.length,
    actionCount: trace.length,
    recoveryCount,
    boundedRetriesUsed,
    humanInterventionCount: 0,
    latencyMs,
    maxSteps,
    reachedGoal,
    hazardCollisions,
    finalState: controller.getState(),
    trace,
  };
}

/**
 * Runs the 12-episode benchmark suite (8 standard + 4 withheld scenarios)
 * required by Directive v3.1 Priority C (>=10 varied seeded episodes including >=3 withheld scenarios).
 */
export function runSandboxEvaluationSuite() {
  const seeds = [101, 102, 103, 104, 105, 106, 107, 108, 201, 202, 203, 204];
  const deterministicRuns: SandboxEpisodeResult[] = [];
  const plannerRuns: SandboxEpisodeResult[] = [];

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;
    const heldOut = i >= 8;
    deterministicRuns.push(
      runSeededSandboxEpisode({
        seed,
        heldOutScenario: heldOut,
        policyMode: "DETERMINISTIC_BASELINE",
      }),
    );
    plannerRuns.push(
      runSeededSandboxEpisode({
        seed,
        heldOutScenario: heldOut,
        policyMode: "LOOKAHEAD_PLANNER",
      }),
    );
  }

  // Verify MODEL_ASSISTED reports BLOCKED when no approved zero-spend model inference is active
  const blockedModelRun = runSeededSandboxEpisode({
    seed: 101,
    policyMode: "MODEL_ASSISTED",
  });

  const detSuccess = deterministicRuns.filter((r) => r.reachedGoal).length;
  const planSuccess = plannerRuns.filter((r) => r.reachedGoal).length;
  const totalRecoveries = plannerRuns.reduce((acc, r) => acc + r.recoveryCount, 0);
  const meanPlannerLatencyMs = Number(
    (plannerRuns.reduce((acc, r) => acc + r.latencyMs, 0) / plannerRuns.length).toFixed(3),
  );

  return {
    ps5AutomationStatus: PS5_AUTOMATION,
    externalPaidModelInferenceStatus: "BLOCKED" as const,
    modelInferenceStatus: "NOT_VERIFIED" as const,
    blockedModelCheck: {
      finalState: blockedModelRun.finalState,
      blockedReason: blockedModelRun.blockedReason,
    },
    totalEpisodesPerPolicy: seeds.length,
    heldOutEpisodes: 4,
    deterministicSuccessCount: detSuccess,
    deterministicSuccessRate: Number((detSuccess / seeds.length).toFixed(2)),
    plannerSuccessCount: planSuccess,
    plannerSuccessRate: Number((planSuccess / seeds.length).toFixed(2)),
    totalPlannerRecoveries: totalRecoveries,
    meanPlannerLatencyMs,
    deterministicRuns,
    plannerRuns,
  };
}
