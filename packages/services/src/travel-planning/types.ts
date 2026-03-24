import type { AirportCode, ISODate, ServiceResult } from "@dive-planner/shared";
import type { AccommodationOption, FlightOption } from "@dive-planner/domain";

export interface SearchFlightsParams {
  originCode: AirportCode;
  destinationCode: AirportCode;
  startDate: ISODate;
  endDate: ISODate;
  limit?: number;
}

export interface SearchFlightsResult {
  options: FlightOption[];
}

export interface SearchAccommodationParams {
  destinationId: string;
  destinationName: string;
  startDate: ISODate;
  endDate: ISODate;
  maxNightlyPriceUsd?: number;
  limit?: number;
}

export interface SearchAccommodationResult {
  options: AccommodationOption[];
}

export interface TravelPlanningService {
  searchFlights(params: SearchFlightsParams): Promise<ServiceResult<SearchFlightsResult>>;
  searchAccommodation(params: SearchAccommodationParams): Promise<ServiceResult<SearchAccommodationResult>>;
}
