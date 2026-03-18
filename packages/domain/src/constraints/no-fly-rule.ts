/**
 * No-fly-after-diving constraint.
 *
 * PADI/DAN guideline: divers should not fly within 12 hours of a single
 * no-decompression dive, 18 hours after multiple dives, and preferably
 * 24 hours after multi-day dive schedules.
 *
 * This system conservatively enforces 24 hours after ANY diving activity
 * to eliminate margin for error in itinerary generation.
 */

import { ConstraintViolationError } from "@dive-planner/shared";

/** Conservative no-fly wait period in milliseconds (24 hours) */
export const NO_FLY_WAIT_MS = 24 * 60 * 60 * 1000;

export interface NoFlyEvaluation {
  lastDiveAt: Date;
  proposedDepartureAt: Date;
  earliestSafeFlightAt: Date;
  isViolation: boolean;
  waitHours: number;
}

/**
 * Evaluate whether a proposed departure time violates the no-fly rule.
 *
 * @param lastDiveAt - Timestamp of the last dive activity
 * @param proposedDepartureAt - Proposed flight departure time
 * @returns Evaluation result with violation flag and safe window
 */
export function evaluateNoFlyRule(
  lastDiveAt: Date,
  proposedDepartureAt: Date
): NoFlyEvaluation {
  const earliestSafeFlightAt = new Date(lastDiveAt.getTime() + NO_FLY_WAIT_MS);
  const isViolation = proposedDepartureAt < earliestSafeFlightAt;
  const waitHours = NO_FLY_WAIT_MS / (60 * 60 * 1000);

  return {
    lastDiveAt,
    proposedDepartureAt,
    earliestSafeFlightAt,
    isViolation,
    waitHours,
  };
}

/**
 * Assert that a proposed departure does not violate the no-fly rule.
 * Throws ConstraintViolationError if the rule is violated.
 */
export function assertNoFlyRule(
  lastDiveAt: Date,
  proposedDepartureAt: Date
): void {
  const evaluation = evaluateNoFlyRule(lastDiveAt, proposedDepartureAt);

  if (evaluation.isViolation) {
    throw new ConstraintViolationError(
      `No-fly rule violation: proposed departure at ${proposedDepartureAt.toISOString()} is within ${evaluation.waitHours}h of last dive at ${lastDiveAt.toISOString()}. Earliest safe flight: ${evaluation.earliestSafeFlightAt.toISOString()}.`,
      {
        lastDiveAt: lastDiveAt.toISOString(),
        proposedDepartureAt: proposedDepartureAt.toISOString(),
        earliestSafeFlightAt: evaluation.earliestSafeFlightAt.toISOString(),
        waitHours: evaluation.waitHours,
      }
    );
  }
}
