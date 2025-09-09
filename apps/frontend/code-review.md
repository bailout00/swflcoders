# Code review – @swflcoders/frontend (Expo + Expo Router + Tamagui)

Scope: Reviewed only apps/frontend. Observations are based on static inspection (no code changes made).

Highlights
- Clean Expo Router layout with a clear (tabs) group and modal route
- Sensible provider composition (Tamagui + React Query + Toast) and font loading with SplashScreen control
- React Query used with optimistic updates and reconciliation; Zustand store encapsulates WebSocket lifecycle with reconnection/backoff
- Tamagui integration looks correct (Babel/Metro plugin, extracted CSS for web)

Key risks and quick wins (top 8)
1) Platform-unsafe API config (throws on native): config/api.ts relies on window at import time, which will crash native/SSR. Use EXPO_PUBLIC_* env or platform-aware lazy resolution.
2) TypeScript strictness undermined: tsconfig.base.json disables strict flags that override strict: true. Recommend making strict truly strict and using moduleResolution: "Bundler" for RN.
3) Suspicious package.json field: "module": "module" is likely a mistake for an app package. Remove or set correctly if publishing a library.
4) Over-verbose logging in production paths: Many console.log calls in stores/hooks/components. Gate with __DEV__ or a logger utility.
5) Duplicate status text in ChatInterface: Re-prints connection status; likely meant to show “Reconnecting… (n)”.
6) ScrollView for chat: Consider FlatList/FlashList for large histories and perf.
7) Env duplication and drift: config/env.ts and config/api.ts diverge (3000 vs 3001, WS URLs). Consolidate to a single source.
8) .gitignore typo: .env.test.localp should be .env.test.local.

Architecture overview
- Expo 53, RN 0.79, React 19, Expo Router v5
- UI: Tamagui v1 with extracted CSS (metro plugin) and accent toast overlay
- State: Zustand stores (userStore with persist + AsyncStorage; websocketStore with reconnection, AppState awareness)
- Data: TanStack Query for REST (chatApi) + optimistic UI; WebSocket updates merged into cache via global message handler
- Routing: app/_layout.tsx composes providers; app/index.tsx redirects to (tabs); +html.tsx for web-only HTML shell; +not-found.tsx present

Notable findings with references
1) API config assumes window at module load (crashes native/SSR)
   - apps/frontend/config/api.ts:L21–L27 getCurrentHostnameOrThrow uses window and throws if unavailable; L29 computes currentHostname at import time; used by chatApi and hooks.
   Impact: Native builds or SSR/web prerender will throw before React mounts.
   Recommendation: Use EXPO_PUBLIC_API_BASE_URL/WS_URL and derive defaults lazily per platform.
   Example (conceptual):
   ```ts path=null start=null
   import { Platform } from 'react-native'

   export const DEFAULT_ROOM_ID = 'general'

   const endpoints = { messages: '/chat/messages', health: '/health' } as const

   export function getRestUrl(endpoint: keyof typeof endpoints) {
     const base = process.env.EXPO_PUBLIC_API_BASE_URL
       ?? (Platform.OS === 'web' ? `${location.origin.replace(/^(https?:\/\/)(www\.)?([^/:]+).*/, '$1api.$3')}`
                                  : 'http://localhost:3001')
     return `${base}${endpoints[endpoint]}`
   }

   export function getWebSocketUrl(params?: { roomId?: string; userId?: string; username?: string }) {
     const base = process.env.EXPO_PUBLIC_WS_URL
       ?? (Platform.OS === 'web' ? `wss://ws.${location.hostname.replace(/^www\./,'')}` : 'ws://localhost:3001/ws')
     const url = new URL(base)
     if (params?.roomId) url.searchParams.set('room_id', params.roomId)
     if (params?.userId) url.searchParams.set('userId', params.userId)
     if (params?.username) url.searchParams.set('username', params.username)
     return url.toString()
   }
   ```

2) TypeScript config: strictness and RN bundler settings
   - apps/frontend/tsconfig.base.json:L12 jsx: "react-jsx" (OK, but RN commonly uses "react-native"), L13 module: "system" (unusual for RN), L14 moduleResolution: "node", L16–L20 explicit non-strict flags.
   - apps/frontend/tsconfig.json sets strict: true but base disables many strict flags; the explicit flags typically override strict.
   Recommendation:
   - Use moduleResolution: "Bundler" for RN/Metro and set jsx: "react-native".
   - Remove explicit non-strict flags, enable noUncheckedIndexedAccess and exactOptionalPropertyTypes.
   Example (conceptual):
   ```json path=null start=null
   {
     "compilerOptions": {
       "jsx": "react-native",
       "module": "esnext",
       "moduleResolution": "Bundler",
       "strict": true,
       "noUncheckedIndexedAccess": true,
       "exactOptionalPropertyTypes": true,
       "skipLibCheck": true
     }
   }
   ```

3) package.json metadata
   - apps/frontend/package.json:L7 "module": "module" – likely incorrect for an application; the module field normally points to an ESM entry file when publishing a library.
   - engines not specified. Given your preference for Node 22, pin engines and keep packageManager.
   Recommendation:
   ```json path=null start=null
   {
     "engines": { "node": ">=22 <23" },
     "packageManager": "yarn@4.5.0"
   }
   ```

4) Duplicate and divergent env config
   - apps/frontend/config/env.ts defines API_BASE_URL (3000) and WS_URL, but app logic uses config/api.ts (3001) and host-derived domains.
   Recommendation: Consolidate into a single config module (prefer env-driven), remove drift, and avoid window at import time.

5) Logging noise in production paths
   - Numerous console logs in UsernameInput (apps/frontend/components/UsernameInput.tsx:L6, L13–L46), userStore (apps/frontend/stores/userStore.ts:L31, L35–L44, L57), websocketStore (multiple), api/chatApi.ts, hooks/useChatQueries.ts.
   Impact: Performance noise and potentially sensitive details in logs.
   Recommendation: Gate logs with __DEV__ or a simple logger.
   ```ts path=null start=null
   export const log = {
     info: (...a: unknown[]) => { if (__DEV__) console.log(...a) },
     warn: (...a: unknown[]) => { if (__DEV__) console.warn(...a) },
     error: (...a: unknown[]) => console.error(...a),
   }
   ```

6) ChatInterface: duplicate status text
   - apps/frontend/components/ChatInterface.tsx:L61–L85: status label appears twice; second block likely intended as “Reconnecting…”.
   Recommendation:
   ```ts path=null start=null
   {reconnectCount > 0 && (
     <SizableText fontSize="$2">Reconnecting… ({reconnectCount})</SizableText>
   )}
   ```

7) Message list rendering
   - apps/frontend/components/MessageList.tsx uses ScrollView. For long chats, prefer FlatList/FlashList (windowing, perf, incremental rendering).
   Example:
   ```ts path=null start=null
   import { FlatList } from 'react-native'

   <FlatList
     data={messages}
     keyExtractor={(m) => m.id}
     renderItem={({ item }) => <MessageItem message={item} />}
     initialNumToRender={20}
     onEndReachedThreshold={0.2}
     contentContainerStyle={{ paddingVertical: 8 }}
     keyboardShouldPersistTaps="handled"
   />
   ```

8) React Query app lifecycle & network awareness
   - components/RqProvider.tsx creates a QueryClient with retry/refetch defaults, but there’s no focusManager/onlineManager integration for RN.
   Recommendation: Wire @react-native-community/netinfo and AppState so Query knows when to refetch.
   ```ts path=null start=null
   import NetInfo from '@react-native-community/netinfo'
   import { onlineManager, focusManager } from '@tanstack/react-query'
   import { AppState } from 'react-native'

   onlineManager.setEventListener(setOnline => {
     return NetInfo.addEventListener(state => {
       setOnline(Boolean(state.isConnected && state.isInternetReachable))
     })
   })

   const sub = AppState.addEventListener('change', status => {
     focusManager.setFocused(status === 'active')
   })
   // call sub.remove() when appropriate
   ```

9) Global AppState listener cleanup
   - apps/frontend/stores/websocketStore.ts:L240 registers an AppState listener at module scope and never removes it. Not fatal (lives for app lifetime) but consider storing the subscription and calling .remove() during teardown to avoid leaks in test/dev tools.

10) Unused duplication: hooks/useChatSocket.ts
   - Appears functionally overlapped by useWebSocketConnection + websocketStore. If not used, consider marking as experimental or removing to reduce surface area.

11) Monorepo type imports
   - apps/frontend/types/chat.ts imports from ../../../packages/types/bindings/… which aren’t present inside apps/frontend. Ensure the monorepo workspace contains packages/types and path resolution works in editors/ci; otherwise provide local fallbacks.

12) Tamagui config is defaulted
   - apps/frontend/tamagui.config.ts currently re-exports defaultConfig from @tamagui/config/v4. That’s fine for a talk, but as a foundation consider customizing tokens/themes/fonts to demonstrate theming.

13) Metro and Babel are generally correct
   - babel.config.js keeps react-native-reanimated/plugin last – good.
   - metro.config.js uses withTamagui and adds .mjs. The zustand CommonJS resolver is a narrow workaround; keep an eye on it across upgrades.

14) app.json polish
   - Name/slug still "expo-router-example". Consider setting app-specific values and adding deep link scheme/intent filters as needed.
   - assets/images includes "splash 2.png" (unused). Minor cleanup.

15) Testing & DX
   - Jest preset is set (jest-expo) and test script exists, but there are no tests. Suggest starting with unit tests for:
     - mergeMessagesById/addOwnership in hooks/useChatQueries.ts
     - userStore (persistence, migration)
   - Recommend explicit lint/format scripts and baseline ESLint config.
   Example:
   ```js path=null start=null
   // .eslintrc.cjs (conceptual)
   module.exports = {
     root: true,
     extends: ['universe/native', 'universe/shared/typescript-analysis'],
     plugins: ['react-hooks'],
     rules: {
       'react-hooks/rules-of-hooks': 'error',
       'react-hooks/exhaustive-deps': 'warn',
     },
   }
   ```

Accessibility and UX nits
- Buttons/inputs: consider accessibilityLabel/role on primary actions (e.g., send/logout) to improve screen reader support.
- Toasts: ensure any critical errors (e.g., WebSocket failure) also surface as an alert/toast, not only inline text.

Performance notes
- Optimistic UI and cache merge logic is solid. Deduplication via clientMessageId is good.
- Sorting by new Date(a.timestamp) assumes either Date or ISO string; current types annotate Date on frontend; consistent conversion is handled in chatMessageToMessage – good.
- Consider memoization of heavy props or extraction of inline objects if profiling finds re-render hotspots.

Security and config hygiene
- No secrets committed; .env files ignored (fix .env.test.localp typo).
- AsyncStorage use is fine for non-sensitive items (username). If future auth tokens are added, plan to use expo-secure-store on native.

Prioritized recommendations
Quick wins (1–2 hours)
- Make API config platform-safe (env or Platform-aware lazy getters) and consolidate env.ts/api.ts
- Add engines.node ">=22 <23" to honor your Node 22 preference
- Remove or correct package.json "module" field
- Gate logging with __DEV__
- Fix duplicate status text in ChatInterface
- Correct .gitignore typo for .env.test.local

Medium (0.5–1 day)
- Switch MessageList to FlatList/FlashList
- Tighten TypeScript settings (Bundler resolution, full strict)
- Add React Query online/focus integration
- Establish ESLint/Prettier configs + scripts

Longer-term
- CI: Simple GitHub Actions job for typecheck/lint/test on Node 22 + Yarn 4
- Theming: Expand Tamagui config to showcase tokens/themes in the talk
- Accessibility pass

CI example (optional)
```yml path=null start=null
name: frontend-ci
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn
      - run: corepack enable
      - run: yarn install --immutable
      - run: node -v && yarn -v
      - run: npx tsc -p apps/frontend/tsconfig.json --noEmit
      - run: npx prettier --check "apps/frontend/**/*.{ts,tsx,js,jsx,json,md}"
      - run: npx eslint apps/frontend --ext .ts,.tsx || true
      - run: npx expo-doctor --project-dir apps/frontend || true
```

Overall
This is a solid foundation for a tech talk: the architecture is clear, the real-time path is well-structured, and the UI stack is modern. Addressing the platform-safe config, TypeScript settings, and a few polish items will make it sturdier for both web and native while keeping the example approachable.

