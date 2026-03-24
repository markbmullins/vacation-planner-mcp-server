import type { TripRequest } from "@dive-planner/domain";

export interface TripRequestRepository {
  findById(id: string): Promise<TripRequest | null>;
  save(request: TripRequest): Promise<TripRequest>;
  updateStatus(id: string, status: TripRequest["status"]): Promise<void>;
}
