/**
 * Domain entity type definitions aligned with the data model spec.
 * These types represent the canonical product-facing objects.
 */

export type { TripRequest } from "./trip-request.js";
export type { Destination, DiveSite } from "./destination.js";
export type { DiveOperator, OperatorPriceSnapshot, OperatorRequirement } from "./operator.js";
export type { FlightOption, AccommodationOption } from "./travel.js";
export type { Itinerary, ItineraryItem } from "./itinerary.js";
export type { CostEstimate, TripPlan } from "./plan.js";
export type { ResearchArtifact } from "./research.js";
