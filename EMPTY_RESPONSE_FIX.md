# Empty Response Hardening Fix

## Problem

The tutor agent would show raw error messages to users when the LLM endpoint returned completely empty content. This could happen due to:
- Rate limits
- Safety filters triggering
- Internal LLM provider errors
- Token budget exhaustion
- Network issues returning partial responses

The error message shown to users was: **"Tutor endpoint returned an empty message."**

## Root Cause

The error originated in `agentRuntime.ts` at the `chatCompletion` function (line ~427-450). When the endpoint returned empty content, it threw an `AgentRuntimeError` that propagated up through `callStructuredAgent` and was re-thrown before any recovery callback could run.

Additionally, the original repair loop would make **up to 3 attempts** to fix malformed responses. Empty responses would trigger these repair attempts, causing:
1. **Wasted API calls** - Retrying an empty response won't magically produce content
2. **Rate limit triggers** - Multiple rapid requests to the same endpoint can trigger 403 errors
3. **Poor user experience** - Longer wait times before seeing a helpful message

## Solution

### 1. Detect Empty Responses Early (agentRuntime.ts)

```typescript
if (!content.trim()) {
  console.warn(
    `[agentRuntime] ${ROLE_LABEL[endpoint.role]} endpoint returned empty content. Response:`,
    res.text.slice(0, 240)
  );
  throw new AgentRuntimeError(
    `${ROLE_LABEL[endpoint.role]} endpoint returned empty content.`,
    "empty_response",
    res.text.slice(0, 240)
  );
}
```

**Key:** We throw a specific `"empty_response"` error class that signals "don't retry this."

### 2. Skip Repair Loop for Empty Responses (agentRuntime.ts)

In `callStructuredAgent`, catch `empty_response` errors and go **straight to recovery** instead of attempting repairs:

```typescript
catch (err) {
  const failure = err instanceof AgentRuntimeError ? err.failureClass : "transport";
  
  // Empty responses should skip repair attempts and go straight to recovery.
  // Retrying empty responses wastes API calls and can trigger rate limits.
  if (err instanceof AgentRuntimeError && err.failureClass === "empty_response" && recover) {
    let recovered: T | null = null;
    try {
      recovered = recover({ raw: "", payload: {}, errors: [err.message], attempts: attempt });
    } catch {
      recovered = null;
    }
    if (recovered !== null) {
      // Log success and return recovered turn
      return { value: recovered, ... };
    }
  }
  
  // For other errors, log and throw
  throw err;
}
```

**Key benefit:** Makes **only 1 API call** instead of 3 when response is empty, avoiding rate limits.

### 3. Enhanced Recovery Messaging (tutor.ts)

Updated the recovery fallback messages in `recoverTutorPayload` to be clearer and more actionable:

```typescript
if (!speech) {
  if (boardOps.length > 0) {
    speech = "I've made the safe parts of that update on the board.";
  } else if (learnerMessage.trim()) {
    speech = "I'm having trouble generating a response right now. Could you rephrase that in a short sentence?";
  } else {
    speech = "I'm ready when you are. What would you like to work on?";
  }
}
```

### 4. Ultimate Safety Net (tutor.ts)

Added error handling around the recovery callback itself in `askTutorTurn`:

```typescript
recover: ({ payload, raw }) => {
  try {
    return recoverTutorPayload(payload, raw, allowedEvidence, req.learnerMessage);
  } catch (err) {
    console.error("[tutor] recovery callback failed", err);
    return {
      speech: learnerMessage.trim()
        ? "I'm having trouble responding. Could you rephrase that in one short sentence?"
        : "I'm ready when you are. What would you like to work on?",
      boardOps: [],
      evidenceRefs: [],
    };
  }
}
```

## Why This Prevents HTTP 403 Errors

**Before:** Empty response → Attempt 1 fails → **Attempt 2 (new API call)** → **Attempt 3 (new API call)** → Recovery  
→ 3 rapid API calls can trigger rate limits or anti-spam protection (HTTP 403)

**After:** Empty response → Attempt 1 fails → **Immediately skip to recovery**  
→ Only 1 API call, no rate limit triggers

## Testing

Added comprehensive test coverage:

### `agentRuntime.empty-response.test.ts` (30 tests)
- Tests `extractAssistantContent` with various input shapes
- Tests `chatCompletion` throws `empty_response` error for empty responses
- Covers: empty string, whitespace-only, missing message object, empty choices array

### `tutor.empty-recovery.test.ts` (18 tests)
- Tests `recoverTutorPayload` with empty/malformed responses
- Validates contextual recovery messages
- Tests board op preservation, evidence filtering, diagnosis handling
- Tests boundary conditions (8000 char limit, null character sanitization)

### Existing Tests
- All 87 existing tutor tests pass
- All 13 existing agentRuntime tests pass
- Full production build succeeds

## Impact

**Before:**
- User sees: "Tutor endpoint returned an empty message."
- System makes 3 API calls (can trigger 403 rate limits)

**After:**
- User sees: "I'm having trouble generating a response right now. Could you rephrase that in a short sentence?"
- System makes 1 API call (avoids rate limits)
- Session continues normally - no data loss, no crash, no exposed implementation details

## Files Changed

- `src/lib/agentRuntime.ts` - Throw specific error + skip repair loop for empty responses
- `src/lib/tutor.ts` - Enhanced recovery messaging and ultimate safety net
- `src/lib/agentRuntime.empty-response.test.ts` - New test coverage
- `src/lib/tutor.empty-recovery.test.ts` - New test coverage
- `src/lib/tutor.test.ts` - Updated existing test expectations

## Verification

✅ New empty response tests pass (30/30)  
✅ New tutor recovery tests pass (18/18)  
✅ Existing agentRuntime tests pass (13/13)  
✅ Existing tutor tests pass (87/87)  
✅ Full production build succeeds  
✅ No linter errors

## Design Principles

1. **Fail fast, recover gracefully** - Detect empty responses immediately, skip wasteful retries
2. **One API call is enough** - Don't retry when the problem is clearly upstream
3. **User-facing errors must be actionable** - Tell users what to do next
4. **Preserve context** - Never lose learner input or session state
5. **Defense in depth** - Multiple recovery layers (chatCompletion → callStructuredAgent → recoverTutorPayload → ultimate fallback)
6. **Test the failure modes** - Comprehensive coverage of empty/malformed responses
