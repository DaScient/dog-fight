import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    worldSize: 1200,
    count: 3333,
    baseSpeed: 1.0,
    slowMoSpeed: 0.1
};

// --- CLASS DEFINITIONS ---
const CLASSES = {
    INTERCEPTOR: {
        id: 0,
        name: 'INTERCEPTOR',
        color: 0x00f3ff,
        shape: 'tetra',
        scale: 1.2,
        speed: 2.5,
        turnRate: 0.08,
        fireRate: 0.02,
        damage: 10
    },
    DREADNOUGHT: {
        id: 1,
        name: 'DREADNOUGHT',
        color: 0xff00ff,
        shape: 'box',
        scale: 4.0,
        speed: 0.6,
        turnRate: 0.02,
        fireRate: 0.08, // Slow but heavy
        damage: 50
    },
    VIPER: {
        id: 2,
        name: 'VIPER',
        color: 0xccff00,
        shape: 'octa',
        scale: 2.0,
        speed: 1.8,
        turnRate: 0.12,
        fireRate: 0.04,
        damage: 20
    }
};

const dummy = new THREE.Object3D();
const _position = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _target = new THREE.Vector3();

// --- FX SYSTEM (Explosions & Lasers) ---
class FXSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.lasers = [];
        
        // Reusable Geometries
        this.laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
        this.particleGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(3);
        this.particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    }

    createLaser(start, end, color) {
        // Visual Line
        const mat = new THREE.LineBasicMaterial({ color: color });
        const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.lasers.push({ mesh: line, age: 0, maxAge: 5 });
    }

    createExplosion(pos, color, scale) {
        // Flash
        const light = new THREE.PointLight(color, 2 * scale, 50);
        light.position.copy(pos);
        this.scene.add(light);

        // Particles
        const count = 8;
        const geo = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        
        for(let i=0; i<count; i++) {
            positions.push(pos.x, pos.y, pos.z);
            velocities.push(
                (Math.random()-0.5) * 5 * scale,
                (Math.random()-0.5) * 5 * scale,
                (Math.random()-0.5) * 5 * scale
            );
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: color, size: 3 * scale, transparent: true });
        const points = new THREE.Points(geo, mat);
        this.scene.add(points);

        this.particles.push({ 
            mesh: points, 
            light: light, 
            velocities: velocities, 
            age: 0, 
            decay: 0.05 
        });

        window.sim.shaker.trigger(0.2 * scale);
    }

    update() {
        // Update Lasers
        for(let i=this.lasers.length-1; i>=0; i--) {
            const l = this.lasers[i];
            l.age++;
            if(l.age > l.maxAge) {
                this.scene.remove(l.mesh);
                l.mesh.geometry.dispose();
                l.mesh.material.dispose();
                this.lasers.splice(i, 1);
            }
        }

        // Update Particles
        for(let i=this.particles.length-1; i>=0; i--) {
            const p = this.particles[i];
            p.age++;
            
            const positions = p.mesh.geometry.attributes.position.array;
            for(let j=0; j<positions.length/3; j++) {
                positions[j*3] += p.velocities[j*3];
                positions[j*3+1] += p.velocities[j*3+1];
                positions[j*3+2] += p.velocities[j*3+2];
            }
            p.mesh.geometry.attributes.position.needsUpdate = true;
            
            p.mesh.material.opacity -= p.decay;
            p.light.intensity *= 0.8;

            if(p.mesh.material.opacity <= 0) {
                this.scene.remove(p.mesh);
                this.scene.remove(p.light);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.particles.splice(i, 1);
            }
        }
    }
}

// --- LOGIC MANAGER ---
class WingManager {
    constructor(scene, count) {
        this.scene = scene;
        this.count = count;
        this.agents = [];
        this.meshes = {};
        
        // Initialize Instanced Meshes
        const matBase = { roughness: 0.4, metalness: 0.8 };
        
        // Interceptor Mesh
        const geoInt = new THREE.TetrahedronGeometry(1);
        const matInt = new THREE.MeshStandardMaterial({ ...matBase, color: 0x111111, emissive: CLASSES.INTERCEPTOR.color, emissiveIntensity: 2 });
        this.meshes[0] = new THREE.InstancedMesh(geoInt, matInt, count); // Allocate max potential
        this.scene.add(this.meshes[0]);

        // Dreadnought Mesh
        const geoDread = new THREE.BoxGeometry(1, 1, 2.5);
        const matDread = new THREE.MeshStandardMaterial({ ...matBase, color: 0x111111, emissive: CLASSES.DREADNOUGHT.color, emissiveIntensity: 3 });
        this.meshes[1] = new THREE.InstancedMesh(geoDread, matDread, count);
        this.scene.add(this.meshes[1]);

        // Viper Mesh
        const geoViper = new THREE.OctahedronGeometry(1);
        const matViper = new THREE.MeshStandardMaterial({ ...matBase, color: 0x111111, emissive: CLASSES.VIPER.color, emissiveIntensity: 2 });
        this.meshes[2] = new THREE.InstancedMesh(geoViper, matViper, count);
        this.scene.add(this.meshes[2]);

        this.initAgents();
    }

    initAgents() {
        for(let i=0; i<this.count; i++) {
            const r = Math.random();
            let type;
            if(r < 0.6) type = CLASSES.INTERCEPTOR;
            else if (r < 0.85) type = CLASSES.DREADNOUGHT;
            else type = CLASSES.VIPER;

            this.agents.push({
                index: i,
                type: type,
                alive: true,
                pos: new THREE.Vector3((Math.random()-0.5)*CONFIG.worldSize, (Math.random()-0.5)*CONFIG.worldSize/2, (Math.random()-0.5)*CONFIG.worldSize),
                vel: new THREE.Vector3((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)).normalize().multiplyScalar(type.speed),
                targetPos: new THREE.Vector3()
            });
        }
        this.updateCounts();
    }

    update(dt) {
        // Reset counters for instanced mesh rendering
        const counts = { 0: 0, 1: 0, 2: 0 };

        for(let agent of this.agents) {
            if(!agent.alive) continue;

            // 1. Logic
            if(agent.pos.distanceToSquared(agent.targetPos) < 1000 || Math.random() < 0.01) {
                // Pick new random point in sphere
                agent.targetPos.set(
                    (Math.random()-0.5)*CONFIG.worldSize,
                    (Math.random()-0.5)*CONFIG.worldSize * 0.5,
                    (Math.random()-0.5)*CONFIG.worldSize
                );
            }

            // Steer
            const desired = agent.targetPos.clone().sub(agent.pos).normalize().multiplyScalar(agent.type.speed);
            const steer = desired.sub(agent.vel).multiplyScalar(agent.type.turnRate);
            agent.vel.add(steer).normalize().multiplyScalar(agent.type.speed);
            
            // Move
            agent.pos.add(agent.vel.clone().multiplyScalar(dt * 60));

            // 2. Combat (Random Firing)
            if(Math.random() < agent.type.fireRate * dt * 60) {
                // Pick a random nearby point as "enemy"
                const target = agent.pos.clone().add(agent.vel.clone().multiplyScalar(20)).add(new THREE.Vector3((Math.random()-0.5)*50, (Math.random()-0.5)*50, (Math.random()-0.5)*50));
                window.sim.fx.createLaser(agent.pos, target, agent.type.color);
                
                // Chance to create explosion at target (simulating hit)
                if(Math.random() < 0.3) {
                     window.sim.fx.createExplosion(target, 0xffffff, 0.5);
                }
            }

            // 3. Render
            dummy.position.copy(agent.pos);
            dummy.lookAt(agent.pos.clone().add(agent.vel));
            dummy.scale.setScalar(agent.type.scale);
            dummy.updateMatrix();

            const mesh = this.meshes[agent.type.id];
            mesh.setMatrixAt(counts[agent.type.id], dummy.matrix);
            counts[agent.type.id]++;
        }

        // Update GPU
        this.meshes[0].count = counts[0];
        this.meshes[0].instanceMatrix.needsUpdate = true;
        this.meshes[1].count = counts[1];
        this.meshes[1].instanceMatrix.needsUpdate = true;
        this.meshes[2].count = counts[2];
        this.meshes[2].instanceMatrix.needsUpdate = true;
    }

    updateCounts() {
        const c = this.agents.filter(a => a.type.id === 0).length;
        const m = this.agents.filter(a => a.type.id === 1).length;
        const l = this.agents.filter(a => a.type.id === 2).length;
        
        document.getElementById('count-cyan').innerText = c;
        document.getElementById('count-magenta').innerText = m;
        document.getElementById('count-lime').innerText = l;
        document.getElementById('total-agents').innerText = this.count;
    }
}

// --- CAMERA SHAKE ---
class CameraShake {
    constructor(camera) {
        this.camera = camera;
        this.intensity = 0;
    }
    trigger(amount) { this.intensity = Math.min(this.intensity + amount, 2.0); }
    update() {
        if(this.intensity > 0) {
            const rx = (Math.random()-0.5) * this.intensity;
            const ry = (Math.random()-0.5) * this.intensity;
            const rz = (Math.random()-0.5) * this.intensity;
            this.camera.position.add(new THREE.Vector3(rx, ry, rz));
            this.intensity *= 0.9;
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
        this.wing = new WingManager(this.scene, CONFIG.count);
        
        window.sim = this;
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.0015);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
        this.camera.position.set(0, 200, 600);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.5;

        // Bloom
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloom.strength = 1.2;
        bloom.radius = 0.5;
        bloom.threshold = 0.1;
        this.composer.addPass(bloom);

        // Lights
        this.scene.add(new THREE.AmbientLight(0x404040));
        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(100, 100, 50);
        this.scene.add(dirLight);

        // Stars
        const starsGeo = new THREE.BufferGeometry();
        const sPos = [];
        for(let i=0; i<4000; i++) sPos.push((Math.random()-0.5)*3000, (Math.random()-0.5)*3000, (Math.random()-0.5)*3000);
        starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
        this.scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({color: 0x888888, size: 1.5})));

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

    reset() {
        location.reload();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.timeScale += (this.targetTimeScale - this.timeScale) * 0.1;
        const dt = this.clock.getDelta() * this.timeScale;

        this.wing.update(dt);
        this.fx.update();
        this.shaker.update();
        this.controls.update();
        this.composer.render();

        document.getElementById('fps-counter').innerText = Math.round(1/dt * this.timeScale) || 60;
        document.getElementById('sim-speed').innerText = Math.round(this.timeScale * 100) + "%";
    }
}

new Simulation();
