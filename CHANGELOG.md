# Changelog

All notable changes to the Workout Tracker are documented in this file.

## [0.0.1.0] - 2026-08-29

### Fixed

- Prefill weight and rep fields with the most recent values for each exercise, even when those values came from a different workout day or an earlier session.
- Calculate non-assisted personal records from the highest-volume individual set (`weight × reps`) and show the PR badge on that exact set and session.
- Choose the correct latest workout when multiple sessions share the same date.
