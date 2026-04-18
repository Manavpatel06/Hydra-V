import { useMemo, useState } from 'react'
import type { SessionModality, SessionOutcomes } from '../types/domain'

interface OutcomeCapturePanelProps {
  onCompleteSession: (payload: { modality: SessionModality; outcomes: SessionOutcomes }) => Promise<void>
}

interface CaptureState {
  modality: SessionModality
  hrvBefore: number
  hrvAfter: number
  symmetryBefore: number
  symmetryAfter: number
  microsaccadeBefore: number
  microsaccadeAfter: number
  painBefore: number
  painAfter: number
  romBefore: number
  romAfter: number
  readinessBefore: number
  readinessAfter: number
}

const initialState = (): CaptureState => ({
  modality: 'hybrid',
  hrvBefore: 60,
  hrvAfter: 67,
  symmetryBefore: 13,
  symmetryAfter: 9,
  microsaccadeBefore: 0.7,
  microsaccadeAfter: 1.2,
  painBefore: 6,
  painAfter: 4,
  romBefore: 58,
  romAfter: 69,
  readinessBefore: 4.5,
  readinessAfter: 6.2,
})

const toOutcomes = (state: CaptureState): SessionOutcomes => ({
  hrvDelta: state.hrvAfter - state.hrvBefore,
  symmetryGain: state.symmetryBefore - state.symmetryAfter,
  symmetryDeltaRemaining: Math.max(state.symmetryAfter, 0),
  microsaccadeStabilityGain: state.microsaccadeAfter - state.microsaccadeBefore,
  painReduction: state.painBefore - state.painAfter,
  romGain: state.romAfter - state.romBefore,
  subjectiveReadinessGain: state.readinessAfter - state.readinessBefore,
})

export const OutcomeCapturePanel = ({ onCompleteSession }: OutcomeCapturePanelProps) => {
  const [state, setState] = useState<CaptureState>(initialState)
  const [saving, setSaving] = useState(false)
  const preview = useMemo(() => toOutcomes(state), [state])

  const update = <Key extends keyof CaptureState>(key: Key, value: CaptureState[Key]) =>
    setState((previous) => ({
      ...previous,
      [key]: value,
    }))

  const complete = async () => {
    setSaving(true)
    try {
      await onCompleteSession({
        modality: state.modality,
        outcomes: preview,
      })
      setState((previous) => ({
        ...initialState(),
        modality: previous.modality,
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Outcome + Continuity Capture</h2>
        <p>Before/after in one screen. Save session and train the next recommendation.</p>
      </header>

      <div className="capture-grid">
        <label>
          Session modality
          <select
            value={state.modality}
            onChange={(event) => update('modality', event.target.value as SessionModality)}
          >
            <option value="photobiomodulation">Photobiomodulation</option>
            <option value="resonance">Resonance</option>
            <option value="thermal">Thermal</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>

        <label>
          HRV before
          <input
            type="number"
            value={state.hrvBefore}
            onChange={(event) => update('hrvBefore', Number(event.target.value))}
          />
        </label>

        <label>
          HRV after
          <input
            type="number"
            value={state.hrvAfter}
            onChange={(event) => update('hrvAfter', Number(event.target.value))}
          />
        </label>

        <label>
          Symmetry delta before (%)
          <input
            type="number"
            step={0.1}
            value={state.symmetryBefore}
            onChange={(event) => update('symmetryBefore', Number(event.target.value))}
          />
        </label>

        <label>
          Symmetry delta after (%)
          <input
            type="number"
            step={0.1}
            value={state.symmetryAfter}
            onChange={(event) => update('symmetryAfter', Number(event.target.value))}
          />
        </label>

        <label>
          Micro-saccade before (Hz)
          <input
            type="number"
            step={0.1}
            value={state.microsaccadeBefore}
            onChange={(event) => update('microsaccadeBefore', Number(event.target.value))}
          />
        </label>

        <label>
          Micro-saccade after (Hz)
          <input
            type="number"
            step={0.1}
            value={state.microsaccadeAfter}
            onChange={(event) => update('microsaccadeAfter', Number(event.target.value))}
          />
        </label>

        <label>
          Pain before (0-10)
          <input
            type="number"
            step={0.1}
            value={state.painBefore}
            onChange={(event) => update('painBefore', Number(event.target.value))}
          />
        </label>

        <label>
          Pain after (0-10)
          <input
            type="number"
            step={0.1}
            value={state.painAfter}
            onChange={(event) => update('painAfter', Number(event.target.value))}
          />
        </label>

        <label>
          ROM before
          <input
            type="number"
            step={1}
            value={state.romBefore}
            onChange={(event) => update('romBefore', Number(event.target.value))}
          />
        </label>

        <label>
          ROM after
          <input
            type="number"
            step={1}
            value={state.romAfter}
            onChange={(event) => update('romAfter', Number(event.target.value))}
          />
        </label>

        <label>
          Readiness before (0-10)
          <input
            type="number"
            step={0.1}
            value={state.readinessBefore}
            onChange={(event) => update('readinessBefore', Number(event.target.value))}
          />
        </label>

        <label>
          Readiness after (0-10)
          <input
            type="number"
            step={0.1}
            value={state.readinessAfter}
            onChange={(event) => update('readinessAfter', Number(event.target.value))}
          />
        </label>
      </div>

      <div className="preview-strip">
        <span>HRV delta: {preview.hrvDelta.toFixed(1)}</span>
        <span>Symmetry gain: {preview.symmetryGain.toFixed(1)}%</span>
        <span>Pain reduction: {preview.painReduction.toFixed(1)}</span>
        <span>ROM gain: {preview.romGain.toFixed(1)}</span>
      </div>

      <button type="button" className="primary-btn" onClick={complete} disabled={saving}>
        {saving ? 'Saving...' : 'Complete Session + Update AI'}
      </button>
    </section>
  )
}
