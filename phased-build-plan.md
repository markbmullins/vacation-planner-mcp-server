# Dive Vacation Planner Phased Build Plan

## Goal

This plan turns the product spec and system architecture into a practical execution sequence for building the Dive Vacation Planner MVP.

The build strategy is intentionally staged:

- prove the end-to-end planning loop early
- keep the MCP layer thin
- defer non-essential integrations until the planning workflow is solid
- invest in reusable data ingestion only after the first planner experience works

## Delivery Principles

- Ship an end-to-end slice before broadening tool coverage.
- Prefer mocked or simplified providers early if they unblock workflow validation.
- Separate interactive planning from background crawling from day one.
- Enforce hard safety rules in code before polishing recommendation quality.
- Add data breadth only after the planning output is coherent and explainable.

## What This Plan Adds

This document is meant to be a delivery playbook, not just a bridge between product and architecture. To make it operational, the plan includes four practical layers that should guide execution:

- concrete implementation tasks by phase
- evaluation loops to measure output quality and system behavior
- a staged data acquisition strategy
- explicit LLM orchestration design for how tools and services interact

## Success Criteria for MVP

The MVP is successful when a user can:

- ask for a dive trip in natural language
- receive 1-3 plausible destination options
- compare at least a few dive operators for a selected destination
- see at least one set of flight and accommodation options
- receive a total estimated trip cost
- receive a day-by-day itinerary that respects the no-fly-after-diving rule
- understand the rationale behind the recommendation

## Phase 0: Foundations and Repo Setup

Objective:
- Create the skeleton that prevents rework later.

Deliverables:
- project structure with thin MCP adapter and services split
- TypeScript workspace and package layout
- FastMCP server bootstrapped behind an internal abstraction
- Postgres, Redis, and BullMQ local development setup
- base configuration management and secret handling
- logging, request ids, and basic health endpoints

Suggested module layout:

```text
apps/
  mcp-server/
  worker/

packages/
  domain/
  services/
  adapters/
  data-access/
  shared/
```

Exit criteria:
- server starts
- one placeholder tool call works end to end
- worker process can consume a test BullMQ job

Concrete implementation tasks:
- create repo/package structure
- add FastMCP bootstrap and internal server adapter interface
- add shared config module for env validation
- add Postgres and Redis docker or local dev setup
- add logging, error handling, and health endpoints
- add BullMQ producer/consumer hello-world flow

## Phase 1: End-to-End Planning Skeleton

Objective:
- Prove the full planner experience with minimal but real functionality.

Build:
- `TripRequest` parsing and normalization
- `searchDiveSites`
- `getBestSeason`
- `findDiveOperators`
- `searchFlights`
- `searchAccommodation`
- `estimateTripCost`
- `generateDiveTripItinerary`
- `scheduleSurfaceIntervals`
- `summarizeRedditOpinions` using simplified or initial research integration

Implementation guidance:
- use a very small destination dataset to start
- allow some provider responses to be stubbed if necessary
- persist all requests and outputs for evaluation
- implement deterministic no-fly rule immediately

Exit criteria:
- one natural-language trip workflow completes from request to trip plan
- output contains destination, operator, flight, accommodation, cost estimate, and itinerary
- itinerary constraint validation is enforced in service code

Concrete implementation tasks:
- implement `TripRequest` parser that converts free-form input into structured request fields
- build `DiveDiscoveryService` with seed destination data
- build `TravelPlanningService` with one initial flight source adapter and one accommodation adapter or fixture-backed adapter
- build `OperatorResearchService` with static or seeded operator comparison data
- build `CostEstimationService` with explicit assumptions
- build `ItineraryService` with day-by-day itinerary generation and no-fly validation
- persist generated `TripPlan` output for review
- expose the first thin MCP tools that call these services

## Phase 2: Core Data Model and Persistence

Objective:
- Replace temporary in-memory assumptions with durable planning data.

Build:
- Postgres schema for core entities from `data-model.md`
- repositories for `trip_requests`, `destinations`, `dive_operators`, `operator_price_snapshots`, `flight_options`, `accommodation_options`, `research_artifacts`, `itineraries`, `cost_estimates`, `trip_plans`
- source provenance through `source_records`
- audit-friendly storage for generated plans and supporting evidence

Implementation guidance:
- keep normalized entities separate from raw provider payloads
- store freshness metadata on time-sensitive records
- use application ids rather than provider ids in service boundaries

Exit criteria:
- planning results persist and can be reloaded
- source and freshness metadata are visible in stored records
- the same request can be rerun and compared against prior output

Concrete implementation tasks:
- create initial SQL migrations for core tables
- implement repository layer and transactional write patterns
- store source provenance and freshness timestamps on all fetched records
- add plan retrieval by request id or trip plan id
- add internal admin/debug query paths for inspecting planning evidence

## Phase 3: Operator Crawling and Research Ingestion

Objective:
- Make destination and operator recommendations meaningfully better with real source data.

Build:
- BullMQ queues and worker topology
- `crawlOperatorPrices`
- `extractCertificationRequirements`
- `extractOperatorReviews`
- Playwright + Crawlee crawl pipeline for operator websites
- crawl4ai-based extraction where it improves structured content quality
- Reddit integration through `reddit-research-mcp`
- normalization pipeline into `source_records`, `operator_price_snapshots`, `operator_requirements`, and `research_artifacts`

Implementation guidance:
- start with a small set of representative operators across different site styles
- treat crawling as best-effort and non-blocking for the planner
- prefer cached results with freshness notes over long synchronous waits

Exit criteria:
- operators can be crawled and normalized from live sources
- planner can use real operator pricing and requirement data
- research summaries can be attached to destination or operator comparisons

Concrete implementation tasks:
- create queue definitions and worker processors
- implement crawl launcher for known operator URLs
- implement extraction pipeline from raw page to normalized operator data
- integrate `reddit-research-mcp` behind a research adapter
- store crawl failures, retries, and dead-letter cases for inspection
- mark stale or partial data in planner responses

## Phase 4: Recommendation Quality and Ranking

Objective:
- Improve trip quality from "works" to "usefully persuasive."

Build:
- ranking logic for destinations, operators, flights, and accommodations
- explanation generation backed by structured evidence
- certification-fit penalties or exclusions
- seasonality-aware destination scoring
- budget-fit and tradeoff explanation
- comparison outputs for operators, flights, and accommodations

Implementation guidance:
- keep ranking transparent; store explanation factors
- do not overfit to opaque LLM scoring without deterministic inputs
- validate recommendations with real divers where possible

Exit criteria:
- planner can explain why one option is recommended over another
- obviously unsafe or poor-fit options are excluded or clearly demoted
- side-by-side comparison output is stable enough for user review

Concrete implementation tasks:
- implement ranking policy for destination fit
- implement scoring inputs for operator quality, cost fit, and travel convenience
- add structured explanation fields to comparison and trip plan responses
- create regression scenarios to detect ranking drift
- add deterministic exclusion rules for safety or certification mismatch

## Phase 5: Reusable Knowledge Base

Objective:
- Move from one-off planning responses toward a durable product asset.

Build:
- scheduled refresh jobs for known destinations and operators
- stale data policies
- pgvector support for semantic retrieval over research summaries and extracted content
- deduplication of repeated crawls and text artifacts
- destination knowledge enrichment, including marine life and seasonality coverage

Implementation guidance:
- focus on a few strong destinations first rather than broad low-quality coverage
- use embeddings only where they clearly improve recall or summarization
- keep normalized summaries human-auditable

Exit criteria:
- planner increasingly serves from an internal knowledge base instead of only live calls
- freshness and provenance remain visible
- research retrieval quality improves for follow-up questions

Concrete implementation tasks:
- add scheduled refresh jobs
- implement deduplication and merge rules for repeated crawls
- generate and store embeddings for research summaries
- implement semantic retrieval for destination and operator context
- add freshness scoring and staleness thresholds

## Phase 6: Optional Product Enhancements

Objective:
- Add workflow polish after the planner core is reliable.

Candidate additions:
- `getMarineLife`
- `filterSitesByCertification`
- `compareDiveOperators`
- `compareFlightPrices`
- `compareAccommodationPrices`
- `optimizeDiveSchedule`
- `redditDiveShopResearch`
- `searchLocalActivities`
- `createCalendarEvents`

Exit criteria:
- each new capability improves a real user workflow, not just tool count

Concrete implementation tasks:
- add optional tools one category at a time
- gate non-core features behind explicit acceptance criteria
- measure whether each enhancement improves plan quality or follow-up task completion

## Data Acquisition Strategy

The system will only feel credible if the data strategy is deliberate. The data plan should evolve in stages instead of trying to ingest the whole dive-travel universe immediately.

### Stage 1: Seeded Planning Data

Use a small curated dataset to prove the planner workflow.

Scope:
- 3-5 destinations
- 2-4 operators per destination
- representative flight and accommodation fixtures or limited provider results
- a few research summaries per destination

Purpose:
- validate product flow
- unblock tool and service development
- make recommendation logic testable before live crawling is reliable

### Stage 2: Targeted Live Sources

Add real data for a narrow set of destinations.

Scope:
- a small number of operator websites with different page structures
- one or two flight/accommodation acquisition paths
- Reddit research on the same destinations

Purpose:
- prove extraction pipeline quality
- test freshness and partial-failure behavior
- establish normalization rules from real data

### Stage 3: Reusable Knowledge Expansion

Expand only after core quality is acceptable.

Scope:
- scheduled refresh of known operators
- additional destinations in the same region first
- richer marine life and seasonality coverage

Rules:
- prefer depth over breadth at first
- every new source should have a normalization owner
- every new provider should define freshness expectations and fallback behavior

### Data Priority Order

Prioritize acquisition in this order:

1. destination and seasonality data
2. operator pricing and certification requirements
3. flight options
4. accommodation options
5. Reddit research summaries
6. local activities and enrichment

This order matches user trust: if destination fit, operator quality, and itinerary safety are weak, more peripheral data will not save the experience.

## LLM Orchestration Design

The planner should not rely on ad hoc tool chaining. It needs an explicit orchestration pattern so the same request produces repeatable behavior.

### Control Model

Use a hybrid model:

- deterministic services handle parsing, retrieval, filtering, ranking inputs, and safety validation
- the LLM handles synthesis, tradeoff explanation, and composition of the final recommendation

### Recommended Orchestration Stages

```text
User Request
  -> Request Normalization
  -> Candidate Destination Retrieval
  -> Destination Filtering
  -> Travel and Operator Retrieval
  -> Cost Estimation
  -> Itinerary Generation
  -> Constraint Validation
  -> Recommendation Synthesis
  -> Final Trip Plan Response
```

### Planner Loop

The orchestration loop for the primary planning flow should look like this:

1. parse the user request into a `TripRequest`
2. call discovery tools or services to get candidate destinations
3. narrow candidates using budget, certification, seasonality, and marine life filters
4. retrieve operator, flight, accommodation, and research data for the best candidates
5. compute cost estimates and itinerary feasibility
6. enforce hard constraints such as no-fly timing
7. ask the LLM to produce a recommendation and rationale from structured evidence
8. persist the resulting `TripPlan`

### Orchestration Rules

- never let the LLM invent missing structured data when a tool call fails; surface the gap instead
- never let the LLM override hard safety rules
- use tools to fetch facts, not to perform hidden workflow logic
- persist intermediate evidence so recommendation decisions can be audited
- keep the first orchestration path narrow and stable before adding branching complexity

### Suggested Internal Planner Interfaces

```text
TripPlannerService.planTrip(request)
  -> RequestParser
  -> DestinationSelector
  -> OptionRetriever
  -> CostEstimator
  -> ItineraryBuilder
  -> ConstraintEvaluator
  -> RecommendationComposer
```

This is not a public MCP contract. It is the internal orchestration shape the app should converge on.

## Evaluation Loops

The product will fail if it only measures whether tools execute. It must also measure whether the produced trip plans are useful, safe, and believable.

### Loop 1: Functional Correctness

Checks:
- does each tool return valid structured output
- does each service enforce hard rules correctly
- does the planner complete end-to-end without crashing

Examples:
- no-fly rule unit tests
- schema contract tests
- queue retry and failure tests

### Loop 2: Planning Quality

Checks:
- are destination recommendations plausible
- do operator choices fit certification and budget
- are itinerary sequences realistic
- are total cost estimates directionally believable

Mechanism:
- create a benchmark set of representative trip requests
- store expected quality notes for each benchmark
- manually review outputs after major ranking or orchestration changes

### Loop 3: Source Quality and Freshness

Checks:
- how often crawler extraction succeeds
- how fresh operator pricing is
- whether research summaries have enough source coverage
- whether stale data is being surfaced clearly

Mechanism:
- source health dashboards
- freshness reports by destination and operator
- crawl failure review queue

### Loop 4: User Trust and Explanation Quality

Checks:
- can a user understand why the recommendation was made
- does the system clearly call out uncertainty and stale data
- are tradeoffs explained rather than hidden

Mechanism:
- review `TripPlan` rationale outputs
- compare explanation quality across prompt or ranking changes
- collect structured feedback from test users or domain experts

### Benchmark Scenario Set

Maintain a stable scenario set such as:

- budget Caribbean trip from Charleston in April
- beginner diver seeking easy reef diving under a tight budget
- advanced diver seeking sharks in November
- traveler with short trip length where no-fly timing becomes constraining

These scenarios should be rerun whenever ranking, tool contracts, or orchestration logic changes.

## Suggested Workstreams

### Workstream A: MCP and Application Layer

- tool registration
- request validation
- service orchestration
- result shaping

### Workstream B: Domain and Persistence

- schema design
- repositories
- planning artifacts
- constraint evaluation storage

### Workstream C: Crawling and External Adapters

- source adapters
- crawl pipeline
- extraction normalization
- freshness handling

### Workstream D: Recommendation Quality

- ranking rules
- rationale generation
- evaluation with sample requests

## MVP Build Order Inside Phase 1-3

If strict prioritization is needed, build in this order:

1. FastMCP wrapper and one working tool
2. `TripRequest` parsing
3. destination search and seasonality lookup
4. itinerary generation with no-fly rule enforcement
5. flight and accommodation search
6. operator search and simple comparison
7. cost estimation
8. research summarization
9. live operator crawling
10. richer ranking and explanation

## Testing Strategy by Phase

### Early

- unit tests for request normalization
- unit tests for no-fly rule enforcement
- contract tests for tool input/output shapes

### Middle

- repository tests against Postgres
- worker tests for crawl job processing
- adapter tests for source normalization

### Later

- end-to-end scenario tests for full trip planning
- golden test cases for recommendation quality
- failure-mode tests for stale or missing source data

## Operational Readiness Milestones

Before calling the system MVP-ready, verify:

- worker crashes do not break the MCP server
- queue backlog is observable
- source freshness is visible in output
- partial source failure still produces a usable plan
- planner can explain recommendation inputs
- calendar integration remains optional and isolated

## Risks to Watch During Delivery

- spending too long on crawling before proving the planner experience
- letting tool handlers accumulate business logic
- over-modeling provider-specific data too early
- blocking synchronous planning on slow live crawls
- relying on the LLM for safety or ranking logic without deterministic checks

## Recommended Milestone Sequence

```text
Milestone 1: runnable MCP skeleton
Milestone 2: end-to-end trip plan with mocked/simple data
Milestone 3: persisted planning artifacts and core schema
Milestone 4: live operator crawl and research enrichment
Milestone 5: improved ranking and reusable knowledge base
Milestone 6: optional integrations and product polish
```

## Definition of Done for MVP

The MVP is done when:

- an MCP client can call the planner tools successfully
- the planner can produce a coherent `TripPlan`
- the output includes source-backed operator, flight, and accommodation choices
- total estimated cost is computed and explained
- itinerary safety constraints are deterministically enforced
- partial source failures degrade gracefully
- the architecture still follows the thin-tool, service-heavy design

## Final Note

The shortest path to value is not "build every tool." It is "make one complete dive trip plan feel credible." This phased plan is designed to get there quickly, then expand data quality, coverage, and polish without losing architectural discipline.
