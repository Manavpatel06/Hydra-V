import type { ProtocolParameters } from '../types/domain'
import type { HydraAuthTokens, HydraPlayCommand, HydraSessionConfigPayload } from '../types/hydrawav'
import { clamp } from './math'

interface LoginRequest {
  baseUrl: string
  username: string
  password: string
  rememberMe?: boolean
}

interface PublishRequest {
  baseUrl: string
  accessToken: string
  topic: string
  payload: Record<string, unknown>
}

const stripBearerPrefix = (tokenValue: string): string =>
  tokenValue.replace(/^Bearer\s+/i, '').trim()

const ensureOk = async (response: Response): Promise<void> => {
  if (response.ok) {
    return
  }

  const text = await response.text()
  throw new Error(text || `Request failed with status ${response.status}`)
}

const macShapeRegex = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

export const normalizeMacAddress = (value: string): string => {
  const normalized = value.trim().toUpperCase()
  if (!macShapeRegex.test(normalized)) {
    throw new Error('MAC address must be in format 74:4D:BD:A0:A3:EC')
  }
  return normalized
}

export const hydraLogin = async ({
  baseUrl,
  username,
  password,
  rememberMe = true,
}: LoginRequest): Promise<HydraAuthTokens> => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
      rememberMe,
    }),
  })

  await ensureOk(response)
  const data = (await response.json()) as {
    JWT_ACCESS_TOKEN?: string
    JWT_REFRESH_TOKEN?: string
  }

  const access = data.JWT_ACCESS_TOKEN ? stripBearerPrefix(data.JWT_ACCESS_TOKEN) : ''
  const refresh = data.JWT_REFRESH_TOKEN ? stripBearerPrefix(data.JWT_REFRESH_TOKEN) : undefined

  if (!access) {
    throw new Error('Login succeeded but JWT_ACCESS_TOKEN was missing.')
  }

  return {
    accessToken: access,
    refreshToken: refresh,
  }
}

export const hydraPublish = async ({
  baseUrl,
  accessToken,
  topic,
  payload,
}: PublishRequest): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/v1/mqtt/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${stripBearerPrefix(accessToken)}`,
    },
    body: JSON.stringify({
      topic,
      payload: JSON.stringify(payload),
    }),
  })

  await ensureOk(response)
}

const mapThermalStrength = (thermalGradient: number): { hotDrop: number; coldDrop: number } => {
  const hotDrop = Math.round(2 + thermalGradient * 6)
  const coldDrop = Math.round(2 + thermalGradient * 4)
  return { hotDrop, coldDrop }
}

const mapVibrationBand = (protocol: ProtocolParameters): { vibMin: number; vibMax: number } => {
  const base = clamp(protocol.vibrationHz, 20, 80)
  const vibMin = Math.round(clamp(base - 18, 10, 120))
  const vibMax = Math.round(clamp(base * 3.2 + protocol.resonanceBias * 20, 80, 240))
  return { vibMin, vibMax }
}

const mapPwmValues = (protocol: ProtocolParameters): { hot: number[]; cold: number[] } => {
  const heatWeight = clamp(protocol.thermalGradient, 0, 1)
  const lightWeight = clamp(protocol.lightRatio, 0, 1)

  const hotValue = Math.round(clamp(70 + heatWeight * 35 + lightWeight * 8, 65, 110))
  const coldValue = Math.round(clamp(180 + heatWeight * 80 - lightWeight * 30, 120, 255))

  return {
    hot: [hotValue, hotValue, hotValue],
    cold: [coldValue, coldValue, coldValue],
  }
}

const leftFunctions = (protocol: ProtocolParameters): string[] => {
  if (protocol.lightRatio > 0.66) {
    return ['leftColdBlue', 'leftHotRed', 'leftHotRed']
  }
  if (protocol.thermalGradient > 0.64) {
    return ['leftHotRed', 'leftColdBlue', 'leftHotRed']
  }
  return ['leftColdBlue', 'leftHotRed', 'leftColdBlue']
}

const rightFunctions = (protocol: ProtocolParameters): string[] => {
  if (protocol.resonanceBias > 0.68) {
    return ['rightHotRed', 'rightHotRed', 'rightColdBlue']
  }
  if (protocol.thermalGradient > 0.64) {
    return ['rightColdBlue', 'rightHotRed', 'rightHotRed']
  }
  return ['rightHotRed', 'rightColdBlue', 'rightHotRed']
}

export const buildStartSessionPayload = (
  protocol: ProtocolParameters,
  macAddress: string,
): HydraSessionConfigPayload => {
  const mac = normalizeMacAddress(macAddress)
  const cycleDurations = [3, 3, 3]
  const cycleRepetitions = [6, 6, 3]
  const cyclePauses = [3, 3, 3]
  const pauseIntervals = [3, 3, 3]
  const totalDuration = Math.round(protocol.padDurationMin * 60)

  const { hotDrop, coldDrop } = mapThermalStrength(protocol.thermalGradient)
  const { vibMin, vibMax } = mapVibrationBand(protocol)

  return {
    mac,
    sessionCount: 3,
    sessionPause: 30,
    sDelay: 0,
    cycle1: 1,
    cycle5: 1,
    edgeCycleDuration: 9,
    cycleRepetitions,
    cycleDurations,
    cyclePauses,
    pauseIntervals,
    leftFuncs: leftFunctions(protocol),
    rightFuncs: rightFunctions(protocol),
    pwmValues: mapPwmValues(protocol),
    playCmd: 1,
    led: 1,
    hotDrop,
    coldDrop,
    vibMin,
    vibMax,
    totalDuration,
  }
}

export const buildPlayCommandPayload = (
  macAddress: string,
  playCmd: HydraPlayCommand,
): { mac: string; playCmd: HydraPlayCommand } => ({
  mac: normalizeMacAddress(macAddress),
  playCmd,
})

export const playCommandLabel = (cmd: HydraPlayCommand): string => {
  if (cmd === 1) {
    return 'Start'
  }
  if (cmd === 2) {
    return 'Pause'
  }
  if (cmd === 3) {
    return 'Stop'
  }
  return 'Resume'
}
