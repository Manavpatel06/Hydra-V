import { useMemo, useState } from 'react'
import { AdaptiveProtocolPanel } from './components/AdaptiveProtocolPanel'
import { DeviceBridgePanel } from './components/DeviceBridgePanel'
import { FeatureGuidePanel } from './components/FeatureGuidePanel'
import { OutcomeCapturePanel } from './components/OutcomeCapturePanel'
import { SolaceGardenPanel } from './components/SolaceGardenPanel'
import { useHydraSessions } from './hooks/useHydraSessions'
import { recommendProtocol } from './lib/adaptiveProtocol'
import { buildGardenSnapshot } from './lib/gardenGrowth'
import { recoveryScore } from './lib/scoring'
import { buildPostSessionVoiceNote, playVoiceNote } from './lib/voice'
import type { ProtocolParameters, SessionModality, SessionOutcomes } from './types/domain'

function App() {
  const { loading, sessions, addSession, resetDemoData } = useHydraSessions()
  const [draftProtocol, setDraftProtocol] = useState<ProtocolParameters | null>(null)
  const [overrideNote, setOverrideNote] = useState('')
  const [sharePreview, setSharePreview] = useState<string | null>(null)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  const webGPUAvailable = useMemo(
    () => typeof navigator !== 'undefined' && 'gpu' in navigator,
    [],
  )

  const recommendation = useMemo(
    () => recommendProtocol(sessions, webGPUAvailable),
    [sessions, webGPUAvailable],
  )

  const gardenSnapshot = useMemo(() => buildGardenSnapshot(sessions), [sessions])

  const latestSession = sessions.at(-1)
  const latestRecoveryScore = recoveryScore(latestSession)
  const voiceNote = useMemo(
    () => buildPostSessionVoiceNote(latestSession, recommendation, gardenSnapshot),
    [latestSession, recommendation, gardenSnapshot],
  )
  const activeProtocol = draftProtocol ?? recommendation.protocol

  const applyRecommendation = () => {
    setDraftProtocol(recommendation.protocol)
    setStatusMessage('AI recommendation copied into the editable session card.')
  }

  const completeSession = async (payload: {
    modality: SessionModality
    outcomes: SessionOutcomes
  }) => {
    await addSession({
      modality: payload.modality,
      outcomes: payload.outcomes,
      protocol: activeProtocol,
      overrideNote: overrideNote.trim() || undefined,
    })

    setOverrideNote('')
    setDraftProtocol(null)
    setStatusMessage('Session saved. Garden growth and protocol model have been updated.')
  }

  const playContinuityVoice = async () => {
    setStatusMessage('Playing post-session continuity voice note...')
    const playback = await playVoiceNote(voiceNote)

    if (playback.mode === 'elevenlabs') {
      setStatusMessage('Voice note completed with ElevenLabs.')
      return
    }

    if (playback.mode === 'speech') {
      setStatusMessage('Voice note completed with browser speech synthesis fallback.')
      return
    }

    setStatusMessage(playback.reason ?? 'Voice note could not be played on this browser.')
  }

  const captureShareImage = () => {
    if (!canvasElement) {
      setStatusMessage('Canvas is still loading. Try capture again in a second.')
      return
    }

    const dataUrl = canvasElement.toDataURL('image/png')
    setSharePreview(dataUrl)
    setStatusMessage('Garden image captured. Preview is ready for sharing.')
  }

  if (loading) {
    return (
      <main className="app-shell">
        <section className="loading-state">
          <h1>HYDRA-V</h1>
          <p>Preparing local session intelligence...</p>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Recovery Intelligence Layer for Hydrawav3</p>
        <h1>HYDRA-V | Know - Act - Learn</h1>
        <p className="hero-copy">
          Feature 6 and Feature 7 MVP. All data stays on-device in IndexedDB and all
          recommendations are explainable for practitioner review in under two minutes.
        </p>

        <div className="top-stats">
          <article>
            <span>Sessions</span>
            <strong>{sessions.length}</strong>
          </article>
          <article>
            <span>Recovery score</span>
            <strong>{latestRecoveryScore}</strong>
          </article>
          <article>
            <span>Current streak</span>
            <strong>{gardenSnapshot.milestones.streak}</strong>
          </article>
          <article>
            <span>Mode</span>
            <strong>{recommendation.modelMode}</strong>
          </article>
        </div>

        <p className="guardrail">
          Wellness support only. HYDRA-V supports recovery, mobility, and performance and is not a
          diagnostic or treatment system.
        </p>
      </header>

      <section className="workspace-grid">
        <div className="column">
          <FeatureGuidePanel />

          <AdaptiveProtocolPanel
            recommendation={recommendation}
            draftProtocol={activeProtocol}
            onDraftChange={setDraftProtocol}
            onApplyRecommendation={applyRecommendation}
            overrideNote={overrideNote}
            onOverrideNoteChange={setOverrideNote}
          />

          <DeviceBridgePanel protocol={activeProtocol} onStatus={setStatusMessage} />

          <OutcomeCapturePanel onCompleteSession={completeSession} />

          <section className="panel trend-panel">
            <header className="panel-header">
              <h2>Practitioner trend view</h2>
              <p>Outcome trajectory over recent sessions.</p>
            </header>

            <div className="trend-chart">
              {sessions.slice(-8).map((session) => (
                <div key={session.id} className="trend-bar-wrap">
                  <div
                    className="trend-bar"
                    style={{
                      height: `${Math.max(16, session.outcomes.hrvDelta * 7)}px`,
                    }}
                  />
                  <span>{new Date(session.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="column">
          <SolaceGardenPanel
            snapshot={gardenSnapshot}
            voiceNote={voiceNote}
            onPlayVoice={playContinuityVoice}
            onCaptureImage={captureShareImage}
            onCanvasReady={setCanvasElement}
            sharePreview={sharePreview}
          />

          <section className="panel utility-panel">
            <h2>Demo controls</h2>
            <p>Reset seeded data to replay the full judge flow from session one.</p>
            <button type="button" className="secondary-btn" onClick={() => void resetDemoData()}>
              Reset Demo Dataset
            </button>
          </section>
        </div>
      </section>

      {statusMessage && <p className="status-banner">{statusMessage}</p>}
    </main>
  )
}

export default App
