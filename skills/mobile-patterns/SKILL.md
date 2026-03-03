---
name: mobile-patterns
description: React Native / Expo development patterns — offline-first, battery consciousness, optimistic mutations, navigation, i18n for CJK, platform-specific code.
---

# Mobile Development Patterns

## Offline-First Architecture

### Principle
Mobile apps must work without network. Queue mutations, sync on reconnect.

### Pattern: Mutation Queue
```typescript
// 1. Update local state immediately (optimistic)
store.addItem(item);

// 2. Queue the mutation
mutationQueue.push({ type: 'ADD_ITEM', payload: item, timestamp: Date.now() });

// 3. Try to sync
if (isOnline) {
  await syncQueue();
}

// 4. On reconnect, process queue
NetInfo.addEventListener(state => {
  if (state.isConnected) syncQueue();
});
```

### Storage Strategy
| Data Type | Storage | Sync Strategy |
|-----------|---------|---------------|
| User preferences | AsyncStorage | On change |
| Cached API data | AsyncStorage / MMKV | TTL-based refresh |
| Pending mutations | AsyncStorage queue | On reconnect |
| Large files | FileSystem | Background upload |

## Battery-Conscious Patterns

### GPS Polling
- **Never** poll GPS continuously
- Use `requestForegroundPermissionsAsync()` not background
- Reduce accuracy when high precision isn't needed
- Stop polling when app is backgrounded

### Network Requests
- Batch API calls instead of many small ones
- Use `staleTime` in React Query to avoid refetching
- Prefetch on WiFi, defer on cellular
- Cancel pending requests when screen unmounts

### UI
- Prefer dark themes (OLED battery savings)
- Reduce animations on low-battery
- Lazy-load heavy components

## Optimistic Mutation Pattern (Zustand)

### Three-Layer Architecture
1. **Optimistic local update** — update store immediately
2. **Cross-screen event bus** — emit mutation event
3. **Event listeners** — other screens react via version counter

```typescript
// Store
interface Store {
  items: Item[];
  mutationVersion: number;  // Incremented on every mutation
  addItem: (item: Item) => void;
}

// Consumer
useEffect(() => {
  refetch();  // Re-query when version changes
}, [store.mutationVersion]);
```

**Key principle**: Consumers listen via version counter, not by consuming events.

## Navigation Patterns (Expo Router)

### Tab + Stack Combination
```
app/
  (tabs)/
    index.tsx           # Home tab
    explore.tsx         # Explore tab
    profile.tsx         # Profile tab
  (auth)/
    login.tsx
    register.tsx
  [id]/
    detail.tsx          # Dynamic route
```

### Deep Linking
- Configure in `app.json` under `scheme`
- Handle universal links for shared content
- Always validate deep link parameters

## i18n for CJK Languages

### Character Width
CJK characters are ~2x the width of Latin characters. Never assume string length = visual width.

```typescript
// Measure visual width, not character count
const visualWidth = [...text].reduce((w, char) =>
  w + (char.charCodeAt(0) > 0x2E80 ? 2 : 1), 0
);
```

### Font Loading
- Load CJK fonts async (they're large: 5-15MB)
- Show Latin content first, CJK when ready
- Use system fonts as fallback

### Layout
- Allow text containers to expand vertically
- Don't set fixed widths on text-heavy components
- Test with longest translation (usually German or Japanese)

## Image Handling

### Camera/Gallery Flow
1. Request permissions (`ImagePicker.requestCameraPermissionsAsync()`)
2. Capture/select image
3. **Compress on client** (resize to max 1200px, quality 0.8)
4. Upload to storage (show progress)
5. Store URL in database

### Thumbnail Strategy
- Generate thumbnails server-side (if possible)
- Or generate client-side before upload (two sizes)
- Use `expo-image` for optimized rendering with caching

## Push Notifications

### Setup Flow
1. `registerForPushNotificationsAsync()` → get token
2. Store token in database (per device)
3. Listen for notifications in app root
4. Handle notification tap → navigate to relevant screen

### Best Practices
- Always ask WHY before requesting permission
- Offer notification preferences (which types)
- Handle foreground vs background differently
- Test on real devices (simulators don't get push)

## In-App Purchases (RevenueCat)

### Integration Pattern
```typescript
// Initialize on app start
Purchases.configure({ apiKey: REVENUECAT_KEY });

// Check entitlements
const { customerInfo } = await Purchases.getCustomerInfo();
const isPremium = customerInfo.entitlements.active['premium'];

// Purchase
const { customerInfo } = await Purchases.purchasePackage(package);
```

### Premium Gating
- Check `isPremium` before showing premium features
- Show upgrade prompt with clear value proposition
- Handle restore purchases for re-installs

## Platform-Specific Code

```typescript
import { Platform } from 'react-native';

// Simple branch
const fontSize = Platform.OS === 'ios' ? 17 : 16;

// Platform select
const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 } },
  android: { elevation: 4 },
});

// Platform-specific files
// Button.ios.tsx / Button.android.tsx → import Button from './Button'
```

## App Store Submission Checklist

- [ ] Icons at all required sizes
- [ ] Screenshots for required devices
- [ ] Privacy policy URL
- [ ] App description and keywords
- [ ] Age rating
- [ ] In-app purchase configuration (if applicable)
- [ ] Push notification entitlement (if applicable)
- [ ] Test on physical devices (both platforms)
- [ ] Version number bumped
- [ ] EAS Submit configured
