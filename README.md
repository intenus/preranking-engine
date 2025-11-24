# Intenus Prerank engine

<div align="center">

**Event-Driven Intent Processing with Instant Solution Preranking**

[![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Sui](https://img.shields.io/badge/Sui-Blockchain-4DA2FF)](https://sui.io/)
[![Redis](https://img.shields.io/badge/Redis-Storage-DC382D?logo=redis)](https://redis.io/)

</div>

---

## Table of Contents

- [What is Prerank Engine](#what-is-prerank-engine)
- [System Workflow](#system-workflow)
- [Architecture](#architecture)
- [Integration](#integration)

---

## What is Prerank Engine

Intenus Prerank engine is a NestJS-based microservice that processes submitted intents and solutions using the **Intenus General Standard (IGS)**. It listens to blockchain events, fetches encrypted intent/solution data from Walrus, performs instant preranking validation, and forwards qualified solutions to AI ranking services.

### Key feature

1. **Event Listening** - Monitors Sui blockchain for `IntentSubmitted` and `SolutionSubmitted` events
2. **Data Retrieval** - Fetches encrypted intents/solutions from Walrus decentralized storage
3. **Preranking** - Validates solutions immediately upon arrival using constraint-based filtering
4. **State Management** - Stores all data in Redis with TTL for crash recovery, there also Postgres for long-term and history cursor store
5. **Queue Management** - Sends passed solutions to AI ranking service when solution window closes

---

## System Workflow

### Complete User Journey

**1. User Submits Intent (On-Chain)**
```
User: "Swap 100 SUI for max USDC, <2% slippage, 5min window"
  ↓
Sui blockchain emits IntentSubmitted event
  ↓
Prerank Engine detects event (2s polling)
  ↓
Fetches encrypted intent from Walrus storage
  ↓
Stores in Redis + sets 5-minute timeout
  ↓
Waits for solver solutions...
```

**2. Solvers Submit Solutions (On-Chain)**
```
Solver: Submits transaction solving the intent
  ↓
Sui blockchain emits SolutionSubmitted event
  ↓
Prerank Engine detects event immediately
  ↓
Fetches solution from Walrus
  ↓
INSTANT VALIDATION (500-1000ms total):
  ├─ ✓ Deadline: Submitted before window closed?
  ├─ ✓ Routing: Uses allowed protocols?
  ├─ ✓ Dry-run: Simulate transaction on Sui network
  │   └─ Extract actual outputs, gas cost
  ├─ ✓ Slippage: Within user's 2% tolerance?
  ├─ ✓ Min outputs: Meets minimum amounts?
  └─ ✓ Gas budget: Within cost limits?
  ↓
PASS → Store in Redis: solution:passed:{intentId}
FAIL → Store in Redis: failed:{intentId} (audit log)
```

**3. Window Closes (Automatic)**
```
Timer expires
  ↓
Prerank Engine collects all PASSED solutions from Redis
  ↓
Sends to AI Ranking service via Redis queue
  ↓
AI ranks by quality/efficiency
  ↓
Best solution returned to user
```

### Validation Rules

| Constraint | User Benefit | Example |
|------------|--------------|---------|
| **Deadline** | Solution arrives on time | "Execute within 5 minutes" |
| **Max Slippage** | Price protection | "Maximum 2% slippage (200 bps)" |
| **Min Outputs** | Amount guarantee | "Receive ≥950 USDC" |
| **Max Inputs** | Spending ceiling | "Spend ≤100 SUI" |
| **Gas Budget** | Cost control | "Max $2 gas fees" |
| **Routing** | Protocol safety | "Don't use risky protocols" |
| **Limit Price** | Price bounds | "SUI price must be ≥$3.00" |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Sui Blockchain                           │
│  IntentSubmitted Events │ SolutionSubmitted Events              │
└────────────┬────────────┴──────────────────┬───────────────────┘
             │                                │
             ▼                                ▼
    ┌────────────────┐              ┌────────────────┐
    │  Sui Service   │              │  Sui Service   │
    │  (Event Poll)  │              │  (Event Poll)  │
    └────────┬───────┘              └────────┬───────┘
             │ Emit                           │ Emit
             │ intent.submitted               │ solution.submitted
             ▼                                ▼
    ┌──────────────────────────────────────────────────┐
    │         Processing Service (Orchestrator)        │
    │  - Manages solution windows                      │
    │  - Coordinates instant preranking workflow       │
    └──────┬────────────────────────────────┬──────────┘
           │                                 │
           ▼                                 ▼
  ┌─────────────────┐             ┌──────────────────────┐
  │ Walrus Service  │             │  PreRanking Service  │
  │ - Fetch Intent  │             │  - Validate Now      │
  │ - Fetch Solution│             │  - Dry Run           │
  │ - Decrypt Data  │             │  - Extract Features  │
  └────────┬────────┘             └──────────┬───────────┘
           │                                  │
           ▼                                  ▼
  ┌──────────────────────────────────────────────────────┐
  │              Redis Storage Service                    │
  │  - Store intents/solutions (1h TTL)                  │
  │  - Event cursor (crash recovery)                     │
  │  - Ranking queue (AI service input)                  │
  └──────────────────────────────────────────────────────┘
                           │
                           ▼ Window closes
                  ┌──────────────────┐
                  │  AI Ranking API  │
                  │  (External)      │
                  └──────────────────┘
```

### Event Processing Flow

1. **Intent Submission**
   ```
   User → Blockchain → IntentSubmitted Event
   → Fetch from Walrus → Store in Redis → Set Window Timeout
   ```

2. **Solution Processing (Instant)**
   ```
   Solver → Blockchain → SolutionSubmitted Event
   → Fetch from Walrus → Validate Constraints → Dry Run
   → Pass/Fail → Store in Redis (immediate)
   ```

3. **Window Close**
   ```
   Timeout Expires → Get Passed Solutions from Redis
   → Send to AI Ranking API → Cleanup State
   ```

## External Integrations

### Connection Points

**1. Blockchain Integration (Sui Network)**
- **Connection:** Polls Sui RPC endpoint every 2 seconds for new events
- **Events Monitored:** `IntentSubmitted`, `SolutionSubmitted` from deployed Move contract
- **State Management:** Event cursor persisted in Redis for crash recovery
- **Dry-run Capability:** Simulates transactions on Sui network to extract outputs and gas costs

**2. Decentralized Storage (Walrus)**
- **Protocol:** HTTP GET requests to Walrus aggregator nodes
- **Data Retrieved:** Encrypted intent/solution blobs (too large for blockchain events)
- **Blob Identification:** Uses `blobId` from blockchain events

**3. State & Cache Layer (Redis)**
- **Purpose:** Fast in-memory storage for active intents and validated solutions
- **Key Patterns:**
  - `sui:event:cursor` - Last processed blockchain event (persistent)
  - `intent:{intentId}` - Full intent data with 1-hour TTL
  - `solution:passed:{intentId}:{solutionId}` - Valid solutions (1-hour TTL)
  - `failed:{intentId}:{solutionId}` - Failed solutions for audit (1-hour TTL)
  - `ranking:queue:{intentId}` - Queue for AI service consumption
  - `cache:source:{sourceId}` - Oracle price data (5-30s TTL) (Future works)

**4. Market Data (Oracle Integration)**
- **SourceMap System:** Flexible multi-provider architecture for price feeds
- **Providers:**
  - **DefiLlama** - Off-chain aggregated prices via HTTP API (30s cache)
  - **Cetus DEX** - On-chain pool reads via Sui RPC (5s cache)
  - **Aggregators** - Median/average combinations for manipulation resistance
- **Usage:** Validates slippage constraints and limit prices

**5. AI Ranking Service (Downstream)**
- **Protocol:** Redis queue-based async communication
- **Data Format:** JSON payload with `{ intentId, solutions[], metadata }`
- **Trigger:** Automatically pushed when solution window closes
- **Decoupling:** AI service is separate microservice (not in this repo)

<div align="center">

**Built by the Intenus Team**

</div>
