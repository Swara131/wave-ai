import { SCORE_WEIGHTS } from "./constants";
import type {
  GroupFeedback,
  GroupIntake,
  GroupRecommendation,
  ParticipantMatch,
  RestaurantCandidate,
  ScoredRestaurant,
} from "./types";

function tokens(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 2);
}

function qualitative(score: number): ParticipantMatch["qualitative"] {
  if (score >= 70) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 30) return "weak";
  return "poor";
}

function dietConflict(dietary: string | undefined, haystack: string): boolean {
  const diet = (dietary ?? "").toLowerCase();
  if (!diet) return false;
  if (/\bvegan\b/.test(diet) && /\b(steak|barbecue|biryani|seafood|chicken|mutton|egg)\b/.test(haystack)) {
    return true;
  }
  if (/\bvegetarian\b/.test(diet) && /\b(steak|barbecue|seafood|chicken|mutton|kebab|non-veg|non veg)\b/.test(haystack)) {
    return true;
  }
  if (/\bhalal\b/.test(diet) && /\b(pork|bacon|ham|wine bar)\b/.test(haystack)) return true;
  if (/\bjain\b/.test(diet) && /\b(onion|garlic|root)\b/.test(haystack)) return true;
  return false;
}

export function scoreCandidate(
  candidate: RestaurantCandidate,
  intake: GroupIntake,
  feedback: GroupFeedback[]
): ScoredRestaurant {
  const haystack = [candidate.name, candidate.cuisine, candidate.neighborhood, ...candidate.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const rejectReasons: string[] = [];
  const unknownFlags = [...candidate.unknownFields];
  const party = intake.participants.length;
  const estimatedTotal =
    candidate.estimatedCostPerPerson != null ? candidate.estimatedCostPerPerson * party : null;

  if (estimatedTotal != null && estimatedTotal > intake.maxBudgetInr) {
    rejectReasons.push(`Estimated total ${estimatedTotal} exceeds the group budget of ${intake.maxBudgetInr}.`);
  } else if (candidate.estimatedCostPerPerson == null) {
    unknownFlags.push("price");
  }

  if (candidate.distanceMinutes != null && candidate.distanceMinutes > intake.maxTravelMinutes) {
    rejectReasons.push(`Travel time ${candidate.distanceMinutes} min exceeds the group limit of ${intake.maxTravelMinutes} min.`);
  } else if (candidate.distanceMinutes == null) {
    unknownFlags.push("travel time");
  }

  if (!candidate.openingHours) unknownFlags.push("opening hours");
  unknownFlags.push("table availability");

  for (const person of intake.participants) {
    if (dietConflict(person.dietary, haystack)) {
      rejectReasons.push(`${person.displayName}'s dietary restriction (${person.dietary}) is not verified as safe here.`);
    }
    if (person.hardBudgetInr != null && candidate.estimatedCostPerPerson != null && candidate.estimatedCostPerPerson > person.hardBudgetInr) {
      rejectReasons.push(`${person.displayName}'s personal budget of ₹${person.hardBudgetInr} is exceeded.`);
    }
    if (
      person.maxTravelMinutes != null &&
      candidate.distanceMinutes != null &&
      candidate.distanceMinutes > person.maxTravelMinutes
    ) {
      rejectReasons.push(`${person.displayName}'s travel limit of ${person.maxTravelMinutes} min is exceeded.`);
    }
  }

  const activeRejects = feedback.filter((item) => !item.undone && item.restaurantId === candidate.id);
  if (activeRejects.length) {
    rejectReasons.push(
      `${activeRejects.map((item) => item.participantId).join(", ")} marked this option as not for them.`
    );
  }

  const matches: ParticipantMatch[] = intake.participants.map((person) => {
    const likes = person.likes.flatMap(tokens);
    const cuisines = tokens(person.preferredCuisines);
    const dislikes = tokens(person.dislikes);
    const likeHits = likes.filter((token) => haystack.includes(token)).length;
    const cuisineHits = cuisines.filter((token) => haystack.includes(token)).length;
    const dislikeHits = dislikes.filter((token) => haystack.includes(token)).length;
    const affinity = candidate.affinity != null ? Math.max(0, Math.min(1, candidate.affinity)) * 20 : 0;
    let score = 35 + likeHits * 8 + cuisineHits * 12 + affinity - dislikeHits * 12;
    if (person.dietary && dietConflict(person.dietary, haystack)) score -= 40;
    const foodRejects = feedback.filter(
      (item) => !item.undone && item.participantId === person.id && item.reason === "food" && item.restaurantId !== candidate.id
    );
    if (foodRejects.length && cuisineHits === 0) score -= 4;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const explanationParts = [];
    if (cuisineHits) explanationParts.push("cuisine overlap with stated preferences");
    else explanationParts.push("limited cuisine overlap");
    if (likeHits) explanationParts.push("some stated likes appear in tags or name");
    if (candidate.source === "qloo" && candidate.affinity != null) {
      explanationParts.push("Qloo affinity is evidence of taste compatibility, not a guarantee");
    } else if (candidate.source !== "qloo") {
      explanationParts.push("not a Qloo restaurant result");
    }
    if (dislikeHits) explanationParts.push("possible overlap with stated dislikes");
    return {
      participantId: person.id,
      displayName: person.displayName,
      score,
      qualitative: qualitative(score),
      explanation: explanationParts.join("; ") + ".",
    };
  });

  const groupMean = matches.reduce((sum, item) => sum + item.score, 0) / Math.max(matches.length, 1);
  const fairnessScore = Math.min(...matches.map((item) => item.score));
  const weakest = matches.reduce((min, item) => (item.score < min.score ? item : min), matches[0]);
  const popularity = candidate.popularity ?? 0.5;
  const discoveryScore = (100 - popularity * 100) * 0.6 + (candidate.affinity != null ? candidate.affinity * 40 : 10);

  const taste = groupMean;
  const budget =
    estimatedTotal == null ? 55 : estimatedTotal <= intake.maxBudgetInr * 0.7 ? 90 : estimatedTotal <= intake.maxBudgetInr ? 70 : 10;
  const travel = candidate.distanceMinutes == null ? 55 : candidate.distanceMinutes <= intake.maxTravelMinutes * 0.6 ? 90 : 60;
  const diet = matches.every((item) => item.score >= 30) ? 80 : 40;
  const blended =
    taste * SCORE_WEIGHTS.taste +
    budget * SCORE_WEIGHTS.budget +
    travel * SCORE_WEIGHTS.travel +
    diet * SCORE_WEIGHTS.diet +
    fairnessScore * SCORE_WEIGHTS.fairness;

  return {
    candidate,
    groupScore: Math.round(blended),
    fairnessScore,
    discoveryScore: Math.round(discoveryScore),
    matches,
    weakest,
    hardPass: rejectReasons.length === 0,
    rejectReasons,
    unknownFlags: [...new Set(unknownFlags)],
    tradeoffs: `Weakest match: ${weakest.displayName} (${weakest.qualitative}, ${weakest.score}). Unknown: ${[...new Set(unknownFlags)].join(", ") || "none listed"}.`,
    explanation: `Group score ${Math.round(blended)} using visible weights taste ${SCORE_WEIGHTS.taste}, budget ${SCORE_WEIGHTS.budget}, travel ${SCORE_WEIGHTS.travel}, diet ${SCORE_WEIGHTS.diet}, fairness ${SCORE_WEIGHTS.fairness}. Qloo affinities are evidence only.`,
  };
}

export function pickThreeRecommendations(
  candidates: RestaurantCandidate[],
  intake: GroupIntake,
  feedback: GroupFeedback[]
): { recommendations: GroupRecommendation[]; tooFewReason: string | null } {
  const scored = candidates
    .map((candidate) => scoreCandidate(candidate, intake, feedback))
    .filter((item) => item.hardPass)
    .sort((a, b) => b.groupScore - a.groupScore);

  if (scored.length === 0) {
    return {
      recommendations: [],
      tooFewReason:
        candidates.length === 0
          ? "No restaurant candidates were returned. WAVE will not invent venues."
          : "Every candidate failed a hard constraint or was rejected. WAVE will not fabricate replacements.",
    };
  }

  const used = new Set<string>();
  const take = (item: ScoredRestaurant | undefined, kind: GroupRecommendation["kind"], title: string) => {
    if (!item || used.has(item.candidate.id)) return null;
    used.add(item.candidate.id);
    return { kind, title, scored: item };
  };

  const overall = take(scored[0], "best_overall", "Best overall match");
  const fairestPool = scored.filter((item) => !used.has(item.candidate.id));
  fairestPool.sort((a, b) => b.fairnessScore - a.fairnessScore || b.groupScore - a.groupScore);
  const fairest = take(fairestPool[0], "fairest", "Fairest compromise");
  const discoveryPool = scored.filter((item) => !used.has(item.candidate.id) && item.candidate.source === "qloo");
  discoveryPool.sort((a, b) => b.discoveryScore - a.discoveryScore);
  const discovery =
    take(discoveryPool[0], "discovery", "Discovery pick") ??
    take(
      scored.find((item) => !used.has(item.candidate.id)),
      "discovery",
      "Discovery pick"
    );

  const recommendations = [overall, fairest, discovery].filter((item): item is GroupRecommendation => Boolean(item));
  return {
    recommendations,
    tooFewReason:
      recommendations.length < 3
        ? `Only ${recommendations.length} distinct valid restaurant${recommendations.length === 1 ? "" : "s"} remained after hard filters. WAVE did not duplicate or invent options to fill three slots.`
        : null,
  };
}

export function candidatesFromQloo(
  entities: Array<{
    entityId: string;
    name: string;
    subtype?: string;
    popularity?: number;
    address?: string;
    neighborhood?: string;
    affinity?: number;
    tags?: string[];
  }>,
  retrievedAt: string,
  source: "qloo" | "stated_preferences"
): RestaurantCandidate[] {
  return entities
    .filter((entity) => entity.entityId && entity.name)
    .map((entity) => {
      const unknownFields: string[] = [];
      if (!entity.address) unknownFields.push("address");
      unknownFields.push("opening hours", "price", "travel time", "table availability");
      return {
        id: entity.entityId,
        name: entity.name,
        entityId: entity.entityId,
        cuisine: entity.tags?.[0],
        address: entity.address,
        neighborhood: entity.neighborhood,
        estimatedCostPerPerson: null,
        currency: "INR",
        distanceMinutes: null,
        openingHours: null,
        availability: "unverified" as const,
        popularity: entity.popularity ?? null,
        affinity: entity.affinity ?? null,
        tags: entity.tags ?? [],
        source,
        retrievedAt,
        unknownFields,
      };
    });
}
