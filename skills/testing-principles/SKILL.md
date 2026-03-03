---
name: testing-principles
description: Testing principles including TDD, test quality, coverage standards, and test design patterns. Use when writing or reviewing tests.
---

# Testing Principles

## TDD: Red-Green-Refactor

1. **Red**: Write a failing test for the behavior you want
2. **Green**: Write the minimum code to make it pass
3. **Refactor**: Clean up while keeping tests green

Not dogmatic — use TDD when it helps, skip when it slows you down.

## Test Pyramid

```
        /  E2E  \         Few, slow, expensive
       /Integration\      Moderate, test boundaries
      /   Unit Tests  \   Many, fast, cheap
```

### By Ambition Tier
| Tier | Unit | Integration | E2E |
|------|------|-------------|-----|
| MVP | Core logic | API boundaries | Manual QA |
| Production | 80%+ coverage | All API routes | Critical paths |
| Enterprise | 90%+ coverage | All boundaries | Full user flows |

## Test Quality Rules

### Good Tests Are:
- **Fast** — milliseconds, not seconds
- **Isolated** — no test depends on another
- **Repeatable** — same result every time
- **Self-validating** — pass or fail, no manual checking
- **Timely** — written close to when code is written

### Test Structure: Arrange-Act-Assert
```typescript
it('should calculate total with discount', () => {
  // Arrange
  const cart = new Cart([{ price: 100, qty: 2 }]);
  const discount = 0.1;

  // Act
  const total = cart.calculateTotal(discount);

  // Assert
  expect(total).toBe(180);
});
```

### What to Test
| Always Test | Sometimes Test | Never Test |
|-------------|---------------|------------|
| Business logic | UI rendering | Framework internals |
| API boundaries | Event handlers | Third-party library code |
| Error handling | Edge cases | Implementation details |
| Auth/permissions | Performance | Private methods directly |

### Test Naming
```typescript
// Pattern: should [expected behavior] when [condition]
it('should return 404 when user not found', () => {});
it('should create order when cart is valid', () => {});
it('should reject duplicate email on registration', () => {});
```

## Mocking Strategy

### Mock at Boundaries
- External APIs → mock the HTTP call
- Database → mock the client/ORM
- Time → mock Date.now() / timers
- File system → mock fs operations

### Don't Mock
- Your own pure functions
- Simple value transformations
- Things that are faster unmocked

## Coverage

### Targets
- **Statements**: 80%+ (Production), 90%+ (Enterprise)
- **Branches**: 70%+ — this catches missed edge cases
- **Functions**: 80%+

### Coverage is a Floor, Not a Goal
100% coverage doesn't mean bug-free. Focus on testing behaviors, not hitting numbers.

## Integration Test Patterns

### API Route Tests
```typescript
describe('POST /api/users', () => {
  it('should create user with valid data', async () => {
    const res = await app.request('/api/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@test.com', name: 'Test' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.email).toBe('test@test.com');
  });

  it('should reject invalid email', async () => {
    const res = await app.request('/api/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'invalid', name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });
});
```

## E2E Test Patterns

### Focus on User Flows
```typescript
test('user can sign up and create first item', async ({ page }) => {
  await page.goto('/signup');
  await page.fill('[name="email"]', 'test@test.com');
  await page.fill('[name="password"]', 'SecurePass123');
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL('/dashboard');
  await page.click('text=Create New');
  // ... continue flow
});
```
