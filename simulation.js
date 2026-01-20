import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    worldSize: 1200,
    seaLevel: 0,
    baseSpeed: 1.0, 
    slowMoSpeed: 0.1,
    maxAgents: 80,
    teams: {
        CYAN:   { type: 'AIR',   color: 0x00f3ff, hp: 50, speed: 3.0, range: 400 },
        MAGENTA:{ type: 'SEA',   color: 0xff00ff, hp: 150, speed: 1.2, range: 250 },
        LIME:   { type: 'LAND',  color: 0xccff00, hp: 200, speed: 0.0, range: 500 } // Stationary Turrets
    }
};

const randomRange = (min, max) => Math.random() * (max - min) + min;

// --- ENVIRONMENT BUILDER ---
class Environment {
    constructor(scene) {
        this.scene = scene;
        this.obstacles = []; // Collision objects

        // 1. THE OCEAN SURFACE (Transparent Plane)
        const seaGeo = new THREE.PlaneGeometry(CONFIG.worldSize * 2, CONFIG.worldSize * 2);
        const seaMat = new THREE.MeshBasicMaterial({ 
            color: 0x001133, transparent: true, opacity: 0.3, side: THREE.DoubleSide 
        });
        const sea = new THREE.Mesh(seaGeo, seaMat);
        sea.rotation.x = -Math.PI / 2;
        scene.add(sea);

        // 2. THE SEABED (Grid)
        const grid = new THREE.GridHelper(CONFIG.worldSize, 50, 0x0044ff, 0x001122);
        grid.position.y = -300;
        scene.add(grid);

        // 3. HARD-CODED STRUCTURES (Islands & Sea Labs)
        this.generateStructures();
    }

    generateStructures() {
        // Shared Material for obstacles
        const obsMat = new THREE.MeshStandardMaterial({ 
            color: 0x111111, roughness: 0.1, metalness: 0.9, 
            emissive: 0x222222, emissiveIntensity: 0.5 
        });

        // A. SURFACE ISLANDS (Blocks)
        for(let i=0; i<8; i++) {
            const w = randomRange(40, 100);
            const h = randomRange(50, 150);
            const d = randomRange(40, 100);
            const geo = new THREE.BoxGeometry(w, h, d);
            const mesh = new THREE.Mesh(geo, obsMat);
            
            mesh.position.set(randomRange(-500, 500), h/2 - 20, randomRange(-500, 500));
            this.scene.add(mesh);
            this.obstacles.push({ mesh: mesh, type: 'LAND_OBSTACLE' });
        }

        // B. DEEP SEA LABS (Spheres)
        for(let i=0; i<6; i++) {
            const geo = new THREE.IcosahedronGeometry(randomRange(30, 60), 1);
            const mesh = new THREE.Mesh(geo, obsMat);
            mesh.position.set(randomRange(-500, 500), randomRange(-250, -50), randomRange(-500, 500));
            this.scene.add(mesh);
            this.obstacles.push({ mesh: mesh, type: 'SEA_OBSTACLE' });
        }
    }
}

// --- PROJECTILE SYSTEM (Bombs, Missiles, Torpedoes) ---
class Projectile {
    constructor(scene, start, target, type, color) {
        this.scene = scene;
        this.pos = start.clone();
        this.target = target;
        this.type = type; // 'LASER', 'BOMB', 'TORPEDO'
        this.active = true;
        this.color = color;

        // Physics Setup
        if(type === 'BOMB') this.vel = new THREE.Vector3(0, -2, 0); // Gravity
        else if(type === 'TORPEDO') this.vel = target.position.clone().sub(start).normalize().multiplyScalar(1.5);
        else this.vel = target.position.clone().sub(start).normalize().multiplyScalar(8); // Laser is fast

        // Visuals
        const geo = type === 'LASER' ? new THREE.BoxGeometry(1,1,6) : new THREE.SphereGeometry(1.5);
        const mat = new THREE.MeshBasicMaterial({ color: color });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.position.copy(this.pos);
        scene.add(this.mesh);
    }

    update(dt) {
        if(!this.active) return;

        // Logic per type
        if(this.type === 'BOMB') {
            this.vel.y -= 0.1 * dt * 60; // Gravity accel
        } else if (this.type === 'TORPEDO') {
            // Homing logic (slow turn)
            if(this.target && this.target.alive) {
                const ideal = this.target.position.clone().sub(this.pos).normalize().multiplyScalar(1.5);
                this.vel.lerp(ideal, 0.05);
            }
        }

        this.pos.add(this.vel.clone().multiplyScalar(dt * 60));
        this.mesh.position.copy(this.pos);
        this.mesh.lookAt(this.pos.clone().add(this.vel));

        // SPLASH CHECK (Water surface interaction)
        if(this.pos.y < 5 && this.pos.y > -5 && this.type === 'BOMB') {
            window.sim.fx.createSplash(this.pos);
        }

        // COLLISION CHECK
        if(this.target && this.target.alive && this.pos.distanceTo(this.target.position) < 15) {
            this.target.takeDamage(25, this.type); // Hit!
            this.kill();
        }

        // Timeout distance
        if(this.pos.length() > CONFIG.worldSize) this.kill();
    }

    kill() {
        this.active = false;
        this.scene.remove(this.mesh);
    }
}

// --- AGENT CLASS (Polymorphic-ish) ---
class Agent {
    constructor(scene, teamKey, sim) {
        this.scene = scene;
        this.team = teamKey;
        this.sim = sim;
        this.stats = CONFIG.teams[teamKey];
        this.hp = this.stats.hp;
        this.alive = true;
        
        // --- DOMAIN LOGIC ---
        if(this.stats.type === 'AIR') {
            this.position = new THREE.Vector3(randomRange(-400,400), randomRange(100, 300), randomRange(-400,400));
            this.velocity = new THREE.Vector3(1,0,0);
            this.geometry = new THREE.TetrahedronGeometry(2);
        } 
        else if (this.stats.type === 'SEA') {
            this.position = new THREE.Vector3(randomRange(-400,400), randomRange(-200, -20), randomRange(-400,400));
            this.velocity = new THREE.Vector3(0.5,0,0);
            this.geometry = new THREE.BoxGeometry(3, 1, 6); // Submarine shape
        }
        else { // LAND (Stationary Turret)
            // Spawn on top of a random land obstacle
            const obs = sim.env.obstacles.filter(o => o.type === 'LAND_OBSTACLE');
            if(obs.length > 0) {
                const land = obs[Math.floor(Math.random()*obs.length)].mesh;
                this.position = land.position.clone();
                this.position.y += land.geometry.parameters.height/2 + 2; // Sit on top
            } else {
                this.position = new THREE.Vector3(0, 10, 0);
            }
            this.velocity = new THREE.Vector3(0,0,0); // Stationary
            this.geometry = new THREE.CylinderGeometry(2, 3, 4, 8);
        }

        const mat = new THREE.MeshStandardMaterial({ 
            color: 0x111111, emissive: this.stats.color, emissiveIntensity: 3, roughness: 0.2
        });
        
        this.mesh = new THREE.Mesh(this.geometry, mat);
        this.mesh.position.copy(this.position);
        scene.add(this.mesh);
    }

    update(dt, agents) {
        if(!this.alive) return;

        // TARGETING
        if(!this.target || !this.target.alive) {
            this.target = agents.find(a => a.alive && a.team !== this.team && this.position.distanceTo(a.position) < this.stats.range);
        }

        // MOVEMENT LOGIC
        if(this.stats.type !== 'LAND') {
            const desired = new THREE.Vector3();

            if(this.target) {
                // Intercept Logic
                desired.subVectors(this.target.position, this.position).normalize();
                
                // Attack logic
                if(Math.random() < 0.02) this.attack();

            } else {
                // Patrol Logic (Stay in domain)
                if(this.position.length() > 500) desired.subVectors(new THREE.Vector3(0, (this.stats.type==='AIR'?150:-100), 0), this.position).normalize();
                else desired.copy(this.velocity).normalize();
            }

            // Domain Constraints (Don't let subs fly, don't let jets swim)
            if(this.stats.type === 'AIR' && this.position.y < 20) desired.y += 1; // Pull up
            if(this.stats.type === 'SEA' && this.position.y > -10) desired.y -= 1; // Dive

            // Apply steering
            const steer = this.velocity.clone().normalize().lerp(desired, 0.05).setLength(this.stats.speed);
            this.velocity.copy(steer);
            this.position.add(this.velocity.clone().multiplyScalar(dt * 60));
            
            // Visual Rotation
            this.mesh.lookAt(this.position.clone().add(this.velocity));
        } else {
            // TURRET LOGIC (Rotate to face target only)
            if(this.target) {
                this.mesh.lookAt(this.target.position);
                if(Math.random() < 0.04) this.attack();
            }
        }

        this.mesh.position.copy(this.position);
    }

    attack() {
        // Determine weapon type based on domain
        let weaponType = 'LASER';
        if(this.stats.type === 'AIR' && this.target.position.y < 10) weaponType = 'BOMB'; // Bomb ground/sea
        if(this.stats.type === 'SEA') weaponType = 'TORPEDO'; // Subs use torpedoes

        this.sim.spawnProjectile(this.position, this.target, weaponType, this.stats.color);
    }

    takeDamage(amt, type) {
        this.hp -= amt;
        this.mesh.scale.multiplyScalar(0.95); // Visual feedback
        if(this.hp <= 0 && this.alive) {
            this.sim.registerKill(this.team);
            this.explode();
        }
    }

    explode() {
        this.alive = false;
        this.mesh.visible = false;
        // Big Explosion for bigger units
        const scale = this.stats.type === 'LAND' ? 3.0 : 1.5;
        this.sim.fx.createExplosion(this.position, this.stats.color, scale);
    }
}

// --- FX SYSTEM ---
class FXSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
    }

    createExplosion(pos, color, scale) {
        // 1. Light Flash
        const light = new THREE.PointLight(color, 10 * scale, 200);
        light.position.copy(pos);
        this.scene.add(light);
        
        // 2. Debris Particles
        const geo = new THREE.BufferGeometry();
        const pCount = 20 * scale;
        const positions = [];
        const vels = [];
        
        for(let i=0; i<pCount; i++) {
            positions.push(pos.x, pos.y, pos.z);
            vels.push((Math.random()-0.5)*5, (Math.random()-0.5)*5, (Math.random()-0.5)*5);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: color, size: 3*scale, transparent: true });
        const mesh = new THREE.Points(geo, mat);
        this.scene.add(mesh);
        
        // 3. Shockwave Sphere
        const shockGeo = new THREE.SphereGeometry(1, 16, 16);
        const shockMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true });
        const shock = new THREE.Mesh(shockGeo, shockMat);
        shock.position.copy(pos);
        this.scene.add(shock);

        this.particles.push({ mesh, light, shock, vels, age: 0 });
        window.sim.shaker.trigger(0.5 * scale);
    }

    createSplash(pos) {
        // Simple ring on water surface
        const geo = new THREE.RingGeometry(1, 2, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(pos.x, 0.5, pos.z);
        mesh.rotation.x = -Math.PI/2;
        this.scene.add(mesh);
        
        // Hacky: Reuse particle logic structure but mark as splash
        this.particles.push({ mesh, isSplash: true, age: 0 });
    }

    update() {
        for(let i=this.particles.length-1; i>=0; i--) {
            const p = this.particles[i];
            p.age++;

            if(p.isSplash) {
                p.mesh.scale.multiplyScalar(1.1);
                p.mesh.material.opacity -= 0.05;
                if(p.mesh.material.opacity <= 0) {
                    this.scene.remove(p.mesh);
                    this.particles.splice(i, 1);
                }
                continue;
            }

            // Explosion Update
            p.shock.scale.multiplyScalar(1.15);
            p.shock.material.opacity -= 0.05;
            p.light.intensity *= 0.8;
            
            const pos = p.mesh.geometry.attributes.position.array;
            for(let j=0; j<pos.length/3; j++) {
                pos[j*3] += p.vels[j*3];
                pos[j*3+1] += p.vels[j*3+1];
                pos[j*3+2] += p.vels[j*3+2];
            }
            p.mesh.geometry.attributes.position.needsUpdate = true;
            p.mesh.material.opacity -= 0.02;

            if(p.mesh.material.opacity <= 0) {
                this.scene.remove(p.mesh); this.scene.remove(p.light); this.scene.remove(p.shock);
                this.particles.splice(i, 1);
            }
        }
    }
}

// --- MAIN SIMULATION ---
class Simulation {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.clock = new THREE.Clock();
        this.agents = [];
        this.projectiles = [];
        this.scores = { CYAN: 0, MAGENTA: 0, LIME: 0 };
        this.timeScale = CONFIG.baseSpeed;
        this.targetTimeScale = CONFIG.baseSpeed;

        this.initThree();
        this.env = new Environment(this.scene);
        this.fx = new FXSystem(this.scene);
        
        // Camera Shaker
        this.shaker = { 
            intensity: 0, 
            trigger: function(v) { this.intensity += v; },
            update: function(cam) {
                if(this.intensity > 0) {
                    cam.position.add(new THREE.Vector3((Math.random()-0.5)*this.intensity, (Math.random()-0.5)*this.intensity, (Math.random()-0.5)*this.intensity));
                    this.intensity *= 0.9;
                }
            }
        };

        window.sim = this;
        this.spawnAirWing();
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000511, 0.0015); // Dark Blue Fog

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 1, 3000);
        this.camera.position.set(0, 150, 600);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.2;

        // Post Processing
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85));

        // Lighting
        this.scene.add(new THREE.AmbientLight(0x404040));
        const dl = new THREE.DirectionalLight(0xffffff, 2);
        dl.position.set(200, 500, 200);
        this.scene.add(dl);
        
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    spawnAirWing() { this.spawnBatch('CYAN', 5); }
    spawnNavalFleet() { this.spawnBatch('MAGENTA', 3); }
    spawnGroundDefense() { this.spawnBatch('LIME', 4); }

    spawnBatch(team, count) {
        if(this.agents.length >= CONFIG.maxAgents) return;
        for(let i=0; i<count; i++) {
            this.agents.push(new Agent(this.scene, team, this));
        }
        this.updateHUD();
    }

    spawnProjectile(start, target, type, color) {
        this.projectiles.push(new Projectile(this.scene, start, target, type, color));
    }

    registerKill(team) {
        this.scores[team]++;
        document.getElementById(`score-${team.toLowerCase()}`).innerText = this.scores[team];
    }

    updateHUD() {
        document.getElementById('agent-count').innerText = this.agents.length;
    }

    toggleMatrixMode() {
        this.matrixMode = !this.matrixMode;
        this.targetTimeScale = this.matrixMode ? CONFIG.slowMoSpeed : CONFIG.baseSpeed;
        const btn = document.getElementById('matrix-btn');
        btn.innerText = this.matrixMode ? "DEACTIVATE" : "MATRIX MODE";
        btn.classList.toggle('active');
    }

    reset() {
        location.reload();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.timeScale += (this.targetTimeScale - this.timeScale) * 0.1;
        const dt = this.clock.getDelta() * this.timeScale;

        this.shaker.update(this.camera);
        
        // Update Entities
        this.agents = this.agents.filter(a => a.alive);
        this.agents.forEach(a => a.update(dt, this.agents));
        
        this.projectiles = this.projectiles.filter(p => p.active);
        this.projectiles.forEach(p => p.update(dt));

        this.fx.update();
        this.controls.update();
        this.composer.render();

        document.getElementById('fps-counter').innerText = Math.round(1/(dt/this.timeScale)) || 60;
        document.getElementById('depth-meter').innerText = Math.abs(Math.min(0, Math.round(this.camera.position.y)));
    }
}

new Simulation();
