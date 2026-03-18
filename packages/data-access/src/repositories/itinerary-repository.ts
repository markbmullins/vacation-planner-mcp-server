import type { Itinerary, ItineraryItem } from "@dive-planner/domain";

export interface ItineraryRepository {
  findById(id: string): Promise<Itinerary | null>;
  findByTripRequestId(tripRequestId: string): Promise<Itinerary | null>;
  findItems(itineraryId: string): Promise<ItineraryItem[]>;
  save(itinerary: Itinerary): Promise<Itinerary>;
  saveItems(items: ItineraryItem[]): Promise<ItineraryItem[]>;
}
