# DaScient’s Dog Fight Simulator

**Status:** System Online  
**Deployment:** [dog-fight.dascient.xyz](https://dog-fight.dascient.xyz)

### Overview
A physically-realistic autonomous aerial combat simulation. This project utilizes WebGL (Three.js) to render a high-performance 3D airspace where autonomous agents, governed by state-machine AI, compete in dogfights.

### Features
* **Surreal Graphics:** UnrealBloomPass post-processing, volumetric fog emulation, and emissive geometry.
* **Autonomous Agents:** Agents possess simulated physics (thrust, lift, banking) and decision logic (Target Acquisition, Intercept, Evade).
* **Interactive HUD:** Glassmorphism UI for real-time telemetry and wing deployment.
* **Scalability:** Optimized loop handling 50+ agents simultaneously.

### Installation
1.  Clone the repository.
2.  No build step required (uses ES Modules via CDN).
3.  Serve `index.html` via a local server (e.g., Live Server in VS Code or Python `http.server`).
    * *Note: Directly opening the file in Chrome may block ES modules due to CORS policy.*

### Controls
* **Left Mouse:** Rotate Camera
* **Right Mouse:** Pan Camera
* **Scroll:** Zoom
* **HUD:** Use the on-screen buttons to spawn wings or adjust time dilation.

---
*Designed by DaScient. Powered by Intelligence.*
