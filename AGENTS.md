# Repository Guidelines

## Project Structure & Module Organization

`diablo-like-game` is an initial workspace with no application source, assets, dependency manifests, or test suite yet. Follow the selected engine's conventions when scaffolding; a suggested layout is:

- `src/`: gameplay systems, input handling, and application code.
- `tests/`: automated tests and reusable fixtures.
- `assets/`: sprites, audio, maps, and other game resources.
- `docs/`: setup instructions and architecture notes.

Keep generated builds and engine caches out of source directories and version control.

## Build, Test, and Development Commands

No build system or package manager is configured, so there are currently no verified install, run, build, or test commands. When adding the toolchain, document exact commands and required versions in `README.md`, then update this guide. Provide repeatable commands for local gameplay, production builds, automated tests, and formatting.

## Coding Style & Naming Conventions

Adopt the selected language's standard formatter and linter, and commit their configuration. Use two spaces for JSON and YAML; establish source-code indentation with the first implementation. Follow the language's standard naming rules and use descriptive gameplay identifiers. Prefer lowercase, hyphen-separated asset filenames, such as `dungeon-floor.png`. Keep combat, input, rendering, and persistence responsibilities separate.

## Testing Guidelines

No testing framework or coverage target is established. Add tests with new gameplay logic using the chosen framework's standard test-file naming. Prioritize damage calculations, loot generation, inventory rules, and save/load behavior. Seed randomness for reproducible tests. Until automated checks exist, describe manual gameplay validation and reproduction steps in each pull request.

## Commit & Pull Request Guidelines

This directory has no Git metadata or commit history, so no existing commit convention can be inferred. After Git is initialized, use short, imperative commit subjects, such as `Add inventory capacity checks`. Keep changes focused. Pull requests should explain the change, link relevant issues, list validation performed, and include screenshots or a short recording for visible gameplay changes.
