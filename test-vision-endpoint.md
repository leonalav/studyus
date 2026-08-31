# Vision Endpoint Integration - Test Plan

## What Was Implemented

1. **Database Schema (v13 migration)**
   - New `vision_endpoints` table for dedicated vision models
   - Separate from agent role bindings (tutor/generation/evaluator)

2. **TypeScript API (`llm.ts`)**
   - `getVisionEndpoints()` - list all vision endpoints
   - `getActiveVisionEndpoint()` - get currently active endpoint
   - `saveVisionEndpoint()` - create or update endpoint
   - `activateVisionEndpoint()` - set active (deactivates others)
   - `deleteVisionEndpoint()` - remove endpoint
   - `testVisionEndpoint()` - test connection

3. **Updated OCR Flow (`curriculum.ts`)**
   - Local ONNX first (PP-OCR)
   - On failure → Vision endpoint from database
   - Uses Rust `vision_extract_image` command in Tauri mode

4. **Rust Command (`vision_extract_image`)**
   - Already accepts optional `visionModel` and `visionEndpoint` parameters
   - Uses document extraction prompt (better than simple OCR)
   - Returns structured `ExtractionResult` with markdown, tables, warnings

## How to Configure Your Default Vision Endpoint

Since you don't want the UI, you'll need to insert directly into the database:

```typescript
import { saveVisionEndpoint, activateVisionEndpoint } from './src/lib/llm';

// Example: Configure your vision endpoint
const endpointId = await saveVisionEndpoint({
  label: "My Vision Model",
  provider: "custom",
  baseUrl: "https://modelapi.vn/v1",
  modelId: "deepseek-v4-flash",
  apiKey: "your-api-key-here", // optional - uses STUDYUS_API_KEY if not provided
});

// Set it as active
await activateVisionEndpoint(endpointId);
```

Or directly in the database:

```sql
INSERT INTO vision_endpoints (id, label, provider, base_url, model_id, api_key, is_active, created_at, updated_at)
VALUES (
  'vision-default',
  'Default Vision Model',
  'custom',
  'https://modelapi.vn/v1',
  'deepseek-v4-flash',
  NULL, -- will use STUDYUS_API_KEY from environment
  1,
  datetime('now'),
  datetime('now')
);
```

## Testing the Integration

1. **Start the app** - The migration will run automatically on first launch
2. **Configure your vision endpoint** - Use the SQL above or the TypeScript API
3. **Upload a curriculum PDF** - The extraction will:
   - Try local PP-OCR first
   - Fall back to your vision endpoint on failure
   - Use the Rust `vision_extract_image` command (no CORS issues)

## What Happens When Local ONNX Fails

```typescript
// In curriculum.ts transcribeNode():
try {
  result = await doclingExtractImage(pngBase64[i]); // PP-OCR
} catch (localErr) {
  // Fetch active vision endpoint from database
  const visionEndpoint = await getActiveVisionEndpoint();
  const visionModel = visionEndpoint?.modelId;
  const visionUrl = visionEndpoint ? `${visionEndpoint.baseUrl}/v1/chat/completions` : undefined;
  
  // Call Rust command with endpoint parameters
  result = await visionExtractImage(pngBase64[i], visionModel, visionUrl);
}
```

The Rust side uses your configured endpoint and API key automatically.
