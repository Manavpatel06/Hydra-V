import { useCallback, useEffect, useState } from 'react'
import { createSeedSessions } from '../data/seedSessions'
import { hydraDb } from '../db/hydraDb'
import type { SessionModality, SessionOutcomes, SessionRecord } from '../types/domain'

const DEMO_ATHLETE = 'athlete-demo-001'

export interface AddSessionInput {
  modality: SessionModality
  outcomes: SessionOutcomes
  protocol: SessionRecord['protocol']
  overrideNote?: string
}

export const useHydraSessions = () => {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionRecord[]>([])

  const refresh = useCallback(async () => {
    const records = await hydraDb.sessions.where('athleteId').equals(DEMO_ATHLETE).sortBy('createdAt')
    setSessions(records)
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const existing = await hydraDb.sessions
        .where('athleteId')
        .equals(DEMO_ATHLETE)
        .sortBy('createdAt')

      if (existing.length === 0) {
        await hydraDb.sessions.bulkAdd(createSeedSessions())
      }

      await refresh()
      setLoading(false)
    }

    void bootstrap()
  }, [refresh])

  const addSession = useCallback(
    async (input: AddSessionInput) => {
      const record: SessionRecord = {
        id: crypto.randomUUID(),
        athleteId: DEMO_ATHLETE,
        createdAt: new Date().toISOString(),
        modality: input.modality,
        protocol: input.protocol,
        outcomes: input.outcomes,
        overrideNote: input.overrideNote,
      }

      await hydraDb.sessions.add(record)
      await refresh()
      return record
    },
    [refresh],
  )

  const resetDemoData = useCallback(async () => {
    await hydraDb.sessions.where('athleteId').equals(DEMO_ATHLETE).delete()
    await hydraDb.sessions.bulkAdd(createSeedSessions())
    await refresh()
  }, [refresh])

  return {
    loading,
    sessions,
    addSession,
    resetDemoData,
  }
}
