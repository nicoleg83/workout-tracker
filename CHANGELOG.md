# Changelog

All notable changes to the Workout Tracker are documented in this file.

## [0.0.2.0] - 2026-09-09

### Fixed

- Stop re-queuing workout history that Supabase has already saved.
- Send large recovery queues in batches, while keeping any failed row on the device for another retry.
- Mark new local records as pending until Supabase confirms the write.

## [0.0.1.0] - 2026-08-29

### Fixed

- Prefill weight and rep fields with the most recent values for each exercise, even when those values came from a different workout day or an earlier session.
- Calculate non-assisted personal records from the highest-volume individual set (`weight × reps`) and show the PR badge on that exact set and session.
- Choose the correct latest workout when multiple sessions share the same date.
