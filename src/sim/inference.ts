export type DeliveryEventId = "deliveredNow" | "claimsDelay" | "failedDelivery";
export type IntentId = "honestDelivery" | "honestDelay" | "betrayal";

export type ProfileId = "honestAlly" | "pragmaticAlly" | "opportunisticAlly" | "backstabber";

export type BeliefDistribution = Record<ProfileId, number>;

export type IntentLikelihoods = Record<ProfileId, Record<IntentId, number>>;
export type DeliveryEventLikelihoods = Record<IntentId, Record<DeliveryEventId, number>>;

export type DeliveryEstimate = {
  id: DeliveryEventId;
  label: string;
  probability: number;
  detail: string;
};

export const deliveryEventLabels: Record<DeliveryEventId, string> = {
  deliveredNow: "Delivered now",
  claimsDelay: "Claims delay",
  failedDelivery: "Failure risk",
};

export function normaliseBeliefs(distribution: BeliefDistribution): BeliefDistribution {
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error("Cannot normalise an empty belief distribution.");
  }

  return {
    honestAlly: distribution.honestAlly / total,
    pragmaticAlly: distribution.pragmaticAlly / total,
    opportunisticAlly: distribution.opportunisticAlly / total,
    backstabber: distribution.backstabber / total,
  };
}

function estimateDeliveryEventForProfile(
  profileId: ProfileId,
  intentLikelihoods: IntentLikelihoods,
  deliveryEventLikelihoods: DeliveryEventLikelihoods,
  deliveryEventId: DeliveryEventId,
) {
  return (Object.keys(intentLikelihoods[profileId]) as IntentId[]).reduce((sum, intentId) => {
    return sum + intentLikelihoods[profileId][intentId] * deliveryEventLikelihoods[intentId][deliveryEventId];
  }, 0);
}

// P(event | observed history) = Σ P(event | intent) P(intent | profile) P(profile | observed history)
export function estimateDeliveryEventsFromHistory(
  observedHistoryPrior: BeliefDistribution,
  intentLikelihoods: IntentLikelihoods,
  deliveryEventLikelihoods: DeliveryEventLikelihoods,
  confidence: string,
): DeliveryEstimate[] {
  const prior = normaliseBeliefs(observedHistoryPrior);

  return (["deliveredNow", "claimsDelay", "failedDelivery"] as DeliveryEventId[]).map((deliveryEventId) => {
    const probability = (Object.keys(prior) as ProfileId[]).reduce((sum, profileId) => {
      return (
        sum +
        prior[profileId] *
          estimateDeliveryEventForProfile(profileId, intentLikelihoods, deliveryEventLikelihoods, deliveryEventId)
      );
    }, 0);

    return {
      id: deliveryEventId,
      label: deliveryEventLabels[deliveryEventId],
      probability,
      detail: confidence,
    };
  });
}

// Bayes update: P(profile | observed event) ∝ P(observed event | profile) P(profile)
export function updateBeliefFromObservedDeliveryEvent(
  currentBelief: BeliefDistribution,
  intentLikelihoods: IntentLikelihoods,
  deliveryEventLikelihoods: DeliveryEventLikelihoods,
  observedEvent: DeliveryEventId,
): BeliefDistribution {
  const prior = normaliseBeliefs(currentBelief);

  return normaliseBeliefs({
    honestAlly:
      prior.honestAlly *
      estimateDeliveryEventForProfile("honestAlly", intentLikelihoods, deliveryEventLikelihoods, observedEvent),
    pragmaticAlly:
      prior.pragmaticAlly *
      estimateDeliveryEventForProfile("pragmaticAlly", intentLikelihoods, deliveryEventLikelihoods, observedEvent),
    opportunisticAlly:
      prior.opportunisticAlly *
      estimateDeliveryEventForProfile("opportunisticAlly", intentLikelihoods, deliveryEventLikelihoods, observedEvent),
    backstabber:
      prior.backstabber *
      estimateDeliveryEventForProfile("backstabber", intentLikelihoods, deliveryEventLikelihoods, observedEvent),
  });
}

export function formatProbability(probability: number) {
  return `${Math.round(probability * 100)}%`;
}
