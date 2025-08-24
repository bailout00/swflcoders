# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Architecture

This is a pnpm monorepo with the following packages:

### Core Architecture Pattern
- **Rust-first types** in `packages/types` using `ts-rs` to generate TypeScript interfaces
- **Backend API** in Rust using Axum, deployed as AWS Lambda functions
- **Infrastructure** managed via AWS CDK with multi-stage deployments
- **Frontend** using React Native/Expo with Tamagui for cross-platform UI
- **E2E Testing** with Playwright for comprehensive testing

### Package Structure
```
packages/
├── types/          # Rust types with TypeScript generation via ts-rs
├── cdk/            # AWS CDK infrastructure (TypeScript)
├── backend/        # Rust API using Axum framework
├── frontend/       # React Native/Expo with Tamagui UI
└── e2e/            # Playwright end-to-end tests
```

## Development Commands

### Monorepo Management
```bash
# Build all packages (types first, then others)
pnpm build

# Generate TypeScript types from Rust
pnpm build:types

# Start all development servers
pnpm dev

# Run all tests
pnpm test

# Run end-to-end tests
pnpm test:e2e

# Type check all packages
pnpm type-check

# Clean all packages
pnpm clean
```

### Stage-based Deployments
```bash
# Deploy to beta environment
pnpm deploy:beta

# Deploy to gamma (staging) environment
pnpm deploy:gamma

# Deploy to production
pnpm deploy:prod
```

### Package-specific Commands
```bash
# Work with specific packages using --filter
pnpm --filter=types build
pnpm --filter=backend test
pnpm --filter=frontend dev
pnpm --filter=cdk deploy:beta
```

## Type System Architecture

### Rust-to-TypeScript Generation
- **Source**: `packages/types/src/lib.rs` contains Rust structs/enums with `#[ts(export)]`
- **Generated**: TypeScript bindings are automatically created during build
- **Integration**: All other packages consume these shared types

### Type Consistency Rules
1. **Always define types in Rust first** - never create duplicate TypeScript types
2. **Run `pnpm build:types` after any type changes** in the `types` package
3. **All API responses must use the shared types** from `@swflcoders/types`
4. **Import types using the workspace reference**: `"@swflcoders/types": "workspace:*"`

## Deployment Architecture

### Stage Configuration
- **Beta**: `beta.swflcoders.com` - development testing
- **Gamma**: `gamma.swflcoders.com` - staging/pre-production
- **Prod**: `swflcoders.com` - production

### AWS Resources Pattern
- **CloudFront** → **API Gateway** → **Lambda** (unauthenticated endpoints)
- **API Gateway** → **Lambda** (authenticated endpoints with Cognito)
- **Cognito User Pools** for authentication
- **Stage-specific resource naming**: `SwflcodersStack-{stage}`

### Domain Configuration
- Root domain configured in `packages/cdk/src/config.ts`
- Subdomains automatically generated: `{stage}.{ROOT_DOMAIN}`
- Production uses root domain directly

## AI Agent Rules

### Type Consistency
When making changes that affect data structures:
1. **Always update Rust types first** in `packages/types/src/lib.rs`
2. **Rebuild types** with `pnpm build:types` before other changes
3. **Update all consuming packages** to use the new types
4. **Verify type consistency** across backend, frontend, and CDK packages

### Deployment Workflows
When asked about deployments:
1. **Always specify the target stage** (beta/gamma/prod)
2. **Use the monorepo deployment commands** (`pnpm deploy:{stage}`)
3. **Reference stage-specific configurations** from `packages/cdk/src/config.ts`
4. **Consider impact on all three environments** when making infrastructure changes

### AWS Integration Guidelines
When working with AWS resources:
1. **Use the CDK constructs** in `packages/cdk/lib/swflcoders-stack.ts`
2. **Follow the stage configuration pattern** from `config.ts`
3. **Update Lambda runtime to Node.js 22** for all functions
4. **Maintain environment-specific outputs** for debugging

### Development Patterns
When adding new features:
1. **Start with types** - define data structures in Rust
2. **Update backend API** - implement endpoints using shared types
3. **Update CDK infrastructure** - add necessary AWS resources
4. **Update frontend** - consume the new types and endpoints
5. **Add E2E tests** - verify the full flow works

### Package Dependencies
- **types**: No dependencies on other packages (pure Rust/TypeScript types)
- **backend**: Depends on `types` for data structures
- **cdk**: Depends on `types` for configuration interfaces
- **frontend**: Depends on `types` for API consumption
- **e2e**: Depends on `types` for test assertions

### Technology Stack Requirements
- **Node.js**: Version 22+ across all packages except `frontend` which uses 20
- **Package Manager**: pnpm with workspace references (`workspace:*`)
- **Rust**: Latest stable version with 2021 edition
- **TypeScript**: Version 5+ with strict mode enabled
- **AWS CDK**: Version 2.87+ for infrastructure
- **React Query**: @tanstack/react-query for API state management
- **Zustand**: Client-side state management with persistence
- **AsyncStorage**: React Native persistent storage for user data

## Quick Development Setup

1. **Install dependencies**: `pnpm install`
2. **Build types**: `pnpm build:types`
3. **Start development**: `pnpm dev`
4. **Run tests**: `pnpm test`

## Common Operations

### Adding New API Endpoint
1. Define request/response types in `packages/types/src/lib.rs`
2. Add handler in `packages/backend/src/main.rs`
3. Update CDK stack if new AWS resources needed
4. Update frontend to consume the endpoint
5. Add E2E test in `packages/e2e/tests/`

### Modifying Infrastructure
1. Update stage configuration in `packages/cdk/src/config.ts`
2. Modify stack in `packages/cdk/lib/swflcoders-stack.ts`
3. Test with `pnpm --filter=cdk synth`
4. Deploy to beta first: `pnpm deploy:beta`

### Type System Changes
1. Modify Rust structs/enums in `packages/types/src/lib.rs`
2. Rebuild: `pnpm build:types`
3. Update consuming packages to handle type changes
4. Run full test suite: `pnpm test`

## Frontend Architecture

### Chat Interface Implementation

The frontend includes a complete chat interface with the following components:

#### State Management
- **Zustand Store** (`stores/userStore.ts`) - Manages username state with AsyncStorage persistence
- **React Query** - Handles API state, caching, and optimistic updates
- **AsyncStorage** - Persists user data across app sessions

#### Component Structure
```
components/
├── UsernameInput.tsx      # Username entry with validation
├── ChatInterface.tsx      # Main chat screen with header/logout
├── MessageList.tsx        # Scrollable message display
├── MessageItem.tsx        # Individual message bubbles
├── MessageInput.tsx       # Text input with send button
└── ChatProvider.tsx       # React Query provider setup
```

#### API Layer
```
api/
└── chatApi.ts            # Pseudo API functions (demo implementation)

hooks/
└── useChatQueries.ts     # React Query hooks for chat operations

types/
└── chat.ts               # TypeScript interfaces for chat data
```

#### Tab Configuration
- **Home Tab** (index.tsx) - Original Tamagui demo content
- **Chat Tab** (two.tsx) - Chat interface with conditional rendering
  - Shows username input if no username stored
  - Shows chat interface once username is set

### Chat Features
- **Username Management** - Persistent storage with validation
- **Message Threading** - Real-time message display with auto-scroll
- **Optimistic Updates** - Immediate UI updates before API confirmation
- **Demo Mode** - Pseudo API with mock responses for development
- **Responsive Design** - Mobile-first UI using Tamagui components
- **Error Handling** - Loading states and error recovery

### Development Notes
- All chat types should eventually be migrated to `packages/types/src/lib.rs`
- API functions in `api/chatApi.ts` are pseudo-code for demo purposes
- Real backend integration requires WebSocket or polling for real-time updates
- Consider implementing message pagination for large chat histories
