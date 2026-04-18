import { format } from 'date-fns'
import type { GardenSnapshot, ProtocolRecommendation, SessionRecord, VoiceNote } from '../types/domain'

const elevenLabsKey = import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined
const elevenLabsVoiceId = import.meta.env.VITE_ELEVENLABS_VOICE_ID as string | undefined

export interface VoicePlaybackResult {
  mode: 'elevenlabs' | 'speech' | 'none'
  reason?: string
}

const buildFocus = (recommendation: ProtocolRecommendation): string => {
  if (recommendation.warnings.length > 0) {
    return recommendation.warnings[0]
  }

  if (recommendation.protocol.contralateralTargeting) {
    return 'Use contralateral mirroring during setup to support better motor carryover.'
  }

  return 'Stay with smooth nasal breathing during the first two protocol minutes to improve down-regulation.'
}

export const buildPostSessionVoiceNote = (
  latest: SessionRecord | undefined,
  recommendation: ProtocolRecommendation,
  garden: GardenSnapshot,
): VoiceNote => {
  if (!latest) {
    return {
      headline: 'Welcome to your Solace Garden',
      body: 'Complete the first session to start your adaptive recovery timeline.',
    }
  }

  const dateLabel = format(new Date(latest.createdAt), 'MMM d')
  const bloomText = garden.milestones.blossomEvent
    ? 'You unlocked a bloom event across your forest today.'
    : 'Your forest expanded with one new growth element today.'
  const riverText = garden.milestones.equilibriumRiver
    ? 'Symmetry is in equilibrium and the river biome is now active.'
    : 'Keep reducing residual asymmetry to unlock the river biome.'

  return {
    headline: `Session ${dateLabel}: Recovery score ${garden.milestones.recoveryScore}`,
    body: `${bloomText} ${riverText} Next focus: ${buildFocus(recommendation)}`,
  }
}

const playWithSpeechSynthesis = (text: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve(false)
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.96
    utterance.pitch = 0.97
    utterance.onend = () => resolve(true)
    utterance.onerror = () => resolve(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })

const playWithElevenLabs = async (text: string): Promise<boolean> => {
  if (!elevenLabsKey || !elevenLabsVoiceId) {
    return false
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.38,
          similarity_boost: 0.78,
        },
      }),
    },
  )

  if (!response.ok) {
    return false
  }

  const audioBuffer = await response.arrayBuffer()
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)

  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('Audio playback failed'))
      void audio.play().catch(reject)
    })
    return true
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const playVoiceNote = async (note: VoiceNote): Promise<VoicePlaybackResult> => {
  const text = `${note.headline}. ${note.body}`

  try {
    const usedElevenLabs = await playWithElevenLabs(text)
    if (usedElevenLabs) {
      return { mode: 'elevenlabs' }
    }
  } catch {
    // Fallback to native speech if ElevenLabs fails.
  }

  const usedSpeech = await playWithSpeechSynthesis(text)
  if (usedSpeech) {
    return { mode: 'speech' }
  }

  return {
    mode: 'none',
    reason:
      'No supported voice output available. Configure ElevenLabs keys or use a browser with SpeechSynthesis.',
  }
}
