import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION & ARSENAL ---
const CONFIG = {
    worldSize: 1000,
    baseSpeed: 1.0, 
    slowMoSpeed: 0.1,
    maxAgents: 60, // Cap for smooth performance with high-fidelity agents
    detectionRange: 300,
    // THE CLASS SYSTEM: distinct stats for each team
    teams: {
        CYAN: { 
            name: 'INTERCEPTOR', color: 0x00f3ff, shape: 'tetra',
            hp: 40, speed: 2.8, turn: 0.1, damage: 8, fireRate: 0.08, scale: 1.5 
        },
        MAGENTA: { 
            name: 'DREADNOUGHT', color: 0xff00ff, shape: 'box',
            hp: 200, speed: 0.8, turn: 0.02, damage: 40, fireRate: 0.02, scale: 5.0 
        },
        LIME: { 
            name: 'VIPER', color: 0xccff00, shape: 'octa',
            hp: 80, speed: 2.0, turn: 0.06, damage: 15, fireRate: 0.05, scale: 2.2 
        }
    }
};

// --- UTILITIES ---
const randomRange = (min, max) => Math.random() * (max - min) + min;

// --- CAMERA SHAKE SYSTEM ---
class CameraShake {
    constructor(camera) {
        this.camera = camera;
        this.shakeIntensity = 0;
        this.decay = 0.95;
    }
    trigger(intensity) {
        this.shakeIntensity = Math.min(this.shakeIntensity + intensity, 2.5);
    }
    update() {
        if (this.shakeIntensity > 0.01) {
            const rx = (Math.random() - 0.5) * this.shakeIntensity;
            const ry = (Math.random() - 0.5) * this.shakeIntensity;
            const rz = (Math.random() - 0.5) * this.shakeIntensity;
            this.camera.position.add(new THREE.Vector3(rx, ry, rz));
            this.shakeIntensity *= this.decay;
        }
    }
}

// --- CLASS: AGENT ---
class Agent {
    constructor(scene, teamKey, simReference, startPos) {
        this.scene = scene;
        this.team = teamKey;
        this.sim = simReference;
        this.stats = CONFIG.teams[teamKey]; // Load Class Stats
        this.alive = true;
        this.hp = this.stats.hp;
        this.target = null;
        
        // Physics (Spawn Logic)
        if(startPos) {
            this.position = startPos.clone();
            // Fly towards center initially
            this.velocity = new THREE.Vector3(0,0,0).sub(startPos).normalize().multiplyScalar(this.stats.speed);
        } else {
            this.position = new THREE.Vector3(randomRange(-200, 200), randomRange(-50, 50), randomRange(-200, 200));
            this.velocity = new THREE.Vector3(randomRange(-1, 1), randomRange(-1, 1), randomRange(-1, 1)).normalize().multiplyScalar(this.stats.speed);
        }
        
        // Visuals (Shape & Size based on Class)
        let geometry;
        if(this.stats.shape === 'tetra') geometry = new THREE.TetrahedronGeometry(1);
        else if(this.stats.shape === 'box') geometry = new THREE.BoxGeometry(1, 0.5, 2);
        else geometry = new THREE.OctahedronGeometry(1);

        const material = new THREE.MeshStandardMaterial({ 
            color: 0x111111, 
            emissive: this.stats.color,
            emissiveIntensity: 2.5,
            roughness: 0.3,
            metalness: 0.8
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.scale.setScalar(this.stats.scale); // Apply Class Scaling
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        // Engine Trail
        this.trailGeo = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(50 * 3);
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        this.trailMat = new THREE.LineBasicMaterial({ color: this.stats.color, transparent: true, opacity: 0.5 });
        this.trail = new THREE.Line(this.trailGeo, this.trailMat);
        scene.add(this.trail);
    }

    update(dt, agents) {
        if (!this.alive) return;

        // 1. AI Logic
        if (!this.target || !this.target.alive) this.findTarget(agents);

        const desiredDirection = new THREE.Vector3();
        
        if (this.target && this.target.alive) {
            // Lead the target
            const leadPos = this.target.position.clone().add(this.target.velocity.clone().multiplyScalar(15));
            desiredDirection.subVectors(leadPos, this.position).normalize();
            
            // Engagement Check
            const dist = this.position.distanceTo(this.target.mesh.position);
            const angle = this.velocity.angleTo(desiredDirection);
            
            // Firing Solution
            if(dist < 300 && angle < 0.5) this.fire(dt);

        } else {
            // Patrol / Return to Battlespace
            if (this.position.length() > CONFIG.worldSize / 1.5) {
                desiredDirection.subVectors(new THREE.Vector3(0,0,0), this.position).normalize();
            } else {
                desiredDirection.copy(this.velocity).normalize();
            }
        }

        // 2. Physics (Class-Specific Agility)
        const currentDir = this.velocity.clone().normalize();
        // Heavier ships turn slower
        currentDir.lerp(desiredDirection, this.stats.turn * dt * 60);
        this.velocity.copy(currentDir).setLength(this.stats.speed);

        this.position.add(this.velocity.clone().multiplyScalar(dt * 60));

        // 3. Orientation
        const targetQuaternion = new THREE.Quaternion();
        const m = new THREE.Matrix4().lookAt(this.position, this.position.clone().add(this.velocity), new THREE.Vector3(0, 1, 0));
        targetQuaternion.setFromRotationMatrix(m);
        this.mesh.quaternion.slerp(targetQuaternion, 0.1);
        this.mesh.position.copy(this.position);

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
        // Class-Specific Fire Rate
        if(Math.random() < this.stats.fireRate) { 
           // Laser Visual
           const laserGeo = new THREE.BufferGeometry().setFromPoints([this.position, this.target.position]);
           const laserMat = new THREE.LineBasicMaterial({ 
               color: this.stats.color, // Lasers match team color
               linewidth: 1 
            });
           const laser = new THREE.Line(laserGeo, laserMat);
           this.scene.add(laser);
           
           // Cleanup Laser
           setTimeout(() => { 
               this.scene.remove(laser); 
               laserGeo.dispose(); laserMat.dispose();
            }, 50);

           // Physics Recoil (Heavy ships recoil less)
           const recoil = 0.5 / this.stats.scale;
           this.position.sub(this.velocity.clone().normalize().multiplyScalar(recoil));
           
           // Apply Damage
           this.target.takeDamage(this.stats.damage, this.team);
        }
    }

    takeDamage(amount, attackerTeam) {
        this.hp -= amount;
        
        // Flash Hit Effect
        this.mesh.material.emissiveIntensity = 8.0;
        setTimeout(() => {
            if(this.alive) this.mesh.material.emissiveIntensity = 2.5;
        }, 50);

        if(this.hp <= 0 && this.alive) {
            this.sim.registerKill(attackerTeam);
            this.explode();
        }
    }

    explode() {
        this.alive = false;
        this.mesh.visible = false;
        this.trail.visible = false;
        
        // Camera Shake based on ship size (Dreadnoughts shake screen hard)
        this.sim.shaker.trigger(0.2 * this.stats.scale);

        // Explosion Particles
        const particleCount = 15 * this.stats.scale; // Bigger explosion for bigger ships
        const geo = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        for(let i=0; i<particleCount; i++) {
            positions.push(this.position.x, this.position.y, this.position.z);
            velocities.push(
                (Math.random()-0.5)*3 * this.stats.scale, 
                (Math.random()-0.5)*3 * this.stats.scale, 
                (Math.random()-0.5)*3 * this.stats.scale
            );
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: this.stats.color, size: 2 * this.stats.scale, transparent: true });
        const particles = new THREE.Points(geo, mat);
        this.scene.add(particles);

        // Shockwave Ring
        const ringGeo = new THREE.RingGeometry(0.1, 1.0 * this.stats.scale, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const shockwave = new THREE.Mesh(ringGeo, ringMat);
        shockwave.position.copy(this.position);
        shockwave.lookAt(this.sim.camera.position); 
        this.scene.add(shockwave);

        // Animation
        const explodeAnim = () => {
            if(!particles.parent) return; 
            shockwave.scale.multiplyScalar(1.1);
            shockwave.material.opacity -= 0.05;

            const posAttr = particles.geometry.attributes.position;
            for(let i=0; i<particleCount; i++) {
                posAttr.setX(i, posAttr.getX(i) + velocities[i*3]);
                posAttr.setY(i, posAttr.getY(i) + velocities[i*3+1]);
                posAttr.setZ(i, posAttr.getZ(i) + velocities[i*3+2]);
            }
            posAttr.needsUpdate = true;
            mat.opacity -= 0.03;

            if(mat.opacity <= 0) {
                this.scene.remove(particles);
                this.scene.remove(shockwave);
                geo.dispose(); mat.dispose();
            } else {
                requestAnimationFrame(explodeAnim);
            }
        };
        explodeAnim();
    }

    updateTrail() {
        const positions = this.trail.geometry.attributes.position.array;
        for (let i = positions.length - 1; i > 2; i--) positions[i] = positions[i - 3];
        positions[0] = this.position.x; positions[1] = this.position.y; positions[2] = this.position.z;
        this.trail.geometry.attributes.position.needsUpdate = true;
    }
}

// --- MAIN SIMULATION CLASS ---
class Simulation {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.agents = [];
        this.scores = { CYAN: 0, MAGENTA: 0, LIME: 0 };
        this.clock = new THREE.Clock();
        this.timeScale = CONFIG.baseSpeed;
        this.targetTimeScale = CONFIG.baseSpeed;
        this.matrixMode = false;

        this.initThree();
        this.shaker = new CameraShake(this.camera);
        this.initEnvironment();
        
        window.sim = this;

        // Initial Deployment
        this.spawnSquad('CYAN');
        this.spawnSquad('MAGENTA');

        // AUTO-SPAWN LOGIC (Reinforcements)
        setInterval(() => {
            if(this.agents.length < CONFIG.maxAgents) {
                const teams = Object.keys(CONFIG.teams);
                const randomTeam = teams[Math.floor(Math.random() * teams.length)];
                this.spawnSquad(randomTeam);
                // console.log(`Reinforcements arriving: ${randomTeam}`);
            }
        }, 4000); // Check every 4 seconds

        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.002);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 120, 350);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.3;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.strength = 1.5; bloomPass.radius = 0.4; bloomPass.threshold = 0.1;
        this.composer.addPass(bloomPass);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initEnvironment() {
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(100, 200, 100);
        this.scene.add(dirLight);

        const gridHelper = new THREE.GridHelper(CONFIG.worldSize, 40, 0x222222, 0x111111);
        this.scene.add(gridHelper);

        const starGeo = new THREE.BufferGeometry();
        const starPos = [];
        for(let i=0; i<3000; i++) starPos.push((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, (Math.random()-0.5)*2000);
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({color: 0x888888, size: 1.5});
        this.scene.add(new THREE.Points(starGeo, starMat));
    }

    // New Formation Spawning Logic (Renamed from addSquad to spawnSquad)
    spawnSquad(team) {
        if(this.agents.length >= CONFIG.maxAgents) return;

        // Pick a random entry point at the edge of the world
        const angle = Math.random() * Math.PI * 2;
        const radius = 500;
        const startX = Math.cos(angle) * radius;
        const startZ = Math.sin(angle) * radius;
        const startY = (Math.random() - 0.5) * 200;
        
        // Spawn 3-5 units in a cluster
        const squadSize = Math.floor(randomRange(3, 6));
        
        for(let i=0; i<squadSize; i++) {
            // Add slight randomness to formation so they don't clip
            const offset = new THREE.Vector3(randomRange(-20,20), randomRange(-10,10), randomRange(-20,20));
            const spawnPos = new THREE.Vector3(startX, startY, startZ).add(offset);
            
            this.agents.push(new Agent(this.scene, team, this, spawnPos));
        }
        this.updateHUD();
    }

    registerKill(teamKey) {
        if(this.scores[teamKey] !== undefined) {
            this.scores[teamKey]++;
            const el = document.getElementById(`score-${teamKey.toLowerCase()}`);
            if(el) {
                el.innerText = this.scores[teamKey];
                el.parentElement.style.transform = "scale(1.2)";
                setTimeout(() => el.parentElement.style.transform = "scale(1.0)", 200);
            }
        }
    }

    toggleMatrixMode() {
        this.matrixMode = !this.matrixMode;
        const btn = document.getElementById('matrix-btn');
        if(this.matrixMode) {
            this.targetTimeScale = CONFIG.slowMoSpeed;
            btn.innerText = "DEACTIVATE MATRIX";
            btn.classList.add('active');
            document.getElementById('sys-status').innerText = "SLOW-MOTION";
        } else {
            this.targetTimeScale = CONFIG.baseSpeed;
            btn.innerText = "ACTIVATE MATRIX MODE";
            btn.classList.remove('active');
            document.getElementById('sys-status').innerText = "REALISTIC";
        }
    }

    reset() {
        this.agents.forEach(a => {
            this.scene.remove(a.mesh);
            this.scene.remove(a.trail);
        });
        this.agents = [];
        this.scores = { CYAN: 0, MAGENTA: 0, LIME: 0 };
        ['cyan', 'magenta', 'lime'].forEach(t => document.getElementById(`score-${t}`).innerText = '0');
        this.updateHUD();
    }

    updateHUD() {
        document.getElementById('agent-count').innerText = this.agents.length;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.timeScale += (this.targetTimeScale - this.timeScale) * 0.1;
        const delta = this.clock.getDelta() * this.timeScale;
        
        this.shaker.update();
        
        // Update & Cleanup
        this.agents = this.agents.filter(a => a.alive);
        this.agents.forEach(agent => agent.update(delta, this.agents));
        
        this.controls.update();
        this.composer.render();
        
        document.getElementById('fps-counter').innerText = Math.round(1 / (delta/this.timeScale) || 60);
        document.getElementById('g-force').innerText = (this.timeScale * 3.5).toFixed(1); 
    }
}

new Simulation();
