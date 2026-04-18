export type HydraPlayCommand = 1 | 2 | 3 | 4

export interface HydraAuthTokens {
  accessToken: string
  refreshToken?: string
}

export interface HydraSessionConfigPayload {
  mac: string
  sessionCount: number
  sessionPause: number
  sDelay: number
  cycle1: number
  cycle5: number
  edgeCycleDuration: number
  cycleRepetitions: number[]
  cycleDurations: number[]
  cyclePauses: number[]
  pauseIntervals: number[]
  leftFuncs: string[]
  rightFuncs: string[]
  pwmValues: {
    hot: number[]
    cold: number[]
  }
  playCmd: HydraPlayCommand
  led: number
  hotDrop: number
  coldDrop: number
  vibMin: number
  vibMax: number
  totalDuration: number
}
