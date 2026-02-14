# OpenClaw Shared Bridge TypeScript Fixes

Applied on: 2026-02-14

## Summary

Fixed 5 issues in the OpenClaw shared bridge TypeScript code with minimal, targeted changes.

## Changes Applied

### 1. openclaw-client.ts - WebSocket Reliability & Type Safety

**Changes:**
- Changed `ws` from public to private (line 20)
- Added reconnection fields: `reconnectAttempts`, `maxReconnectAttempts` (lines 29-30)
- Wrapped `JSON.parse(raw.toString())` in try-catch at line 52 to handle malformed messages
- Fixed unsafe type casting: changed `value: undefined as unknown as string` to `value: ""` (lines 163, 244)
- Added `ws.on("close")` handler with exponential backoff reconnection (max 3 attempts)

**Impact:** Improves WebSocket resilience and eliminates unsafe type coercion.

### 2. bridge.ts - SSE Client Management & State Cleanup

**Changes:**
- Moved `startTime` from module level (line 13) into `createApp` function scope (line 15)
- Added `req.on('close', ...)` listener in `/message` POST handler to detect client disconnection
- Added `clientDisconnected` flag to stop async generator iteration when client disconnects
- Wrapped `sse.sendDone()` and `sse.sendError()` in disconnection checks

**Impact:** Prevents resource leaks when SSE clients disconnect mid-stream.

### 3. patch-config.ts - Module vs CLI Execution

**Changes:**
- Wrapped CLI entry point code (lines 38-44) in `if (require.main === module)` check
- Prevents CLI code from running when imported as a module

**Impact:** Makes the module safely importable without side effects.

### 4. lifecycle.ts - Shutdown State Management

**Changes:**
- Added `_shutdown` flag (line 3)
- Added `isShuttingDown` getter (lines 13-15)
- Enhanced `gracefulShutdown()` with meaningful logging and state setting

**Impact:** Enables components to check shutdown state and coordinate cleanup.

### 5. types.ts - Type Export Verification

**Status:** No changes needed. Types are correctly exported and available for use.

## Verification

- ✅ TypeScript compilation: `npm run build` succeeds with no errors
- ✅ All dist files generated correctly
- ✅ Compiled JavaScript contains all expected changes
- ✅ No breaking changes to public API (except `ws` visibility change, which is correct)

## Build Output

All files compiled successfully to `dist/`:
- bridge.js, bridge.d.ts
- openclaw-client.js, openclaw-client.d.ts
- patch-config.js, patch-config.d.ts
- lifecycle.js, lifecycle.d.ts
- types.js, types.d.ts
- sse-sender.js, sse-sender.d.ts
- constants.js, constants.d.ts
- index.js, index.d.ts
