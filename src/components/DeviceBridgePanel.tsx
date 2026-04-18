import { useMemo, useState } from 'react'
import type { ProtocolParameters } from '../types/domain'
import type { HydraPlayCommand } from '../types/hydrawav'
import {
  buildPlayCommandPayload,
  buildStartSessionPayload,
  hydraLogin,
  hydraPublish,
  normalizeMacAddress,
  playCommandLabel,
} from '../lib/hydrawavDeviceApi'

interface DeviceBridgePanelProps {
  protocol: ProtocolParameters
  onStatus: (message: string) => void
}

const TOPIC = 'HydraWav3Pro/config'

const requestDefaults = {
  baseUrl: 'http://localhost:8080',
  username: '',
  password: '',
  rememberMe: true,
  macAddress: '74:4D:BD:A0:A3:EC',
}

export const DeviceBridgePanel = ({ protocol, onStatus }: DeviceBridgePanelProps) => {
  const [baseUrl, setBaseUrl] = useState(requestDefaults.baseUrl)
  const [username, setUsername] = useState(requestDefaults.username)
  const [password, setPassword] = useState(requestDefaults.password)
  const [rememberMe, setRememberMe] = useState(requestDefaults.rememberMe)
  const [macAddress, setMacAddress] = useState(requestDefaults.macAddress)
  const [accessToken, setAccessToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastPayload, setLastPayload] = useState('')
  const [panelStatus, setPanelStatus] = useState(
    'Waiting for login. This panel needs a reachable HydraWav API service.',
  )

  const reportStatus = (message: string) => {
    setPanelStatus(message)
    onStatus(message)
  }

  const friendlyError = (error: unknown): string => {
    if (error instanceof TypeError) {
      return 'Network/CORS failure. Verify API base URL and allow browser origin in backend CORS.'
    }
    return error instanceof Error ? error.message : 'Unknown error'
  }

  const startPayloadPreview = useMemo(() => {
    try {
      const payload = buildStartSessionPayload(protocol, macAddress)
      return JSON.stringify(payload, null, 2)
    } catch {
      return 'Invalid MAC address format. Use XX:XX:XX:XX:XX:XX'
    }
  }, [protocol, macAddress])

  const login = async () => {
    if (!username.trim() || !password.trim()) {
      reportStatus('Enter HydraWav API username and password before login.')
      return
    }

    setBusy(true)
    try {
      const tokens = await hydraLogin({
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        username: username.trim(),
        password: password.trim(),
        rememberMe,
      })
      setAccessToken(tokens.accessToken)
      reportStatus('HydraWav auth success. Access token loaded for MQTT publish calls.')
    } catch (error) {
      reportStatus(`HydraWav auth failed: ${friendlyError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const publishControl = async (playCmd: HydraPlayCommand) => {
    if (!accessToken) {
      reportStatus('Login first to retrieve JWT_ACCESS_TOKEN.')
      return
    }

    setBusy(true)
    try {
      const payload =
        playCmd === 1
          ? buildStartSessionPayload(protocol, macAddress)
          : buildPlayCommandPayload(macAddress, playCmd)

      await hydraPublish({
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        accessToken,
        topic: TOPIC,
        payload,
      })

      setLastPayload(JSON.stringify(payload, null, 2))
      reportStatus(
        `Published ${playCommandLabel(playCmd)} command to ${TOPIC} for ${normalizeMacAddress(
          macAddress,
        )}.`,
      )
    } catch (error) {
      reportStatus(`MQTT publish failed: ${friendlyError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>HydraWav Device Bridge</h2>
        <p>
          Mapped from the hackathon MQTT document: login, then publish to
          <strong> HydraWav3Pro/config</strong> with stringified payload.
        </p>
      </header>

      <div className="bridge-grid">
        <label>
          API base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label>
          Device MAC
          <input value={macAddress} onChange={(event) => setMacAddress(event.target.value)} />
        </label>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </div>

      <label className="toggle-row">
        <span>Remember me</span>
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(event) => setRememberMe(event.target.checked)}
        />
      </label>

      <div className="bridge-actions">
        <button type="button" className="secondary-btn" onClick={() => void login()} disabled={busy}>
          Login for JWT Token
        </button>
        <button
          type="button"
          className="primary-btn"
          onClick={() => void publishControl(1)}
          disabled={busy}
        >
          Start Session
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void publishControl(2)}
          disabled={busy}
        >
          Pause
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void publishControl(4)}
          disabled={busy}
        >
          Resume
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void publishControl(3)}
          disabled={busy}
        >
          Stop
        </button>
      </div>

      <div className="token-line">
        <span>Token status:</span>
        <strong>{accessToken ? 'Loaded' : 'Not loaded'}</strong>
      </div>

      <p className="panel-status">{panelStatus}</p>

      <div className="payload-preview">
        <h3>Start payload preview</h3>
        <pre>{startPayloadPreview}</pre>
      </div>

      {lastPayload && (
        <div className="payload-preview">
          <h3>Last published payload</h3>
          <pre>{lastPayload}</pre>
        </div>
      )}

      <p className="doc-note">
        PDF note: the table shows Pause=3, but the explicit Pause request example uses
        <code> playCmd: 2</code>. This bridge follows the explicit request examples:
        Start=1, Pause=2, Stop=3, Resume=4.
      </p>
    </section>
  )
}
