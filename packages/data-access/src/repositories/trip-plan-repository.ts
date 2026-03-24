import type { CostEstimate, TripPlan } from "@dive-planner/domain";

export interface TripPlanRepository {
  findById(id: string): Promise<TripPlan | null>;
  findByTripRequestId(tripRequestId: string): Promise<TripPlan[]>;
  save(plan: TripPlan): Promise<TripPlan>;
  saveCostEstimate(estimate: CostEstimate): Promise<CostEstimate>;
  findCostEstimate(tripRequestId: string): Promise<CostEstimate | null>;
}
