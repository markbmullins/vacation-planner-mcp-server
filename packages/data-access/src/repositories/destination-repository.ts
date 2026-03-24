import type { Destination, DiveSite } from "@dive-planner/domain";

export interface DestinationFilter {
  region?: string;
  country?: string;
  month?: string;
  limit?: number;
}

export interface DestinationRepository {
  findById(id: string): Promise<Destination | null>;
  findBySlug(slug: string): Promise<Destination | null>;
  search(filter: DestinationFilter): Promise<Destination[]>;
  findSitesByDestination(destinationId: string): Promise<DiveSite[]>;
  save(destination: Destination): Promise<Destination>;
}
