import {
  BeliefDistribution,
  DeliveryEventId,
  DeliveryEventLikelihoods,
  IntentId,
  IntentLikelihoods,
  normaliseBeliefs,
  ProfileId,
} from "./inference";
import { ResourceId, ScenarioOffer } from "./scenarios/uk1935";

export type ForecastResourceState = Record<ResourceId, number>;

export type ForecastResult = {
  rollouts: number;
  improvedChance: number;
  unchangedChance: number;
  lossChance: number;
  expectedPowerChange: number;
  p10: number;
  median: number;
  p90: number;
  catastrophicDownsideChance: number;
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

function powerScore(resources: ForecastResourceState) {
  return resources.manpower + resources.munitions * 10 + resources.industry * 5 + resources.morale * 2;
}

function withDelta(resources: ForecastResourceState, resourceId: ResourceId, delta: number): ForecastResourceState {
  return {
    ...resources,
    [resourceId]: Math.max(0, resources[resourceId] + delta),
  };
}

function resolveDeliveryEvent(resources: ForecastResourceState, offer: ScenarioOffer, deliveryEvent: DeliveryEventId) {
  let resolved = withDelta(resources, offer.ask.resourceId, -offer.ask.amount);

  if (deliveryEvent === "deliveredNow") {
    resolved = withDelta(resolved, offer.promise.resourceId, offer.promise.amount);
  }

  if (deliveryEvent === "failedDelivery") {
    resolved = withDelta(resolved, "morale", -8);
  }

  return resolved;
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) {
    throw new Error("Cannot calculate percentile for empty forecast results.");
  }

  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(percentileValue * (sortedValues.length - 1))));
  return sortedValues[index];
}

export function runOfferForecast(params: {
  offer: ScenarioOffer;
  resources: ForecastResourceState;
  belief: BeliefDistribution;
  intentLikelihoods: IntentLikelihoods;
  deliveryEventLikelihoods: DeliveryEventLikelihoods;
  seed: string;
  rollouts: number;
}): ForecastResult {
  const rng = makeRng(hashSeed(params.seed));
  const belief = normaliseBeliefs(params.belief);
  const startingPower = powerScore(params.resources);
  const deltas: number[] = [];
  let improved = 0;
  let unchanged = 0;
  let loss = 0;
  let catastrophic = 0;

  for (let index = 0; index < params.rollouts; index += 1) {
    // profile -> intent -> observed event, then record Δ power for the sampled path.
    const profile = sampleWeighted<ProfileId>(belief, rng);
    const intent = sampleWeighted<IntentId>(params.intentLikelihoods[profile], rng);
    const deliveryEvent = sampleWeighted<DeliveryEventId>(params.deliveryEventLikelihoods[intent], rng);
    const resolvedResources = resolveDeliveryEvent(params.resources, params.offer, deliveryEvent);
    const delta = powerScore(resolvedResources) - startingPower;

    deltas.push(delta);

    if (delta > 0) {
      improved += 1;
    } else if (delta < 0) {
      loss += 1;
    } else {
      unchanged += 1;
    }

    if (delta <= -750) {
      catastrophic += 1;
    }
  }

  deltas.sort((left, right) => left - right);

  return {
    rollouts: params.rollouts,
    improvedChance: improved / params.rollouts,
    unchangedChance: unchanged / params.rollouts,
    lossChance: loss / params.rollouts,
    expectedPowerChange: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
    p10: percentile(deltas, 0.1),
    median: percentile(deltas, 0.5),
    p90: percentile(deltas, 0.9),
    catastrophicDownsideChance: catastrophic / params.rollouts,
  };
}
