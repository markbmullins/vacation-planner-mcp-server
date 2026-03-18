# Dive Vacation Planner MCP Tool Schema

## Purpose

This document turns the product and architecture docs into an implementation-facing MCP tool contract. It defines the core tool surface, expected inputs and outputs, and design rules for the Dive Vacation Planner MCP server.

The goal is not to lock every field forever. The goal is to make the initial MCP implementation consistent, thin, and easy to evolve.

## Design Principles

- Tools expose product capabilities, not internal architecture.
- Tools stay thin and delegate logic to services.
- Tools should return structured data the LLM can reason over.
- Hard constraints must be enforced in services, not left to prompt behavior.
- Tool names should remain stable even if providers or internal implementations change.
- Provider-specific behavior belongs behind adapters, not in the tool contract.

## Shared Conventions

### Common Input Patterns

Most tools should reuse a small set of input concepts:

- `origin`: departure airport or city
- `destination`: destination name, region, or island
- `dates`: specific start and end dates when known
- `month`: preferred travel month when exact dates are unknown
- `budgetUsd`: target total or component budget
- `certificationLevel`: diver certification level
- `marineLife`: desired species or experience
- `tripLengthDays`: total trip duration
- `currency`: response currency, default `USD`
- `limit`: max result count

### Common Output Patterns

Most tools should return:

- `results`: array of structured records
- `sourceSummary`: providers or sources used
- `freshness`: when the data was last fetched or normalized
- `warnings`: missing coverage, stale data, or partial failure notes

### Error Handling

Tools should return structured failure states where possible:

- invalid input
- source unavailable
- no results found
- partial result set
- stale cached result

They should not leak raw provider errors unless needed for debugging.

## Tool Categories

```text
Dive Discovery
Operator Research
Travel Planning
Trip Planning
Research
Optional Integration
```

## Dive Discovery

### `searchDiveSites`

Purpose:
- Find destinations or dive sites that fit a trip request.

Suggested input:
```json
{
  "region": "Caribbean",
  "month": "November",
  "budgetUsd": 2500,
  "certificationLevel": "advanced_open_water",
  "marineLife": ["sharks"],
  "tripLengthDays": 7,
  "limit": 5
}
```

Suggested output:
```json
{
  "results": [
    {
      "destinationName": "Roatan",
      "country": "Honduras",
      "region": "Caribbean",
      "bestMonths": ["March", "April", "May"],
      "marineLife": ["reef sharks", "turtles"],
      "certificationFit": "good",
      "indicativeTripCostRange": { "minUsd": 1500, "maxUsd": 2200 },
      "whyItMatches": ["fits budget", "strong shark diving"]
    }
  ],
  "sourceSummary": ["internal knowledge base", "seasonality data"],
  "warnings": []
}
```

### `getDiveSiteDetails`

Purpose:
- Return detailed information about a destination or specific site.

Key output fields:
- destination name
- country and region
- site types
- depth range
- certification recommendations
- marine life highlights
- seasonality summary

### `getBestSeason`

Purpose:
- Explain the best diving months for a destination and highlight risky months.

Key output fields:
- best months
- acceptable months
- avoid months
- rationale

### `getMarineLife`

Purpose:
- Return expected marine life by destination and season.

Key output fields:
- likely species
- seasonal likelihood notes
- dive style implications

### `filterSitesByCertification`

Purpose:
- Narrow destinations or sites to those appropriate for a diver's certification.

Key output fields:
- allowed sites
- borderline sites
- excluded sites with explanation

## Operator Research

### `findDiveOperators`

Purpose:
- Find operators in a destination and return basic comparison data.

Suggested input:
```json
{
  "destination": "Cozumel",
  "budgetPerDiveUsd": 120,
  "certificationLevel": "open_water",
  "limit": 5
}
```

Suggested output fields:
- operator name
- location
- package pricing summary
- rental availability
- certification requirements
- review score
- recommendation notes

### `crawlOperatorPrices`

Purpose:
- Trigger or retrieve operator-specific pricing extraction.

Notes:
- May return cached data immediately.
- May return `status: queued` when live crawling is required.

Suggested output fields:
- operator id or name
- crawl status
- price snapshot
- source URL
- freshness

### `extractCertificationRequirements`

Purpose:
- Return operator requirements for trips, specialties, or advanced sites.

Key output fields:
- minimum certification
- number of logged dives if known
- specialty requirements
- uncertainty notes

### `extractOperatorReviews`

Purpose:
- Return normalized review signals for an operator.

Key output fields:
- review score
- review count
- positive themes
- negative themes
- source provenance

### `compareDiveOperators`

Purpose:
- Compare multiple operators side by side for one destination.

Key output fields:
- compared operators
- price comparison
- requirement comparison
- review comparison
- best-for notes

## Travel Planning

### `searchFlights`

Purpose:
- Search flight options for a route and date window.

Suggested input:
```json
{
  "origin": "CHS",
  "destination": "Roatan",
  "dates": {
    "startDate": "2026-04-12",
    "endDate": "2026-04-17"
  },
  "limit": 10
}
```

Suggested output fields:
- airline
- departure time
- arrival time
- price
- duration
- stop count
- baggage note if available
- booking-link placeholder or source reference

### `compareFlightPrices`

Purpose:
- Compare returned flight options across providers or itineraries.

Key output fields:
- cheapest option
- fastest option
- best value option
- provider/source coverage

### `searchAccommodation`

Purpose:
- Search accommodation options near a destination.

Key output fields:
- name
- type
- nightly price
- location
- rating
- distance-to-dive-area note if available

### `compareAccommodationPrices`

Purpose:
- Compare accommodation options across listing types.

Key output fields:
- cheapest option
- best rated option
- best value option
- category comparison by type

## Trip Planning

### `estimateTripCost`

Purpose:
- Roll up expected total trip cost using known or estimated components.

Suggested input:
```json
{
  "flightOptionId": "flt_123",
  "accommodationOptionId": "acc_456",
  "diveOperatorId": "op_789",
  "tripLengthDays": 7,
  "currency": "USD"
}
```

Suggested output fields:
- flight cost
- accommodation cost
- dive cost
- food/local transport allowance
- total estimated cost
- assumptions

### `generateDiveTripItinerary`

Purpose:
- Produce a day-by-day trip itinerary.

Suggested output fields:
- daily plan entries
- dive days
- non-dive days
- arrival and departure timing
- assumptions

### `optimizeDiveSchedule`

Purpose:
- Improve itinerary order for trip quality, logistics, and pacing.

Key output fields:
- optimized itinerary
- reasons for changes
- constraints applied

### `scheduleSurfaceIntervals`

Purpose:
- Enforce post-dive recovery and no-fly timing.

Key output fields:
- last dive timestamp or day
- earliest safe departure
- rule evaluation
- violations prevented

## Research

### `redditDiveSiteResearch`

Purpose:
- Retrieve Reddit sentiment and anecdotal insights about a destination.

Key output fields:
- destination
- summary themes
- common pros
- common cons
- confidence or coverage note

### `redditDiveShopResearch`

Purpose:
- Retrieve Reddit commentary about a dive operator.

Key output fields:
- operator name
- summary themes
- recurring praise
- recurring complaints
- source provenance

### `summarizeRedditOpinions`

Purpose:
- Summarize collected Reddit material for a topic.

Key output fields:
- summary
- top themes
- notable disagreements
- evidence count

### `searchLocalActivities`

Purpose:
- Find non-diving activities relevant to a trip plan.

Key output fields:
- activity name
- category
- approximate cost if known
- fit for rest day or arrival/departure day

## Optional Integration

### `createCalendarEvents`

Purpose:
- Export a completed itinerary into calendar-ready events.

Suggested input:
```json
{
  "tripPlanId": "trip_123",
  "calendarProvider": "google"
}
```

Suggested output fields:
- event count
- created event references
- skipped items
- permission or auth warnings

## MVP Tool Set

These tools should be treated as MVP-critical:

- `searchDiveSites`
- `getBestSeason`
- `findDiveOperators`
- `crawlOperatorPrices`
- `extractCertificationRequirements`
- `searchFlights`
- `searchAccommodation`
- `estimateTripCost`
- `generateDiveTripItinerary`
- `scheduleSurfaceIntervals`
- `redditDiveSiteResearch`
- `summarizeRedditOpinions`

These tools are important but can land after the first end-to-end version:

- `getDiveSiteDetails`
- `getMarineLife`
- `filterSitesByCertification`
- `extractOperatorReviews`
- `compareDiveOperators`
- `compareFlightPrices`
- `compareAccommodationPrices`
- `optimizeDiveSchedule`
- `redditDiveShopResearch`
- `searchLocalActivities`
- `createCalendarEvents`

## Suggested Service Ownership

```text
searchDiveSites -> DiveDiscoveryService
findDiveOperators -> OperatorResearchService
searchFlights -> TravelPlanningService
estimateTripCost -> CostEstimationService
generateDiveTripItinerary -> ItineraryService
scheduleSurfaceIntervals -> ItineraryService / ConstraintService
redditDiveSiteResearch -> ResearchService
createCalendarEvents -> CalendarIntegrationService
```

## Contract Stability Guidance

- Keep external tool names stable.
- Prefer additive response changes over breaking changes.
- Introduce new optional fields before renaming existing ones.
- Version only when response shape or semantics materially change.
- Keep provider-specific ids internal where possible; expose stable application ids instead.

## Final Note

The MCP surface should make the planner easy for an LLM to compose: discover destinations, evaluate operators, compare travel options, estimate costs, generate a safe itinerary, and optionally export it. If a proposed tool does not clearly help that product workflow, it probably belongs in a service or adapter instead of the public MCP contract.
