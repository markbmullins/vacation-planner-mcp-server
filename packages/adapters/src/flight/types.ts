import type { AirportCode, ISODate } from "@dive-planner/shared";
import type { FlightOption } from "@dive-planner/domain";

export interface FlightSearchParams {
  originCode: AirportCode;
  destinationCode: AirportCode;
  startDate: ISODate;
  endDate: ISODate;
  limit?: number;
}

export interface FlightSearchResult {
  options: FlightOption[];
  providerName: string;
  fetchedAt: string;
  warnings: string[];
}

export interface FlightProvider {
  readonly providerName: string;
  search(params: FlightSearchParams): Promise<FlightSearchResult>;
}
