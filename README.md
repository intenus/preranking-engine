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

- [Prerank Engine Overview](#prerank-engine-overview)
- [System Workflow](#system-workflow)
- [Architecture Overview](#architecture-overview)
- [External integrations](#external-integrations)

---

## Prerank Engine Overview

The **Prerank Engine** is the first validation layer in the Intenus intent-based trading pipeline. It acts as an intelligent filter that validates solver-submitted solutions against user-defined constraints before forwarding them to expensive AI ranking services.

**The Challenge It Solves:**

- High computational costs (AI ranking is expensive)
- Exposure to invalid solutions that could fail or lose user funds

**How Prerank Engine Helps:**

1. Monitors Sui blockchain for `IntentSubmitted` and `SolutionSubmitted` events
2. Fetches encrypted intent/solution data from Walrus decentralized storage
3. Performs instant constraint-based validation (deadline, slippage, gas limits, routing rules)
4. Filters out invalid solutions before they reach AI ranking
5. Provide features vector for ranking calculations.

---

## System Workflow

### Complete User Journey

#### Phase 1: Intent Submission

**User Action:** Creates intent on-chain
```
Example: "Swap 100 SUI for max USDC, <2% slippage, 5min window"
  ↓
Sui blockchain emits IntentSubmitted event with Walrus blobId
  ↓
Prerank Engine detects event (polling every 2s)
  ↓
Fetches encrypted intent from Walrus storage via HTTP
  ↓
Stores complete intent data in Redis (1h TTL)
  ↓
Sets timeout timer for solution window (5 minutes)
  ↓
System ready to receive solver solutions
```

#### Phase 2: Solution Validation

**Solver Action:** Submits solution transaction on-chain
```
Solver constructs transaction to fulfill intent
  ↓
Sui blockchain emits SolutionSubmitted event
  ↓
Prerank Engine detects event immediately
  ↓
Fetches solution data from Walrus
  ↓
VALIDATION PIPELINE (500-1000ms):
│
├─ 1. Pre-Flight Checks (Fast)
│   ✓ Deadline: Submitted before window closed?
│   ✓ Routing: Uses whitelisted protocols only?
│   ✓ Max Inputs: Within spending limits?
│
├─ 2. Blockchain Simulation (Expensive)
│   ✓ Dry-run: Execute on Sui testnet
│   └─ Extracts: actual outputs, gas cost, events
│
└─ 3. Output Validation (Accuracy)
    ✓ Slippage: Within user's 2% tolerance?
    ✓ Min Outputs: Meets minimum receive amounts?
    ✓ Gas Budget: Under maximum cost limit?
  ↓
RESULT:
  PASS → Store in Redis: solution:passed:{intentId}:{solutionId}
  FAIL → Store in Redis: failed:{intentId}:{solutionId} + reason
```

#### Phase 3: Window Close & Ranking

**System Action:** Automatic processing when timer expires
```
Solution window timer expires (5 minutes reached)
  ↓
Prerank Engine queries Redis for all PASSED solutions
  ↓
Constructs payload: { intentId, passedSolutions[], metadata }
  ↓
Pushes to Redis queue: ranking:queue:{intentId}
  ↓
AI Ranking Service (external) consumes queue
  ↓
Ranks solutions by quality, efficiency, historical performance
  ↓
Returns best solution to user wallet
  ↓
Cleanup: Remove intent context from memory
```

### Validation Rules

The engine validates solutions against **IGS (Intenus General Standard)** constraints defined by users:

| Constraint Type | What It Protects | Real-World Example |
|-----------------|------------------|-------------------|
| **Deadline** | Time-bound execution | "Must execute within 5 minutes of submission" |
| **Max Slippage** | Price deviation tolerance | "Price can move maximum 2% (200 basis points)" |
| **Min Outputs** | Guaranteed receive amounts | "Must receive at least 950 USDC (not less)" |
| **Max Inputs** | Spending ceiling protection | "Don't spend more than 100 SUI" |
| **Gas Budget** | Transaction cost limits | "Gas fees cannot exceed $2 worth of SUI" |
| **Routing Rules** | Protocol safety controls | "Only use Cetus DEX, block risky protocols" |
| **Limit Price** | Price boundary enforcement | "Only execute if SUI ≥ $3.00" |

**Validation Strategy:**
- **Fast-fail approach:** Check cheap constraints first (deadline, routing) before expensive ones (dry-run simulation)
- **Two-phase validation:** Pre-flight checks → Blockchain simulation → Output verification

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

**Intent Lifecycle:**
```
User → Sui Blockchain (IntentSubmitted event)
  → Walrus fetch (encrypted intent blob)
  → Redis storage (intent:{id}, 1h TTL)
  → Window timer starts
```

**Solution Lifecycle:**
```
Solver → Sui Blockchain (SolutionSubmitted event)
  → Walrus fetch (solution blob)
  → Validation pipeline (constraints + dry-run)
  → Redis storage (passed/failed state)
```

**Ranking Handoff:**
```
Window expires → Collect passed solutions from Redis
  → Push to ranking queue
  → Send to AI Ranking
```

**State Management:**
- **Redis (Hot Storage):** Active intents, recent solutions, event cursor, cache (1h TTL)
- **PostgreSQL (Cold Storage):** Historical cursor states, audit logs, long-term analytics

## External Integrations

### 1. Blockchain Layer (Sui Network)

**Purpose:** Event monitoring and transaction simulation

- **Connection:** Polls Sui RPC endpoint every 2 seconds
- **Events:** `IntentSubmitted`, `SolutionSubmitted` from deployed Move contract
- **Dry-Run:** Simulates transactions without executing to extract outputs and gas costs
- **State Tracking:** Event cursor persisted in Redis (crash recovery) and PostgreSQL (audit trail)

### 2. Decentralized Storage (Walrus)

**Purpose:** Off-chain data storage for large payloads

- **Protocol:** HTTP GET to Walrus aggregator nodes
- **Data:** Encrypted intent/solution blobs (transaction bytes, metadata)
- **Trigger:** BlobId emitted in blockchain events
- **Network:** Supports testnet and mainnet configurations

### 3. Cache & State (Redis)

**Purpose:** High-speed in-memory storage for active data

**Key Schema:**
```
sui:event:cursor                          → Last processed event (persistent)
intent:{intentId}                         → Intent metadata + IGS spec (1h TTL)
solution:passed:{intentId}:{solutionId}   → Valid solutions (1h TTL)
failed:{intentId}:{solutionId}            → Failed solutions + reasons (1h TTL)
ranking:queue:{intentId}                  → AI service input queue (1h TTL)
cache:source:{sourceId}                   → Oracle price data (5-30s TTL)
```

### 4. Market Data (Price Oracles)

**Purpose:** Multi-source price validation for slippage and limit orders

**SourceMap Architecture:**
- **DefiLlama Provider:** Off-chain aggregated CEX/DEX prices (HTTP API, 30s cache)
- **Cetus DEX Provider:** On-chain pool state reads (Sui RPC, 5s cache)
- **Aggregation Strategies:** Median/average/weighted combinations for manipulation resistance

**Usage:** Validates `maxSlippageBps` and `limitPrice` constraints against real-time market data

### 5. Database (PostgreSQL)

**Purpose:** Long-term persistence cursor store

---


<div align="center">

**Built by the Intenus Team**

</div>

---