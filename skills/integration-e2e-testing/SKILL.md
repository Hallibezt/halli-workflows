---
name: integration-e2e-testing
description: Integration and E2E test design principles, ROI calculation, test skeleton specification, and review criteria. Use when designing or reviewing integration/E2E tests.
---

# Integration & E2E Testing Guide

## Test Types

| Type | What It Tests | Speed | Cost | When |
|------|-------------|-------|------|------|
| **Integration** | Component boundaries, API routes | Medium | Medium | Per feature |
| **E2E** | Full user flows | Slow | High | Critical paths only |

## ROI-Based Test Selection

### High ROI (Always Test)
- Authentication flows
- Payment/billing flows
- Data creation/mutation APIs
- Permission boundaries
- Error handling at API boundaries

### Medium ROI (Test for Production+)
- Search/filter functionality
- Pagination
- File upload flows
- Notification delivery

### Low ROI (Test for Enterprise)
- UI rendering details
- Animation timing
- Tooltip positioning
- Style consistency

## Test Skeleton Specification

### Integration Test Skeleton
```typescript
// [feature].int.test.ts
describe('[Feature] Integration', () => {
  // AC-1: [Acceptance criterion from Design Doc]
  it('should [expected behavior]', async () => {
    // TODO: Implement
    // Setup: [what state to prepare]
    // Action: [what API call / operation to perform]
    // Assert: [what response / state to verify]
  });

  // AC-2: Error handling
  it('should return [error] when [invalid input]', async () => {
    // TODO: Implement
  });
});
```

### E2E Test Skeleton
```typescript
// [flow].e2e.test.ts
test('[User Flow Name]', async ({ page }) => {
  // Step 1: [Navigate to starting point]
  // TODO: await page.goto('/...');

  // Step 2: [Perform user action]
  // TODO: await page.click/fill/...

  // Step 3: [Verify outcome]
  // TODO: await expect(page).toHave...
});
```

## Review Criteria

### Must Pass
- [ ] Every Design Doc AC has at least one test
- [ ] Assertions are meaningful (not `expect(true).toBe(true)`)
- [ ] Error cases covered
- [ ] Tests are isolated (no shared state between tests)
- [ ] Tests can run in any order

### Should Pass
- [ ] Edge cases covered
- [ ] Performance-sensitive paths have timing assertions
- [ ] Cleanup/teardown proper
- [ ] Test data doesn't pollute database

## Stack-Specific Notes

### Vitest (Web / API)
- Use `describe` / `it` / `expect`
- Use `beforeEach` / `afterEach` for setup/teardown
- Mock external services with `vi.mock()`

### Jest (Mobile)
- Similar to Vitest API
- Use `jest.mock()` for module mocking
- `@testing-library/react-native` for component tests

### Playwright (E2E Web)
- `test` / `expect` from `@playwright/test`
- Use `page` fixture for browser interactions
- `await expect(page).toHaveURL()` for navigation assertions

### Detox (E2E Mobile)
- `device.launchApp()` to start
- `element(by.id('...'))` for element selection
- `waitFor(element).toBeVisible()` for async assertions
