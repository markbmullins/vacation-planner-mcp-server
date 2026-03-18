# Dive Vacation Planner Data Model

## Purpose

This document defines an implementation-ready data model for the Dive Vacation Planner. It translates the product-facing entities into a practical domain model for storage, service boundaries, and query design.

It is intentionally product-centered first: the model exists to support trip planning workflows, not to mirror providers or crawler internals.

## Modeling Principles

- Keep user-facing planning objects explicit.
- Separate normalized business entities from raw source records.
- Treat prices, reviews, and availability as time-sensitive snapshots.
- Keep source provenance for auditability and reprocessing.
- Support both cached knowledge and live refresh workflows.
- Model hard constraints explicitly so itinerary safety is enforceable.

## Core Entity Groups

```text
Planning
  TripRequest -> TripPlan -> Itinerary -> CostEstimate

Supply and Research
  Destination -> DiveSite -> DiveOperator
  FlightOption
  AccommodationOption
  ResearchArtifact

Operational
  SourceRecord
  CrawlJob
  ExtractionRun
  CalendarExport
```

## Core Entities

### `trip_requests`

Represents the user's planning intent.

Key fields:
- `id`
- `origin_code`
- `preferred_region`
- `preferred_destination`
- `start_date`
- `end_date`
- `travel_month`
- `trip_length_days`
- `budget_usd`
- `certification_level`
- `marine_life_preferences` JSONB
- `trip_preferences` JSONB
- `status`
- `created_at`

Notes:
- This is the root object for a planning session.
- Exact dates and month should both be allowed because user input will vary.

### `destinations`

Represents a place that can be recommended as a trip target.

Key fields:
- `id`
- `slug`
- `name`
- `region`
- `country`
- `summary`
- `best_months` JSONB
- `avoid_months` JSONB
- `marine_life_summary` JSONB
- `certification_fit_summary`
- `created_at`
- `updated_at`

Notes:
- This is the canonical destination object used across planning.
- A destination can have many dive sites and many operators.

### `dive_sites`

Represents an individual dive site within a destination.

Key fields:
- `id`
- `destination_id`
- `name`
- `site_type`
- `min_depth_meters`
- `max_depth_meters`
- `certification_level`
- `marine_life` JSONB
- `best_months` JSONB
- `notes`
- `created_at`
- `updated_at`

Notes:
- Needed for detailed destination evaluation and future matching by skill or species.

### `dive_operators`

Represents a dive shop or operator.

Key fields:
- `id`
- `destination_id`
- `name`
- `location_name`
- `website_url`
- `summary`
- `equipment_rental_available`
- `review_score`
- `review_count`
- `active`
- `created_at`
- `updated_at`

Notes:
- Keep operator identity separate from prices and requirements because those change over time.

### `operator_price_snapshots`

Represents time-versioned pricing for an operator.

Key fields:
- `id`
- `operator_id`
- `currency`
- `price_type`
- `package_name`
- `price_amount`
- `price_unit`
- `includes_equipment`
- `source_record_id`
- `captured_at`

Examples:
- single-tank dive
- two-tank package
- rental bundle

### `operator_requirements`

Represents operator constraints and certification expectations.

Key fields:
- `id`
- `operator_id`
- `minimum_certification_level`
- `minimum_logged_dives`
- `specialty_requirements` JSONB
- `notes`
- `source_record_id`
- `captured_at`

### `flight_options`

Represents a concrete flight option returned for a route and date context.

Key fields:
- `id`
- `trip_request_id` nullable
- `destination_id` nullable
- `provider_name`
- `airline_name`
- `origin_code`
- `destination_code`
- `departure_time`
- `arrival_time`
- `duration_minutes`
- `stop_count`
- `price_amount`
- `currency`
- `booking_reference_url` nullable
- `fetched_at`

Notes:
- Flight results are ephemeral and request-dependent, but storing them helps explain plans and compare options.

### `accommodation_options`

Represents an accommodation result.

Key fields:
- `id`
- `trip_request_id` nullable
- `destination_id`
- `provider_name`
- `name`
- `accommodation_type`
- `location_name`
- `nightly_price_amount`
- `currency`
- `rating`
- `distance_to_dive_area_km` nullable
- `booking_reference_url` nullable
- `fetched_at`

### `research_artifacts`

Represents normalized qualitative research from Reddit or other text-heavy sources.

Key fields:
- `id`
- `artifact_type`
- `destination_id` nullable
- `operator_id` nullable
- `topic`
- `summary`
- `positive_themes` JSONB
- `negative_themes` JSONB
- `confidence_note`
- `embedding` vector nullable
- `source_record_id`
- `created_at`

Artifact examples:
- destination sentiment summary
- operator sentiment summary
- local activity summary

### `itineraries`

Represents a generated trip itinerary.

Key fields:
- `id`
- `trip_request_id`
- `destination_id`
- `status`
- `summary`
- `last_dive_at` nullable
- `earliest_safe_flight_at` nullable
- `constraints_applied` JSONB
- `created_at`
- `updated_at`

Notes:
- Keep the itinerary header separate from its day-by-day items.

### `itinerary_items`

Represents a day or event in the itinerary.

Key fields:
- `id`
- `itinerary_id`
- `day_number`
- `item_type`
- `title`
- `description`
- `start_time` nullable
- `end_time` nullable
- `location_name` nullable
- `is_dive_activity`
- `created_at`

Item examples:
- arrival
- reef dives
- wreck dives
- rest day
- local activity
- departure

### `cost_estimates`

Represents the rolled-up trip estimate.

Key fields:
- `id`
- `trip_request_id`
- `flight_cost_amount`
- `accommodation_cost_amount`
- `dive_cost_amount`
- `food_transport_allowance_amount`
- `total_cost_amount`
- `currency`
- `assumptions` JSONB
- `created_at`

### `trip_plans`

Represents the recommended result delivered to the user.

Key fields:
- `id`
- `trip_request_id`
- `destination_id`
- `selected_operator_id` nullable
- `selected_flight_option_id` nullable
- `selected_accommodation_option_id` nullable
- `itinerary_id`
- `cost_estimate_id`
- `recommendation_rationale`
- `status`
- `created_at`

Notes:
- A request may have multiple candidate plans during ranking, but one primary recommended plan for presentation.

## Supporting Entities

### `source_records`

Stores raw fetch metadata and provenance.

Key fields:
- `id`
- `source_type`
- `provider_name`
- `source_url`
- `external_id` nullable
- `raw_payload` JSONB
- `content_hash`
- `fetched_at`
- `expires_at` nullable

Purpose:
- Auditing
- debugging
- reprocessing
- freshness tracking

### `crawl_jobs`

Tracks crawl and refresh work.

Key fields:
- `id`
- `job_type`
- `target_type`
- `target_id` nullable
- `target_url` nullable
- `status`
- `attempt_count`
- `last_error` nullable
- `queued_at`
- `started_at` nullable
- `completed_at` nullable

### `extraction_runs`

Tracks structured extraction from raw content.

Key fields:
- `id`
- `source_record_id`
- `extractor_type`
- `schema_version`
- `status`
- `output_payload` JSONB
- `error_message` nullable
- `created_at`

### `calendar_exports`

Tracks optional calendar sync activity.

Key fields:
- `id`
- `trip_plan_id`
- `provider_name`
- `status`
- `exported_event_count`
- `external_reference` nullable
- `created_at`

## Relationship View

```text
trip_requests
  -> destinations
  -> flight_options
  -> accommodation_options
  -> itineraries
  -> cost_estimates
  -> trip_plans

destinations
  -> dive_sites
  -> dive_operators
  -> research_artifacts

dive_operators
  -> operator_price_snapshots
  -> operator_requirements
  -> research_artifacts

itineraries
  -> itinerary_items

trip_plans
  -> one destination
  -> one selected operator
  -> one selected flight option
  -> one selected accommodation option
  -> one itinerary
  -> one cost estimate
```

## Suggested Enumerations

### Certification Levels

- `discover_scuba`
- `open_water`
- `advanced_open_water`
- `rescue`
- `divemaster`
- `instructor`

### Dive Site Types

- `reef`
- `wall`
- `wreck`
- `drift`
- `cavern`
- `shore`

### Accommodation Types

- `airbnb`
- `hotel`
- `dive_resort`
- `hostel`

### Research Artifact Types

- `destination_summary`
- `operator_summary`
- `activity_summary`

### Itinerary Item Types

- `arrival`
- `dive`
- `rest_day`
- `activity`
- `lodging`
- `departure`

## Constraints and Rules to Model Explicitly

These should not live only in prompts.

### No-Fly Rule

The itinerary model should support deterministic validation for:

- timestamp of last dive activity
- earliest safe departure time
- violation flag or rule evaluation output

### Certification Fit

Recommendations should be able to compare:

- trip request certification level
- dive site recommended level
- operator minimum required level

### Freshness

Pricing and research outputs should expose:

- source fetch time
- normalization time
- stale threshold state

## Query Patterns the Model Must Support

- Find destinations matching month, region, budget range, and marine life goals.
- Find operators in a destination under a price threshold.
- Compare operator requirements and reviews.
- Build a trip plan from one destination, one operator, one flight option, and one accommodation option.
- Generate and validate an itinerary against no-fly constraints.
- Retrieve Reddit-derived summaries for a destination or operator.
- Explain why a recommendation was selected.

## Storage and Indexing Guidance

Recommended indexes:

- `destinations(region, country)`
- `dive_sites(destination_id, certification_level, site_type)`
- `dive_operators(destination_id, active)`
- `operator_price_snapshots(operator_id, captured_at desc)`
- `flight_options(trip_request_id, price_amount)`
- `accommodation_options(trip_request_id, nightly_price_amount)`
- `research_artifacts(destination_id, operator_id, artifact_type)`
- `itinerary_items(itinerary_id, day_number)`
- vector index on `research_artifacts.embedding`

## Normalized vs Raw Data Boundary

Keep both layers:

- normalized entities for planning, ranking, and MCP responses
- raw source records for traceability and recovery

Do not force planners to query raw crawler payloads directly. Raw records should feed normalization pipelines, not become the product model.

## MVP Subset

The MVP does not need every future table populated equally. The minimum useful subset is:

- `trip_requests`
- `destinations`
- `dive_operators`
- `operator_price_snapshots`
- `operator_requirements`
- `flight_options`
- `accommodation_options`
- `research_artifacts`
- `itineraries`
- `itinerary_items`
- `cost_estimates`
- `trip_plans`
- `source_records`
- `crawl_jobs`

`dive_sites`, `extraction_runs`, and `calendar_exports` can start lighter if needed, but their shapes should still be planned up front.

## Final Note

This model is intentionally centered on the planning workflow: user intent in, candidate options gathered, constraints applied, recommendation produced, itinerary validated. If a table does not help the system answer a user planning question or maintain trustworthy source data, it should probably not be part of the early model.
