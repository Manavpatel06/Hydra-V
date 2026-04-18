import { GardenScene } from './garden/GardenScene'
import type { GardenSnapshot, VoiceNote } from '../types/domain'

interface SolaceGardenPanelProps {
  snapshot: GardenSnapshot
  voiceNote: VoiceNote
  onPlayVoice: () => Promise<void>
  onCaptureImage: () => void
  onCanvasReady: (canvas: HTMLCanvasElement) => void
  sharePreview: string | null
}

const speciesLabel: Record<string, string> = {
  birch: 'Birch (Light)',
  bamboo: 'Bamboo (Resonance)',
  pine: 'Pine (Thermal)',
  oak: 'Oak (Balanced)',
  rare: 'Rare Species',
}

export const SolaceGardenPanel = ({
  snapshot,
  voiceNote,
  onPlayVoice,
  onCaptureImage,
  onCanvasReady,
  sharePreview,
}: SolaceGardenPanelProps) => (
  <section className="panel panel-garden">
    <header className="panel-header">
      <h2>Solace Digital Garden+</h2>
      <p>
        A living continuity layer: physiology becomes visual growth, not just another chart.
      </p>
    </header>

    <div className="garden-canvas-wrap">
      <GardenScene snapshot={snapshot} onCanvasReady={onCanvasReady} />
    </div>

    <div className="garden-actions">
      <button type="button" className="primary-btn" onClick={() => void onPlayVoice()}>
        Play Post-Session Voice Note
      </button>
      <button type="button" className="secondary-btn" onClick={onCaptureImage}>
        Capture Share Image
      </button>
    </div>

    <article className="voice-card">
      <h3>{voiceNote.headline}</h3>
      <p>{voiceNote.body}</p>
    </article>

    <div className="milestone-grid">
      <div className="milestone-card">
        <span>Streak</span>
        <strong>{snapshot.milestones.streak} sessions</strong>
      </div>
      <div className="milestone-card">
        <span>Recovery score</span>
        <strong>{snapshot.milestones.recoveryScore}</strong>
      </div>
      <div className="milestone-card">
        <span>Frost level</span>
        <strong>{Math.round(snapshot.milestones.frostLevel * 100)}%</strong>
      </div>
      <div className="milestone-card">
        <span>Biome unlock</span>
        <strong>{snapshot.milestones.biomeUnlocked ? 'Unlocked' : 'Locked'}</strong>
      </div>
      <div className="milestone-card">
        <span>River event</span>
        <strong>{snapshot.milestones.equilibriumRiver ? 'Active' : 'Pending'}</strong>
      </div>
      <div className="milestone-card">
        <span>Blossom event</span>
        <strong>{snapshot.milestones.blossomEvent ? 'Blooming' : 'Inactive'}</strong>
      </div>
    </div>

    <div className="species-mix">
      <h3>Species composition</h3>
      {Object.entries(snapshot.milestones.speciesMix).map(([species, count]) => (
        <div key={species} className="species-row">
          <span>{speciesLabel[species] ?? species}</span>
          <strong>{count}</strong>
        </div>
      ))}
    </div>

    {sharePreview && (
      <div className="share-preview">
        <h3>Latest capture preview</h3>
        <img src={sharePreview} alt="Solace Garden snapshot preview" />
      </div>
    )}
  </section>
)
