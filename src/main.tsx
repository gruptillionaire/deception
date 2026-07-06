import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ForecastResult, runOfferForecast } from "./sim/forecast";
import {
  BeliefDistribution,
  estimateDeliveryEventsFromHistory,
  formatProbability,
  updateBeliefFromObservedDeliveryEvent,
} from "./sim/inference";
import { LeaderId, ResourceId, ScenarioOffer, uk1935Scenario } from "./sim/scenarios/uk1935";
import { resolveDecision, ResolutionChoice } from "./sim/resolveDecision";
import { playUiClick, playUiHover } from "./uiAudio";
import ovalOfficeBackground from "../assets/oval office.png";
import rooseveltSprite from "../assets/roosavelt.png";

type Choice = "accept" | "reject" | "counter" | "advisorIntel" | "counterIntel" | "forecast";

type ResourceState = Record<ResourceId, number>;
type RevealedOfferState = Record<string, true>;
type DecisionState = {
  offerId: string;
  choice: ResolutionChoice;
  summary: string;
  termsSummary?: string;
  pendingSummary?: string;
};
type PendingSchedule = {
  id: string;
  offerId: string;
  leaderId: LeaderId;
  leaderName: string;
  resourceId: ResourceId;
  amount: number;
  turnsRemaining: number;
  willArrive: boolean;
};
type DeliveryNotice = {
  id: string;
  kind: "success" | "failure";
  summary: string;
};
type ForecastState = Record<string, ForecastResult>;
type LeaderBeliefState = Partial<Record<LeaderId, BeliefDistribution>>;
type AlignmentState = Record<LeaderId, number>;

const actionText: Record<Choice, string> = {
  accept: "Offer accepted. The true outcome will resolve later.",
  reject: "Offer rejected. Relations cool, but your immediate position stays intact.",
  counter: "Counteroffer drafted. You reduce exposure, but the leader may walk away.",
  advisorIntel: "Advisor intelligence requested. Confidence improves and the estimate narrows.",
  counterIntel: "Counter intelligence requested. Counteroffer risk is now visible.",
  forecast: "Monte Carlo forecast queued. You spend one forecast credit to estimate outcome spread.",
};

function buildInitialResources(): ResourceState {
  return uk1935Scenario.resources.reduce((state, resource) => {
    state[resource.id] = resource.value;
    return state;
  }, {} as ResourceState);
}

function buildInitialLeaderBeliefs(): LeaderBeliefState {
  return uk1935Scenario.offers.reduce((state, offer) => {
    state[offer.leaderId] = offer.observedHistoryPrior;
    return state;
  }, {} as LeaderBeliefState);
}

function buildInitialAlignment(): AlignmentState {
  return uk1935Scenario.leaders.reduce((state, leader) => {
    state[leader.id] = 50;
    return state;
  }, {} as AlignmentState);
}

function getLeader(offer: ScenarioOffer) {
  const leader = uk1935Scenario.leaders.find((candidate) => candidate.id === offer.leaderId);
  if (!leader) {
    throw new Error(`Scenario offer references missing leader '${offer.leaderId}'.`);
  }
  return leader;
}

const resourceById = new Map(uk1935Scenario.resources.map((resource) => [resource.id, resource]));

function parseTurns(timing: string | undefined) {
  if (!timing) {
    return 0;
  }

  const match = timing.match(/\d+/);
  if (!match) {
    throw new Error(`Term timing does not include a turn count: '${timing}'.`);
  }

  return Number(match[0]);
}

function formatTerm(resourceId: ResourceId, amount: number, timing?: string) {
  const resource = resourceById.get(resourceId);
  if (!resource) {
    throw new Error(`Offer term references missing resource '${resourceId}'.`);
  }

  const turnsUntilDue = parseTurns(timing);
  const suffix = turnsUntilDue > 1 ? ` ${timing}` : "";
  return `${amount} ${resource.label.toLowerCase()}${suffix}`;
}

function getBelief(beliefs: LeaderBeliefState, leaderId: LeaderId) {
  const belief = beliefs[leaderId];
  if (!belief) {
    throw new Error(`Missing belief state for leader '${leaderId}'.`);
  }
  return belief;
}

function buildForecastFromBelief(
  offer: ScenarioOffer,
  resources: ResourceState,
  belief: BeliefDistribution,
  gameSeed: string,
  seedSuffix: string,
) {
  return runOfferForecast({
    offer,
    resources,
    belief,
    intentLikelihoods: offer.intentLikelihoods,
    deliveryEventLikelihoods: offer.deliveryEventLikelihoods,
    seed: `${gameSeed}:${offer.id}:${resources.forecasts}:${seedSuffix}`,
    rollouts: 5000,
  });
}

function formatPendingDelivery(resourceId: ResourceId, amount: number, turnsUntilDue: number) {
  const resource = resourceById.get(resourceId);
  if (!resource) {
    throw new Error(`Pending delivery references missing resource '${resourceId}'.`);
  }

  return `${amount} ${resource.label.toLowerCase()} scheduled in ${turnsUntilDue} turns.`;
}

function formatSchedule(schedule: PendingSchedule) {
  const resource = resourceById.get(schedule.resourceId);
  if (!resource) {
    throw new Error(`Schedule references missing resource '${schedule.resourceId}'.`);
  }

  return `${schedule.amount} ${resource.label.toLowerCase()} arriving in ${schedule.turnsRemaining} turns from ${schedule.leaderName}`;
}

function formatDeliveryNotice(schedule: PendingSchedule) {
  const resource = resourceById.get(schedule.resourceId);
  if (!resource) {
    throw new Error(`Schedule references missing resource '${schedule.resourceId}'.`);
  }

  const resourceText = `${schedule.amount} ${resource.label.toLowerCase()}`;
  return schedule.willArrive
    ? `Your ${resourceText} from ${schedule.leaderName} has arrived successfully.`
    : `Your ${resourceText} from ${schedule.leaderName} has not arrived.`;
}

function formatCommittedTerms(offer: ScenarioOffer, choice: ResolutionChoice) {
  if (choice === "reject") {
    return undefined;
  }

  const ask = choice === "counter" ? offer.counter.ask : offer.ask;
  const promise = choice === "counter" ? offer.counter.promise : offer.promise;
  return `Committed terms: paid ${formatTerm(ask.resourceId, ask.amount, ask.timing)} for ${formatTerm(
    promise.resourceId,
    promise.amount,
    promise.timing,
  )}.`;
}

function makeRng(seed: number) {
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

function buildGameSeed() {
  const value = Math.floor(Math.random() * 0xffffff);
  return `UK-${value.toString(16).toUpperCase().padStart(6, "0")}`;
}

function buildTimeline(gameSeed: string) {
  const rng = makeRng(hashSeed(`${gameSeed}:timeline`));
  const timeline = [...uk1935Scenario.offers];

  for (let index = timeline.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [timeline[index], timeline[swapIndex]] = [timeline[swapIndex], timeline[index]];
  }

  return timeline;
}

function App() {
  const [selected, setSelected] = useState<Choice | null>(null);
  const [gameSeed] = useState(() => buildGameSeed());
  const [timeline, setTimeline] = useState<ScenarioOffer[]>(() => buildTimeline(gameSeed));
  const [completedEvents, setCompletedEvents] = useState(0);
  const [resources, setResources] = useState<ResourceState>(() => buildInitialResources());
  const [advisorIntelRevealed, setAdvisorIntelRevealed] = useState<RevealedOfferState>({});
  const [counterIntelRevealed, setCounterIntelRevealed] = useState<RevealedOfferState>({});
  const [forecastRevealed, setForecastRevealed] = useState<RevealedOfferState>({});
  const [forecasts, setForecasts] = useState<ForecastState>({});
  const [decision, setDecision] = useState<DecisionState | null>(null);
  const [pendingSchedules, setPendingSchedules] = useState<PendingSchedule[]>([]);
  const [deliveryNotices, setDeliveryNotices] = useState<DeliveryNotice[]>([]);
  const [leaderBeliefs, setLeaderBeliefs] = useState<LeaderBeliefState>(() => buildInitialLeaderBeliefs());
  const [alignment, setAlignment] = useState<AlignmentState>(() => buildInitialAlignment());

  const offer = timeline[0] ?? uk1935Scenario.offers[0];
  const leader = useMemo(() => getLeader(offer), [offer]);
  const offerAdvisorIntelRevealed = Boolean(advisorIntelRevealed[offer.id]);
  const offerCounterIntelRevealed = Boolean(counterIntelRevealed[offer.id]);
  const offerForecastRevealed = Boolean(forecastRevealed[offer.id]);
  const forecast = forecasts[offer.id];
  const currentBelief = getBelief(leaderBeliefs, offer.leaderId);
  const decisionCommitted = decision?.offerId === offer.id;
  const noEventsLeft = timeline.length === 0;
  const defeated = resources.manpower <= 0 || resources.morale <= 0;
  const gameEnded = noEventsLeft || defeated;
  const canSpendAdvisorIntel = resources.intel > 0 && !offerAdvisorIntelRevealed && !decisionCommitted;
  const canSpendCounterIntel = resources.intel > 0 && !offerCounterIntelRevealed && !decisionCommitted;
  const canSpendForecast = resources.forecasts > 0 && !offerForecastRevealed && !decisionCommitted;

  const estimate = useMemo(() => {
    const confidence = offerAdvisorIntelRevealed ? "medium confidence" : "history-weighted prior";
    return estimateDeliveryEventsFromHistory(
      currentBelief,
      offer.intentLikelihoods,
      offer.deliveryEventLikelihoods,
      confidence,
    );
  }, [currentBelief, offerAdvisorIntelRevealed, offer.intentLikelihoods, offer.deliveryEventLikelihoods]);

  function updateResource(resourceId: ResourceId, delta: number) {
    const resourceConfig = resourceById.get(resourceId);
    if (!resourceConfig) {
      throw new Error(`Tried to update missing resource '${resourceId}'.`);
    }

    setResources((current) => {
      const nextValue = Math.max(0, current[resourceId] + delta);
      return {
        ...current,
        [resourceId]: resourceConfig.max ? Math.min(resourceConfig.max, nextValue) : nextValue,
      };
    });
  }

  function applyAlignmentDelta(leaderId: LeaderId, delta: number) {
    setAlignment((current) => ({
      ...current,
      [leaderId]: Math.max(0, Math.min(100, current[leaderId] + delta)),
    }));
  }

  function commitDecision(choice: ResolutionChoice) {
    setDeliveryNotices([]);

    const resolution = resolveDecision({
      choice,
      offer,
      resources,
      belief: currentBelief,
      seed: `${gameSeed}:${offer.id}:${choice}`,
    });

    setResources(resolution.resources);
    applyAlignmentDelta(offer.leaderId, resolution.alignmentDelta);

    const pendingSummary = resolution.pendingDelivery
      ? formatPendingDelivery(
          resolution.pendingDelivery.resourceId,
          resolution.pendingDelivery.amount,
          resolution.pendingDelivery.turnsUntilDue,
        )
      : undefined;

    if (pendingSummary) {
      const pending = resolution.pendingDelivery;
      if (!pending) {
        throw new Error("Pending summary exists without pending delivery state.");
      }

      setPendingSchedules((current) => [
        ...current,
        {
          id: `${offer.id}:${choice}`,
          offerId: offer.id,
          leaderId: offer.leaderId,
          leaderName: leader.name,
          resourceId: pending.resourceId,
          amount: pending.amount,
          turnsRemaining: pending.turnsUntilDue,
          willArrive: pending.willArrive,
        },
      ]);
    }

    setDecision({
      offerId: offer.id,
      choice,
      summary: resolution.summary,
      termsSummary: resolution.dealCommitted ? formatCommittedTerms(offer, choice) : undefined,
      pendingSummary,
    });
    setSelected(choice);
  }

  function continueTimeline() {
    if (!decisionCommitted) {
      return;
    }

    const remainingSchedules: PendingSchedule[] = [];
    const dueSchedules: PendingSchedule[] = [];

    for (const schedule of pendingSchedules) {
      const updated = {
        ...schedule,
        turnsRemaining: schedule.turnsRemaining - 1,
      };

      if (updated.turnsRemaining <= 0) {
        dueSchedules.push(updated);
      } else {
        remainingSchedules.push(updated);
      }
    }

    setPendingSchedules(remainingSchedules);

    if (dueSchedules.length > 0) {
      setDeliveryNotices(
        dueSchedules.map((schedule) => ({
          id: `${schedule.id}:notice:${completedEvents + 1}`,
          kind: schedule.willArrive ? "success" : "failure",
          summary: formatDeliveryNotice(schedule),
        })),
      );

      for (const schedule of dueSchedules) {
        if (schedule.willArrive) {
          updateResource(schedule.resourceId, schedule.amount);
        }
      }

      setLeaderBeliefs((current) => {
        const next = { ...current };

        for (const schedule of dueSchedules) {
          const sourceOffer = uk1935Scenario.offers.find((candidate) => candidate.id === schedule.offerId);
          if (!sourceOffer) {
            throw new Error(`Schedule references missing offer '${schedule.offerId}'.`);
          }

          next[schedule.leaderId] = updateBeliefFromObservedDeliveryEvent(
            getBelief(next, schedule.leaderId),
            sourceOffer.intentLikelihoods,
            sourceOffer.deliveryEventLikelihoods,
            schedule.willArrive ? "deliveredNow" : "failedDelivery",
          );
        }

        return next;
      });
    } else {
      setDeliveryNotices([]);
    }

    setTimeline((current) => current.slice(1));
    setCompletedEvents((current) => current + 1);
    setDecision(null);
    setSelected(null);
  }

  function choose(choice: Choice) {
    if (gameEnded) {
      return;
    }

    if (choice === "advisorIntel") {
      if (!canSpendAdvisorIntel) {
        return;
      }
      updateResource("intel", -1);
      setAdvisorIntelRevealed((current) => ({ ...current, [offer.id]: true }));
      setLeaderBeliefs((current) => ({
        ...current,
        [offer.leaderId]: offer.intelAdjustedPrior,
      }));
      if (offerForecastRevealed) {
        setForecasts((current) => ({
          ...current,
          [offer.id]: buildForecastFromBelief(offer, resources, offer.intelAdjustedPrior, gameSeed, "advisor-intel"),
        }));
      }
      setSelected(choice);
      return;
    }

    if (choice === "counterIntel") {
      if (!canSpendCounterIntel) {
        return;
      }
      updateResource("intel", -1);
      setCounterIntelRevealed((current) => ({ ...current, [offer.id]: true }));
      setSelected(choice);
      return;
    }

    if (choice === "forecast") {
      if (!canSpendForecast) {
        return;
      }
      updateResource("forecasts", -1);
      setForecasts((current) => ({
        ...current,
        [offer.id]: buildForecastFromBelief(
          offer,
          resources,
          currentBelief,
          gameSeed,
          offerAdvisorIntelRevealed ? "advisor-intel" : "history",
        ),
      }));
      setForecastRevealed((current) => ({ ...current, [offer.id]: true }));
      setSelected(choice);
      return;
    }

    if (decisionCommitted) {
      return;
    }

    if (choice === "accept") {
      commitDecision(choice);
      return;
    }

    if (choice === "reject") {
      commitDecision(choice);
      return;
    }

    if (choice === "counter") {
      commitDecision(choice);
      return;
    }
  }

  function buttonAudioProps() {
    return {
      onMouseEnter: playUiHover,
      onClickCapture: playUiClick,
    };
  }

  return (
    <main className="app-shell">
      <img className="scene-background" src={ovalOfficeBackground} alt="" aria-hidden="true" />
      <img className="scene-leader" src={rooseveltSprite} alt="" aria-hidden="true" />
      <section className="topbar">
        <div>
          <p className="eyebrow">{uk1935Scenario.title}</p>
          <h1>Turn {completedEvents + 1}: {gameEnded ? "End state" : offer.title}</h1>
        </div>
        <div className="status-pill">Seed {gameSeed}</div>
      </section>

      <section className="timeline-strip" aria-label="Event timeline">
        {uk1935Scenario.offers.map((candidate) => {
          const isActive = !gameEnded && candidate.id === offer.id;
          const isRemaining = timeline.some((queuedOffer) => queuedOffer.id === candidate.id);
          return (
            <div className={isActive ? "timeline-node active" : "timeline-node"} key={candidate.id}>
              <strong>{candidate.title}</strong>
              <span>{isActive ? "Current" : isRemaining ? "Queued" : "Resolved"}</span>
            </div>
          );
        })}
      </section>

      <section className="layout">
        <aside className="panel resources-panel" aria-label="Resources">
          <h2>Position</h2>
          <div className="resource-grid">
            {uk1935Scenario.resources.map((resource) => (
              <div className={`resource-card ${resource.tone}`} key={resource.id} onMouseEnter={playUiHover}>
                <span>{resource.label}</span>
                <strong>{resources[resource.id]}</strong>
                {resource.max ? <div className="meter"><i style={{ width: `${resources[resource.id]}%` }} /></div> : null}
              </div>
            ))}
          </div>
        </aside>

        <section className="panel offer-panel">
          {gameEnded ? (
            <div className="end-panel">
              <h2>{defeated ? "Government position collapsed" : "No diplomatic events remain"}</h2>
              <p>
                {defeated
                  ? "Your position has fallen below the minimum threshold needed to keep negotiating."
                  : "The current Roosevelt timeline has been exhausted. Later passes can add other leaders and escalation events."}
              </p>
            </div>
          ) : (
            <>
              <div className="leader-row">
            <div className="portrait">
              <img src={rooseveltSprite} alt="Roosevelt" />
            </div>
            <div>
              <p className="eyebrow">Incoming offer</p>
              <h2>{leader.name}</h2>
              <p className="subtle">
                {offer.apparentProfile} / Alignment {alignment[offer.leaderId]}
              </p>
            </div>
              </div>

              <div className="leader-strip" aria-label="Active leaders">
            {uk1935Scenario.leaders.map((candidate) => (
              <div
                className={candidate.id === offer.leaderId ? "leader-chip active" : "leader-chip"}
                key={candidate.id}
                onMouseEnter={playUiHover}
              >
                <strong>{candidate.name}</strong>
                <span>{candidate.stance}</span>
              </div>
            ))}
              </div>

              <div className="offer-card">
            <div>
              <span>You give</span>
              <strong>{formatTerm(offer.ask.resourceId, offer.ask.amount, offer.ask.timing)}</strong>
            </div>
            <div>
              <span>They promise</span>
              <strong>{formatTerm(offer.promise.resourceId, offer.promise.amount, offer.promise.timing)}</strong>
            </div>
              </div>

              {(pendingSchedules.length > 0 || deliveryNotices.length > 0) && !decisionCommitted ? (
                <div className="schedule-board" aria-label="Pending deliveries">
                  <h3>Schedule</h3>
                  {deliveryNotices.map((notice) => (
                    <p className={`arrival-line ${notice.kind}`} key={notice.id}>{notice.summary}</p>
                  ))}
                  {pendingSchedules.map((pending) => (
                    <p className="pending-line" key={pending.id}>{formatSchedule(pending)}</p>
                  ))}
                </div>
              ) : null}

              <p className="briefing">{offer.statedIntent}</p>

              <div className="button-grid">
            <button
              {...buttonAudioProps()}
              className={selected === "accept" ? "active" : ""}
              disabled={decisionCommitted}
              onClick={() => choose("accept")}
            >
              Accept
            </button>
            <button
              {...buttonAudioProps()}
              className={selected === "reject" ? "active" : ""}
              disabled={decisionCommitted}
              onClick={() => choose("reject")}
            >
              Reject
            </button>
            <button
              {...buttonAudioProps()}
              className={selected === "counter" ? "active" : ""}
              disabled={decisionCommitted}
              onClick={() => choose("counter")}
            >
              Counter
            </button>
            <button
              {...buttonAudioProps()}
              className={selected === "advisorIntel" ? "active" : ""}
              disabled={!canSpendAdvisorIntel}
              onClick={() => choose("advisorIntel")}
            >
              Advisor Intel
            </button>
            <button
              {...buttonAudioProps()}
              className={selected === "counterIntel" ? "active" : ""}
              disabled={!canSpendCounterIntel}
              onClick={() => choose("counterIntel")}
            >
              Counter Intel
            </button>
            <button
              {...buttonAudioProps()}
              className={selected === "forecast" ? "active" : ""}
              disabled={!canSpendForecast}
              onClick={() => choose("forecast")}
            >
              Run Forecast
            </button>
              </div>

              {decision?.offerId === offer.id ? (
            <div className="decision-result">
              <p className="result-line">{decision.summary}</p>
              {decision.termsSummary ? <p className="terms-line">{decision.termsSummary}</p> : null}
              {decision.pendingSummary ? <p className="pending-line">{decision.pendingSummary}</p> : null}
              <button {...buttonAudioProps()} className="continue-button" onClick={continueTimeline}>
                Continue
              </button>
            </div>
              ) : selected ? (
            <p className="result-line">{actionText[selected]}</p>
              ) : null}

              <div className={`counter-intel-box ${offerCounterIntelRevealed ? "revealed" : ""}`}>
            <h3>Counteroffer Read</h3>
            <p className="formula-note">E[counter] = P(accept) * E(deal) - P(refusal) * cost</p>
            {offerCounterIntelRevealed ? (
              <div className="counter-intel-grid">
                <div>
                  <span>Upside</span>
                  <strong>{offer.counter.upside}</strong>
                </div>
                <div>
                  <span>Acceptance chance</span>
                  <strong>{Math.round(offer.counter.acceptanceChance * 100)}%</strong>
                </div>
                <div>
                  <span>Refusal chance</span>
                  <strong>{Math.round(offer.counter.dealCollapseChance * 100)}%</strong>
                </div>
                <div>
                  <span>Offence on refusal</span>
                  <strong>{Math.round(offer.counter.stanceRisk * 100)}%</strong>
                </div>
              </div>
            ) : (
              <p>
                Spend counter intel to estimate upside, refusal risk, acceptance chance, and offence risk if refused.
                Betrayal is separate: it happens only after a deal is accepted.
              </p>
            )}
              </div>
            </>
          )}
        </section>

        <aside className="panel intel-panel">
          <h2>Advisor Estimate</h2>
          <p className="formula-note">P(event | observed history)</p>
          <div className="estimate-list">
            {estimate.map((row) => (
              <div className="estimate-row" key={row.id}>
                <span>{row.label}</span>
                <strong>{formatProbability(row.probability)}</strong>
                <em>{row.detail}</em>
              </div>
            ))}
          </div>

          <div className={`forecast-box ${offerForecastRevealed ? "revealed" : ""}`}>
            <h3>Monte Carlo Forecast</h3>
            <p className="formula-note">EV = mean(delta power), tail = P(delta power &lt;= threshold)</p>
            {offerForecastRevealed && forecast ? (
              <>
                <p>
                  {forecast.rollouts.toLocaleString()} rollouts: {formatProbability(forecast.improvedChance)} improved
                  position, {formatProbability(forecast.unchangedChance)} no material change,{" "}
                  {formatProbability(forecast.lossChance)} strategic loss.
                </p>
                <p>
                  Expected power change: {Math.round(forecast.expectedPowerChange).toLocaleString()}. P10:{" "}
                  {Math.round(forecast.p10).toLocaleString()}. Median: {Math.round(forecast.median).toLocaleString()}.
                  P90: {Math.round(forecast.p90).toLocaleString()}.
                </p>
                <p>Catastrophic downside chance: {formatProbability(forecast.catastrophicDownsideChance)}.</p>
              </>
            ) : (
              <p>Spend a forecast credit to estimate the outcome distribution before committing.</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
