import type { AccommodationType, AirportCode, ISODateTime } from "@dive-planner/shared";

export interface FlightOption {
  id: string;
  tripRequestId?: string;
  destinationId?: string;
  providerName: string;
  airlineName: string;
  originCode: AirportCode;
  destinationCode: AirportCode;
  departureTime: ISODateTime;
  arrivalTime: ISODateTime;
  durationMinutes: number;
  stopCount: number;
  priceAmount: number;
  currency: string;
  bookingReferenceUrl?: string;
  fetchedAt: ISODateTime;
}

export interface AccommodationOption {
  id: string;
  tripRequestId?: string;
  destinationId: string;
  providerName: string;
  name: string;
  accommodationType: AccommodationType;
  locationName: string;
  nightlyPriceAmount: number;
  currency: string;
  rating: number | null;
  distanceToDiveAreaKm?: number;
  bookingReferenceUrl?: string;
  fetchedAt: ISODateTime;
}
