# Intenus Prerank Engine - Intent Processing System

<div align="center">

**Event-Driven DeFi Intent Processing with Instant Solution Preranking**

[![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Sui](https://img.shields.io/badge/Sui-Blockchain-4DA2FF)](https://sui.io/)
[![Redis](https://img.shields.io/badge/Redis-Storage-DC382D?logo=redis)](https://redis.io/)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)

---

## Overview

Intenus Prerank engine is a NestJS-based microservice that processes DeFi intents using the **Intenus General Standard (IGS)**. It listens to blockchain events, fetches encrypted intent/solution data from Walrus, performs instant preranking validation, and forwards qualified solutions to AI ranking services.

### What This Does

1. **Event Listening** - Monitors Sui blockchain for `IntentSubmitted` and `SolutionSubmitted` events
2. **Data Retrieval** - Fetches encrypted intents/solutions from Walrus decentralized storage
3. **Instant Preranking** - Validates solutions immediately upon arrival using constraint-based filtering
4. **State Management** - Stores all data in Redis with TTL for crash recovery
5. **Queue Management** - Sends passed solutions to AI ranking service when solution window closes

### What This Does NOT Do

-  Final ranking of solutions (handled by separate AI service)
-  Transaction execution (solutions are dry-run only)
-  Batch processing (deprecated - now event-driven)

---

##  Key Features

### Instant Preranking

Solutions are validated **immediately** when `SolutionSubmitted` events arrive, not in batches:

```typescript
SolutionSubmitted Event → Fetch from Walrus → Validate Constraints → Dry Run → Store Result
```

### Comprehensive Constraint Validation

Based on IGS schema, supports:

-  **Deadline** - Time-based solution acceptance
-  **Max Slippage** - Percentage-based slippage limits (basis points)
-  **Min Outputs** - Minimum output amounts (slippage protection)
-  **Max Inputs** - Spending ceiling limits
-  **Gas Limits** - Maximum gas cost constraints
-  **Routing** - Max hops, protocol blacklist/whitelist
-  **Limit Price** - Price limits for limit orders (GTE/LTE)

### Redis-Based State Management

All data stored in Redis with 1-hour TTL:

```
sui:event:cursor           - Event cursor for crash recovery
intents:{intentId}         - Full intent data
solutions:passed:{id}      - Passed solutions
solutions:failed:{id}      - Failed solutions  
ranking:queue:{intentId}   - Queue for AI ranking
```

### Crash Recovery

Event cursor persisted to Redis - service resumes from last processed event after restart.

---

## Architecture

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

### Data Flow

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

---

## Project Structure (Not updated)

```
backend/
├── src/
│   ├── common/
│   │   └── types/              # Type definitions from schemas
│   │       ├── igs-intent.types.ts
│   │       ├── igs-solution.types.ts
│   │       ├── core.types.ts
│   │       └── sui-events.types.ts
│   ├── config/                 # Configuration
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── sui.config.ts
│   │   └── walrus.config.ts
│   ├── modules/
│   │   ├── sui/                # Blockchain event listener
│   │   │   ├── sui.service.ts
│   │   │   ├── sui.module.ts
│   │   │   └── sui.service.spec.ts
│   │   ├── walrus/             # Decentralized storage
│   │   │   ├── walrus.service.ts
│   │   │   ├── walrus.module.ts
│   │   │   └── walrus.service.spec.ts
│   │   ├── redis/              # State management
│   │   │   ├── redis.service.ts
│   │   │   ├── redis.module.ts
│   │   │   └── redis.service.spec.ts
│   │   ├── preranking/         # Instant validation
│   │   │   ├── preranking.service.ts
│   │   │   ├── preranking.module.ts
│   │   │   ├── validators/
│   │   │   │   ├── constraint.validator.ts
│   │   │   │   └── constraint.validator.spec.ts
│   │   │   └── preranking.service.spec.ts
│   │   └── dataset/            # Dataset management
│   │       ├── dataset.controller.ts
│   │       └── dataset.service.ts
│   ├── app.module.ts
│   └── main.ts
├── test/
│   ├── mocks/                  # Test fixtures
│   │   ├── intent.mock.ts
│   │   ├── solution.mock.ts
│   │   └── events.mock.ts
│   └── app.e2e-spec.ts
├── schemas/                    # JSON schemas
│   ├── igs-intent-schema.json
│   ├── igs-solution-schema.json
│   └── core-schema.json
├── .env.example
├── package.json
├── tsconfig.json
└── README.md                   # This file
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 18.x
- **pnpm** >= 8.x (or npm/yarn)
- **Redis** >= 7.x
- **PostgreSQL** >= 14.x (optional, for metadata)
- **Sui CLI** (optional, for local testing)

### Installation

```bash
# Clone the repository
git clone https://github.com/intenus/backend.git
cd backend

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### Quick Start

```bash
# Development mode (auto-reload)
pnpm start:dev

# Production mode
pnpm build
pnpm start:prod

# Run tests
pnpm test

# Run tests with coverage
pnpm test:cov
```

---

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

#### Sui Blockchain

```env
SUI_NETWORK=testnet
SUI_RPC_URL=https://fullnode.testnet.sui.io
SUI_INTENT_PACKAGE_ID=0x...    # Your deployed package ID
SUI_EVENT_POLLING_INTERVAL_MS=2000
SUI_AUTO_START_EVENT_LISTENER=true
```

#### Walrus Storage

```env
WALRUS_NETWORK=testnet
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_DEFAULT_EPOCHS=5
```

#### Redis

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=redis://localhost:6379  # Alternative to host/port
```

#### Application

```env
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
CORS_ORIGIN=http://localhost:3001
```

### Configuration Files

All configs in `src/config/`:

- `sui.config.ts` - Blockchain connection
- `walrus.config.ts` - Storage settings
- `redis.config.ts` - Cache & queue
- `database.config.ts` - PostgreSQL (optional)

---

### Internal Events (NestJS Event Emitter)

```typescript
// Intent submitted
@OnEvent('intent.submitted')
handleIntentSubmitted(event: IntentSubmittedEvent) { }

// Solution submitted
@OnEvent('solution.submitted')
handleSolutionSubmitted(event: SolutionSubmittedEvent) { }
```

---

##  Acknowledgments

- [NestJS](https://nestjs.com/) - Progressive Node.js framework
- [Sui](https://sui.io/) - High-performance blockchain
- [Walrus](https://walrus.site/) - Decentralized storage
- [Redis](https://redis.io/) - In-memory data store

---

<div align="center">

**Built with by the Intenus Team**

</div>
