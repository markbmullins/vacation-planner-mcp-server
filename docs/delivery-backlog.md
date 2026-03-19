# Dive Vacation Planner Delivery Backlog

## Recommended Epic Order

1. Foundations and repo bootstrap
2. End-to-end planning skeleton
3. Core data model and persistence
4. Operator crawling and research ingestion
5. Travel option ingestion
6. Recommendation, constraints, and itinerary quality
7. MCP tool surface and orchestration hardening
8. Reusable knowledge base
9. Observability and admin/debug tooling
10. Security and privacy
11. Evaluation and testing
12. Deployment and operations
13. Optional enhancements

## EPIC 1: Foundations and Repo Bootstrap

Goal: Stand up the modular monolith, worker runtime, shared conventions, and local developer environment so feature work can proceed in parallel.

### Tickets

- **E1-T1 Project scaffolding and package boundaries**
  - Objective: Create the TypeScript monorepo and package layout for MCP server, workers, shared libraries, and domain modules.
  - Key implementation notes: Use a modular monolith structure with explicit service, adapter, and repository boundaries. Suggested layout: `apps/mcp-server`, `apps/worker`, `packages/domain`, `packages/services`, `packages/adapters`, `packages/data-access`, `packages/shared`.
  - Dependencies: None.
  - Acceptance criteria:
    - Repo builds with a single bootstrap command.
    - MCP server and worker entrypoints start independently.
    - Shared packages can be imported cleanly without circular dependency issues.

- **E1-T2 Local infrastructure and developer bootstrap**
  - Objective: Provide local Postgres, pgvector, Redis, and BullMQ supporting services through containerized development setup.
  - Key implementation notes: Add Docker Compose or equivalent, environment templates, initialization scripts, and startup documentation.
  - Dependencies: E1-T1.
  - Acceptance criteria:
    - One command starts Postgres, Redis, and required local services.
    - `pgvector` is enabled automatically.
    - A new engineer can bring the stack up from docs alone.

- **E1-T3 Configuration, secrets, and environment loading**
  - Objective: Standardize config loading and validation for server, workers, crawlers, and optional integrations.
  - Key implementation notes: Use typed env validation. Separate required from optional variables. Support per-environment configuration.
  - Dependencies: E1-T1.
  - Acceptance criteria:
    - Startup fails fast on missing required config.
    - Optional integrations disable cleanly when config is absent.
    - Secrets are never logged.

- **E1-T4 Base server and health endpoints**
  - Objective: Expose app lifecycle, readiness, and liveness endpoints for interactive and worker runtimes.
  - Key implementation notes: Include dependency checks for Postgres and Redis in readiness. Separate shallow and deep health checks.
  - Dependencies: E1-T2, E1-T3.
  - Acceptance criteria:
    - `health/live` and `health/ready` endpoints exist.
    - Readiness reports dependency failures in machine-readable form.
    - Worker process exposes equivalent operational health signals.

- **E1-T5 Shared logging, request IDs, and error envelope**
  - Objective: Establish structured logs, correlation IDs, and consistent service and tool error handling.
  - Key implementation notes: Inject request and job IDs into logs and async context. Define an error taxonomy for validation, dependency, and planning failures.
  - Dependencies: E1-T1.
  - Acceptance criteria:
    - Every MCP request and background job log contains a correlation ID.
    - Unhandled errors produce a structured error payload and log entry.
    - Service code can access the active request or job context.

- **E1-T6 CI pipeline and quality gates**
  - Objective: Add automated lint, typecheck, unit test, migration check, and build validation.
  - Key implementation notes: Keep CI fast enough for frequent iteration. Fail on migration drift and type errors.
  - Dependencies: E1-T1.
  - Acceptance criteria:
    - Pull request CI runs lint, typecheck, tests, and build.
    - Failing checks block merge.
    - Local reproduction steps are documented.

## EPIC 2: End-to-End Planning Skeleton

Goal: Deliver a working planner flow using simplified and seeded data so orchestration, tool contracts, and user-facing output are proven early.

### Tickets

- **E2-T1 Seed dataset for destinations, operators, flights, and stays**
  - Objective: Create deterministic seed data covering representative dive destinations and travel options.
  - Key implementation notes: Include at least 3 to 5 destinations, 2 to 4 operators per destination, and enough variety to exercise ranking, budget, and safety constraints.
  - Dependencies: E1-T2.
  - Acceptance criteria:
    - Seed command populates destinations, operators, flights, accommodations, and basic research summaries.
    - Seed data includes seasonality, price ranges, and certification requirements.
    - Reset and reseed is repeatable.

- **E2-T2 Trip request intake and normalization service**
  - Objective: Accept natural-language trip requests and normalize them into a structured `TripRequest`.
  - Key implementation notes: Extract budget, dates or month, trip length, certification level, marine life interests, preferences, and unknown fields. Store raw text for auditability.
  - Dependencies: E1-T1, E2-T1.
  - Acceptance criteria:
    - Service returns a normalized request object with explicit unknown or inferred fields.
    - Invalid or underspecified requests return actionable validation feedback.
    - Raw and normalized request values are persisted or stubbed for later persistence wiring.

- **E2-T3 Skeleton planning orchestrator**
  - Objective: Chain parsing, destination discovery, operator comparison, travel lookup, cost estimation, and itinerary assembly using seeded data.
  - Key implementation notes: Implement orchestration in services, not in FastMCP handlers. Return intermediate planning artifacts for later debugging.
  - Dependencies: E2-T1, E2-T2.
  - Acceptance criteria:
    - A single planning call returns destination options, operator comparisons, travel options, cost estimate, and itinerary.
    - Failures in one sub-step degrade gracefully while preserving partial output.
    - Orchestrator emits step-level status for debugging.

- **E2-T4 Deterministic no-fly-after-diving rule in itinerary builder**
  - Objective: Enforce the 24-hour no-fly window in service code from day one.
  - Key implementation notes: Keep rule enforcement in domain services and emit explicit constraint evaluations when the itinerary is rejected or adjusted.
  - Dependencies: E2-T3.
  - Acceptance criteria:
    - Any itinerary violating the 24-hour rule is rejected or adjusted automatically.
    - Response explains the applied safety rule.
    - Unit tests cover compliant and non-compliant itineraries.

- **E2-T5 Initial ranking and explanation scaffold**
  - Objective: Rank seeded recommendations using simple, deterministic weighted heuristics and return clear reasons.
  - Key implementation notes: Start with budget fit, certification fit, travel burden, seasonality, and operator quality placeholders.
  - Dependencies: E2-T3.
  - Acceptance criteria:
    - Recommendations are ordered consistently for identical inputs.
    - Each ranked item includes explanation fields with major scoring drivers.
    - Weights are configurable centrally.

- **E2-T6 Thin FastMCP adapter and first tool contracts**
  - Objective: Expose the initial planner and category-specific tools through a thin FastMCP layer.
  - Key implementation notes: Add tools across Dive Discovery, Operator Research, Travel Planning, Trip Planning, and Research while keeping handlers minimal.
  - Dependencies: E2-T3, E2-T5.
  - Acceptance criteria:
    - FastMCP exposes documented schemas for the initial tool set.
    - Tool handlers return consistent payload shapes and errors.
    - An MCP client can complete one full seeded trip plan end to end.

## EPIC 3: Durable Core Data Model and Persistence

Goal: Replace skeleton storage with the full persistent model and repository layer required for planning, provenance, and later knowledge reuse.

### Tickets

- **E3-T1 Core schema migrations for request and plan entities**
  - Objective: Create tables and indexes for `trip_requests`, `trip_plans`, `itineraries`, `cost_estimates`, `ranking_explanations`, and `constraint_evaluations`.
  - Key implementation notes: Include lifecycle and status fields, timestamps, foreign keys, and JSON columns only where structure is truly variable.
  - Dependencies: E1-T2.
  - Acceptance criteria:
    - Migrations create all listed entities with referential integrity.
    - Roll-forward migration succeeds on a clean database.
    - Repository tests validate basic CRUD and joins.

- **E3-T2 Discovery and operator schema migrations**
  - Objective: Create durable storage for `destinations`, `dive_operators`, `operator_price_snapshots`, and `operator_requirements`.
  - Key implementation notes: Separate stable operator identity data from time-variant prices and requirements.
  - Dependencies: E1-T2.
  - Acceptance criteria:
    - Historical operator prices are stored without overwriting prior snapshots.
    - Operator requirements support certification, experience, equipment, and policy fields.
    - Destination and operator relationships are queryable efficiently.

- **E3-T3 Travel and booking option schema migrations**
  - Objective: Create `flight_options` and `accommodation_options` tables with validity and freshness metadata.
  - Key implementation notes: Store source, fetch time, price currency, cancellation or flexibility signals, and travel-specific fields.
  - Dependencies: E1-T2.
  - Acceptance criteria:
    - Flight and accommodation options support multiple refreshes over time.
    - Freshness metadata is queryable for filtering and display.
    - Repositories support lookups by destination and date window.

- **E3-T4 Research, provenance, and ingestion schema migrations**
  - Objective: Create `research_artifacts`, `source_records`, `crawl_jobs`, and `extraction_runs`.
  - Key implementation notes: Model provenance explicitly so every derived artifact can link back to the underlying sources and extraction passes.
  - Dependencies: E1-T2.
  - Acceptance criteria:
    - Each research artifact can reference one or more source records.
    - Crawl jobs and extraction runs track status, timing, and errors.
    - Operators and destinations can be linked to supporting evidence.

- **E3-T5 Vector support and document storage**
  - Objective: Enable `pgvector` storage and embedding-aware access patterns for reusable research retrieval and deduplication.
  - Key implementation notes: Add vector columns and indexes where needed. Use separate chunk or document storage if helpful.
  - Dependencies: E3-T4.
  - Acceptance criteria:
    - Database stores embeddings and supports similarity search.
    - Query paths exist for top-k relevant research artifacts.
    - Migrations and repository tests cover vector-backed retrieval.

- **E3-T6 Repository layer and transaction patterns**
  - Objective: Implement repositories and service-facing persistence APIs across all core entities.
  - Key implementation notes: Keep repositories focused on data access. Enforce business logic in services. Add transaction helpers for full plan writes.
  - Dependencies: E3-T1, E3-T2, E3-T3, E3-T4.
  - Acceptance criteria:
    - Services can persist and reload a full trip plan with linked artifacts.
    - Transaction boundaries prevent partially written plans on failure.
    - Repository interfaces are test-covered and used by orchestration code.

- **E3-T7 Planner persistence integration**
  - Objective: Replace temporary storage with durable writes and reads in the planning workflow.
  - Key implementation notes: Persist intermediate and final artifacts, including ranking explanations and constraint evaluations.
  - Dependencies: E2-T3, E3-T6.
  - Acceptance criteria:
    - Each planner run creates a durable `trip_request` and linked `trip_plan`.
    - Rerunning the same request creates a distinct plan record or version.
    - Stored plans can be retrieved for debug and replay.

## EPIC 4: Operator Crawling and Research Ingestion

Goal: Build the async pipeline that discovers, crawls, extracts, and normalizes operator and destination research data with provenance and retries.

### Tickets

- **E4-T1 BullMQ job model and worker queue setup**
  - Objective: Create queues and job contracts for crawl dispatch, extraction, enrichment, retries, and dead-letter handling.
  - Key implementation notes: Separate queues by failure domain. Add idempotency keys, retry policy, and job metadata.
  - Dependencies: E1-T2, E1-T5.
  - Acceptance criteria:
    - Workers consume named queues with configured concurrency.
    - Failed jobs retry with backoff and dead-letter after threshold.
    - Job payloads include trace and correlation metadata.

- **E4-T2 Crawl target discovery and scheduling**
  - Objective: Generate crawl jobs for operator sites, destination sources, and supporting research URLs.
  - Key implementation notes: Support manual seed targets first, then freshness-driven scheduling.
  - Dependencies: E4-T1, E3-T4.
  - Acceptance criteria:
    - System can enqueue crawl jobs from configured source lists.
    - Duplicate scheduling is prevented inside freshness windows.
    - Crawl job records persist status and timestamps.

- **E4-T3 Playwright and Crawlee crawler implementation**
  - Objective: Crawl operator and destination websites robustly, including JavaScript-rendered pages.
  - Key implementation notes: Store raw HTML, fetch metadata, and optional screenshots where useful. Classify failure modes.
  - Dependencies: E4-T2.
  - Acceptance criteria:
    - Crawler can fetch representative operator pages successfully.
    - Raw content and metadata are stored as source records.
    - Common failures are classified as blocked, timeout, parse error, or unavailable.

- **E4-T4 crawl4ai extraction pipeline**
  - Objective: Extract structured facts from crawled source content into normalized research artifacts.
  - Key implementation notes: Define schemas for pricing, amenities, policies, certification requirements, and destination conditions.
  - Dependencies: E4-T3, E3-T4.
  - Acceptance criteria:
    - Extraction runs produce schema-validated artifacts.
    - Invalid extractions are flagged without corrupting prior good data.
    - Every artifact links back to source records and extraction runs.

- **E4-T5 Reddit and community research ingestion**
  - Objective: Ingest destination and operator sentiment through `reddit-research-mcp`.
  - Key implementation notes: Treat this as lower-confidence evidence. Tag it separately from primary-source facts.
  - Dependencies: E4-T1, E3-T4.
  - Acceptance criteria:
    - Research jobs can fetch and store Reddit-derived artifacts.
    - Community evidence is tagged distinctly from primary-source data.
    - Downstream ranking and explanation code can consume it safely.

- **E4-T6 Operator normalization and merge service**
  - Objective: Merge crawled and extracted data into canonical `dive_operators` and related snapshots and requirements.
  - Key implementation notes: Handle duplicate names and URLs, conflicting facts, source trust ordering, and snapshot versioning.
  - Dependencies: E4-T4, E4-T5, E3-T2.
  - Acceptance criteria:
    - Canonical operator records update without losing historical price snapshots.
    - Conflicts are stored with provenance instead of being silently overwritten.
    - Merge logic is deterministic and test-covered.

- **E4-T7 Freshness policy and recrawl rules**
  - Objective: Define how often source types are refreshed and how stale data affects planner output.
  - Key implementation notes: Encode freshness SLAs for pricing, operator policies, destination research, and community evidence.
  - Dependencies: E4-T2, E4-T6.
  - Acceptance criteria:
    - Recrawl eligibility is computed automatically.
    - Stale data is visible on stored records.
    - Planner can surface freshness status in responses.

## EPIC 5: Travel Option Ingestion

Goal: Add durable ingestion and refresh of flight and accommodation options needed for realistic plan generation and costing.

### Tickets

- **E5-T1 Flight provider abstraction and initial connector**
  - Objective: Define a flight ingestion interface and implement an initial provider or stub connector.
  - Key implementation notes: Normalize origin, destination airport mapping, layovers, total travel time, and fare details where available.
  - Dependencies: E3-T3.
  - Acceptance criteria:
    - Service can fetch and persist normalized flight options for a date window.
    - Provider failures do not crash planning flow.
    - Connector contract supports future provider swaps.

- **E5-T2 Accommodation provider abstraction and initial connector**
  - Objective: Define a lodging ingestion interface and implement an initial provider or stub connector.
  - Key implementation notes: Normalize location, nightly cost, taxes and fees where available, occupancy, and cancellation signals.
  - Dependencies: E3-T3.
  - Acceptance criteria:
    - Service can fetch and persist normalized accommodation options.
    - Result records include source and freshness metadata.
    - Planner can filter by budget and trip duration.

- **E5-T3 Travel option refresh jobs and persistence integration**
  - Objective: Move flight and lodging retrieval into refreshable background jobs with cache-aware persistence.
  - Key implementation notes: Use BullMQ and Redis for refresh scheduling. Avoid duplicate fetches for equivalent search keys.
  - Dependencies: E4-T1, E5-T1, E5-T2.
  - Acceptance criteria:
    - Jobs refresh travel options asynchronously and persist results.
    - Equivalent searches reuse recent results inside freshness bounds.
    - Fetch failures degrade to last-known-good data where allowed.

- **E5-T4 Origin and destination mapping and airport resolution**
  - Objective: Resolve user-specified origin locations and destination regions into searchable airport sets.
  - Key implementation notes: Add mapping tables or services for metro areas, islands, and remote destinations. Keep deterministic fallback behavior.
  - Dependencies: E2-T2, E5-T1.
  - Acceptance criteria:
    - Planner can map common city inputs to airport codes.
    - Destination recommendations can provide compatible arrival airports.
    - Unknown mappings return explicit planner warnings.

- **E5-T5 Travel planning service integration**
  - Objective: Incorporate persisted flight and accommodation options into planning and cost estimation.
  - Key implementation notes: Planner must work with fresh, stale, or unavailable travel data and mark confidence appropriately.
  - Dependencies: E3-T7, E5-T3, E5-T4.
  - Acceptance criteria:
    - Planner output includes concrete travel options when available.
    - Missing travel data results in partial plans, not hard failure.
    - Travel options are linked to the final trip plan records.

## EPIC 6: Recommendation, Constraints, and Itinerary Quality

Goal: Improve trip quality from merely functional to credible, safe, and explainable.

### Tickets

- **E6-T1 Destination scoring model**
  - Objective: Implement a configurable destination ranking model using trip fit, budget fit, seasonality, travel burden, and evidence quality.
  - Key implementation notes: Separate scoring features from presentation. Include confidence penalties for weak or stale data.
  - Dependencies: E3-T7, E4-T7, E5-T5.
  - Acceptance criteria:
    - Destinations are ranked by an explicit weighted score.
    - Score breakdown is available for explanations and debugging.
    - Config changes can alter scoring without code changes.

- **E6-T2 Operator comparison model**
  - Objective: Compare operators on suitability, requirements match, included services, price recency, and evidence quality.
  - Key implementation notes: Penalize uncertain or stale pricing and requirements. Preserve provenance in comparison output.
  - Dependencies: E4-T6, E4-T7.
  - Acceptance criteria:
    - Operator comparisons show differentiated scores and reasons.
    - Operators that fail certification or experience constraints are excluded or clearly flagged.
    - Comparison output includes freshness indicators.

- **E6-T3 Cost estimation engine**
  - Objective: Produce total and line-item cost estimates from flights, lodging, diving, and buffer assumptions.
  - Key implementation notes: Support low, base, and high estimate bands. Store assumptions for food, transport, taxes, and extras.
  - Dependencies: E5-T5, E4-T6.
  - Acceptance criteria:
    - Planner returns line-item and total cost with currency.
    - Missing components are marked estimated versus sourced.
    - Cost estimates are persisted with assumptions.

- **E6-T4 Constraint evaluation framework**
  - Objective: Centralize deterministic validation for safety, schedule, budget, and eligibility constraints.
  - Key implementation notes: Rules should emit machine-readable results and human-readable explanations. Include the hard 24-hour no-fly rule.
  - Dependencies: E2-T4, E3-T1.
  - Acceptance criteria:
    - Planner stores `constraint_evaluations` for each plan.
    - Violations can block, warn, or suggest adjustment based on severity.
    - Rule results are reproducible and test-covered.

- **E6-T5 Itinerary generator refinement**
  - Objective: Build a safer, more realistic itinerary generator that sequences arrival, dive days, rest buffers, and departure.
  - Key implementation notes: Consider operator schedules, trip length, transfer time, and no-fly enforcement.
  - Dependencies: E6-T3, E6-T4.
  - Acceptance criteria:
    - Itineraries include dated segments with rationale.
    - Generated itineraries satisfy all blocking constraints.
    - Adjustments for flight timing or operator availability are reflected in output.

- **E6-T6 Ranking explanations and provenance surfacing**
  - Objective: Improve user-visible explanations for why options were recommended and what sources support them.
  - Key implementation notes: Persist `ranking_explanations` and link key claims to source records and research artifacts.
  - Dependencies: E6-T1, E6-T2, E3-T4.
  - Acceptance criteria:
    - Each recommendation includes top reasons and cited evidence.
    - Explanations distinguish sourced facts from inferred or estimated values.
    - Debug views can trace explanation claims to stored provenance.

## EPIC 7: MCP Tool Surface and Orchestration Hardening

Goal: Finalize the MCP-facing interface and ensure category-specific tools map cleanly to internal services and partial workflows.

### Tickets

- **E7-T1 Final tool schemas for all MVP categories**
  - Objective: Define production-ready MCP tools across Dive Discovery, Operator Research, Travel Planning, Trip Planning, and Research.
  - Key implementation notes: Inputs and outputs should be explicit and stable. Do not leak internal persistence structures.
  - Dependencies: E2-T6, E5-T5, E6-T6.
  - Acceptance criteria:
    - Tool contracts are documented and versioned.
    - Each category has at least one usable end-to-end tool.
    - Validation errors are consistent across tools.

- **E7-T2 Partial workflow tools and composable service endpoints**
  - Objective: Support using individual planner capabilities independently, not only full trip-plan generation.
  - Key implementation notes: Expose services for destination discovery, operator comparison, costing, itinerary generation, and research lookup.
  - Dependencies: E7-T1.
  - Acceptance criteria:
    - Clients can call individual tool categories without generating a full plan.
    - Partial outputs persist relevant artifacts where appropriate.
    - Tool behavior is consistent with the full planner.

- **E7-T3 Orchestration resilience and graceful degradation**
  - Objective: Harden orchestrator behavior for missing data, timeouts, stale data, and worker lag.
  - Key implementation notes: Add per-step timeouts, fallback policies, and partial-plan response semantics.
  - Dependencies: E6-T5, E5-T5, E4-T7.
  - Acceptance criteria:
    - Planner returns useful partial results when one or more dependencies fail.
    - Responses indicate which sections are stale, missing, or estimated.
    - Timeout and failure handling is integration-tested.

- **E7-T4 Planner replay and deterministic regeneration**
  - Objective: Allow replaying a stored request and plan-generation path for debugging and evaluation.
  - Key implementation notes: Reuse persisted inputs and optionally pin source snapshots during replay.
  - Dependencies: E3-T7, E7-T3.
  - Acceptance criteria:
    - Engineers can trigger replay for a stored `trip_request`.
    - Replay output records whether source data was pinned or refreshed.
    - Divergence from original plan is inspectable.

## EPIC 8: Reusable Knowledge Base

Goal: Convert accumulated research into a reusable destination and operator knowledge base that improves planning quality and reduces repeated crawl cost.

### Tickets

- **E8-T1 Knowledge base document model and chunking**
  - Objective: Define how research artifacts become retrievable KB documents and chunks with embeddings.
  - Key implementation notes: Preserve provenance, freshness, source trust, and entity links per chunk.
  - Dependencies: E3-T5, E4-T4.
  - Acceptance criteria:
    - KB documents and chunks are generated from research artifacts.
    - Each chunk retains entity references and provenance metadata.
    - Embeddings are stored and queryable.

- **E8-T2 Entity-centric KB views for destinations and operators**
  - Objective: Build consolidated knowledge summaries for each destination and operator from underlying evidence.
  - Key implementation notes: Separate canonical facts, softer signals, and unresolved conflicts.
  - Dependencies: E8-T1, E4-T6.
  - Acceptance criteria:
    - Every canonical destination and operator can expose a KB summary view.
    - Conflicting facts are surfaced rather than flattened.
    - Summary regeneration is repeatable after new ingestion.

- **E8-T3 Retrieval service for planner and research tools**
  - Objective: Provide semantic and structured retrieval over KB content for planning and ad hoc research workflows.
  - Key implementation notes: Combine vector retrieval with entity filters and freshness thresholds.
  - Dependencies: E8-T1.
  - Acceptance criteria:
    - Planner and services can retrieve relevant KB evidence for a given trip request.
    - Research tools can query by destination, operator, or topic.
    - Retrieval results include provenance and freshness metadata.

- **E8-T4 Knowledge refresh and invalidation rules**
  - Objective: Keep KB summaries current as new crawls, extraction runs, or community signals arrive.
  - Key implementation notes: Trigger targeted regeneration for changed entities instead of full rebuilds.
  - Dependencies: E8-T2, E4-T7.
  - Acceptance criteria:
    - Changed source data marks affected KB views stale.
    - Regeneration jobs update only impacted entities.
    - Planner can detect and use refreshed KB content.

- **E8-T5 KB-backed recommendation enhancements**
  - Objective: Use the reusable KB to improve ranking, explanation depth, and cold-start behavior.
  - Key implementation notes: Fold in evidence density, confidence, and cross-source agreement as ranking features.
  - Dependencies: E6-T1, E6-T2, E8-T3.
  - Acceptance criteria:
    - Ranking quality improves on benchmark scenarios using KB evidence.
    - Explanations cite KB-derived evidence with provenance.
    - System can plan with less reliance on immediate recrawls.

## EPIC 9: Observability and Admin/Debug Tooling

Goal: Make the system operable by exposing job state, data freshness, source provenance, and planner internals.

### Tickets

- **E9-T1 Metrics and tracing instrumentation**
  - Objective: Add structured metrics and distributed tracing across server, services, workers, and queues.
  - Key implementation notes: Instrument request latency, queue lag, crawl success, extraction quality, freshness coverage, and planner step timing.
  - Dependencies: E1-T5, E4-T1.
  - Acceptance criteria:
    - Core request and job metrics are emitted with useful tags.
    - Traces correlate planning requests to downstream jobs where applicable.
    - Dashboards distinguish planner, crawler, and travel-ingestion issues.

- **E9-T2 Planner debug endpoint or view**
  - Objective: Expose a debug surface for inspecting plan inputs, intermediate decisions, explanations, and constraint results.
  - Key implementation notes: Keep access read-only and mask sensitive user data where needed.
  - Dependencies: E3-T7, E6-T6.
  - Acceptance criteria:
    - Engineers can inspect a plan and see step outputs and final decisions.
    - Constraint evaluations and ranking explanations are visible.
    - Debug surface links to provenance records.

- **E9-T3 Crawl and admin operations view**
  - Objective: Expose crawl job, extraction run, dead-letter, and freshness status for operational debugging.
  - Key implementation notes: Include manual retry and requeue actions behind admin authorization.
  - Dependencies: E4-T1, E4-T7.
  - Acceptance criteria:
    - Admins can view queue health and failed jobs.
    - Dead-lettered jobs can be requeued manually.
    - Freshness status for major data domains is visible.

- **E9-T4 Source provenance and freshness display**
  - Objective: Surface source recency, trust level, and evidence links in planner and admin outputs.
  - Key implementation notes: Standardize freshness states and provenance payload shape across features.
  - Dependencies: E4-T7, E6-T6.
  - Acceptance criteria:
    - Planner responses include freshness visibility for sourced sections.
    - Admin and debug views can trace data back to original sources.
    - Stale data is clearly labeled.

## EPIC 10: Security and Privacy

Goal: Protect user data, control access to admin capabilities, and enforce sensible privacy defaults for research and planning data.

### Tickets

- **E10-T1 Authentication and authorization for admin surfaces**
  - Objective: Add access control for debug and admin endpoints and operational actions.
  - Key implementation notes: Role-based access is sufficient initially. Keep MCP consumer authentication aligned with deployment environment.
  - Dependencies: E9-T2, E9-T3.
  - Acceptance criteria:
    - Admin and debug endpoints require authentication.
    - Sensitive operations require elevated roles or permissions.
    - Unauthorized access attempts are logged.

- **E10-T2 PII handling and data minimization**
  - Objective: Define and enforce what user-identifiable trip data is stored, masked, and retained.
  - Key implementation notes: Avoid storing unnecessary traveler details. Mask logs and debug output.
  - Dependencies: E3-T1, E1-T5.
  - Acceptance criteria:
    - Logs and traces do not expose raw PII unnecessarily.
    - Stored trip request fields are documented and intentionally scoped.
    - Debug and admin outputs mask sensitive fields.

- **E10-T3 Secrets management and outbound request hygiene**
  - Objective: Secure provider credentials and harden outbound crawler and integration request handling.
  - Key implementation notes: Use centralized secret access per environment. Define user-agent, allowlist, and rate-limit policy for outbound requests.
  - Dependencies: E1-T3, E4-T3, E5-T1, E5-T2.
  - Acceptance criteria:
    - Secrets are never committed or logged.
    - Crawler and provider clients use centralized secret access.
    - Outbound request policy is documented and enforced in code.

- **E10-T4 Retention and deletion controls**
  - Objective: Implement retention rules for trip requests, research artifacts, and operational records.
  - Key implementation notes: Separate user-request retention from durable non-PII research data.
  - Dependencies: E3-T1, E3-T4.
  - Acceptance criteria:
    - Retention jobs or policies exist for time-bounded data.
    - Deletion behavior is documented and testable.
    - Planner and admin queries handle expired or deleted records gracefully.

## EPIC 11: Evaluation and Testing

Goal: Create a repeatable quality loop with automated tests, benchmark scenarios, and regression detection across planning and ingestion.

### Tickets

- **E11-T1 Benchmark scenario suite**
  - Objective: Define representative dive trip scenarios covering budget, certification level, flexibility, destination style, and tricky constraints.
  - Key implementation notes: Include scenarios for no-fly pressure, stale data, missing travel options, and conflicting operator evidence.
  - Dependencies: E2-T3.
  - Acceptance criteria:
    - Scenario fixtures are stored in version control.
    - Each scenario has expected qualitative outcomes or invariants.
    - Benchmarks can run locally and in CI.

- **E11-T2 Service-level unit tests for planning rules**
  - Objective: Cover normalization, ranking, costing, itinerary, and constraint services with deterministic tests.
  - Key implementation notes: Prioritize safety and scoring logic using fixture-based tests.
  - Dependencies: E6-T1, E6-T3, E6-T4.
  - Acceptance criteria:
    - Core planning services have meaningful unit coverage.
    - The 24-hour no-fly rule has explicit regression tests.
    - Fixtures are easy to extend.

- **E11-T3 Integration tests for planner and persistence flows**
  - Objective: Validate full planner execution against seeded and persisted data and stored outputs.
  - Key implementation notes: Include graceful degradation and partial failure cases.
  - Dependencies: E3-T7, E7-T3.
  - Acceptance criteria:
    - Tests cover end-to-end plan creation and retrieval.
    - Partial dependency failures still produce expected partial outputs.
    - Persisted records match returned response structures.

- **E11-T4 Worker pipeline integration tests**
  - Objective: Test crawl, extract, normalize, and persist flows using fixtures rather than live sites.
  - Key implementation notes: Use recorded pages or controlled fixtures in CI.
  - Dependencies: E4-T6.
  - Acceptance criteria:
    - Worker tests validate crawl job lifecycle and stored outputs.
    - Extraction validation failures are covered.
    - Retry and dead-letter behavior is tested.

- **E11-T5 Ranking and recommendation evaluation loop**
  - Objective: Measure recommendation quality and compare scoring or orchestration changes over time.
  - Key implementation notes: Capture score breakdowns and plan diffs for benchmark scenarios.
  - Dependencies: E6-T1, E6-T2, E8-T5.
  - Acceptance criteria:
    - Engineers can run evaluation before changing ranking logic.
    - Results show deltas versus baseline for key scenarios.
    - Regressions are visible and actionable.

- **E11-T6 Contract tests for MCP tools**
  - Objective: Lock down tool schemas and output compatibility for MCP consumers.
  - Key implementation notes: Validate request and response shapes and error envelopes per tool category.
  - Dependencies: E7-T1.
  - Acceptance criteria:
    - Tool schema changes fail tests unless intentionally updated.
    - Error cases are covered for each tool family.
    - Contract suite runs in CI.

## EPIC 12: Deployment and Operations

Goal: Make the system deployable, observable in production-like environments, and operable under failure conditions.

### Tickets

- **E12-T1 Environment-specific deployment manifests**
  - Objective: Create deployment configs for server, workers, Postgres or Redis dependencies, and scheduled jobs.
  - Key implementation notes: Separate interactive and worker scaling. Include health checks and resource settings.
  - Dependencies: E1-T4, E4-T1.
  - Acceptance criteria:
    - Non-local environments can deploy server and workers independently.
    - Health and readiness probes are wired into deployment manifests.
    - Config and secret injection is environment-specific.

- **E12-T2 Database migration and release workflow**
  - Objective: Standardize safe migration execution during deploys.
  - Key implementation notes: Add startup guards and documented forward and rollback procedures.
  - Dependencies: E3-T1, E3-T2, E3-T3, E3-T4, E3-T5.
  - Acceptance criteria:
    - Release workflow runs migrations safely.
    - Migration status is visible in deployment logs and monitoring.
    - Failed migrations halt release cleanly.

- **E12-T3 Queue operations, scaling, and failure playbooks**
  - Objective: Define how workers scale, recover, and are operated under crawl and travel-ingestion load.
  - Key implementation notes: Include queue lag alarms, concurrency tuning, and dead-letter procedures.
  - Dependencies: E4-T1, E9-T1.
  - Acceptance criteria:
    - Operational runbooks exist for queue backlog and dead-letter spikes.
    - Worker scaling knobs are documented and configurable.
    - Alerts fire for critical lag and failure conditions.

- **E12-T4 Backup, restore, and disaster recovery validation**
  - Objective: Ensure critical data stores can be restored and service resumed.
  - Key implementation notes: Cover Postgres first. Redis rebuild assumptions are acceptable if documented.
  - Dependencies: E3-T7, E12-T1.
  - Acceptance criteria:
    - Backup and restore procedure is documented and tested.
    - Recovery point expectations are explicit.
    - Core planning functionality works after restore validation.

## EPIC 13: Optional Enhancements

Goal: Extend the product beyond MVP with features that improve workflow polish without blocking the core planner.

### Tickets

- **E13-T1 Calendar export integration** `[Optional/Post-MVP]`
  - Objective: Persist and export planned itineraries to calendar providers and track exports in `calendar_exports`.
  - Key implementation notes: Keep integration provider-agnostic and optional. Export only after itinerary constraints pass.
  - Dependencies: E6-T5, E10-T1.
  - Acceptance criteria:
    - Users can export a trip itinerary to a configured calendar provider.
    - Export records are stored with status and timestamps.
    - Missing calendar config disables the feature gracefully.

- **E13-T2 Manual trip plan editing and re-costing** `[Optional/Post-MVP]`
  - Objective: Let users or internal operators adjust a generated itinerary and recalculate downstream impacts.
  - Key implementation notes: Preserve the original plan and create a new plan version for edits.
  - Dependencies: E3-T7, E6-T3, E6-T5.
  - Acceptance criteria:
    - Edited plans are stored as distinct versions.
    - Cost and constraint evaluations rerun after edits.
    - Unsafe edits are blocked or warned appropriately.

- **E13-T3 Saved preferences and returning-traveler profiles** `[Optional/Post-MVP]`
  - Objective: Reuse traveler preferences across planning sessions.
  - Key implementation notes: Keep privacy scope narrow and do not block planning on profile support.
  - Dependencies: E10-T2.
  - Acceptance criteria:
    - Returning users can apply stored default preferences.
    - Planner still works fully without profile data.
    - Stored preferences follow masking and retention rules.

- **E13-T4 Proactive freshness alerts and recrawl triggers** `[Optional/Post-MVP]`
  - Objective: Notify internal operators when critical pricing or requirement data becomes stale or changes significantly.
  - Key implementation notes: Build on freshness metadata and admin tooling. Start internal-only.
  - Dependencies: E4-T7, E9-T3.
  - Acceptance criteria:
    - Stale or high-change records generate alert events.
    - Admins can see why an alert fired.
    - Alerts are throttled to reduce noise.

- **E13-T5 Alternative recommendation strategies and experimentation** `[Optional/Post-MVP]`
  - Objective: Support offline comparison of ranking models and prompt or research strategies.
  - Key implementation notes: Use the benchmark harness first. Avoid uncontrolled live experimentation.
  - Dependencies: E11-T5, E8-T5.
  - Acceptance criteria:
    - Multiple ranking strategies can run against the same benchmark set.
    - Evaluation output compares outcomes side by side.
    - Default production strategy remains explicitly configured.

- **E13-T6 Remaining optional product-surface tools** `[Optional/Post-MVP]`
  - Objective: Add non-core tools after the planner core is reliable.
  - Key implementation notes: Implement one category at a time and require explicit acceptance criteria per capability.
  - Dependencies: E7-T2, E8-T5.
  - Acceptance criteria:
    - The following tools are implemented incrementally as justified: `getMarineLife`, `filterSitesByCertification`, `compareDiveOperators`, `compareFlightPrices`, `compareAccommodationPrices`, `optimizeDiveSchedule`, `redditDiveShopResearch`, `searchLocalActivities`.
    - Each tool improves a measurable user workflow or follow-up completion rate.
    - Non-core tools remain isolated from core planner stability.

## Suggested MVP Cut Line

The practical MVP scope is:

- Epics 1 through 7 in full
- Critical observability from Epic 9
- Core security and privacy controls from Epic 10
- Essential testing from Epic 11
- Basic deployment and operational readiness from Epic 12

Epics 8 and 13 are the primary post-MVP expansion path, though parts of Epic 8 may be pulled earlier if reusable retrieval becomes necessary for recommendation quality.

## Deferred Autodev Follow-ups

- **FUP-E1-T5-01 Deferred follow-up for E1-T5 Shared logging, request IDs, and error envelope**
  - Objective: Address deferred review findings discovered while implementing `E1-T5`.
  - Key implementation notes: Keep scope limited to the issues below. Original ticket: `E1-T5`. Suggested slug: `shared-logging-request-ids-and-error-envelope`.
  - Deferred review findings:
    - BLOCKER: Health server logging is not actually wired into either runtime - `packages/shared/src/health/server.ts:158` now supports structured logging via an optional `logger`, but neither `apps/mcp-server/src/index.ts` nor `apps/worker/src/index.ts:93` passes `logger: log` when starting the health server. In production this still writes plain-text `[health] ...` lines to stdout, so logging is not consistently using the shared structured logger across the server/worker processes.
    - MAJOR: Missing integration coverage for server/worker logging wiring - The new tests only verify `createHealthServer` in isolation. There is no test covering the actual `apps/mcp-server` and `apps/worker` startup wiring, so the current regression slipped through even though the ticket's acceptance depends on the runtime using the shared logging/error setup. Add an entrypoint-level test or equivalent verification that the runtimes pass their logger into the health server and emit structured startup logs.
  - Dependencies: Schedule after the original ticket's parent flow is complete.
  - Acceptance criteria:
    - Deferred review findings are addressed without expanding scope.
    - Existing behavior from the original ticket remains intact.

- **FUP-E1-T5-02 Deferred follow-up for E1-T5 Shared logging, request IDs, and error envelope**
  - Objective: Address deferred review findings discovered while implementing `E1-T5`.
  - Key implementation notes: Keep scope limited to the issues below. Original ticket: `E1-T5`. Suggested slug: `shared-logging-request-ids-and-error-envelope`.
  - Deferred review findings:
    - MAJOR: Untitled issue - The ticket acceptance criteria require every MCP request log to carry a correlation ID, but the MCP side only has a TODO/comment showing how future tool handlers should call `runWithContext(...)`. There is no implemented request-scoped helper or actual request wiring yet, so the request-ID portion of the ticket is still incomplete.
    - MAJOR: Untitled issue - `wrapJobProcessor` is defined in the worker process entrypoint, and the comment explicitly suggests importing it from `../index.js`. Importing that file also executes dotenv/config loading, installs signal/error handlers, and starts the health server. That makes the shared job-context helper unsafe to reuse from real BullMQ processor modules and violates the intended thin-entrypoint/shared-logic architecture. The wrapper should live in a side-effect-free shared/module file.
  - Dependencies: Schedule after the original ticket's parent flow is complete.
  - Acceptance criteria:
    - Deferred review findings are addressed without expanding scope.
    - Existing behavior from the original ticket remains intact.
