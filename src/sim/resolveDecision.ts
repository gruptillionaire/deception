import { BeliefDistribution, DeliveryEventId, IntentId, normaliseBeliefs, ProfileId } from "./inference";
import { ForecastResourceState } from "./forecast";
import { ResourceId, ScenarioOffer } from "./scenarios/uk1935";

export type ResolutionChoice = "accept" | "reject" | "counter";

export type ResolutionResult = {
  dealCommitted: boolean;
  observedEvent?: DeliveryEventId;
  pendingDelivery?: {
    resourceId: ResourceId;
    amount: number;
    turnsUntilDue: number;
    willArrive: boolean;
  };
  resources: ForecastResourceState;
  alignmentDelta: number;
  summary: string;
};

type Rng = () => number;

function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleWeighted<T extends string>(weights: Record<T, number>, rng: Rng): T {
  const roll = rng();
  let cumulative = 0;

  for (const key of Object.keys(weights) as T[]) {
    cumulative += weights[key];
    if (roll <= cumulative) {
      return key;
    }
  }

  const keys = Object.keys(weights) as T[];
  return keys[keys.length - 1];
}

function withDelta(resources: ForecastResourceState, resourceId: ResourceId, delta: number): ForecastResourceState {
  return {
    ...resources,
    [resourceId]: Math.max(0, resources[resourceId] + delta),
  };
}

function applyImmediateDeliveryEvent(
  resources: ForecastResourceState,
  offer: ScenarioOffer,
  deliveryEvent: DeliveryEventId,
  useCounterTerms: boolean,
) {
  const promise = useCounterTerms ? offer.counter.promise : offer.promise;
  const turnsUntilDue = parseTurns(promise.timing);
  let resolved = resources;

  if (turnsUntilDue <= 1 || deliveryEvent === "deliveredNow") {
    resolved = withDelta(resolved, promise.resourceId, promise.amount);
  }

  return resolved;
}

function parseTurns(timing: string | undefined) {
  if (!timing) {
    return 0;
  }

  const match = timing.match(/\d+/);
  if (!match) {
    throw new Error(`Promise timing does not include a turn count: '${timing}'.`);
  }

  return Number(match[0]);
}

function sampleDeliveryEvent(offer: ScenarioOffer, belief: BeliefDistribution, rng: Rng) {
  const prior = normaliseBeliefs(belief);
  const profile = sampleWeighted<ProfileId>(prior, rng);
  const intent = sampleWeighted<IntentId>(offer.intentLikelihoods[profile], rng);
  return sampleWeighted<DeliveryEventId>(offer.deliveryEventLikelihoods[intent], rng);
}

function getPendingDelivery(offer: ScenarioOffer, deliveryEvent: DeliveryEventId, useCounterTerms: boolean) {
  const promise = useCounterTerms ? offer.counter.promise : offer.promise;
  const turnsUntilDue = parseTurns(promise.timing);

  if (turnsUntilDue <= 1) {
    return undefined;
  }

  return {
    resourceId: promise.resourceId,
    amount: promise.amount,
    turnsUntilDue,
    willArrive: deliveryEvent !== "failedDelivery",
  };
}

export function resolveDecision(params: {
  choice: ResolutionChoice;
  offer: ScenarioOffer;
  resources: ForecastResourceState;
  belief: BeliefDistribution;
  seed: string;
}): ResolutionResult {
  const rng = makeRng(hashSeed(params.seed));

  if (params.choice === "reject") {
    return {
      dealCommitted: false,
      resources: params.resources,
      alignmentDelta: -3,
      summary: "Rejected. You avoid the immediate trade, but relations cool.",
    };
  }

  if (params.choice === "counter") {
    const counterRoll = rng();

    if (counterRoll > params.offer.counter.acceptanceChance) {
      const offended = rng() < params.offer.counter.stanceRisk;
      return {
        dealCommitted: false,
        resources: params.resources,
        alignmentDelta: offended ? -8 : -3,
        summary: offended
          ? "Counter rejected. The offer collapses and the leader takes offence."
          : "Counter rejected. The offer collapses without major incident.",
      };
    }

    const paid = withDelta(params.resources, params.offer.counter.ask.resourceId, -params.offer.counter.ask.amount);
    const deliveryEvent = sampleDeliveryEvent(params.offer, params.belief, rng);
    const pendingDelivery = getPendingDelivery(params.offer, deliveryEvent, true);
    const summary = pendingDelivery
      ? "Counter accepted. Roosevelt has committed to the revised delivery."
      : "Counter accepted. Roosevelt has held up his end.";

    return {
      dealCommitted: true,
      observedEvent: deliveryEvent,
      pendingDelivery,
      resources: pendingDelivery ? paid : applyImmediateDeliveryEvent(paid, params.offer, deliveryEvent, true),
      alignmentDelta: deliveryEvent === "deliveredNow" ? 4 : -2,
      summary,
    };
  }

  const paid = withDelta(params.resources, params.offer.ask.resourceId, -params.offer.ask.amount);
  const deliveryEvent = sampleDeliveryEvent(params.offer, params.belief, rng);
  const pendingDelivery = getPendingDelivery(params.offer, deliveryEvent, false);
  const summary = pendingDelivery
    ? "Accepted. Roosevelt has committed to the delivery."
    : "Accepted. Roosevelt has held up his end.";

  return {
    dealCommitted: true,
    observedEvent: deliveryEvent,
    pendingDelivery,
    resources: pendingDelivery ? paid : applyImmediateDeliveryEvent(paid, params.offer, deliveryEvent, false),
    alignmentDelta: deliveryEvent === "deliveredNow" ? 5 : -1,
    summary,
  };
}
