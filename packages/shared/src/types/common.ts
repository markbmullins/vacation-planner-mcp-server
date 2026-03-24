/**
 * Common primitive types used across the Dive Vacation Planner system.
 */

/** ISO 8601 date string e.g. "2026-04-12" */
export type ISODate = string;

/** ISO 8601 datetime string e.g. "2026-04-12T14:00:00Z" */
export type ISODateTime = string;

/** Three-letter IATA airport code e.g. "CHS" */
export type AirportCode = string;

/** ISO 4217 currency code e.g. "USD" */
export type CurrencyCode = string;

/** Supported diver certification levels */
export type CertificationLevel =
  | "discover_scuba"
  | "open_water"
  | "advanced_open_water"
  | "rescue"
  | "divemaster"
  | "instructor";

/** Dive site classification types */
export type DiveSiteType =
  | "reef"
  | "wall"
  | "wreck"
  | "drift"
  | "cavern"
  | "shore";

/** Accommodation categories */
export type AccommodationType =
  | "airbnb"
  | "hotel"
  | "dive_resort"
  | "hostel";

/** Research artifact source types */
export type ResearchArtifactType =
  | "destination_summary"
  | "operator_summary"
  | "activity_summary";

/** Itinerary event types */
export type ItineraryItemType =
  | "arrival"
  | "dive"
  | "rest_day"
  | "activity"
  | "lodging"
  | "departure";

/** A monetary value with explicit currency */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/** A price range with explicit currency */
export interface PriceRange {
  minAmount: number;
  maxAmount: number;
  currency: CurrencyCode;
}
