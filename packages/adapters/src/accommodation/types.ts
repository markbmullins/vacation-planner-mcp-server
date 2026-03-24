import type { AccommodationType, ISODate } from "@dive-planner/shared";
import type { AccommodationOption } from "@dive-planner/domain";

export interface AccommodationSearchParams {
  destinationId: string;
  destinationName: string;
  startDate: ISODate;
  endDate: ISODate;
  maxNightlyPriceUsd?: number;
  preferredTypes?: AccommodationType[];
  limit?: number;
}

export interface AccommodationSearchResult {
  options: AccommodationOption[];
  providerName: string;
  fetchedAt: string;
  warnings: string[];
}

export interface AccommodationProvider {
  readonly providerName: string;
  search(params: AccommodationSearchParams): Promise<AccommodationSearchResult>;
}
