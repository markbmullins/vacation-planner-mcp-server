import type { ISODate, ISODateTime, ServiceResult } from "@dive-planner/shared";
import type { Itinerary, ItineraryItem } from "@dive-planner/domain";
import type { NoFlyEvaluation } from "@dive-planner/domain";

export interface GenerateItineraryParams {
  tripRequestId: string;
  destinationId: string;
  startDate: ISODate;
  endDate: ISODate;
  operatorId?: string;
  proposedDepartureAt?: ISODateTime;
}

export interface GenerateItineraryResult {
  itinerary: Itinerary;
  items: ItineraryItem[];
  noFlyEvaluation?: NoFlyEvaluation;
}

export interface ScheduleSurfaceIntervalsParams {
  lastDiveAt: ISODateTime;
  proposedDepartureAt: ISODateTime;
}

export interface ScheduleSurfaceIntervalsResult {
  evaluation: NoFlyEvaluation;
  isViolation: boolean;
  earliestSafeFlightAt: ISODateTime;
}

export interface ItineraryService {
  generateItinerary(params: GenerateItineraryParams): Promise<ServiceResult<GenerateItineraryResult>>;
  scheduleSurfaceIntervals(params: ScheduleSurfaceIntervalsParams): Promise<ServiceResult<ScheduleSurfaceIntervalsResult>>;
}
