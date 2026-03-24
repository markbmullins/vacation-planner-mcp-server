/**
 * Repository interfaces define the data-access contract.
 * Concrete implementations (Postgres, in-memory, etc.) implement these interfaces.
 */

export type { TripRequestRepository } from "./trip-request-repository.js";
export type { DestinationRepository } from "./destination-repository.js";
export type { OperatorRepository } from "./operator-repository.js";
export type { ItineraryRepository } from "./itinerary-repository.js";
export type { TripPlanRepository } from "./trip-plan-repository.js";
