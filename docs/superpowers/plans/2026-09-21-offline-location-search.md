# Offline Location Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace remote location lookup with a richer, searchable offline attraction catalog and map-selection fallback.

**Architecture:** `locations.ts` owns curated data and a pure search function. The page consumes that function synchronously and contains no geocoding network state. WXML presents map selection when offline search has no match.

**Tech Stack:** WeChat Mini Program, TypeScript, WXML, Node test runner.

---

## Chunk 1: Search and data

### Task 1: Offline search behavior

**Files:**
- Modify: `miniprogram/pages/sky/types.ts`
- Modify: `miniprogram/pages/sky/utils/locations.ts`
- Create: `miniprogram/pages/sky/utils/locations.test.ts`

- [ ] Write tests for empty query, name, administrative area, aliases, and missing places.
- [ ] Run tests and verify the alias/search tests fail.
- [ ] Add `keywords` and implement `searchPresetLocations`.
- [ ] Run tests and verify they pass.

### Task 2: Curated attraction catalog

**Files:**
- Modify: `miniprogram/pages/sky/utils/locations.ts`

- [ ] Add detailed Zhejiang and neighboring-province observation locations.
- [ ] Add selected nationwide outdoor observation locations.
- [ ] Validate unique IDs, valid coordinates, elevations, and category coverage.

## Chunk 2: Page integration

### Task 3: Remove remote search

**Files:**
- Modify: `miniprogram/pages/sky/index.ts`
- Modify: `miniprogram/pages/sky/utils/api.ts`

- [ ] Replace async search state with synchronous offline filtering.
- [ ] Remove Photon types, request code, and import.
- [ ] Confirm no `photon.komoot.io` or remote `searchLocations` reference remains.

### Task 4: Map fallback UI

**Files:**
- Modify: `miniprogram/pages/sky/index.wxml`
- Modify: `miniprogram/pages/sky/index.scss`

- [ ] Remove the search button/loading UI.
- [ ] Add a map-selection call to action for unmatched searches.
- [ ] Ensure map selection closes the location modal before loading a location.
- [ ] Run tests, type/lint checks, and inspect the final diff.
