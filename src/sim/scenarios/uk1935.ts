import { BeliefDistribution, DeliveryEventLikelihoods, IntentLikelihoods } from "../inference";

export type ResourceId = "manpower" | "munitions" | "industry" | "morale" | "intel" | "forecasts";

export type LeaderId = "roosevelt" | "hitler" | "stalin" | "mussolini" | "hirohito";

export type ResourceTone = "blue" | "green" | "amber" | "red" | "slate";

export type HistoricalBasis = {
  actual: string;
  unit: string;
  basis: string;
  confidence: "high" | "medium" | "low";
  sources: string[];
};

export type ResourceConfig = {
  id: ResourceId;
  label: string;
  value: number;
  max?: number;
  tone: ResourceTone;
  historical: HistoricalBasis;
};

export type LeaderConfig = {
  id: LeaderId;
  name: string;
  stance: string;
  initials: string;
};

export type OfferTerm = {
  resourceId: ResourceId;
  amount: number;
  timing?: string;
};

export type ScenarioOffer = {
  id: string;
  turn: number;
  leaderId: LeaderId;
  title: string;
  apparentProfile: string;
  ask: OfferTerm;
  promise: OfferTerm;
  statedIntent: string;
  counter: {
    ask: OfferTerm;
    promise: OfferTerm;
    acceptanceChance: number;
    dealCollapseChance: number;
    stanceRisk: number;
    upside: string;
    note: string;
  };
  observedHistoryPrior: BeliefDistribution;
  intelAdjustedPrior: BeliefDistribution;
  intentLikelihoods: IntentLikelihoods;
  deliveryEventLikelihoods: DeliveryEventLikelihoods;
};

export type ScenarioConfig = {
  id: string;
  title: string;
  seedLabel: string;
  resources: ResourceConfig[];
  leaders: LeaderConfig[];
  offers: ScenarioOffer[];
};

const sources = {
  rafPersonnel: "https://en.wikipedia.org/wiki/Personnel_numbers_in_the_Royal_Air_Force",
  britishArmy: "https://en.wikipedia.org/wiki/British_Army",
  royalNavy: "https://en.wikipedia.org/wiki/Royal_Navy",
  britishTanks: "https://en.wikipedia.org/wiki/Tanks_in_the_British_Army",
  rearmament: "https://en.wikipedia.org/wiki/British_rearmament_before_World_War_II",
};

export const uk1935Scenario: ScenarioConfig = {
  id: "uk-1935",
  title: "Strategic Deception Simulator",
  seedLabel: "UK-1935-A",
  resources: [
    {
      id: "manpower",
      label: "Manpower",
      value: 3200,
      tone: "blue",
      historical: {
        actual: "roughly 320,000 active personnel",
        unit: "personnel",
        basis:
          "Regular Army plus Royal Navy and RAF strength around the early rearmament period. This is normalised at roughly 100 personnel per in-game manpower point.",
        confidence: "medium",
        sources: [sources.britishArmy, sources.rafPersonnel, sources.royalNavy],
      },
    },
    {
      id: "munitions",
      label: "Munitions",
      value: 145,
      tone: "green",
      historical: {
        actual: "major aircraft, tank/armoured vehicle, and naval vessel stock normalised into one equipment pool",
        unit: "weighted equipment index",
        basis:
          "Broad equipment strength, not literal shells. Aircraft, tanks/armoured vehicles, and naval vessels are weighted into a single readable game resource because raw units are not comparable.",
        confidence: "low",
        sources: [sources.royalNavy, sources.britishTanks, sources.rearmament],
      },
    },
    {
      id: "industry",
      label: "Industry",
      value: 68,
      max: 100,
      tone: "amber",
      historical: {
        actual: "early rearmament industrial capacity",
        unit: "capacity index",
        basis:
          "An index rather than a direct historical count. Britain had begun rearmament and shadow-factory planning, but full wartime mobilisation had not occurred.",
        confidence: "medium",
        sources: [sources.rearmament],
      },
    },
    {
      id: "morale",
      label: "Morale",
      value: 74,
      max: 100,
      tone: "slate",
      historical: {
        actual: "pre-war public and political resolve index",
        unit: "morale index",
        basis:
          "Gameplay abstraction for domestic confidence, political will, and institutional readiness during the appeasement/rearmament period.",
        confidence: "low",
        sources: [sources.rearmament],
      },
    },
    {
      id: "intel",
      label: "Intel",
      value: 3,
      tone: "red",
      historical: {
        actual: "scarce intelligence attention",
        unit: "action credits",
        basis: "Gameplay resource. Not intended as a historical agency headcount.",
        confidence: "low",
        sources: [],
      },
    },
    {
      id: "forecasts",
      label: "Forecasts",
      value: 2,
      tone: "blue",
      historical: {
        actual: "scarce analytical capacity",
        unit: "action credits",
        basis: "Gameplay resource representing limited staff time for quantitative scenario analysis.",
        confidence: "low",
        sources: [],
      },
    },
  ],
  leaders: [
    { id: "roosevelt", name: "Roosevelt", stance: "Measured ally", initials: "FR" },
    { id: "hitler", name: "Hitler", stance: "Expansionist aggressor", initials: "AH" },
    { id: "stalin", name: "Stalin", stance: "Ideological rival", initials: "JS" },
    { id: "mussolini", name: "Mussolini", stance: "Fascist opportunist", initials: "BM" },
    { id: "hirohito", name: "Hirohito", stance: "Strategic wildcard", initials: "SH" },
  ],
  offers: [
    {
      id: "roosevelt-support-package",
      turn: 1,
      leaderId: "roosevelt",
      title: "Roosevelt's support package",
      apparentProfile: "Measured ally",
      ask: { resourceId: "manpower", amount: 500 },
      promise: { resourceId: "munitions", amount: 200, timing: "in 2 turns" },
      statedIntent: "Reinforce your European defence before the next escalation window.",
      counter: {
        ask: { resourceId: "manpower", amount: 350 },
        promise: { resourceId: "munitions", amount: 200, timing: "in 2 turns" },
        acceptanceChance: 0.62,
        dealCollapseChance: 0.2,
        stanceRisk: 0.18,
        upside: "You keep 150 more manpower while preserving the promised delivery.",
        note: "Lower exposure, same promised delivery, and a meaningful chance the deal collapses.",
      },
      observedHistoryPrior: {
        honestAlly: 0.58,
        pragmaticAlly: 0.27,
        opportunisticAlly: 0.11,
        backstabber: 0.04,
      },
      intelAdjustedPrior: {
        honestAlly: 0.48,
        pragmaticAlly: 0.31,
        opportunisticAlly: 0.15,
        backstabber: 0.06,
      },
      intentLikelihoods: {
        honestAlly: { honestDelivery: 0.78, honestDelay: 0.18, betrayal: 0.04 },
        pragmaticAlly: { honestDelivery: 0.55, honestDelay: 0.34, betrayal: 0.11 },
        opportunisticAlly: { honestDelivery: 0.35, honestDelay: 0.42, betrayal: 0.23 },
        backstabber: { honestDelivery: 0.12, honestDelay: 0.26, betrayal: 0.62 },
      },
      deliveryEventLikelihoods: {
        honestDelivery: { deliveredNow: 0.92, claimsDelay: 0.06, failedDelivery: 0.02 },
        honestDelay: { deliveredNow: 0.04, claimsDelay: 0.88, failedDelivery: 0.08 },
        betrayal: { deliveredNow: 0.03, claimsDelay: 0.58, failedDelivery: 0.39 },
      },
    },
    {
      id: "roosevelt-naval-convoy",
      turn: 2,
      leaderId: "roosevelt",
      title: "Roosevelt's naval convoy proposal",
      apparentProfile: "Measured ally",
      ask: { resourceId: "industry", amount: 10 },
      promise: { resourceId: "munitions", amount: 120, timing: "in 1 turn" },
      statedIntent: "Divert shipyard capacity now for a safer Atlantic supply route later.",
      counter: {
        ask: { resourceId: "industry", amount: 6 },
        promise: { resourceId: "munitions", amount: 120, timing: "in 1 turn" },
        acceptanceChance: 0.54,
        dealCollapseChance: 0.28,
        stanceRisk: 0.22,
        upside: "You preserve industrial capacity while keeping the full convoy promise.",
        note: "Better downside control, but the counter is easier for Roosevelt to refuse.",
      },
      observedHistoryPrior: {
        honestAlly: 0.58,
        pragmaticAlly: 0.27,
        opportunisticAlly: 0.11,
        backstabber: 0.04,
      },
      intelAdjustedPrior: {
        honestAlly: 0.5,
        pragmaticAlly: 0.3,
        opportunisticAlly: 0.14,
        backstabber: 0.06,
      },
      intentLikelihoods: {
        honestAlly: { honestDelivery: 0.74, honestDelay: 0.22, betrayal: 0.04 },
        pragmaticAlly: { honestDelivery: 0.5, honestDelay: 0.38, betrayal: 0.12 },
        opportunisticAlly: { honestDelivery: 0.3, honestDelay: 0.44, betrayal: 0.26 },
        backstabber: { honestDelivery: 0.1, honestDelay: 0.28, betrayal: 0.62 },
      },
      deliveryEventLikelihoods: {
        honestDelivery: { deliveredNow: 0.88, claimsDelay: 0.1, failedDelivery: 0.02 },
        honestDelay: { deliveredNow: 0.03, claimsDelay: 0.9, failedDelivery: 0.07 },
        betrayal: { deliveredNow: 0.02, claimsDelay: 0.6, failedDelivery: 0.38 },
      },
    },
    {
      id: "roosevelt-intelligence-exchange",
      turn: 3,
      leaderId: "roosevelt",
      title: "Roosevelt's intelligence exchange",
      apparentProfile: "Measured ally",
      ask: { resourceId: "intel", amount: 1 },
      promise: { resourceId: "morale", amount: 12, timing: "in 1 turn" },
      statedIntent: "Share sensitive reports to steady public confidence before the next crisis.",
      counter: {
        ask: { resourceId: "intel", amount: 1 },
        promise: { resourceId: "morale", amount: 16, timing: "in 1 turn" },
        acceptanceChance: 0.48,
        dealCollapseChance: 0.32,
        stanceRisk: 0.26,
        upside: "You demand a stronger public assurance for the same intelligence cost.",
        note: "The counter has better upside, but it risks looking like pressure rather than partnership.",
      },
      observedHistoryPrior: {
        honestAlly: 0.58,
        pragmaticAlly: 0.27,
        opportunisticAlly: 0.11,
        backstabber: 0.04,
      },
      intelAdjustedPrior: {
        honestAlly: 0.46,
        pragmaticAlly: 0.33,
        opportunisticAlly: 0.15,
        backstabber: 0.06,
      },
      intentLikelihoods: {
        honestAlly: { honestDelivery: 0.7, honestDelay: 0.25, betrayal: 0.05 },
        pragmaticAlly: { honestDelivery: 0.48, honestDelay: 0.38, betrayal: 0.14 },
        opportunisticAlly: { honestDelivery: 0.28, honestDelay: 0.43, betrayal: 0.29 },
        backstabber: { honestDelivery: 0.08, honestDelay: 0.3, betrayal: 0.62 },
      },
      deliveryEventLikelihoods: {
        honestDelivery: { deliveredNow: 0.84, claimsDelay: 0.13, failedDelivery: 0.03 },
        honestDelay: { deliveredNow: 0.03, claimsDelay: 0.86, failedDelivery: 0.11 },
        betrayal: { deliveredNow: 0.02, claimsDelay: 0.56, failedDelivery: 0.42 },
      },
    },
  ],
};
