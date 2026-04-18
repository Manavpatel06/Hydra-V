import type { ProtocolParameters, ProtocolRecommendation } from '../types/domain'
import { asPercent } from '../lib/scoring'

interface AdaptiveProtocolPanelProps {
  recommendation: ProtocolRecommendation
  draftProtocol: ProtocolParameters
  onDraftChange: (next: ProtocolParameters) => void
  onApplyRecommendation: () => void
  overrideNote: string
  onOverrideNoteChange: (next: string) => void
}

const updateNumeric = (
  protocol: ProtocolParameters,
  key: keyof Omit<ProtocolParameters, 'contralateralTargeting'>,
  value: number,
): ProtocolParameters => ({
  ...protocol,
  [key]: value,
})

const formatInsightValue = (key: keyof ProtocolParameters, value: number): string => {
  if (key === 'vibrationHz') {
    return `${Math.round(value)} Hz`
  }
  if (key === 'padDurationMin') {
    return `${Math.round(value)} min`
  }
  if (key === 'contralateralTargeting') {
    return value >= 0.5 ? 'Enabled' : 'Disabled'
  }
  return asPercent(value)
}

export const AdaptiveProtocolPanel = ({
  recommendation,
  draftProtocol,
  onDraftChange,
  onApplyRecommendation,
  overrideNote,
  onOverrideNoteChange,
}: AdaptiveProtocolPanelProps) => (
  <section className="panel">
    <header className="panel-header">
      <h2>Adaptive Protocol AI</h2>
      <p>
        Model mode: <strong>{recommendation.modelMode}</strong>
      </p>
    </header>

    <div className="stat-grid">
      <div className="stat-box">
        <span>Expected improvement</span>
        <strong>{recommendation.expectedImprovement.toFixed(2)}</strong>
      </div>
      <div className="stat-box">
        <span>Uncertainty</span>
        <strong>{recommendation.uncertainty.toFixed(2)}</strong>
      </div>
      <div className="stat-box">
        <span>Confidence</span>
        <strong>{asPercent(recommendation.confidence)}</strong>
      </div>
      <div className="stat-box">
        <span>Compute</span>
        <strong>{recommendation.usingWebGPU ? 'WebGPU-ready' : 'CPU fallback'}</strong>
      </div>
    </div>

    <button type="button" className="primary-btn" onClick={onApplyRecommendation}>
      Apply AI Recommendation
    </button>

    <div className="parameter-grid">
      <label>
        Light ratio
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={draftProtocol.lightRatio}
          onChange={(event) =>
            onDraftChange(updateNumeric(draftProtocol, 'lightRatio', Number(event.target.value)))
          }
        />
        <span>{asPercent(draftProtocol.lightRatio)}</span>
      </label>

      <label>
        Vibration intensity
        <input
          type="range"
          min={20}
          max={80}
          step={1}
          value={draftProtocol.vibrationHz}
          onChange={(event) =>
            onDraftChange(updateNumeric(draftProtocol, 'vibrationHz', Number(event.target.value)))
          }
        />
        <span>{Math.round(draftProtocol.vibrationHz)} Hz</span>
      </label>

      <label>
        Thermal gradient
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={draftProtocol.thermalGradient}
          onChange={(event) =>
            onDraftChange(
              updateNumeric(draftProtocol, 'thermalGradient', Number(event.target.value)),
            )
          }
        />
        <span>{asPercent(draftProtocol.thermalGradient)}</span>
      </label>

      <label>
        Pad duration
        <input
          type="range"
          min={8}
          max={30}
          step={1}
          value={draftProtocol.padDurationMin}
          onChange={(event) =>
            onDraftChange(
              updateNumeric(draftProtocol, 'padDurationMin', Number(event.target.value)),
            )
          }
        />
        <span>{Math.round(draftProtocol.padDurationMin)} min</span>
      </label>

      <label>
        Resonance bias
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={draftProtocol.resonanceBias}
          onChange={(event) =>
            onDraftChange(updateNumeric(draftProtocol, 'resonanceBias', Number(event.target.value)))
          }
        />
        <span>{asPercent(draftProtocol.resonanceBias)}</span>
      </label>

      <label className="toggle-row">
        <span>Contralateral targeting</span>
        <input
          type="checkbox"
          checked={draftProtocol.contralateralTargeting}
          onChange={(event) =>
            onDraftChange({
              ...draftProtocol,
              contralateralTargeting: event.target.checked,
            })
          }
        />
      </label>
    </div>

    <div className="confidence-map">
      <h3>Parameter confidence map</h3>
      {recommendation.parameterInsights.map((insight) => (
        <div className="confidence-row" key={insight.key}>
          <div className="confidence-labels">
            <span>{insight.label}</span>
            <span>{formatInsightValue(insight.key, insight.value)}</span>
          </div>
          <div className="confidence-track">
            <div style={{ width: `${insight.confidence * 100}%` }} />
          </div>
        </div>
      ))}
    </div>

    <div className="insight-block">
      <h3>Model rationale</h3>
      {recommendation.rationale.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>

    {recommendation.warnings.length > 0 && (
      <div className="warning-block">
        <h3>Diminishing return alerts</h3>
        {recommendation.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
    )}

    <label className="override-note">
      Practitioner override note
      <textarea
        rows={3}
        placeholder="Optional: explain any manual adjustment for next-session learning."
        value={overrideNote}
        onChange={(event) => onOverrideNoteChange(event.target.value)}
      />
    </label>
  </section>
)
