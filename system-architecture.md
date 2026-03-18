# Dive Vacation Planner System Architecture

## Objective and System Boundary

Dive Vacation Planner is an MCP-powered planning and recommendation system for scuba travelers. It accepts a natural-language trip request and returns a complete trip plan: destination options, dive operator comparisons, flight and accommodation options, estimated costs, and a safety-aware itinerary.

This system explicitly stays within the planning boundary:

- It does: aggregate external travel and dive data, crawl operator information, synthesize recommendations, estimate cost, and generate itineraries.
- It does not: book flights, book hotels, process dive reservations, take payments, sell insurance, or act as a merchant of record.

That boundary should shape both product and architecture: the system is a planner and advisor, not a transaction processor.

## Requirements and Constraints

### Product Requirements

The architecture must support these core product-facing entities:

- `Trip Request`
- `Destination Option`
- `Dive Operator Option`
- `Flight Option`
- `Accommodation Option`
- `Itinerary`
- `Cost Estimate`
- `Trip Plan`

It must also cover the MCP tool categories defined in the product spec:

- Dive Discovery
- Operator Research
- Travel Planning
- Trip Planning
- Research
- Optional Integration

### Core Functional Requirements

- Turn a natural-language trip request into a complete trip recommendation.
- Discover and compare dive destinations by season, budget, certification fit, and marine life.
- Research dive operators, including prices, rental availability, certification requirements, and review signals.
- Compare flights and accommodations from external sources.
- Estimate total trip cost.
- Generate a realistic itinerary with safety constraints.
- Support optional calendar export.

### Technical and Architectural Constraints

- Start with `TypeScript` and `FastMCP`.
- Keep FastMCP replaceable through a thin adapter layer.
- Keep tools as thin primitives; business logic belongs in services.
- Use `Playwright + Crawlee` for crawling. Crawlee manages crawling orchestration. Playwright loads dynamic pages.
- Use `crawl4ai` where extraction workflows benefit from structured web content processing.
- Use `reddit-research-mcp` for Reddit-based research.
- Use `Postgres + pgvector` for core storage and retrieval.
- Use `BullMQ` for async jobs and scheduled crawling.
- Enforce the domain rule: no flying within 24 hours after diving.

## Architecture Drivers

The main architectural drivers are:

- Thin MCP interface, heavy service layer.
- Fast iteration on product workflows over protocol/framework work.
- Reliable ingestion of messy external data.
- Separation of synchronous user planning from slow crawling and enrichment.
- Reusable knowledge base over time, not only one-shot tool output.
- Safe reasoning with explicit constraint enforcement.

## System Context

### Actors

- Traveler using an MCP-capable client or LLM interface
- LLM orchestrator calling MCP tools
- Internal planner services
- External travel and content sources
- Reddit research provider
- Optional calendar provider

### External Dependencies

- Flight data sources or aggregators
- Accommodation listing sources
- Dive operator websites
- Reddit via `reddit-research-mcp`
- Optional calendar API
- Crawling infrastructure dependencies

### Context Diagram

```text
Traveler
  -> LLM Client
  -> MCP Server
      -> Planning Services
      -> Postgres / pgvector
      -> BullMQ / Redis
      -> Crawl Workers
          -> Dive operator websites
          -> Travel listing sites
          -> crawl4ai extraction
          -> Playwright + Crawlee browser crawling
      -> reddit-research-mcp
      -> Optional Calendar Provider
```

## Viable Architecture Options

### Option 1: Thin MCP Server + Modular Monolith Services + Shared Database

```text
FastMCP Adapter
  -> Tool Handlers
  -> Domain Services
  -> Postgres / pgvector
  -> BullMQ Workers
```

Benefits:

- Simplest credible starting point.
- Fastest to build and operate with a small team.
- Keeps tool contracts clean while concentrating business logic in services.
- Easy to evolve into service extraction later.

Liabilities:

- Single deployable can become crowded without strong module boundaries.
- Heavy crawling and planning workloads must be isolated operationally even if in one repo.
- Requires discipline to avoid tool/service coupling.

Hidden costs:

- Data model and module design matter early; a sloppy monolith will be hard to split later.
- Shared database can become a coupling point if domains are not separated conceptually.

Best fit when:

- MVP and early product discovery are the priority.
- Team is small.
- Operational overhead must stay low.

### Option 2: MCP Gateway + Separate Planning API + Separate Ingestion/Crawling Service

```text
FastMCP Gateway
  -> Planning API
  -> Query DB
  -> Queue
  -> Crawl Service
  -> Enrichment Service
```

Benefits:

- Cleaner runtime separation between interactive planning and ingestion.
- Better isolation of browser automation, rate limits, and failures.
- Easier independent scaling.

Liabilities:

- More infrastructure, more deployments, more operational burden.
- More inter-service contracts to design and maintain.
- Slower early iteration.

Hidden costs:

- Distributed tracing, retries, and schema versioning become necessary sooner.
- Service boundaries may be guessed too early and later prove wrong.

Best fit when:

- Crawling volume is high early.
- Multiple engineers can own separate platform areas.
- Latency and throughput isolation is critical from day one.

### Option 3: Fully Distributed Tool-Per-Domain Services

```text
MCP Gateway
  -> Dive Discovery Service
  -> Operator Research Service
  -> Travel Planning Service
  -> Research Service
  -> Itinerary Service
```

Benefits:

- Clear domain ownership if the organization is already large.
- Independent scaling and deployment per domain.

Liabilities:

- Over-architected for the current scope.
- High integration and ops complexity.
- Harder to maintain consistent trip-planning workflows across domains.

Hidden costs:

- Cross-service joins for a single trip plan become expensive in latency and complexity.
- Reasoning workflows become orchestration-heavy.

Best fit when:

- Product is already large-scale with distinct teams and heavy throughput per domain.

## Recommended Architecture

Recommend Option 1: a modular monolith with a thin FastMCP adapter, shared domain services, shared Postgres/pgvector storage, and separate async workers for crawling and enrichment.

Why this is the best fit:

- It matches the explicit constraint to start with FastMCP and avoid building MCP infrastructure.
- It preserves the original plan's "thin tool layer over real business logic" shape.
- It keeps the system simple enough to ship while still supporting a reusable knowledge base, async crawling, and staged evolution.
- It supports the planning boundary well: most product value comes from orchestration, ranking, and synthesis, not from distributed runtime isolation.
- It leaves a clean future path to split out ingestion or planning services if usage patterns justify it.

## High-Level System Shape

```text
LLM Client
  -> FastMCP Server Adapter
      -> MCP Tool Handlers
          -> Domain Services
              -> Search / Planning / Ranking / Constraint Services
              -> Repository Layer
                  -> Postgres + pgvector
                  -> Cache
                  -> Queue Producer
      -> BullMQ Queue
          -> Crawl / Refresh / Enrichment Workers
              -> Playwright + Crawlee
              -> crawl4ai
              -> reddit-research-mcp
```

## Major Components

### 1. MCP Adapter Layer

Responsibilities:

- Expose product capabilities as MCP tools.
- Validate tool inputs and shape outputs.
- Translate tool calls into service calls.
- Remain framework-specific but extremely thin.

Design rule:

- No ranking, constraint solving, itinerary logic, or deep source-specific logic in tools.

Example responsibility split:

```text
tool: searchDiveSites(params)
  -> DiveDiscoveryService.searchSites(params)

tool: generateDiveTripItinerary(params)
  -> ItineraryService.generate(params)
```

### 2. Domain Services Layer

Primary services:

- `TripRequestService`
- `DiveDiscoveryService`
- `OperatorResearchService`
- `TravelPlanningService`
- `ResearchService`
- `CostEstimationService`
- `ItineraryService`
- `TripPlanService`
- `CalendarIntegrationService` (optional)

Responsibilities:

- Normalize user intent into structured planning inputs.
- Query cached knowledge and live source data.
- Rank and compare options.
- Enforce domain constraints.
- Assemble `Trip Plan` outputs.

### 3. Source Adapter Layer

Adapters isolate provider-specific logic:

- Flight source adapters
- Accommodation source adapters
- Operator crawler adapters
- Reddit research adapter
- Calendar adapter

This keeps external dependencies replaceable and prevents source logic from leaking into the tool layer.

### 4. Knowledge Store

Use `Postgres` as the source of truth for structured entities and planning artifacts, with `pgvector` for semantic retrieval and deduplication of crawled content, reviews, and extracted descriptions.

### 5. Async Jobs and Workers

Use `BullMQ` for:

- scheduled crawl refreshes
- on-demand operator crawl jobs
- Reddit research enrichment
- content extraction and normalization
- embedding generation
- stale data revalidation

Workers should run separately from the interactive MCP server so browser crashes, slow pages, or crawl retries do not affect planning latency.

## Domain View and Data Model

The internal schema should stay aligned with the product-facing entities.

### Core Domain Objects

- `TripRequest`
- `DestinationOption`
- `DiveSite`
- `DiveOperator`
- `OperatorPriceSnapshot`
- `OperatorRequirement`
- `FlightOption`
- `AccommodationOption`
- `ResearchArtifact`
- `Itinerary`
- `CostEstimate`
- `TripPlan`

### Supporting Objects

- `SourceRecord`
- `CrawlJob`
- `ExtractionRun`
- `RankingExplanation`
- `ConstraintEvaluation`
- `CalendarExport`

### Data Relationships

```text
TripRequest
  -> candidate DestinationOptions
      -> DiveSites
      -> DiveOperators
      -> FlightOptions
      -> AccommodationOptions
      -> ResearchArtifacts
  -> CostEstimate
  -> Itinerary
  -> TripPlan
```

### Storage Guidance

- Store normalized structured fields for pricing, dates, location, certification requirements, and ratings.
- Store raw source payloads and extraction metadata for auditability and reprocessing.
- Store embeddings for semantic retrieval of destination descriptions, operator reviews, and Reddit summaries.
- Version time-sensitive facts like prices and availability snapshots.

## MCP Tool Architecture

The tool surface should mirror the product-spec categories and remain focused.

### Dive Discovery

- `searchDiveSites`
- `getDiveSiteDetails`
- `getBestSeason`
- `getMarineLife`
- `filterSitesByCertification`

### Operator Research

- `findDiveOperators`
- `crawlOperatorPrices`
- `extractCertificationRequirements`
- `extractOperatorReviews`
- `compareDiveOperators`

### Travel Planning

- `searchFlights`
- `compareFlightPrices`
- `searchAccommodation`
- `compareAccommodationPrices`

### Trip Planning

- `estimateTripCost`
- `generateDiveTripItinerary`
- `optimizeDiveSchedule`
- `scheduleSurfaceIntervals`

### Research

- `redditDiveSiteResearch`
- `redditDiveShopResearch`
- `summarizeRedditOpinions`
- `searchLocalActivities`

### Optional Integration

- `createCalendarEvents`

### Tool Design Principles

- Tools return data or narrowly scoped computed results.
- Tools do not contain end-to-end workflow orchestration.
- Tools should be composable by the LLM and reusable by services.
- Framework-specific registration should be isolated in one adapter package/module.

## Data Ingestion and Crawling Pipeline

The ingestion system should build a reusable dive knowledge base over time while also supporting on-demand refresh.

### Sources

- Dive operator websites
- Travel sources for flight and accommodation data
- Reddit via `reddit-research-mcp`
- Future structured destination datasets

### Pipeline Stages

```text
Source Discovery
  -> Fetch / Crawl
  -> Content Extraction
  -> Normalization
  -> Validation
  -> Deduplication
  -> Enrichment / Embeddings
  -> Persist
  -> Availability for Planning Queries
```

### Recommended Implementation

- Use `Playwright + Crawlee` for browser-driven crawling of operator sites and dynamic pages.
- Use `crawl4ai` where content extraction, markdown-like page understanding, or structured site parsing improves result quality.
- Use `reddit-research-mcp` for qualitative destination and operator insights rather than scraping Reddit directly.
- Use BullMQ jobs to separate discovery, fetch, extraction, and enrichment steps.

### Crawl Modes

- Scheduled refresh for known operators and destinations.
- On-demand crawl when a user requests a destination with stale or missing data.
- Manual/admin re-crawl for problematic sources.

### Important Operational Consequences

- External site layout changes will be common; adapters must fail locally and degrade gracefully.
- Source freshness should be visible in planning results.
- Anti-bot countermeasures, latency spikes, and partial extraction failures are expected and should not block the whole planning flow.

## Orchestration and Reasoning Flow

The planner should combine deterministic services with LLM reasoning rather than relying on free-form LLM behavior alone.

### Typical End-to-End Flow

```text
User request
  -> Parse and structure TripRequest
  -> Retrieve candidate destinations
  -> Filter by seasonality, certification fit, budget range
  -> Fetch/retrieve operators, flights, accommodations, Reddit signals
  -> Estimate costs
  -> Generate itinerary with safety constraints
  -> Rank trip options
  -> Return TripPlan with rationale
```

### Recommended Control Pattern

- Deterministic services handle retrieval, normalization, filtering, ranking inputs, and constraint evaluation.
- LLM reasoning is used to synthesize rationale, compare tradeoffs, and compose a coherent recommendation.
- Safety constraints and hard rules must be enforced by services, not only narrated by the model.

### Constraint Enforcement

Examples of service-level constraints:

- no flight departure within 24 hours of the last dive
- certification mismatch blocks or penalizes operator/site recommendations
- seasonality risk lowers destination rank
- budget overflow is explained explicitly

## Storage Strategy

### Primary Database: Postgres

Use for:

- normalized product entities
- planning sessions and generated trip plans
- source metadata and crawl history
- price snapshots
- constraints and ranking explanations

### Vector Support: pgvector

Use for:

- semantic retrieval of operator reviews and Reddit insights
- destination similarity or marine-life relevance search
- deduplication support for extracted text artifacts

### Cache

A small cache layer can be added for hot queries and short-lived source results, but it should remain an optimization, not a dependency for correctness.

### Data Retention Guidance

- Keep raw extracted artifacts for traceability.
- Keep latest normalized records plus historical snapshots for price/freshness analysis.
- Expire or archive stale ephemeral search data on a schedule.

## Async Jobs and Queue Usage

Use `BullMQ` with queues separated by workload type.

Recommended queues:

- `crawl-discovery`
- `crawl-fetch`
- `extract-normalize`
- `research-enrichment`
- `embedding-generation`
- `refresh-stale-data`
- `calendar-export`

Design guidance:

- Use idempotent jobs keyed by source and entity.
- Use retry policies tuned per source type.
- Route failed jobs to dead-letter handling with inspection metadata.
- Keep user-facing planning requests mostly read/query-oriented; enqueue long-running refresh work instead of blocking.

## Reliability and Failure Handling

The system should degrade gracefully because many dependencies are external and unreliable.

### Expected Failure Modes

- Source pages block crawlers or change HTML structure.
- Flight/accommodation providers return incomplete or stale data.
- Reddit research is unavailable or rate-limited.
- Queue backlog delays enrichment.
- Browser workers crash on heavy pages.
- LLM produces overconfident reasoning from incomplete evidence.

### Mitigations

- Treat each source adapter independently; one source failing should not fail the trip plan.
- Return partial plans with freshness indicators and missing-data notes.
- Prefer cached recent data over hard failure where acceptable.
- Maintain adapter-level health and error rates.
- Enforce hard constraints in deterministic services.
- Persist source provenance for audit and debugging.

### Reliability Posture

For MVP, target graceful degradation over strict completeness. A useful partial recommendation is better than an unavailable system.

## Observability

Observability is essential because most issues will come from external dependencies and orchestration.

### Required Signals

- tool call counts, latency, and error rates
- service-level latency and failure metrics
- crawl success/failure by source
- queue depth, retry counts, dead-letter volume
- source freshness coverage
- plan generation success rate
- constraint violation counts
- external dependency health

### Logging and Tracing

- Structured logs with request, job, and source identifiers.
- Distributed traces across tool call -> service -> DB/queue -> worker.
- Persist planner decision context for debugging ranking and itinerary output.

### Product Analytics

Track:

- request types
- destinations requested
- comparison frequency
- plan completion rate
- calendar export usage
- source coverage gaps

## Security and Privacy

The system handles travel preferences and possibly calendar integration, so privacy should be intentional from the start.

### Principles

- Collect only data needed for trip planning.
- Avoid storing unnecessary personal identifiers.
- Keep calendar access optional and scoped.
- Separate operational secrets from application config.
- Sanitize external content before storage/display.
- Record source provenance to reduce hallucinated recommendations.

### Specific Guidance

- Encrypt sensitive secrets at rest and in transit.
- Use least-privilege credentials for source adapters and calendar integration.
- Apply outbound rate limiting and allowlist controls where possible.
- Treat crawled third-party content as untrusted input.
- If user accounts are added later, isolate planning data by tenant/user boundary.

## Deployment Shape

### Recommended Starting Deployment

```text
[Web / CLI / MCP Client]
        |
        v
[FastMCP App - TypeScript]
        |
        +--> [Postgres + pgvector]
        +--> [Redis]
        +--> [External APIs / Sites]
        |
        v
[BullMQ Workers]
  + Playwright + Crawlee
  + crawl4ai
  + reddit-research-mcp integration
```

### Runtime Separation

Deploy at least two process groups:

- interactive MCP server
- background workers

This separation matters even if both live in one repo and one logical application.

### Environment Guidance

- Start single-region.
- Containerize server and workers separately.
- Use managed Postgres/Redis where possible to reduce ops burden.
- Add horizontal worker scaling before splitting services.

## Phased Roadmap

### Phase 1: MVP Planning Engine

- FastMCP adapter with thin tools
- core services for discovery, operator research, travel planning, itinerary, and cost estimation
- Postgres schema for core entities
- BullMQ for basic async crawl jobs
- operator crawling with Playwright + Crawlee
- Reddit integration via `reddit-research-mcp`
- safety-aware itinerary generation

### Phase 2: Reusable Knowledge Base

- scheduled refresh jobs
- richer normalization and deduplication
- pgvector-backed semantic retrieval
- destination/operator knowledge reuse across requests
- source freshness scoring and explanation

### Phase 3: Smarter Ranking and Research

- improved recommendation/ranking logic
- better marine life and seasonality models
- local activities support
- stronger comparison explanations
- admin tools for crawl health and source coverage

### Phase 4: Optional Evolution

- split ingestion workers into a distinct service if crawl volume demands it
- split planning API from MCP adapter if multiple clients emerge
- add user accounts and saved plans if product scope expands

## Key Risks

- External source instability is the largest operational risk.
- Crawling quality and freshness may determine product quality more than model quality.
- Flight/accommodation source access may constrain reliability or legality depending on provider strategy.
- If business logic drifts into tools, framework lock-in and maintenance cost will rise.
- If data normalization is weak, ranking and itinerary quality will feel inconsistent.
- If safety rules are left to the LLM alone, unsafe itineraries may slip through.

## Validation Steps

- Run design spikes for 3 representative workflows:
  - destination-first trip planning
  - operator comparison in one destination
  - full trip plan generation with safety rule enforcement
- Test crawl reliability across a small but diverse set of operator sites.
- Validate that the no-fly-after-diving rule is enforced deterministically.
- Measure end-to-end latency for interactive planning using cached vs uncached data.
- Evaluate source freshness and fallback behavior under dependency failures.
- Review outputs with real divers for recommendation quality, not just technical correctness.
- Confirm FastMCP abstraction boundaries by ensuring tool handlers can be ported to another MCP framework with minimal service changes.

## Decision

Start with a modular monolith in `TypeScript` using `FastMCP`, with a thin MCP adapter, service-centered business logic, `Postgres + pgvector` for the knowledge store, `BullMQ` for async workflows, and `Playwright + Crawlee` plus `crawl4ai` for ingestion. Integrate `reddit-research-mcp` as a research adapter, not as core planning logic.

This architecture is the simplest one that satisfies the current product scope, preserves the original plan's MCP-first shape, respects the strict planning-only system boundary, and creates a clean path toward a durable dive travel knowledge platform without prematurely paying microservice complexity costs.
