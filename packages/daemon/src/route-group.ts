import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelRef, ModelsFile, ProviderEntry, RouteMode } from "@guild/protocol";
import { isFreeProvider } from "./free-model.ts";
import { isKeylessProvider } from "./opencode-free.ts";

/** Picker id for a routing group. The model id is the group's id. */
export const GROUP_PROVIDER_ID = "group";
const REST_MS = 30 * 60 * 1000;
const MODES = new Set<RouteMode>(["smart", "order", "rotate", "usage", "pace"]);

export type RouteStep = {
  ref: ModelRef;
  /** Resolved spare key. Missing means the provider's own credential. */
  apiKey?: string;
  slot: string;
  groupId?: string;
};

type Affinity = { provider: string; model: string; slot: string };

export type RouteState = {
  affinity: Record<string, Affinity>;
  cursor: Record<string, number>;
  restUntil: Record<string, number>;
  hits: Record<string, number>;
};

const EMPTY: RouteState = { affinity: {}, cursor: {}, restUntil: {}, hits: {} };

export function emptyRouteState(): RouteState {
  return { affinity: {}, cursor: {}, restUntil: {}, hits: {} };
}

export function routeStatePath(dataDir: string): string {
  return join(dataDir, "route-state.json");
}

export function readRouteState(dataDir: string): RouteState {
  try {
    const parsed = JSON.parse(readFileSync(routeStatePath(dataDir), "utf8")) as Partial<RouteState>;
    return {
      affinity: parsed.affinity ?? {},
      cursor: parsed.cursor ?? {},
      restUntil: parsed.restUntil ?? {},
      hits: parsed.hits ?? {},
    };
  } catch {
    return emptyRouteState();
  }
}

function writeRouteState(dataDir: string, state: RouteState): void {
  const path = routeStatePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function isRouteMode(value: string): value is RouteMode {
  return MODES.has(value as RouteMode);
}

export function isRouteFailure(text: string, traces: readonly unknown[]): boolean {
  return traces.length === 0 && /模型請求失敗/.test(text);
}

function slotOf(ref: ModelRef, index: number): string {
  return `${ref.provider}\n${ref.model}\n${index}`;
}

function affinityKey(roomId: string, groupId: string): string {
  return `${roomId}\n${groupId}`;
}

function keySlots(
  providerId: string,
  provider: ProviderEntry | undefined,
): { index: number; raw?: string }[] {
  if (!provider || isKeylessProvider(providerId) || isFreeProvider(providerId)) {
    return [{ index: 0 }];
  }
  const slots: { index: number; raw?: string }[] = [];
  if (provider.apiKey?.trim()) slots.push({ index: 0, raw: provider.apiKey.trim() });
  for (const [index, key] of (provider.keys ?? []).entries()) {
    const raw = key.trim();
    if (!raw || raw === provider.apiKey?.trim()) continue;
    slots.push({ index: index + 1, raw });
  }
  return slots.length ? slots : [{ index: 0 }];
}

function resting(state: RouteState, slot: string, now: number): boolean {
  const until = state.restUntil[slot];
  return typeof until === "number" && until > now;
}

function memberHits(state: RouteState, ref: ModelRef, provider: ProviderEntry | undefined): number {
  return keySlots(ref.provider, provider).reduce(
    (sum, slot) => sum + (state.hits[slotOf(ref, slot.index)] ?? 0),
    0,
  );
}

function memberResting(
  state: RouteState,
  ref: ModelRef,
  provider: ProviderEntry | undefined,
  now: number,
): boolean {
  return keySlots(ref.provider, provider).every((slot) =>
    resting(state, slotOf(ref, slot.index), now),
  );
}

function orderMembers(
  members: ModelRef[],
  groupId: string,
  routing: RouteMode,
  file: ModelsFile,
  state: RouteState,
  roomId: string,
  now: number,
): ModelRef[] {
  const restingLast = (list: ModelRef[]): ModelRef[] => {
    const ready: ModelRef[] = [];
    const later: ModelRef[] = [];
    for (const ref of list) {
      (memberResting(state, ref, file.providers[ref.provider], now) ? later : ready).push(ref);
    }
    return [...ready, ...later];
  };
  let ordered = members.slice();
  if (routing === "rotate" && ordered.length) {
    const start = (state.cursor[groupId] ?? 0) % ordered.length;
    ordered = ordered.slice(start).concat(ordered.slice(0, start));
  } else if (routing === "usage" || routing === "pace") {
    ordered.sort(
      (a, b) =>
        memberHits(state, a, file.providers[a.provider]) -
        memberHits(state, b, file.providers[b.provider]),
    );
  }
  ordered = restingLast(ordered);
  if (!roomId) return ordered;
  const kept = state.affinity[affinityKey(roomId, groupId)];
  if (!kept) return ordered;
  const index = ordered.findIndex(
    (ref) => ref.provider === kept.provider && ref.model === kept.model,
  );
  if (index < 0) return ordered;
  const chosen = ordered[index]!;
  if (memberResting(state, chosen, file.providers[chosen.provider], now)) return ordered;
  return [chosen, ...ordered.filter((_, item) => item !== index)];
}

export function planRouteSteps(input: {
  file: ModelsFile;
  state?: RouteState;
  ref: ModelRef;
  now?: Date;
  roomId?: string;
  resolveKey?: (raw: string) => string;
}): RouteStep[] {
  const state = input.state ?? EMPTY;
  const now = (input.now ?? new Date()).getTime();
  const resolveKey = input.resolveKey ?? ((raw) => raw);
  const group =
    input.ref.provider === GROUP_PROVIDER_ID
      ? input.file.groups?.[input.ref.model]
      : undefined;
  if (input.ref.provider === GROUP_PROVIDER_ID && !group) return [];
  const routing = isRouteMode(group?.routing ?? "") ? group!.routing! : "smart";
  const members = group
    ? orderMembers(
        group.members,
        input.ref.model,
        routing,
        input.file,
        state,
        input.roomId ?? "",
        now,
      )
    : [input.ref];
  const steps: RouteStep[] = [];
  const seen = new Set<string>();
  for (const ref of members) {
    for (const slot of keySlots(ref.provider, input.file.providers[ref.provider])) {
      const id = slotOf(ref, slot.index);
      if (seen.has(id)) continue;
      seen.add(id);
      const resolved = slot.raw ? resolveKey(slot.raw) : "";
      if (slot.raw && !resolved) continue;
      steps.push({
        ref,
        ...(resolved ? { apiKey: resolved } : {}),
        slot: id,
        ...(group ? { groupId: input.ref.model } : {}),
      });
    }
  }
  return steps;
}

export function noteRouteRest(dataDir: string, slot: string, now = new Date()): void {
  const state = readRouteState(dataDir);
  state.restUntil[slot] = now.getTime() + REST_MS;
  writeRouteState(dataDir, state);
}

export function noteRouteSuccess(
  dataDir: string,
  step: RouteStep,
  roomId: string | undefined,
  memberCount = 0,
  now = new Date(),
): void {
  const state = readRouteState(dataDir);
  state.hits[step.slot] = (state.hits[step.slot] ?? 0) + 1;
  delete state.restUntil[step.slot];
  if (step.groupId && roomId) {
    const key = affinityKey(roomId, step.groupId);
    const known = Boolean(state.affinity[key]);
    state.affinity[key] = {
      provider: step.ref.provider,
      model: step.ref.model,
      slot: step.slot,
    };
    if (!known && memberCount > 0) {
      state.cursor[step.groupId] = ((state.cursor[step.groupId] ?? 0) + 1) % memberCount;
    }
  }
  writeRouteState(dataDir, state);
}
