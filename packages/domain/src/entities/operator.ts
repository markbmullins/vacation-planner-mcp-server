import type { CertificationLevel, ISODateTime } from "@dive-planner/shared";

export interface DiveOperator {
  id: string;
  destinationId: string;
  name: string;
  locationName: string;
  websiteUrl: string;
  summary: string;
  equipmentRentalAvailable: boolean;
  reviewScore: number | null;
  reviewCount: number | null;
  active: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface OperatorPriceSnapshot {
  id: string;
  operatorId: string;
  currency: string;
  priceType: string;
  packageName: string;
  priceAmount: number;
  priceUnit: string;
  includesEquipment: boolean;
  sourceRecordId: string;
  capturedAt: ISODateTime;
}

export interface OperatorRequirement {
  id: string;
  operatorId: string;
  minimumCertificationLevel: CertificationLevel;
  minimumLoggedDives: number | null;
  specialtyRequirements: Record<string, unknown>;
  notes?: string;
  sourceRecordId: string;
  capturedAt: ISODateTime;
}
