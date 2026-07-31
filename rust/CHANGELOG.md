# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0-alpha.5](https://github.com/agntcy/slim-bindings/compare/slim-bindings-v2.0.0-alpha.4...slim-bindings-v2.0.0-alpha.5) - 2026-07-30

### Added

- feat(wasm) : add react-native wasm bindings for the slim ([#16](https://github.com/agntcy/slim-bindings/pull/16))
- Update slim references to latest version and relevant update ([#49](https://github.com/agntcy/slim-bindings/pull/49))

## [2.0.0-alpha.4](https://github.com/agntcy/slim-bindings/releases/tag/slim-bindings-v2.0.0-alpha.4) - 2026-07-21

### Added

- Update release process ([#32](https://github.com/agntcy/slim-bindings/pull/32))
- bump crate version ([#31](https://github.com/agntcy/slim-bindings/pull/31))
- Node version update for CI ([#5](https://github.com/agntcy/slim-bindings/pull/5))

### Fixed

- relese please to separete pr ([#33](https://github.com/agntcy/slim-bindings/pull/33))

### Other

- move slim-bindings and slimrpc back to slim core ([#28](https://github.com/agntcy/slim-bindings/pull/28))
- release alpha 3 rerun ([#27](https://github.com/agntcy/slim-bindings/pull/27))
- release v2.0.0-alpha.3 ([#26](https://github.com/agntcy/slim-bindings/pull/26))
- release v2.0.0-alpha.2 ([#13](https://github.com/agntcy/slim-bindings/pull/13))
- release 2.0.0-alpha.2 ([#11](https://github.com/agntcy/slim-bindings/pull/11))
- add missing features ([#2](https://github.com/agntcy/slim-bindings/pull/2))
- move code from slim ([#1](https://github.com/agntcy/slim-bindings/pull/1))

## [2.0.0-alpha.3](https://github.com/agntcy/slim-bindings/compare/slim-bindings-v2.0.0-alpha.2...slim-bindings-v2.0.0-alpha.3) - 2026-07-14

### Added

- named exports for `@agntcy/slim-bindings` to unblock slimrpc/A2A stubs ([#25](https://github.com/agntcy/slim-bindings/pull/25))
- slimrpc support for js/ts bindings ([#22](https://github.com/agntcy/slim-bindings/pull/22))
- validate slimrpc in java/kotlin CI + fix python proto task ([#17](https://github.com/agntcy/slim-bindings/pull/17))
- java and kotlin docs and task file updates ([#14](https://github.com/agntcy/slim-bindings/pull/14))

### Other

- migrate to uniffi-bindgen-react-native and update Node.js bindings ([#20](https://github.com/agntcy/slim-bindings/pull/20))

## [2.0.0-alpha.2](https://github.com/agntcy/slim-bindings/compare/slim-bindings-v2.0.0-alpha.1...slim-bindings-v2.0.0-alpha.2) - 2026-06-29

### Other

- release 2.0.0-alpha.2 ([#11](https://github.com/agntcy/slim-bindings/pull/11))

## [1.4.0](https://github.com/agntcy/slim/compare/slim-bindings-v1.3.0...slim-bindings-v1.4.0) - 2026-04-21

### Added

- add tower auth middleware using spire ([#1452](https://github.com/agntcy/slim/pull/1452))

### Fixed

- adding linters to Golang, Java and Kotlin bindings and generaliz… ([#1502](https://github.com/agntcy/slim/pull/1502))

### Other

- prepare 1.4.0 ([#1530](https://github.com/agntcy/slim/pull/1530))

## [1.3.0](https://github.com/agntcy/slim/compare/slim-bindings-v1.2.0...slim-bindings-v1.3.0) - 2026-03-31

### Added

- slimrcp multicast examples ([#1346](https://github.com/agntcy/slim/pull/1346))
- add backward compatibility integration tests ([#1402](https://github.com/agntcy/slim/pull/1402))
- multicast RPC support ([#1335](https://github.com/agntcy/slim/pull/1335))
- Fix dotnet bindings ([#1403](https://github.com/agntcy/slim/pull/1403))
- MLS identity key integration and security dependency upgrades ([#1394](https://github.com/agntcy/slim/pull/1394))
- add link negotiation protocol between SLIM nodes ([#1353](https://github.com/agntcy/slim/pull/1353))
- expose json config in bindings ([#1366](https://github.com/agntcy/slim/pull/1366))
- add agntcy-slim-version crate as single source of truth for version and build info ([#1360](https://github.com/agntcy/slim/pull/1360))
- *(slimrpc)* session reuse and method demultiplexing ([#1334](https://github.com/agntcy/slim/pull/1334))
- *(websocket)* update the config module while making sure backward compatibility ([#1333](https://github.com/agntcy/slim/pull/1333))
- upgrade bindings to uniffi 0.29 ([#1321](https://github.com/agntcy/slim/pull/1321))

### Other

- move app ID generation from bindings to core application layer ([#1408](https://github.com/agntcy/slim/pull/1408))
- reduce allocations in slimrpc Rust bindings ([#1336](https://github.com/agntcy/slim/pull/1336))
- *(bindings)* Refactor Taskfiles to avoid rebuilds if source unchanged ([#1261](https://github.com/agntcy/slim/pull/1261))

## [1.2.0](https://github.com/agntcy/slim/compare/slim-bindings-v1.1.1...slim-bindings-v1.2.0) - 2026-02-27

### Added

- slim bindings kotlin ([#1198](https://github.com/agntcy/slim/pull/1198))
- remove go implementation of slimctl and refactor workflows ([#1276](https://github.com/agntcy/slim/pull/1276))
- Create helper to convert string name to slim_bindings.Name ([#1251](https://github.com/agntcy/slim/pull/1251))
- improve default values for exposed Client and Server config ([#1244](https://github.com/agntcy/slim/pull/1244))

### Fixed

- *(slimctl)* improve startup error reporting ([#1248](https://github.com/agntcy/slim/pull/1248))
- remove finalize keyword from bindings ([#1237](https://github.com/agntcy/slim/pull/1237))

## [1.1.1](https://github.com/agntcy/slim/compare/slim-bindings-v1.1.0...slim-bindings-v1.1.1) - 2026-02-13

### Fixed

- *(slimrpc-compiler)* correctly process errors from handlers ([#1229](https://github.com/agntcy/slim/pull/1229))

## [1.1.0](https://github.com/agntcy/slim/releases/tag/slim-bindings-v1.0.1) - 2026-02-06

### Added

- *(bindings)* implement slimrpc in bindings ([#1202](https://github.com/agntcy/slim/pull/1202))
- *(bindings)* set release candidate 1.0.0-rc.0 ([#1135](https://github.com/agntcy/slim/pull/1135))
- *(bindings)* move to new python bindings ([#1116](https://github.com/agntcy/slim/pull/1116))
- *(session)* Add direction to slim app to control message flow ([#1121](https://github.com/agntcy/slim/pull/1121))
- generate python bindings with uniffi ([#1046](https://github.com/agntcy/slim/pull/1046))

### Fixed

- *(bindings)* automatically convert internal errors to exposed errors ([#1154](https://github.com/agntcy/slim/pull/1154))

### Other

- upgrade slim-bindings to v1.0.1 ([#1207](https://github.com/agntcy/slim/pull/1207))
- release ([#1162](https://github.com/agntcy/slim/pull/1162))
- release ([#1156](https://github.com/agntcy/slim/pull/1156))
- release ([#1011](https://github.com/agntcy/slim/pull/1011))
- *(Taskfile)* move zig installation to global tools ([#1120](https://github.com/agntcy/slim/pull/1120))
- *(bindings)* do not expose tokio-specific APIs to foreign async calls ([#1110](https://github.com/agntcy/slim/pull/1110))
- *(bindings)* allow multiple global services ([#1106](https://github.com/agntcy/slim/pull/1106))
- *(bindings)* rename BindingsAdapter into App and BindingsSessionContext into Session ([#1104](https://github.com/agntcy/slim/pull/1104))

## [1.0.0](https://github.com/agntcy/slim/releases/tag/slim-bindings-v1.0.0) - 2026-02-06

### Added

- *(bindings)* set release candidate 1.0.0-rc.0 ([#1135](https://github.com/agntcy/slim/pull/1135))
- *(bindings)* move to new python bindings ([#1116](https://github.com/agntcy/slim/pull/1116))
- *(session)* Add direction to slim app to control message flow ([#1121](https://github.com/agntcy/slim/pull/1121))
- generate python bindings with uniffi ([#1046](https://github.com/agntcy/slim/pull/1046))

### Fixed

- *(bindings)* automatically convert internal errors to exposed errors ([#1154](https://github.com/agntcy/slim/pull/1154))

### Other

- release ([#1156](https://github.com/agntcy/slim/pull/1156))
- release ([#1011](https://github.com/agntcy/slim/pull/1011))
- *(Taskfile)* move zig installation to global tools ([#1120](https://github.com/agntcy/slim/pull/1120))
- *(bindings)* do not expose tokio-specific APIs to foreign async calls ([#1110](https://github.com/agntcy/slim/pull/1110))
- *(bindings)* allow multiple global services ([#1106](https://github.com/agntcy/slim/pull/1106))
- *(bindings)* rename BindingsAdapter into App and BindingsSessionContext into Session ([#1104](https://github.com/agntcy/slim/pull/1104))

## [1.0.0-rc.0](https://github.com/agntcy/slim/releases/tag/slim-bindings-v1.0.0-rc.0) - 2026-01-29

### Added

- *(bindings)* set release candidate 1.0.0-rc.0 ([#1135](https://github.com/agntcy/slim/pull/1135))
- *(bindings)* move to new python bindings ([#1116](https://github.com/agntcy/slim/pull/1116))
- *(session)* Add direction to slim app to control message flow ([#1121](https://github.com/agntcy/slim/pull/1121))
- generate python bindings with uniffi ([#1046](https://github.com/agntcy/slim/pull/1046))

### Other

- *(Taskfile)* move zig installation to global tools ([#1120](https://github.com/agntcy/slim/pull/1120))
- *(bindings)* do not expose tokio-specific APIs to foreign async calls ([#1110](https://github.com/agntcy/slim/pull/1110))
- *(bindings)* allow multiple global services ([#1106](https://github.com/agntcy/slim/pull/1106))
- *(bindings)* rename BindingsAdapter into App and BindingsSessionContext into Session ([#1104](https://github.com/agntcy/slim/pull/1104))
