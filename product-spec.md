# Product Overview

Dive Vacation Planner is an MCP-powered trip planning product for scuba travelers. A user can describe a dive trip in natural language - such as destination preferences, timing, budget, marine life interests, certification level, and trip length - and receive a complete trip plan with destination recommendations, operator options, flight and accommodation comparisons, estimated costs, and a safe itinerary.

The product aims to solve a real niche problem: dive travel planning is fragmented across airline sites, hotel listings, dive shop websites, Reddit threads, and manual itinerary building. The planner brings those inputs together into one workflow and is positioned as a potential "Skyscanner for dive trips."

# System Scope

The Dive Vacation Planner MCP server is responsible for:

- orchestrating dive travel planning workflows
- aggregating travel data from external sources
- crawling dive operators
- synthesizing trip plans using LLM reasoning
- exposing capabilities as MCP tools

The system is NOT responsible for:

- flight ticket booking
- hotel booking
- dive reservation payments
- travel insurance
- airline APIs or payment processing

External services provide raw data; the MCP server aggregates and reasons over it.

This scope definition helps prevent the system from being designed too large or too small.

# Core Data Entities

These are product-facing entities that support the user workflow. They define the information a user needs to plan and compare a trip; technical architecture can model them however it wants internally.

Trip Request
- origin
- trip length
- travel month or dates
- budget
- preferred region or destination
- certification level
- marine life interests
- trip preferences (for example price, trip style, non-diving activities)

Destination Option
- destination name
- region
- country
- why it matches the request
- best months or seasonality
- expected marine life
- certification fit
- indicative trip cost range

Dive Operator Option
- name
- location
- certification requirements
- dive package prices
- equipment rental availability
- review score
- why it is recommended

Flight Option
- airline
- departure
- arrival
- price
- duration

Accommodation Option
- name
- type (airbnb, hotel, dive resort)
- price
- location
- rating

Itinerary
- daily plan
- dive days
- rest or surface interval days
- non-diving activities
- arrival and departure timing
- safety constraints applied

Cost Estimate
- flight cost
- accommodation cost
- dive cost
- food or local transport allowance
- total estimated cost

Trip Plan
- selected destination
- selected dive operator
- selected flight option
- selected accommodation option
- itinerary
- estimated total cost
- rationale for recommendation

These entities keep the product spec focused on user decisions and outputs rather than low-level system abstractions.

# User Goals

- Find the best dive destination for a specific region, season, budget, or marine life goal.
- Compare dive operators, prices, requirements, and reviews without manual research across many sites.
- Compare flights and accommodation options for a dive trip.
- Understand the full expected trip cost before booking.
- Generate a realistic day-by-day itinerary for a dive vacation.
- Avoid unsafe or poor trip choices, including bad weather windows and flying too soon after diving.
- Optionally sync the final plan into a calendar.

# MVP Features

- Natural-language trip planning that turns a request into a complete dive trip recommendation.
- Dive destination discovery with site details, best season guidance, and marine life context.
- Dive operator search for a destination, including package prices, equipment rental, certification requirements, and review signals.
- Reddit-based dive research to summarize community opinions on destinations and operators.
- Flight aggregation for trip routing and price comparison.
- Accommodation comparison across Airbnb, hotels, and dive resorts.
- Trip cost estimation combining flights, lodging, dives, and other major trip expenses.
- AI itinerary generation with dive-day sequencing, rest day suggestions, and enforced no-fly-after-diving safety rules.

Core MVP user workflows:

- A traveler asks for a dive trip by budget, region, month, and duration, then receives a recommended destination with flights, lodging, operator options, and a sample itinerary.
- A traveler researches a destination, checks seasonality and marine life, compares operators, and decides whether the destination fits their certification level and budget.
- A traveler compares multiple trip options and reviews a total estimated budget before choosing one.
- A traveler converts the recommended itinerary into a usable trip schedule.

# Core MCP Tool Categories

These categories formalize the product capabilities that should be exposed through MCP. Tool names are representative examples and can be adjusted during implementation, but the capability coverage should remain consistent with the product scope.

Dive Discovery
- `searchDiveSites`
- `getDiveSiteDetails`
- `getBestSeason`
- `getMarineLife`
- `filterSitesByCertification`

Operator Research
- `findDiveOperators`
- `crawlOperatorPrices`
- `extractCertificationRequirements`
- `extractOperatorReviews`
- `compareDiveOperators`

Travel Planning
- `searchFlights`
- `compareFlightPrices`
- `searchAccommodation`
- `compareAccommodationPrices`

Trip Planning
- `estimateTripCost`
- `generateDiveTripItinerary`
- `optimizeDiveSchedule`
- `scheduleSurfaceIntervals`

Research
- `redditDiveSiteResearch`
- `redditDiveShopResearch`
- `summarizeRedditOpinions`
- `searchLocalActivities`

Optional Integration
- `createCalendarEvents`

These tool categories help keep the MCP surface aligned to product jobs: discover destinations, evaluate operators, compare trip components, synthesize a plan, and optionally turn the plan into a usable schedule.

# Future Features

- Google Calendar sync for flights, dive briefings, dive schedules, and trip events.
- Local activities finder for tours, restaurants, and non-diving activities.
- Best season detection that explicitly avoids hurricane season, rainy season, and bad visibility months.
- Marine life finder for trips centered on a species or encounter goal.
- Dive skill matching based on certification level.
- Global dive knowledge database that stores dive sites, operators, prices, marine life data, and reviews for reuse across tools.
- Smarter recommendation and ranking capabilities that make the planner meaningfully better than generic travel tools.

# Technical Constraints (copied from source)

- Start with an MCP framework (FastMCP or similar). Do NOT build your own initially.
- Design your code so the framework is replaceable, because MCP is still evolving.
- The project value is not MCP infrastructure; the value is dive site discovery, flight search aggregation, reddit dive research, itinerary generation, crawling dive operators, and cost optimization.
- The MCP layer should be very thin.
- Avoid putting logic inside tools.
- Tools should be simple primitives: `tool -> get data`; `LLM -> reason about data`.
- Use tools like `https://github.com/punkpeye/fastmcp` but keep it abstracted so it can be swapped later.
- Use `https://github.com/unclecode/crawl4ai`.
- Use `https://github.com/king-of-the-grackles/reddit-research-mcp`.
- Recommended stack from source:
  - Language: TypeScript
  - MCP layer: FastMCP
  - Crawler: Playwright + Crawlee
  - Database: Postgres + pgvector
  - Queue: BullMQ
- Important domain rule: no flying within 24 hours after diving; the system should enforce that automatically.

# Technical Ideas Worth Preserving

- Model the product as an MCP server where each capability is exposed as a focused tool.
- Keep a thin tool layer over separate service modules so business logic is isolated from the MCP framework.
- Use tool categories that map to the user journey: dive site discovery, operator finding, Reddit research, accommodation comparison, flight aggregation, cost estimation, itinerary generation, and calendar integration.
- Crawl dive operators to collect package prices, equipment rental, certification requirements, and review ratings, then rank them.
- Aggregate multiple flight sources such as Google Flights, Skyscanner, Kayak, and ITA Matrix.
- Use Reddit as a high-value research source for qualitative dive destination and operator insight.
- Chain simple tools together so the LLM can compose a full planning workflow.
- Consider a long-term global dive knowledge database so crawled data becomes a reusable product asset rather than one-off search output.
