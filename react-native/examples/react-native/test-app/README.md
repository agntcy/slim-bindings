# SLIM Test App

React Native test application for end-to-end testing of the SLIM JavaScript bindings.

## Purpose

This app tests that the generated JSI bindings work correctly on the iOS simulator (Android is not supported yet). It runs smoke tests that verify:

- Runtime initialization (`initializeWithDefaults()`)
- Version retrieval
- Name object creation
- App creation with shared secrets

## Prerequisites

### iOS
- macOS with Xcode installed
- CocoaPods: `sudo gem install cocoapods`
- iOS Simulator

### Node.js
- Node.js 20+

### Testing Tool
- Maestro: `curl -Ls "https://get.maestro.mobile.dev" | bash`

## Setup

From the React Native bindings root (`react-native`):

```bash
# Build SlimBindings.xcframework (required for iOS; fixes undefined symbol errors)
task prepare:ios

# Set up the test app
task test:e2e:setup
```

`task prepare:ios` builds the iOS XCFramework (device + simulator).
`task test:e2e:setup` installs the test app's npm dependencies and iOS pods.

## Running Tests

### iOS

```bash
# From the React Native bindings root (react-native)
task test:e2e:ios
```

Or manually:
```bash
cd examples/react-native/test-app

# Build and run
npx react-native run-ios

# In another terminal, run Maestro tests
maestro test maestro/smoke-tests.yaml
```

## Test Structure

### App.tsx
The main test UI that:
- Loads the SLIM bindings module
- Provides a "Run Tests" button
- Executes smoke tests
- Displays results with pass/fail status

### maestro/smoke-tests.yaml
Maestro test definition that:
- Launches the app
- Taps "Run Tests"
- Waits for completion
- Verifies all tests passed
- Checks for no failures

## Troubleshooting

### "SLIM bindings module not loaded"
The bindings weren't properly linked. Try:
```bash
cd examples/react-native/test-app
rm -rf node_modules
npm install
cd ios && pod install && cd ..
```

### iOS build fails
```bash
cd ios
pod deintegrate
pod install
cd ..
npx react-native run-ios --clean
```

### Maestro can't find app
Make sure the app is running on the simulator before running Maestro tests.

## CI Integration

These E2E tests are not run in CI yet; run them locally with `task test:e2e:ios`.

## Development

To add new tests:

1. Add test logic to `App.tsx` in the `runTests()` function
2. Update `maestro/smoke-tests.yaml` to verify the new test
3. Run `task test:e2e:ios` locally

## Architecture

```
App.tsx
  ↓ imports
@agntcy/slim-bindings-react-native (local)
  ↓ uses
generated/typescript/slim_bindings.ts
  ↓ calls
generated/cpp/slim_bindings.cpp (JSI layer)
  ↓ calls
Rust library (libslim_bindings.a)
```

## Related Documentation

- [Maestro Documentation](https://maestro.mobile.dev/)
- [React Native Testing](https://reactnative.dev/docs/testing-overview)
- [SLIM React Native Bindings](../../../README.md)
