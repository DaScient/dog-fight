import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    worldSize: 600,
    speed: 1.0, // Global Time Scale
    agentSpeed: 1.5,
    turnSpeed: 0.08,
    detectionRange: 150,
    teams: {
        CYAN: { color: 0x00f3ff, shape: 'tetra' },
        MAGENTA: { color: 0xff00ff, shape: 'box' },
        LIME: { color: 0xccff00, shape: 'octa' }
    }
};

// --- UTILITIES ---
const randomRange = (min, max) => Math.random() * (max - min) + min;

// --- CLASS: AGENT ---
class Agent {
    constructor(scene, teamKey) {
        this.scene = scene;
        this.team = teamKey;
        this.alive = true;
        this.hp = 100;
        this.target = null;
        
        // Physics
        this.position = new THREE.Vector3(
            randomRange(-100, 100),
            randomRange(-50, 50),
            randomRange(-100, 100)
        );
        this.velocity = new THREE.Vector3(randomRange(-1, 1), randomRange(-1, 1), randomRange(-1, 1)).normalize().multiplyScalar(CONFIG.agentSpeed);
        this.quaternion = new THREE.Quaternion();
        
        // Visuals
        const teamConfig = CONFIG.teams[teamKey];
        let geometry;
        if(teamConfig.shape === 'tetra') geometry = new THREE.TetrahedronGeometry(2);
        else if(teamConfig.shape === 'box') geometry = new THREE.BoxGeometry(3, 1, 4);
        else geometry = new THREE.OctahedronGeometry(2);

        // Emissive material for Bloom effect
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            emissive: teamConfig.color,
            emissiveIntensity: 2.0,
            roughness: 0.4,
            metalness: 0.8
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        scene.add(this.mesh);

        // Engine Trail
        this.trailGeo = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(50 * 3); // 50 segments
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        this.trailMat = new THREE.LineBasicMaterial({ color: teamConfig.color, transparent: true, opacity: 0.5 });
        this.trail = new THREE.Line(this.trailGeo, this.trailMat);
        scene.add(this.trail);
    }

    update(dt, agents) {
        if (!this.alive) return;

        // 1. AI Decision
        if (!this.target || !this.target.alive) {
            this.findTarget(agents);
        }

        // Steer
        const desiredDirection = new THREE.Vector3();
        
        if (this.target && this.target.alive) {
            // Dogfight Logic: Intercept logic
            desiredDirection.subVectors(this.target.mesh.position, this.position).normalize();
            
            // Shoot check (simple distance/angle check)
            const dist = this.position.distanceTo(this.target.mesh.position);
            if(dist < 50) this.fire(dt);

        } else {
            // Patrol: Gentle turn back to center if too far
            if (this.position.length() > CONFIG.worldSize / 2) {
                desiredDirection.subVectors(new THREE.Vector3(0,0,0), this.position).normalize();
            } else {
                // Keep current heading with slight noise
                desiredDirection.copy(this.velocity).normalize();
            }
        }

        // 2. Physics (Aerodynamics simulation)
        // Smoothly rotate velocity towards desired direction
        const currentDir = this.velocity.clone().normalize();
        currentDir.lerp(desiredDirection, CONFIG.turnSpeed * dt * 60);
        this.velocity.copy(currentDir).setLength(CONFIG.agentSpeed);

        // Move
        this.position.add(this.velocity.clone().multiplyScalar(dt * 60));

        // 3. Visual Orientation (Banking)
        // Orient mesh to face velocity
        const targetQuaternion = new THREE.Quaternion();
        const m = new THREE.Matrix4().lookAt(this.position, this.position.clone().add(this.velocity), new THREE.Vector3(0, 1, 0));
        targetQuaternion.setFromRotationMatrix(m);
        this.mesh.quaternion.slerp(targetQuaternion, 0.1);
        this.mesh.position.copy(this.position);

        // Update Trail
        this.updateTrail();
    }

    findTarget(agents) {
        let minDist = Infinity;
        let bestTarget = null;
        for (const other of agents) {
            if (other === this || !other.alive || other.team === this.team) continue;
            const dist = this.position.distanceTo(other.position);
            if (dist < CONFIG.detectionRange && dist < minDist) {
                minDist = dist;
                bestTarget = other;
            }
        }
        this.target = bestTarget;
    }

    fire(dt) {
        // Simple hitscan logic for simulation visual
        if(Math.random() < 0.05) { // Fire rate
           // Create laser beam visual
           const laserGeo = new THREE.BufferGeometry().setFromPoints([this.position, this.target.position]);
           const laserMat = new THREE.LineBasicMaterial({ color: 0xffffff });
           const laser = new THREE.Line(laserGeo, laserMat);
           this.scene.add(laser);
           
           // Remove laser next frame
           setTimeout(() => { 
               this.scene.remove(laser); 
               laserGeo.dispose();
               laserMat.dispose();
            }, 50);

           // Damage
           this.target.takeDamage(10);
        }
    }

    takeDamage(amount) {
        this.hp -= amount;
        if(this.hp <= 0) this.explode();
    }

    explode() {
        this.alive = false;
        this.mesh.visible = false;
        this.trail.visible = false;
        
        // Particle Explosion
        const particleCount = 20;
        const geo = new THREE.BufferGeometry();
        const positions = [];
        for(let i=0; i<particleCount; i++) {
            positions.push(this.position.x, this.position.y, this.position.z);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: 0xffaa00, size: 2 });
        const particles = new THREE.Points(geo, mat);
        this.scene.add(particles);

        // Animate explosion removal
        setTimeout(() => {
            this.scene.remove(particles);
            this.scene.remove(this.mesh);
            this.scene.remove(this.trail);
        }, 1000);
    }

    updateTrail() {
        const positions = this.trail.geometry.attributes.position.array;
        // Shift array
        for (let i = positions.length - 1; i > 2; i--) {
            positions[i] = positions[i - 3];
        }
        // Set new head
        positions[0] = this.position.x;
        positions[1] = this.position.y;
        positions[2] = this.position.z;
        this.trail.geometry.attributes.position.needsUpdate = true;
    }
}

// --- MAIN SIMULATION CLASS ---
class Simulation {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.agents = [];
        this.clock = new THREE.Clock();

        this.initThree();
        this.initEnvironment();
        this.setupInput();
        
        // Initial Deployment
        for(let i=0; i<5; i++) this.addAgent('CYAN');
        for(let i=0; i<5; i++) this.addAgent('MAGENTA');

        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.0015);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 100, 200);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.5;

        // Post Processing (Bloom)
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0;
        bloomPass.strength = 1.2; // Intense bloom
        bloomPass.radius = 0.5;
        this.composer.addPass(bloomPass);

        // Responsive resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initEnvironment() {
        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(100, 200, 100);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        // Grid Floor (for visual reference)
        const gridHelper = new THREE.GridHelper(CONFIG.worldSize, 50, 0x333333, 0x111111);
        this.scene.add(gridHelper);

        // Stars
        const starGeo = new THREE.BufferGeometry();
        const starCount = 2000;
        const starPos = [];
        for(let i=0; i<starCount; i++) {
            starPos.push((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, (Math.random()-0.5)*2000);
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({color: 0xffffff, size: 1.5});
        this.scene.add(new THREE.Points(starGeo, starMat));
    }

    addAgent(team) {
        const agent = new Agent(this.scene, team);
        this.agents.push(agent);
        this.updateHUD();
    }

    reset() {
        // Clean up meshes
        this.agents.forEach(a => {
            this.scene.remove(a.mesh);
            this.scene.remove(a.trail);
        });
        this.agents = [];
        this.updateHUD();
    }

    updateHUD() {
        document.getElementById('agent-count').innerText = this.agents.length;
    }

    setupInput() {
        const slider = document.getElementById('time-scale');
        slider.addEventListener('input', (e) => {
            CONFIG.speed = parseFloat(e.target.value);
        });
        
        // Make functions globally accessible for HTML buttons
        window.sim = this; 
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta() * CONFIG.speed;
        const now = this.clock.getElapsedTime();

        // Update Agents
        // Remove dead agents from array logic would go here in full physics engine
        // For now we just filter visual updates
        this.agents = this.agents.filter(a => a.alive);
        this.agents.forEach(agent => agent.update(delta, this.agents));

        this.controls.update();

        // Render with Bloom
        this.composer.render();

        // HUD Updates
        document.getElementById('fps-counter').innerText = Math.round(1 / delta || 60);
        document.getElementById('sim-time').innerText = now.toFixed(1);
        document.getElementById('agent-count').innerText = this.agents.length;
    }
}

// Start
new Simulation();
