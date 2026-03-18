import type { ISODateTime } from "@dive-planner/shared";

export interface CostEstimate {
  id: string;
  tripRequestId: string;
  flightCostAmount: number;
  accommodationCostAmount: number;
  diveCostAmount: number;
  foodTransportAllowanceAmount: number;
  totalCostAmount: number;
  currency: string;
  assumptions: Record<string, unknown>;
  createdAt: ISODateTime;
}

export interface TripPlan {
  id: string;
  tripRequestId: string;
  destinationId: string;
  selectedOperatorId?: string;
  selectedFlightOptionId?: string;
  selectedAccommodationOptionId?: string;
  itineraryId: string;
  costEstimateId: string;
  recommendationRationale: string;
  status: "draft" | "recommended" | "archived";
  createdAt: ISODateTime;
}
