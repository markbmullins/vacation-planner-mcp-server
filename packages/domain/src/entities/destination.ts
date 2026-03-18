import type { CertificationLevel, DiveSiteType, ISODateTime } from "@dive-planner/shared";

export interface Destination {
  id: string;
  slug: string;
  name: string;
  region: string;
  country: string;
  summary: string;
  bestMonths: string[];
  avoidMonths: string[];
  marineLifeSummary: Record<string, unknown>;
  certificationFitSummary: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface DiveSite {
  id: string;
  destinationId: string;
  name: string;
  siteType: DiveSiteType;
  minDepthMeters: number;
  maxDepthMeters: number;
  certificationLevel: CertificationLevel;
  marineLife: string[];
  bestMonths: string[];
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
