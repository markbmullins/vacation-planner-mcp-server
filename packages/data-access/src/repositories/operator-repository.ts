import type {
  DiveOperator,
  OperatorPriceSnapshot,
  OperatorRequirement,
} from "@dive-planner/domain";

export interface OperatorFilter {
  destinationId?: string;
  active?: boolean;
  limit?: number;
}

export interface OperatorRepository {
  findById(id: string): Promise<DiveOperator | null>;
  search(filter: OperatorFilter): Promise<DiveOperator[]>;
  findLatestPrices(operatorId: string): Promise<OperatorPriceSnapshot[]>;
  findRequirements(operatorId: string): Promise<OperatorRequirement | null>;
  save(operator: DiveOperator): Promise<DiveOperator>;
  savePriceSnapshot(snapshot: OperatorPriceSnapshot): Promise<OperatorPriceSnapshot>;
  saveRequirement(requirement: OperatorRequirement): Promise<OperatorRequirement>;
}
