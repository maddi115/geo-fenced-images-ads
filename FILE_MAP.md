# 📁 FILE MAPPING: OLD (Vanilla JS) vs NEW (SolidJS)

## 🔴 OLD FILES (Vanilla JS - NOT USED ANYMORE, backed up):
```
src/
├── behaviors/           ❌ OLD - All .js files
│   ├── fence-behavior.js
│   ├── hover-behavior.js
│   ├── hover-persistence-behavior.js
│   ├── visibility-behavior.js
│   └── zoom-behavior.js
│
├── components/          ❌ OLD - All .js files
│   ├── canvas-component.js
│   ├── comment-component.js
│   └── marker-component.js
│
├── config-old/          ❌ OLD
│   ├── constants.js
│   └── map-config.js
│
├── core/                ❌ OLD
│   ├── app-init.js
│   └── app-state.js
│
├── state/               ❌ OLD
│   ├── fence-complete-state.js
│   ├── fence-drawing-state.js
│   └── state-tracking.js
│
├── ui-old/              ❌ OLD
│   └── controls.js
│
└── utils/               ❌ OLD
    └── element-builder.js
```

## 🟢 NEW FILES (SolidJS + TypeScript - CURRENTLY RUNNING):
```
src/
├── config-new/          ✅ NEW - TypeScript constants
│   └── constants.ts
│
├── domain/              ✅ NEW - Pure business logic
│   ├── fence/
│   │   └── fence-state.ts
│   ├── geo/
│   │   ├── geo-math.ts
│   │   └── geo-schemas.ts
│   └── visibility/
│       ├── visibility-rules.ts
│       └── visibility-rules.test.ts
│
├── infrastructure/      ✅ NEW - Adapters
│   └── adapters/
│       └── map-adapter.ts
│
├── ui-new/              ✅ NEW - SolidJS components
│   ├── App.tsx
│   ├── components/
│   │   └── map/
│   │       ├── CommentBubble.tsx
│   │       ├── ZoneCanvas.tsx
│   │       ├── ZoneMarker.tsx
│   │       ├── comment-bubble.css      (copied from old)
│   │       ├── comment-bubble-posted.css (copied from old)
│   │       └── marker.css              (copied from old)
│   └── screens/
│       └── MapScreen.tsx
│
├── use-cases/           ✅ NEW - Feature stores
│   └── custom-zones/
│       ├── zone-schemas.ts
│       ├── zone-store.ts
│       └── zone-store.test.ts
│
└── main.tsx             ✅ NEW - Entry point
```

## 📄 CSS FILES (Reused):
```
src/
├── features/marker.css         (old, copied to ui-new/)
├── styles/
│   ├── comment-bubble.css      (old, copied to ui-new/)
│   └── comment-bubble-posted.css (old, copied to ui-new/)
└── style.css                    (old, still used)
```

## 🗂️ ROOT FILES:
```
├── index.html              ✅ NEW - For Vite
├── index-old.html          ❌ OLD - CDN script tags
├── package.json            ✅ NEW - Dependencies
├── tsconfig.json           ✅ NEW - TypeScript config
└── vite.config.js          ✅ NEW - Build config
```

## 📊 WHAT'S ACTUALLY RUNNING NOW:

**App Flow:**
1. index.html loads → main.tsx
2. main.tsx → ui-new/App.tsx
3. App.tsx → ui-new/screens/MapScreen.tsx
4. MapScreen uses:
   - infrastructure/adapters/map-adapter.ts (Leaflet wrapper)
   - use-cases/custom-zones/zone-store.ts (State)
   - domain/visibility/visibility-rules.ts (Logic)
   - ui-new/components/map/ZoneCanvas.tsx (Rendering)
   - ui-new/components/map/ZoneMarker.tsx (Marker)
   - ui-new/components/map/CommentBubble.tsx (Comments)

**OLD FILES ARE NOT USED** - They're just sitting there for reference.

## 🧹 CAN WE DELETE OLD FILES?

**YES, but let's keep them for now** until we're 100% sure the new code works.

Once everything works perfectly, we can:
```bash
# Delete old unused files
rm -rf src/behaviors
rm -rf src/components  
rm -rf src/config-old
rm -rf src/core
rm -rf src/state
rm -rf src/ui-old
rm -rf src/utils
```

But **DON'T DELETE YET** - let's fix the hover issue first!
