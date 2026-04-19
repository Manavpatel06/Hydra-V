# HYDRA-V: The Autonomic Symmetry Engine

**Rewiring the brain through pixels, light, and heartbeats.**

HYDRA-V is a **Neural Operating System** built on top of **Hydrawav3 hardware**. It transforms thermal, photobiomodulation, and resonance therapies into a **closed-loop adaptive system** using real-time physiology, neuroscience principles, and on-device AI.

This system bridges:

* **Computer Vision (markerless biomechanics)**
* **Biophotonic + cardiac signals (rPPG)**
* **Neuroscience (mirror neurons, interoception, entrainment)**
* **Adaptive optimization (Bayesian learning)**

---

## 🚀 Quick Start

### 1. Frontend + Realtime Engine

```bash
npm install @splinetool/react-spline @mediapipe/pose @mediapipe/camera_utils three @react-three/fiber @react-three/drei
npm install
npm start
```

---

### 2. Python Analytics Service (High-Fidelity Processing)

```bash
cd python_service
python -m venv .venv

# Windows
.venv\Scripts\activate

# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt
python main.py
```

Default:

```
http://127.0.0.1:8010
```

---

## 🧠 Hydrawav3 Integration

HYDRA-V directly controls and enhances:

### Thermal Modulation

* Sun (heat) + Moon (cold)
* Controlled via **placement + timing gradients**
* Used for vascular response + inflammation modulation

### Photobiomodulation

* **660nm red light** → mitochondrial stimulation (ATP production)
* **450nm blue light** → anti-inflammatory + antimicrobial
* Synchronized with cardiac cycle (Cardiac Gating+)

### Resonance Stimulation

* Low-frequency vibro-acoustic waves
* Targets fascia + neuromuscular activation
* Tuned dynamically per session

Combined effect: **Polar Water Resonance**

---

##  Core System Features 

### F1 — Aura-Scan+ (Know)

**Concepts Used:**

* Remote Photoplethysmography (rPPG)
* Fourier Transform (FFT)
* Autonomic Nervous System metrics

**Pipeline:**

1. Extract forehead ROI
2. Isolate green channel signal
3. Apply bandpass (0.04–0.4 Hz)
4. FFT → HRV spectrum

**Outputs:**

* HRV (vagal tone)
* CNS readiness score
* Symmetry Delta (MediaPipe Pose)
* Micro-saccade frequency (FaceMesh)

Fallback:

* POS algorithm for skin tone robustness
* Python (Welch PSD) for high-fidelity analysis

---

### F2 — Neural Handshake (Neural Priming)

**Concepts Used:**

* Mirror Neuron System (MNS)
* Cross-Education Transfer

**Process:**

* Capture healthy limb motion
* Mirror transform (canvas)
* Render as internal “ghost” overlay

**Effect:**

* Activates motor cortex pre-treatment
* Reduces neural inhibition
* Improves downstream therapy response

---

### F3 — Cardiac Gating+ (Synchronization)

**Concepts Used:**

* Interoceptive Predictive Coding
* Baroreflex sensitivity

**Implementation:**

* Extract heartbeat via rPPG
* Detect R-peak
* Trigger stimulation at:

→ **T-wave window (80–120ms post R-peak)**

**Transport:**

* Web Bluetooth (BLE)
* HydraWav API publish endpoint

**Result:**

* Higher biological acceptance
* Reduced defensive neural response

---

### F4 — Neuroacoustic Entrainment (Brain-State Control)

**Concepts Used:**

* Binaural beats
* Isochronic tones
* Cortical entrainment

**Phases:**

* Gamma (40Hz) → priming
* Theta (4–8Hz) → recovery
* Alpha (10Hz) → integration

**Personalization:**

* Derived from HRV + eye dynamics

**Voice Layer:**

* ElevenLabs dynamic narration
* Session-aware feedback generation

---

### F5 — Fascial Thermal Mapping (Soft Tissue Intelligence)

**Concepts Used:**

* Optical Flow (Farneback)
* Microcirculatory variance
* Computational thermography

**Pipeline:**

1. Capture 8s video
2. Compute pixel motion variance
3. Detect low-perfusion zones

Mapped to:

* **Anatomy Trains (myofascial chains)**

**Output:**

* Pad placement (Sun/Moon)
* Primary + secondary zones

---

### F6 — Solace Environment (Interactive Recovery Space)

**Concepts Used:**

* Generative environments
* Behavioral reinforcement
* Calm-state interaction design

Instead of a static growth visualization, HYDRA-V now provides a **peaceful, interactive recovery environment** where the user engages in simple daily activities.

**Environment Design:**

* Farmland-style setting
* Activities like tending crops, feeding animals, walking through the space
* Slow, calming interactions designed to reinforce parasympathetic states

**Data Mapping (Subtle, not gamified):**

* Better HRV → environment becomes more vibrant and alive
* Improved symmetry → smoother movement and responsiveness
* Recovery consistency → new areas and interactions unlock

**Purpose:**

* Encourage daily engagement without aggressive gamification
* Extend recovery beyond sessions through calm interaction
* Create a mental association between recovery and relaxation

**Experience Layer:**

* The system evolves based on physiological progress
* Users interact with their recovery through actions, not metrics

Includes:

* AI-generated voice summaries integrated into the environment

---

### F7 — Adaptive Protocol AI (Closed Loop Learning)

**Concepts Used:**

* Gaussian Process Regression
* Bayesian Optimization
* N-of-1 Trials

**Inputs:**

* HRV delta
* Symmetry delta
* CNS change

**Logic:**

* Predict response surface
* Select **Expected Improvement point**
* Detect plateaus

**Runs on:**

* WebGPU
* IndexedDB

No cloud. No latency.

---

##  Environment Setup

```env
PORT=3000
ELEVENLABS_API_KEY=your_key_here
HYDRAWAV_API_BASE_URL=https://api.hydrawav.com

PY_AURA_API_BASE_URL=http://127.0.0.1:8010
AURA_USE_PYTHON_ANALYTICS=true
THERMAL_USE_PYTHON_ANALYTICS=true
```

---

## 📡 Architecture

| Layer         | Tech                         |
| ------------- | ---------------------------- |
| Frontend      | React + Three.js + MediaPipe |
| Audio         | Web Audio API                |
| Device Sync   | Web Bluetooth                |
| AI            | WebGPU                       |
| Backend       | Node.js                      |
| Deep Analysis | Python (OpenCV, NumPy)       |

---

##  Privacy

* 100% local processing
* No biometric data leaves device
* No cloud inference

---

##  System Loop

1. **Scan (Know)** → physiological baseline
2. **Prime + Sync (Act)** → optimized stimulation
3. **Measure + Learn (Learn)** → adaptive improvement

---

##  Summary

HYDRA-V converts Hydrawav3 into a **real-time adaptive neural system**.

It combines:

* Physics (light, heat, vibration)
* Biology (HRV, fascia, CNS)
* AI (Bayesian optimization)


