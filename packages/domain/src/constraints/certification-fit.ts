/**
 * Certification fit constraint evaluator.
 *
 * Compares a diver's certification level against a site or operator
 * minimum requirement to determine eligibility.
 */

import type { CertificationLevel } from "@dive-planner/shared";

/** Ordered certification levels from least to most advanced */
const CERTIFICATION_ORDER: CertificationLevel[] = [
  "discover_scuba",
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
];

export type CertificationFit = "good" | "borderline" | "excluded";

/**
 * Evaluate whether a diver's certification meets or exceeds a requirement.
 *
 * @param diverLevel - The diver's certification level
 * @param requiredLevel - Minimum certification required by site or operator
 * @returns Fitness rating
 */
export function evaluateCertificationFit(
  diverLevel: CertificationLevel,
  requiredLevel: CertificationLevel
): CertificationFit {
  const diverIndex = CERTIFICATION_ORDER.indexOf(diverLevel);
  const requiredIndex = CERTIFICATION_ORDER.indexOf(requiredLevel);

  if (diverIndex >= requiredIndex) {
    return "good";
  }

  // One level below is borderline (might be allowed with instructor supervision)
  if (diverIndex === requiredIndex - 1) {
    return "borderline";
  }

  return "excluded";
}

/**
 * Returns true if the diver meets or exceeds the required certification.
 */
export function meetsRequirement(
  diverLevel: CertificationLevel,
  requiredLevel: CertificationLevel
): boolean {
  return evaluateCertificationFit(diverLevel, requiredLevel) === "good";
}
