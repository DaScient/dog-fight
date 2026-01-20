import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    worldSize: 1500,
    initialCount: 333, // USER REQUESTED COUNT
    maxParticles: 10,
    baseSpeed: 0.777,
    slowMoSpeed: 0.025
};

// --- SHIP CLASSES & STATS ---
const SHIP_TYPES = {
    INTERCEPTOR: { 
        id: 0, color: 0x00f3ff, scale: 1.5, speed: 3.5, turn: 0.08, 
        geo: new THREE.TetrahedronGeometry(1) 
    },
    DREADNOUGHT: { 
        id: 1, color: 0xff00ff, scale: 6.0, speed: 0.8, turn: 0.02, 
        geo: new THREE.BoxGeometry(1, 1, 2) 
    },
    VIPER: { 
        id: 2, color: 0xccff00, scale: 2.5, speed: 2.5, turn: 0.12, 
        geo: new THREE.OctahedronGeometry(1) 
    }
};

// --- EFFICIENT MATH TOOLS ---
const dummy = new THREE.Object3D();
const _position = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _target = new THREE.Vector3();

// --- CLASS: SWARM MANAGER (The Engine) ---
class SwarmManager {
    constructor(scene, count) {
        this.scene = scene;
        this.count = count;
        this.meshMap = {}; 
        
        // --- DATA ORIENTED DESIGN ---
        this.types = new Uint8Array(count); 
        this.positions = new Float32Array(count * 3); 
        this.velocities = new Float32Array(count * 3); 
        this.targets = new Float32Array(count * 3); 
        this.alive = new Uint8Array(count).fill(1);
        
        this.initData();
        this.initMeshes();
    }

    initData() {
        for(let i = 0; i < this.count; i++) {
            const r = Math.random();
            if (r < 0.7) this.types[i] = 0;
            else if (r < 0.9) this.types[i] = 1;
            else this.types[i] = 2;

            // Random Position in sphere
            const phi = Math.acos( -1 + ( 2 * i ) / this.count );
            const theta = Math.sqrt( this.count * Math.PI ) * phi;
            const rad = CONFIG.worldSize * 0.8 * Math.random();
            
            this.positions[i*3] = rad * Math.cos(theta) * Math.sin(phi);
            this.positions[i*3+1] = rad * Math.sin(theta) * Math.sin(phi);
            this.positions[i*3+2] = rad * Math.cos(phi);

            // Random Velocity
            this.velocities[i*3] = (Math.random()-0.5) * 2;
            this.velocities[i*3+1] = (Math.random()-0.5) * 2;
            this.velocities[i*3+2] = (Math.random()-0.5) * 2;

            // Initial Target
            this.targets[i*3] = 0;
            this.targets[i*3+1] = 0;
            this.targets[i*3+2] = 0;
        }
        this.updateCounts();
    }

    initMeshes() {
        Object.values(SHIP_TYPES).forEach(type => {
            const material = new THREE.MeshStandardMaterial({
                color: 0x111111,
                emissive: type.color,
                emissiveIntensity: 2.0,
                roughness: 0.4,
                metalness: 0.8
            });

            const mesh = new THREE.InstancedMesh(type.geo, material, this.count);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.scene.add(mesh);
            this.meshMap[type.id] = mesh;
        });
    }

    update(dt) {
        let counts = { 0: 0, 1: 0, 2: 0 }; 

        for(let i = 0; i < this.count; i++) {
            if(this.alive[i] === 0) continue;

            const typeId = this.types[i];
            const typeConfig = Object.values(SHIP_TYPES)[typeId];

            // 1. READ DATA
            _position.set(this.positions[i*3], this.positions[i*3+1], this.positions[i*3+2]);
            _velocity.set(this.velocities[i*3], this.velocities[i*3+1], this.velocities[i*3+2]);
            _target.set(this.targets[i*3], this.targets[i*3+1], this.targets[i*3+2]);

            // 2. LOGIC
            // Periodically pick new random target
            if (_position.distanceToSquared(_target) < 4000) {
                this.targets[i*3] = (Math.random()-0.5) * CONFIG.worldSize;
                this.targets[i*3+1] = (Math.random()-0.5) * CONFIG.worldSize;
                this.targets[i*3+2] = (Math.random()-0.5) * CONFIG.worldSize;
            }

            // Steer
            const desired = _target.clone().sub(_position).normalize().multiplyScalar(typeConfig.speed);
            const steer = desired.sub(_velocity).multiplyScalar(typeConfig.turn);
            _velocity.add(steer).normalize().multiplyScalar(typeConfig.speed);

            // Move
            _position.add(_velocity.clone().multiplyScalar(dt * 60));

            // WRITE BACK DATA
            this.positions[i*3] = _position.x;
            this.positions[i*3+1] = _position.y;
            this.positions[i*3+2] = _position.z;
            this.velocities[i*3] = _velocity.x;
            this.velocities[i*3+1] = _velocity.y;
            this.velocities[i*3+2] = _velocity.z;

            // 3. RENDER UPDATE
            dummy.position.copy(_position);
            const lookAtPos = _position.clone().add(_velocity);
            dummy.lookAt(lookAtPos);
            dummy.scale.setScalar(typeConfig.scale);
            dummy.updateMatrix();

            this.meshMap[typeId].setMatrixAt(counts[typeId], dummy.matrix);
            counts[typeId]++;
            
            // 4. COMBAT (Lasers & Explosions)
            // Chance to fire laser (Weaponry)
            if(Math.random() < 0.005) {
                const range = 200;
                // Random point ahead of ship
                const targetPoint = _position.clone().add(_velocity.clone().multiplyScalar(20)).add(
                    new THREE.Vector3((Math.random()-0.5)*range, (Math.random()-0.5)*range, (Math.random()-0.5)*range)
                );
                window.sim.fx.triggerLaser(_position, targetPoint, typeConfig.color);
            }

            // Chance to explode (Visuals)
            if(Math.random() < 0.0003 && _position.length() < 500) {
                const boomScale = typeId === 1 ? 4.0 : 1.0; 
                window.sim.fx.triggerExplosion(_position, typeConfig.color, boomScale);
            }
        }

        // Inform Three.js to update GPU
        Object.values(SHIP_TYPES).forEach(type => {
            if(this.meshMap[type.id]) {
                this.meshMap[type.id].count = counts[type.id];
                this.meshMap[type.id].instanceMatrix.needsUpdate = true;
            }
        });
    }

    updateCounts() {
        // Safe DOM updates
        const updateDOM = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.innerText = val;
        };

        let c = 0, m = 0, l = 0;
        for(let i=0; i<this.count; i++) {
            if(this.types[i]===0) c++;
            if(this.types[i]===1) m++;
            if(this.types[i]===2) l++;
        }
        updateDOM('count-cyan', c);
        updateDOM('count-magenta', m);
        updateDOM('count-lime', l);
        updateDOM('total-agents', this.count);
    }
}

// --- FX SYSTEM (Lasers & Explosions) ---
class FXSystem {
    constructor(scene) {
        this.scene = scene;
        this.explosions = [];
        this.lasers = [];
        
        // Explosion Geometry
        this.particleGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(30 * 3);
        this.particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    }

    triggerLaser(start, end, colorHex) {
        const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.8 });
        const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.lasers.push({ mesh: line, age: 0 });
    }

    triggerExplosion(pos, colorHex, scale) {
        // Light
        const light = new THREE.PointLight(colorHex, 5 * scale, 100);
        light.position.copy(pos);
        this.scene.add(light);

        // Particles
        const mat = new THREE.PointsMaterial({ color: colorHex, size: 2 * scale, transparent: true });
        const particles = new THREE.Points(this.particleGeo.clone(), mat);
        
        const posAttr = particles.geometry.attributes.position;
        const velocities = [];
        for(let i=0; i<30; i++) {
            posAttr.setXYZ(i, pos.x, pos.y, pos.z);
            velocities.push(
                (Math.random()-0.5)*5*scale, 
                (Math.random()-0.5)*5*scale, 
                (Math.random()-0.5)*5*scale
            );
        }
        this.scene.add(particles);

        this.explosions.push({ mesh: particles, light: light, vels: velocities, age: 0 });
        window.sim.shaker.trigger(0.5 * scale);
    }

    update() {
        // Update Lasers
        for(let i = this.lasers.length - 1; i >= 0; i--) {
            const l = this.lasers[i];
            l.age++;
            l.mesh.material.opacity -= 0.1;
            if(l.age > 10) {
                this.scene.remove(l.mesh);
                l.mesh.geometry.dispose();
                l.mesh.material.dispose();
                this.lasers.splice(i, 1);
            }
        }

        // Update Explosions
        for(let i = this.explosions.length - 1; i >= 0; i--) {
            const ex = this.explosions[i];
            ex.age += 1;
            
            const posAttr = ex.mesh.geometry.attributes.position;
            for(let j=0; j<30; j++) {
                posAttr.setX(j, posAttr.getX(j) + ex.vels[j*3]);
                posAttr.setY(j, posAttr.getY(j) + ex.vels[j*3+1]);
                posAttr.setZ(j, posAttr.getZ(j) + ex.vels[j*3+2]);
            }
            posAttr.needsUpdate = true;
            ex.mesh.material.opacity -= 0.03;
            ex.light.intensity *= 0.9;

            if(ex.mesh.material.opacity <= 0) {
                this.scene.remove(ex.mesh);
                this.scene.remove(ex.light);
                ex.mesh.geometry.dispose();
                this.explosions.splice(i, 1);
            }
        }
    }
}

// --- CAMERA SHAKE ---
class CameraShake {
    constructor(camera) {
        this.camera = camera;
        this.shakeIntensity = 0;
    }
    trigger(val) { this.shakeIntensity = Math.min(this.shakeIntensity + val, 3.0); }
    update() {
        if(this.shakeIntensity > 0.01) {
            const r = this.shakeIntensity;
            this.camera.position.add(new THREE.Vector3((Math.random()-0.5)*r, (Math.random()-0.5)*r, (Math.random()-0.5)*r));
            this.shakeIntensity *= 0.9;
        }
    }
}

// --- MAIN SIMULATION ---
class Simulation {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.clock = new THREE.Clock();
        this.timeScale = CONFIG.baseSpeed;
        this.targetTimeScale = CONFIG.baseSpeed;
        this.matrixMode = false;

        this.initThree();
        this.shaker = new CameraShake(this.camera);
        this.fx = new FXSystem(this.scene);
        
        // THE SWARM
        this.swarm = new SwarmManager(this.scene, CONFIG.initialCount);

        window.sim = this;
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.001);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
        this.camera.position.set(0, 400, 800);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.2;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloom.strength = 1.0;
        bloom.radius = 0.5;
        bloom.threshold = 0.1;
        this.composer.addPass(bloom);

        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(1, 1, 1);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0x404040));

        const stars = new THREE.BufferGeometry();
        const sPos = [];
        for(let i=0; i<5000; i++) sPos.push((Math.random()-0.5)*3000, (Math.random()-0.5)*3000, (Math.random()-0.5)*3000);
        stars.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
        this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({size: 1.5, color: 0x888888})));

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    toggleMatrixMode() {
        this.matrixMode = !this.matrixMode;
        const btn = document.getElementById('matrix-btn');
        if(btn) { // Check if button exists
            if(this.matrixMode) {
                this.targetTimeScale = CONFIG.slowMoSpeed;
                btn.innerText = "DEACTIVATE";
                btn.style.background = "#fff";
                btn.style.color = "#000";
            } else {
                this.targetTimeScale = CONFIG.baseSpeed;
                btn.innerText = "MATRIX MODE";
                btn.style.background = "";
                btn.style.color = "";
            }
        }
    }

    deploySwarm() {
        alert("Swarm protocols active. Refresh to reset allocation.");
    }

    reset() {
        location.reload();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.timeScale += (this.targetTimeScale - this.timeScale) * 0.1;
        const dt = this.clock.getDelta() * this.timeScale;

        this.swarm.update(dt);
        this.fx.update();
        this.shaker.update();
        this.controls.update();
        this.composer.render();

        const fpsEl = document.getElementById('fps-counter');
        if(fpsEl) fpsEl.innerText = Math.round(1/(dt/this.timeScale)) || 60;
        
        const speedEl = document.getElementById('sim-speed');
        if(speedEl) speedEl.innerText = Math.round(this.timeScale * 100) + "%";
    }
}

new Simulation();
