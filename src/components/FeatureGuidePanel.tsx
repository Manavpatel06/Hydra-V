export const FeatureGuidePanel = () => (
  <section className="panel">
    <header className="panel-header">
      <h2>Feature Click Guide</h2>
      <p>Use this to verify each button and understand why something may appear not working.</p>
    </header>

    <div className="guide-grid">
      <article className="guide-card">
        <h3>Apply AI Recommendation</h3>
        <p>
          Copies the latest Adaptive Protocol values into the editable sliders and session card.
        </p>
        <p>If values are already similar, visual change may be small.</p>
      </article>

      <article className="guide-card">
        <h3>Complete Session + Update AI</h3>
        <p>
          Saves before/after metrics, retrains the N-of-1 model, grows the garden, updates streak and
          recovery score.
        </p>
      </article>

      <article className="guide-card">
        <h3>Play Post-Session Voice Note</h3>
        <p>Reads continuity note using ElevenLabs if configured, else browser speech synthesis.</p>
        <p>If silent, check browser tab audio permissions and speaker volume.</p>
      </article>

      <article className="guide-card">
        <h3>Capture Share Image</h3>
        <p>Captures the current 3D garden canvas and shows preview below the garden panel.</p>
      </article>

      <article className="guide-card">
        <h3>Device Bridge Login</h3>
        <p>Calls `POST /api/v1/auth/login` and stores JWT access token in memory.</p>
        <p>Requires reachable HydraWav API URL and valid credentials.</p>
      </article>

      <article className="guide-card">
        <h3>Start / Pause / Resume / Stop</h3>
        <p>
          Publishes to `POST /api/v1/mqtt/publish` with topic `HydraWav3Pro/config` and stringified
          payload.
        </p>
        <p>Requires successful login and API CORS allowance for browser requests.</p>
      </article>
    </div>
  </section>
)
