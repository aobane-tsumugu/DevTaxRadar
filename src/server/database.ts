import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolvedTimeZone } from '../adapters/localTime.js'
import type { NormalizedUsage, UsageProvider } from '../adapters/types.js'
import type { ProviderChargePeriod } from '../core/chargePeriods.js'
import {
  getAppDataDirectory,

// __UNTOUCHED_FILE_CONTENT__
    // Rebuild every property explicitly. This is defense in depth for the
    // cache's privacy boundary: even a manually altered SQLite row cannot
    // reintroduce a localReference or arbitrary transcript-shaped payload.
    return parsed.map((event) => {
      const cached = event as CachedNormalizedUsage
      return {
        provider: cached.provider,
        ...(cached.eventKey === undefined ? {} : { eventKey: cached.eventKey }),
        month: cached.month,
        observedAt: cached.observedAt,
        sessionKey: cached.sessionKey,
        projectKey: cached.projectKey,
        ...(cached.projectLabel === undefined ? {} : { projectLabel: cached.projectLabel }),
        model: cached.model,
