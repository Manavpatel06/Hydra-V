import Dexie, { type Table } from 'dexie'
import type { SessionRecord } from '../types/domain'

class HydraVDatabase extends Dexie {
  sessions!: Table<SessionRecord, string>

  constructor() {
    super('hydra-v-db')
    this.version(1).stores({
      sessions: 'id, athleteId, createdAt, modality',
    })
  }
}

export const hydraDb = new HydraVDatabase()
