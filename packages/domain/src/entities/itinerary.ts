import type { ISODateTime, ItineraryItemType } from "@dive-planner/shared";

export interface Itinerary {
  id: string;
  tripRequestId: string;
  destinationId: string;
  status: "draft" | "validated" | "confirmed";
  summary: string;
  /** Timestamp of the last dive activity in the itinerary */
  lastDiveAt?: ISODateTime;
  /** Earliest safe departure time after last dive (no-fly rule) */
  earliestSafeFlightAt?: ISODateTime;
  constraintsApplied: Record<string, unknown>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ItineraryItem {
  id: string;
  itineraryId: string;
  dayNumber: number;
  itemType: ItineraryItemType;
  title: string;
  description: string;
  startTime?: ISODateTime;
  endTime?: ISODateTime;
  locationName?: string;
  isDiveActivity: boolean;
  createdAt: ISODateTime;
}
