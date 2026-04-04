# CartIQ – Smart Grocery Scanner
## Full-Featured iOS App Blueprint

---

## What's Included

This is a **production-quality interactive prototype** of a full-featured grocery scanner iOS app. All screens are fully functional and interactive in any browser, and serve as a direct blueprint for a React Native iOS build.

### Features Built
- Barcode Scanner — Simulated scan with store price comparison across 5 stores
- Smart Shopping List — Per-store lists, categories, check-off items, estimated total
- Spending Analytics — Monthly trends, category breakdown, savings opportunities, price trend charts
- Nutrition Tracking — Macro tracking, food grades (A–D), nutrient alerts, weekly score ring
- Apple Health Integration — Toggle connect/sync nutrition data
- Profile & Settings — Store preferences, budget, price alerts, connected apps (MyFitnessPal, Cronometer)

---

## Files
- index.html — Full interactive prototype (open in browser)
- README.md — This file: iOS dev guide, APIs, code snippets

---

## How to Use the Prototype
1. Open index.html in any modern browser (Chrome, Safari, Firefox)
2. Tap the center scan button → press "Scan Barcode" to simulate scanning
3. See real-time store price comparison (Target, Walmart, Hannaford, Whole Foods, Kroger)
4. Switch between stores using chips in the Shopping List tab
5. Check off items as you shop
6. Explore Insights for spending charts and savings tips
7. Connect Apple Health in the Nutrition tab

---

## iOS React Native Build Guide

### Recommended Stack
- React Native 0.73+ with Expo SDK 50+
- expo-camera (barcode scanning)
- react-native-health (Apple HealthKit)
- react-navigation/native (tab + stack nav)
- Zustand (state management)
- Supabase (backend + price history DB)
- Open Food Facts API (free barcode/nutrition data)

### Key API: Barcode to Product Data (FREE)
https://world.openfoodfacts.org/api/v0/product/{BARCODE}.json
Returns: name, brand, nutrition facts, ingredients, image, allergens — 3M+ products

### Key API: Apple HealthKit (react-native-health)
Sync nutrition: calories, protein, carbs, fat, sodium, fiber per product scanned.
Requires NSHealthShareUsageDescription + NSHealthUpdateUsageDescription in Info.plist

### Key API: Kroger Developer API (free tier)
https://developer.kroger.com — Official prices + product search for Kroger/Fred Meyer etc.

### Price Tracking Database Schema (Supabase)
products(id, barcode, name, brand, category)
price_history(id, product_id, store_id, price, recorded_at)
shopping_list(id, user_id, product_id, store_id, quantity, checked)
user_settings(user_id, preferred_store, monthly_budget, health_connected)

### Nutrition Grade Algorithm
Score starts at 100. Penalize: high sodium (-20), high sugar (-15), saturated fat (-15).
Reward: fiber >3g (+10), protein >8g (+10), organic (+5), vegetables (+15).
Map score: 90+=A+, 80+=A, 70+=B+, 60+=B, 50+=C, below=D

### App Store Requirements
- NSCameraUsageDescription in Info.plist
- NSHealthShareUsageDescription (HealthKit read)
- NSHealthUpdateUsageDescription (HealthKit write)
- NSLocationWhenInUseUsageDescription (nearby stores)
- HealthKit entitlement in Xcode Capabilities
- Sign in with Apple required for health data apps

---

## Store Integration Notes
- Target: RedCard API / Instacart partner API
- Walmart: Walmart Affiliate API (free)
- Kroger: Official developer.kroger.com API
- Whole Foods: Covered via Amazon product API
- Hannaford: Price scraping (check robots.txt / ToS)
- Instacart API covers 1,000+ retailers as a unified layer

---

## Design Tokens
Primary: #6c63ff | Green: #22c97a | Background: #0a0a0f
Font: DM Sans (prototype) / SF Pro (native iOS)
Style: Dark-first, supports system light/dark toggle
