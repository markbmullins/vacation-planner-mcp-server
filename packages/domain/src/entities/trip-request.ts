import type {
  AirportCode,
  CertificationLevel,
  CurrencyCode,
  ISODate,
} from "@dive-planner/shared";

export interface TripRequest {
  id: string;
  originCode: AirportCode;
  preferredRegion?: string;
  preferredDestination?: string;
  startDate?: ISODate;
  endDate?: ISODate;
  travelMonth?: string;
  tripLengthDays: number;
  budgetUsd: number;
  certificationLevel: CertificationLevel;
  marineLifePreferences: string[];
  tripPreferences: Record<string, unknown>;
  status: "pending" | "planning" | "complete" | "failed";
  currency: CurrencyCode;
  createdAt: string;
}
