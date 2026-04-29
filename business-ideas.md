# Business Ideas — Trevor's running list

JARVIS researches every idea in this file once a week. Reports land in
`reports/business-ideas/YYYY-MM-DD-<slug>.md`. Phone notification fires
when the cycle completes.

## How to use this file

1. Add an idea as a top-level `## Heading`. The heading text becomes the
   idea title. The slug (used in report filenames) is auto-derived.
2. Optional first line under the heading: `Tags: a, b, c` and/or
   `Status: ...`. Status is organizational only — every idea is
   researched equally regardless of status, no filtering.
3. Everything below those metadata lines is free-form description —
   write as much or as little as you want. JARVIS uses the description
   to seed the research queries, so being specific helps.
4. Save the file. Next weekly cycle picks up new entries automatically.
5. To trigger an immediate research run for one idea (without waiting
   a week): `businessIdeas.runOne` tRPC endpoint. To run the whole
   list: `businessIdeas.runAll`.

## What "research" actually does per idea

- 4-6 web searches: market signal, competitor scan, recent news, adjacent
  patterns, regulatory blockers (when relevant)
- Multi-hop retrieval against your own knowledge graph for related
  context you've already scraped
- LLM synthesis (smartChat, "self_evaluate" intent) into a structured
  report: market signal, competitors found, recent news, feasibility
  for *your* skill set + capital, recommended next 1-2 steps
- Comparison against last week's report: what changed?

---

## Soundara — Binaural Beats Platform
Tags: audio, consumer, marketplace, subscription
Status: active

Inspired by the Monroe Institute Experiments and the CIA in the 1980s, this concept brings upon the ideas of hemi-sync, gateway experiences, etc, through customized music.
Upload track files or URLs to the website for it to be converted into a Binaural Beat
The program has adjustable and custom frequencies including Gamma, Beta, Alpha, Theta, Delta, Schumann, and Custom Frequencies
The website also introduces music making tools so creators can create their own music, publish it to the platform, and earn 70% royalty on their music. Platform owner gets other 30%.
Each converted track is $0.08 per MB, or 12.99 Limited Subscription, or 16.99 Unlimited Subscription
Customizable Playlists like Spotify with a bottom centered music bar
Working to get copyrights license to be some culmination of garageband, spotify, and soundcloud.

Domain owned: soundara.co.

## Subliminal Learning
Tags: edtech, ai, consumer, content
Status: active

Uses the pyschological effects of subliminal messaging to teach concepts to people unconsciously
Uses low sound volume, barely audible frequency, flashing images and words, to teach humans
People will upload a reading, website, notes, pdf, etc to be scraped and it produces media in the forms of videos or music. The media can be directly related to the topic or not at all, the key comes from the subliminal learning aspect. However, people will absorb more if it is about the topic.
The idea is to combine entertainment with learning.

## Note-to-Video Creation
Tags: edtech, ai, content, b2c
Status: active

Similar to that of subliminal learning
Turns notes, pdfs, and other sources of information into watchable videos
The idea is that people would much rather watch something than read something
Additionally there is a lot better absorption through audio and images, than just words. So by combining a trifecta this will increase learning and decrease mental load.

## JARVIS AI — Personal AI Operating System
Tags: ai, personal-ai, b2c, b2b
Status: active

# JARVIS v10 — Personal AI Operating System

A fully autonomous AI system with **34 specialized agents**, **DeepSeek-R1 reasoning**, **chat branching**, **curiosity-driven learning**, **4-pass book generation**, browser automation, stock trading, and cross-domain expertise across engineering, law, history, Catholicism, finance, and more. Runs locally on commodity hardware. No cloud dependency required.

**Current intelligence rating: 7-7.5/10 (junior professional tier)** — up from 4.5/10 in v7.7. Crosses the threshold from "impressive demo" to "genuine productivity tool."

(Original v10 README description preserved as Trevor wrote it. Note: project is now at v16 — see project's actual README.md and CLAUDE.md for current state. Tracking here so weekly research surfaces competitor moves, pricing signals, and news that affect positioning.)

### Core Intelligence (the brain)
- **34-Agent Swarm** — Researchers, analysts, coders, planners, executors, memory keepers, QA, security, creative, knowledge, operations, finance, and maintenance specialists working in parallel
- **DeepSeek-R1 Reasoning** — Dedicated reasoning model with native `<think>` step-by-step deliberation. Auto-routes math, logic, analysis, planning, and multi-step queries.
- **Multi-Hop Knowledge Graph RAG** — Vector search (ChromaDB) + entity graph traversal (2 hops) + re-ranking by vector/entity/graph centrality. 96k+ entities, 572k+ connections.
- **Reflection Layer** — Every major tool call gets post-hoc LLM evaluation. Past lessons injected into future related queries.
- **Goal Persistence** — Long-term goals tracked across conversations. LLM auto-decomposes into subtasks with deadlines.
- **Active Learning** — Hedge-word detector auto-logs confused responses. Weekly weakness-topic scan triggers targeted scraping. Corrections weighted 3× in auto-training.
- **Unknown Scheduler (Curiosity-Driven)** — Daily 3-phase cycle: detect weaknesses from 4 signals → LLM generates targeted search queries → injects URLs into crawl frontier → tracks effectiveness → promotes persistent weaknesses to permanent scrape sources.
- **Tool Composition / Planner** — Tool registry. LLM generates JSON plan → executes with variable passing → per-step retry + failure replan.

### Pricing tiers (envisioned)
- Personal License (self-hosted): $499 one-time
- Pro License (self-hosted): $1,499 one-time
- SaaS Personal: $29/mo
- SaaS Pro: $99/mo
- SaaS Business: $299/mo
- Enterprise Self-hosted: $10k-50k/yr
- Enterprise Managed: $25k-100k/yr
- Consulting / Custom Agents: $200-400/hr
- White-label Licensing: $50k-250k one-time
- Book Writer SaaS: $49/mo
- Finance SaaS (Brokerage overlay): $79/mo

## Sound Polarization for Noise Cancellation
Tags: hardware, consumer, audio, deep-tech
Status: active

The idea here is to create a noise canceling space
Unlike headphones which is personal this can impact a whole room or area
By using the same concept of headphones for noise cancelation but by using different methods for noise cancelation
Setting up speakers outside of the room of space, so when sound reaches the microphones the speakers can create an inverse sound wave before it reaches the space
Or you can create a huge sound wave in hopes to cancel out the smaller sound wave, and by knowing that huge one, you can send an inverse one to cancel it out.
Another method is:
Like how polarizing sunglasses polarize light, maybe somehow you can polarize sound and by overlapping these at different angles it can provide total noise cancelation
In todays bustling word there is no quiet and people are yearning for more and more quiet everyday.

## SkyRent — Rental Marketplace
Tags: marketplace, mobile, b2c, supabase
Status: active

Project Scope Analysis
What "SkyRent" Suggests:
Based on the name and tech stack, this appears to be a property/equipment rental platform:
Potential Features:

- 📱 Browse rental listings (properties, equipment, vehicles)
- 🔍 Search and filter functionality
- 📅 Booking/reservation system
- 💳 Payment processing
- 👤 User profiles (renters & owners)
- ⭐ Reviews and ratings
- 📸 Photo uploads for listings
- 💬 Messaging between users
- 📍 Location-based search
- 📊 Analytics dashboard

Development Stage Estimate
Based on 1 Commit + PLpgSQL Percentage:
You've likely completed:

- ✅ Initial Expo project setup
- ✅ Supabase project creation
- ✅ Basic database schema (tables for users, listings, bookings)
- ✅ Environment configuration
- ✅ Git repository initialization

You haven't completed yet:

- ❌ Custom UI components
- ❌ Authentication flow
- ❌ Listing creation/management
- ❌ Search functionality
- ❌ Payment integration
- ❌ Image upload system
- ❌ Booking logic
- ❌ Push notifications
- ❌ App Store deployment

Estimated Completion: 5-10%

Strengths of Your Approach
1. Modern, Battle-Tested Stack — same stack used by billion-dollar companies. Smart.
2. Rapid Development Platform — Rork + Claude = incredible velocity for prototyping
3. Cross-Platform from Day 1 — no need to build separate iOS and Android apps
4. Scalable Backend — Supabase can handle growth without major rewrites
5. TypeScript — type safety will save countless debugging hours

Potential Challenges Ahead
Technical:
- Real-time Booking Conflicts — race conditions when multiple users try to book the same slot
- Payment Processing — Stripe integration + handling failed payments
- Image Optimization — large photos will slow down the app
- Offline Functionality — what happens when users lose connection?
- Push Notifications — requires custom development build
- Geolocation — privacy considerations + battery drain

Business:
- Marketplace Chicken-and-Egg — need both renters AND rental owners
- Trust & Safety — verification, fraud prevention, disputes
- Legal Compliance — terms of service, privacy policy, insurance
- Competition — Airbnb, Turo, various niche rental platforms
- Monetization — commission structure, pricing strategy

Comparison to Other Projects
- vs. GroceryScan: SkyRent 5% complete (Supabase, marketplace model, high complexity 2-sided), GroceryScan 70%+ (custom APIs, iOS in progress, API-partnerships revenue, medium complexity single-sided utility)
- vs. Soundara: SkyRent 5% (Supabase, security not implemented, $0, no domain), Soundara production-ready (FastAPI custom, Phase 0 security complete, generating revenue, soundara.co)
- vs. JARVIS: SkyRent early standard app, JARVIS nearly operational, very high complexity (multi-agent), cutting-edge AI

Strategic Recommendations
Option 1: Full Commitment (3-6 months)
  Phase 1 MVP (4-6 weeks): auth, listing creation, simple booking (no payment yet), profiles, basic search
  Phase 2 Monetization (4-6 weeks): Stripe, commission system, payouts, reviews, messaging
  Phase 3 Growth (8-12 weeks): push notifications, advanced search, analytics, marketing site, App Store launch
  Total Investment: ~$20-40K opportunity cost if focused full-time

Option 2: Side Project (6-12 months) — 5-10 hrs/week alongside other projects, MVP in 3 months, test small, decide based on traction

Option 3: Portfolio Piece (1-2 months) — UI/UX, working booking flow no payments, showcase TypeScript + Supabase skills

Revenue Potential Analysis
Monetization: Commission Model (10-20% per transaction), Subscription ($10-50/month for hosts), Featured Listings ($5-20/listing), Service Fees (flat fee per booking)
Market Size: Vacation Rentals $87B globally (Airbnb $65B), Equipment Rentals $50B+, Vehicle Rentals $100B+ (Turo $2B valuation)
Realistic First Year: Optimistic $5-10K, Realistic $500-2K, Pessimistic $0 (failed critical mass)

Competitive Analysis
Direct Competitors: Airbnb (vacation, giant), Turo (cars, unicorn), Fat Llama (equipment, UK), PeerRenters (general P2P), Neighbor (storage)
Potential Edge: Hyper-local focus (USAFA cadets? Aurora residents?), Niche vertical (ski equipment? dorm furniture?), Better UX (simpler than Airbnb), Lower fees (undercut 20% Airbnb commission)

Resource Requirements
Development Time: Solo at USAFA pace 6-12 months, Full-time 3-4 months, With team 2-3 months
Financial Investment: Supabase $25/mo Pro, Expo EAS $29/mo for builds, Domain $12/yr, Apple Developer $99/yr, Google Play $25 one-time, Stripe fees 2.9% + $0.30 per transaction
Total Year 1 Costs: ~$800-1,200
Opportunity Cost: time away from GroceryScan, Soundara V2/V3, JARVIS, academics/PT

Recommendation (prior assessment)
Priority Ranking: JARVIS (highest innovation factor) > GroceryScan (revenue path) > Soundara (already making money) > SkyRent (5% complete, competitive market)
Suggested: Put SkyRent on ice OR pivot to cadet-specific niche (textbook rentals, uniform exchange, car sharing for USAFA) — much smaller scope, real users available (classmates), portfolio-piece value.

Final Assessment
Current State: Early-stage prototype, strong technical foundation
Potential: Medium-high (if committed fully)
Risk: High (marketplace dynamics, competition)

## Oil + Airline Vertical Integration
Tags: moonshot, transportation, energy, infrastructure
Status: active

This is obviously very long term
The idea here is to monopolize the market because airlines are super costly, time consuming, and uncomfortable
The idea is to create more luxurious, faster and cheaper travel, with better convenience
Free wifi whole flight
Actual in flight TVs
Cheaper oil prices -> Cheaper flights
Bigger and more comfortable seats
Faster travel
Appeals to me because I am always uncomfortable on an air plane as a 6'2 guy with 6'5 legs.

## Own a Sports Team
Tags: moonshot, sports, entertainment
Status: active

Pretty simple idea
Sports teams like NFL and NBA rake in lots of money per year
Plus I could give input into how I want the game to be played
For example in the NFL:
Onside kick return
Go for it on 4th down
Always go for two points

## AI Stock Market Optimizer Trader
Tags: ai, fintech, b2c, automation
Status: active

Create an AI or program that trades stocks for me
Idea is to free up time while also generating more revenue than how much money I earn stocks now
Huge upside if able to be executed correctly

## Personal Brand Website
Tags: marketing, web, personal-brand
Status: active

Idea is to create my own website to put my name out there
Also have people interested in helping with all these ideas so I can get them off the ground
Good for advertising

## Make Websites for Friends (×2)
Tags: web, services, side-income
Status: active

Two website builds for friends — barter / paid / portfolio piece TBD. Could become a freelance side-income channel if the workflow is templated.

## AR Meta Glasses for Angular Viewing Correction
Tags: hardware, ar, accessibility, deep-tech
Status: active

Often times in life there is tiny print at just out of reach to read, or you are viewing words from an angle and can't exactly make them out because of the angle
The purpose of these glasses is to fix the picture, re-adjust the angle so it looks like your looking at it straight on, auto adjust and correct text for better viewing, zooming the text in

## GroceryScan — Grocery Barcode Scanner App
Tags: mobile, b2c, health, fintech
Status: active

GroceryScan / Scan-to-Cart is an iOS grocery shopping app that lets users scan product barcodes to instantly look up food information and prices across multiple stores.

Core Features:
- Barcode scanner using the phone camera to identify any grocery product
- Product details including nutrition facts, health score, and nutriscore grade
- Price comparison across 8 stores — Walmart, Target, Kroger, Whole Foods, Costco, ALDI, Publix, and Hannaford
- Virtual shopping cart where you add items at your preferred store
- Cheaper and healthier alternative suggestions for any scanned product

Tracking & Analytics:
- Monthly spending dashboard with charts broken down by category and store
- Budget goal setting with alerts when approaching your limit
- Price trend history per product so you can see if something is at an all-time low
- Price drop alerts for products you track

Health & Nutrition:
- Daily nutrition log with calorie and macro tracking
- Apple Health sync to push nutrition data and pull activity stats
- Per-product health scoring based on nutriscore, ingredients, and macros

Tech Stack:
- React Native + Expo SDK 51
- Supabase for backend
- RevenueCat for subscriptions
- Firebase for crash reporting
- Open Food Facts API for product data
- Prices currently simulated (Instacart + Rainforest API integration planned)

## 10-Slot Copy/Paste Keyboard Shortcut
Tags: productivity, desktop, utility
Status: active

Creates an easy copy and paste for 10 slots to clipboard instead of one
Ctrl + shift + space brings up a bar which shows the first few words of each copy and paste slot
Ctrl shift 1-10 for pasting, and ctrl c for copying

## Publish 200+ Page Books (×2)
Tags: content, publishing, personal-goal
Status: active

Two full-length 200+ page books. Use JARVIS Book Writer v2 (paragraph-by-paragraph with intervention checkpoints) to draft. Topic + voice TBD per book.

## Instantaneous UV Scanner App
Tags: mobile, health, sensors, b2c
Status: active

Uses two models, camera and gps to find the exact UV at that point in time at that location
The camera uses brightness settings to calculate UV
Accounts for clouds, shadows, etc
The GPS uses realtime UV data

## Hybrid Headphones + AirPods
Tags: hardware, audio, consumer-electronics
Status: active

The idea being that many people have both headphones and airpods
They use airpods for more active things like walking, running, lifting weights, etc
They use headphones for more focused things, reading, homework, studying, sleeping
The product combines both
The headphones have small cutouts on the outside of the heaphones for the airpods to be attached magnetically. The airpods get charged while being connected to the headphones.
Using sensors the headphones will play when a person is using, the airpods will play when a user is using, if both are active both devices will play the same music.
Creates simplicity and consistency due to same brand products.
Also can used for in case your friend forgets their headphones or airpods

## 360° Holographic Sign Display
Tags: hardware, displays, deep-tech, b2b
Status: active

By rotating a mirror 360 degrees on a motor and projecting a reversed image on it, the image will then be projected onto an outer layer of thin film which can then be seen 360 degree views by people

## Football Field Goal Kick Analyzer
Tags: sports, analytics, b2b
Status: active

By getting real time in stadium data (windspeed, distance from field goal, and kicker make percentage) the app can calculate the percentage and trajectory the field goal kicker has to kick at to make the field goal.
The idea is to reduce uncertainty and bring statistics to football, the teams can then making better courses of action on wether to kick or go for it.
$1000 per year per team

## JARVIS Software License (laptop, BYO compute)
Tags: ai, b2c, b2b, software-license
Status: active

Selling Jarvis locally to others to use on their laptops
The idea being to outcompete the major AI companies by using local ai instead of public
One-time software purchase. User runs on their own laptop (Ollama + their own GPU/CPU). Lowest tier of the three JARVIS-as-product paths.

## JARVIS Server Hardware (standalone)
Tags: hardware, b2b, ai-infrastructure
Status: active

Building my own server
Standalone hardware product — pre-configured GPU server tuned for running JARVIS-class workloads (Llama 70B + ChromaDB + Ollama). Sold without bundled software, for power users who already run an AI stack and want optimized hardware. Mid tier.

## JARVIS + Server Bundle (vertically integrated)
Tags: ai, hardware, b2c, b2b, premium
Status: active

Selling Jarvis that comes with a server
The idea being to outcompete the major AI companies by using local ai instead of public
Would sell for a one time purchase of both the AI software and personal server hardware
Premium tier — Apple-style vertical integration. Software + hardware + setup as one purchase. Highest price band, easiest user experience (it just works), strongest moat.

## Brain Patterns × Religious Associations Research
Tags: research, neuroscience, religion, long-term
Status: active

The idea here is that different religions have kids with different physical brain structures than other religions.
This may explain personality differiences and outlooks on life
Catholicism is the best religious association

## WiFi Frequency Jammer
Tags: hardware, security, regulatory
Status: active

2.4 Hz Frequency
5.0 Hz Frequency
Signal jamming

(Note: jamming consumer-band radio is restricted under FCC §333 in the US and equivalents elsewhere — research will surface what legal-adjacent forms this can take, e.g. signal-blocking enclosures / Faraday rooms / RF-isolation paint, alongside any direct-jamming research.)

## Control Computer from Phone (iOS App)
Tags: mobile, productivity, remote-control
Status: active

Control computer from phone iOS app. Likely overlaps with the JARVIS v17 mobile companion plan (phone-as-mic-remote, two-way sync, action buttons). Worth exploring whether this becomes the JARVIS companion app or a standalone product (e.g. "Universal Control" but for any PC, not just Apple ecosystem).
