import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    worldSize: 1000,
    maxAgents: 333, // Hard cap
    baseSpeed: 1.0, 
    slowMoSpeed: 0.1,
    teams: {
        CYAN: { 
            name: 'CYAN', color: 0x00f3ff, shape: 'tetra', 
            hp: 60, speed: 2.8, turn: 0.09, dmg: 8, 
            formation: 'V-SHAPE' 
        },
        MAGENTA: { 
            name: 'MAGENTA', color: 0xff00ff, shape: 'box', 
            hp: 150, speed: 1.2, turn: 0.03, dmg: 30,
            formation: 'WALL' 
        },
        LIME: { 
            name: 'LIME', color: 0xccff00, shape: 'octa', 
            hp: 90, speed: 2.2, turn: 0.07, dmg: 12,
            formation: 'ECHELON' 
        }
    }
};

// --- UTILS ---
const randomRange = (min, max) => Math.random() * (max - min) + min;

// --- CLASS: AGENT ---
class Agent {
    constructor(scene, teamKey, position, velocity) {
        this.scene = scene;
        this.team = teamKey;
        this.config = CONFIG.teams[teamKey];
        this.alive = true;
        this.hp = this.config.hp;
        this.target = null;
        
        // Physics
        this.position = position.clone();
        this.velocity = velocity.clone();
        
        // Visuals
        let geometry;
        if(this.config.shape === 'tetra') geometry = new THREE.TetrahedronGeometry(2);
        else if(this.config.shape === 'box') geometry = new THREE.BoxGeometry(3, 1, 4);
        else geometry = new THREE.OctahedronGeometry(2);

        const material = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            emissive: this.config.color,
            emissiveIntensity: 2.0,
            roughness: 0.3,
            metalness: 0.8
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        // Trail
        this.trailGeo = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(30 * 3);
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        this.trailMat = new THREE.LineBasicMaterial({ color: this.config.color, transparent: true, opacity: 0.4 });
        this.trail = new THREE.Line(this.trailGeo, this.trailMat);
        scene.add(this.trail);
    }

    update(dt, agents) {
        if (!this.alive) return;

        // 1. AI: Find Enemy
        if (!this.target || !this.target.alive) {
            this.findTarget(agents);
        }

        // 2. Steering Logic
        const desiredDirection = new THREE.Vector3();
        
        if (this.target && this.target.alive) {
            // Combat Intercept
            const leadPos = this.target.position.clone().add(this.target.velocity.clone().multiplyScalar(10));
            desiredDirection.subVectors(leadPos, this.position).normalize();
            
            // Fire Weapon
            const dist = this.position.distanceTo(this.target.mesh.position);
            const angle = this.velocity.angleTo(desiredDirection);
            if(dist < 150 && angle < 0.4) this.fire(dt);
        } else {
            // Patrol / Return to center
            if (this.position.length() > CONFIG.worldSize / 2) {
                desiredDirection.subVectors(new THREE.Vector3(0,0,0), this.position).normalize();
            } else {
                desiredDirection.copy(this.velocity).normalize();
            }
        }

        // Apply Physics
        const currentDir = this.velocity.clone().normalize();
        currentDir.lerp(desiredDirection, this.config.turn * dt * 60);
        this.velocity.copy(currentDir).setLength(this.config.speed);
        this.position.add(this.velocity.clone().multiplyScalar(dt * 60));

        // Update Visuals
        this.mesh.position.copy(this.position);
        this.mesh.lookAt(this.position.clone().add(this.velocity));
        
        this.updateTrail();
    }

    findTarget(agents) {
        let minDist = Infinity;
        let bestTarget = null;
        for (const other of agents) {
            if (other === this || !other.alive || other.team === this.team) continue;
            const dist = this.position.distanceTo(other.position);
            if (dist < 300 && dist < minDist) {
                minDist = dist;
                bestTarget = other;
            }
        }
        this.target = bestTarget;
    }

    fire(dt) {
        // Fire rate limiter random check
        if(Math.random() < 0.05) { 
           // Laser Visual
           const laserGeo = new THREE.BufferGeometry().setFromPoints([this.position, this.target.position]);
           const laserMat = new THREE.LineBasicMaterial({ color: 0xffffff });
           const laser = new THREE.Line(laserGeo, laserMat);
           this.scene.add(laser);
           setTimeout(() => { 
               this.scene.remove(laser); 
               laserGeo.dispose(); laserMat.dispose();
            }, 60);

           // Damage
           this.target.takeDamage(this.config.dmg, this.team);
        }
    }

    takeDamage(amount, attackerTeam) {
        this.hp -= amount;
        this.mesh.material.emissiveIntensity = 5.0; // Flash bright
        setTimeout(() => { if(this.alive) this.mesh.material.emissiveIntensity = 2.0; }, 50);

        if(this.hp <= 0 && this.alive) {
            window.sim.registerKill(attackerTeam, this.team);
            this.explode();
        }
    }

    explode() {
        this.alive = false;
        this.mesh.visible = false;
        this.trail.visible = false;
        window.sim.shaker.trigger(0.5);

        // Explosion Particles
        const particleCount = 15;
        const geo = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        for(let i=0; i<particleCount; i++) {
            positions.push(this.position.x, this.position.y, this.position.z);
            velocities.push((Math.random()-0.5)*4, (Math.random()-0.5)*4, (Math.random()-0.5)*4);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: this.config.color, size: 4, transparent: true });
        const particles = new THREE.Points(geo, mat);
        this.scene.add(particles);

        // Animate out
        let frames = 0;
        const anim = () => {
            if(frames > 30) {
                this.scene.remove(particles);
                this.scene.remove(this.mesh);
                this.scene.remove(this.trail);
                return;
            }
            const pos = particles.geometry.attributes.position.array;
            for(let i=0; i<particleCount*3; i++) pos[i] += velocities[Math.floor(i/3) * 3 + (i%3)];
            particles.geometry.attributes.position.needsUpdate = true;
            mat.opacity -= 0.03;
            frames++;
            requestAnimationFrame(anim);
        };
        anim();
    }

    updateTrail() {
        const p = this.trail.geometry.attributes.position.array;
        for (let i = p.length - 1; i > 2; i--) p[i] = p[i - 3];
        p[0] = this.position.x; p[1] = this.position.y; p[2] = this.position.z;
        this.trail.geometry.attributes.position.needsUpdate = true;
    }
}

// --- MAIN SIMULATION ---
class Simulation {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.agents = [];
        this.kills = { CYAN: 0, MAGENTA: 0, LIME: 0 };
        this.clock = new THREE.Clock();
        this.timeScale = CONFIG.baseSpeed;
        this.targetTimeScale = CONFIG.baseSpeed;
        this.matrixMode = false;

        this.initThree();
        this.shaker = { trigger: (val) => { 
            this.camera.position.add(new THREE.Vector3((Math.random()-0.5)*val, (Math.random()-0.5)*val, (Math.random()-0.5)*val)); 
        }}; // Simple shaker
        
        window.sim = this;
        
        // Initial Spawns
        this.spawnFormation('CYAN');
        this.spawnFormation('MAGENTA');

        // Auto-Spawn Loop (Periodic Reinforcements)
        setInterval(() => {
            if(this.agents.length < CONFIG.maxAgents) {
                const teams = ['CYAN', 'MAGENTA', 'LIME'];
                const r = teams[Math.floor(Math.random()*teams.length)];
                this.spawnFormation(r);
                this.log(`REINFORCEMENTS: ${r} WING ENTERING SECTOR`);
            }
        }, 5000);

        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.002);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 150, 300);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.5;

        // Bloom
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloom.strength = 1.3; bloom.radius = 0.5; bloom.threshold = 0.1;
        this.composer.addPass(bloom);

        // Environment
        this.scene.add(new THREE.AmbientLight(0x404040));
        const dl = new THREE.DirectionalLight(0xffffff, 2);
        dl.position.set(100,200,100);
        this.scene.add(dl);
        
        // Stars
        const sg = new THREE.BufferGeometry();
        const sp = [];
        for(let i=0; i<1000; i++) sp.push((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, (Math.random()-0.5)*2000);
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({color:0x888888, size:2})));

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
