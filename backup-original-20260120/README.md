# ORIGINAL WORKING VANILLA JS CODE

This is your original working code before the SolidJS migration.

## What's here:
- behaviors/ - All hover, fence, visibility behaviors
- components/ - Canvas, marker, comment components  
- config/ - Constants and map config
- core/ - App initialization and state
- state/ - State tracking
- styles/ - CSS files
- ui/ - Controls
- utils/ - Element builder

## To restore:
If the new code breaks, you can always go back to this working version.

## Structure was:
```
OLD (Vanilla JS - WORKS):
├── behaviors/ (hover, fence, visibility logic)
├── components/ (canvas, marker, comment DOM)
├── config/ (constants)
├── core/ (app-init.js, app-state.js)
├── state/ (fence state tracking)
└── index-old.html (CDN script tags)

NEW (SolidJS + TypeScript):
├── domain/ (pure logic - no frameworks)
├── use-cases/ (feature stores)
├── infrastructure/ (adapters)
└── ui-new/ (SolidJS components)
```
