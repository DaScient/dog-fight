import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    worldSize: 800,
    baseSpeed: 1.0, 
    slowMoSpeed: 0.1,
    agentSpeed: 2.0,
    turnSpeed: 0.06,
    detectionRange: 200,
    teams: {
        CYAN: { color: 0x00f3ff, shape: 'tetra' },
        MAGENTA: { color: 0xff00ff, shape: 'box' },
        LIME: { color: 0xccff00, shape: 'octa' }
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
        this.shakeIntensity = Math.min(this.shakeIntensity + intensity, 2.0);
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
    constructor(scene, teamKey, simReference) {
        this.scene = scene;
        this.team = teamKey;
        this.sim = simReference;
        this.alive = true;
        this.hp = 100;
        this.target = null;
        
        // Physics
        this.position = new THREE.Vector3(
            randomRange(-200, 200), randomRange(-50, 50), randomRange(-200, 200)
        );
        this.velocity = new THREE.Vector3(randomRange(-1, 1), randomRange(-1, 1), randomRange(-1, 1))
            .normalize().multiplyScalar(CONFIG.agentSpeed);
        
        // Visuals
        const teamConfig = CONFIG.teams[teamKey];
        let geometry;
        if(teamConfig.shape === 'tetra') geometry = new THREE.TetrahedronGeometry(2);
        else if(teamConfig.shape === 'box') geometry = new THREE.BoxGeometry(3, 1, 4);
        else geometry = new THREE.OctahedronGeometry(2);

        const material = new THREE.MeshStandardMaterial({ 
            color: 0x111111, 
            emissive: teamConfig.color,
            emissiveIntensity: 3.0,
            roughness: 0.2,
            metalness: 0.9
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        // Engine Trail
        this.trailGeo = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(60 * 3);
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        this.trailMat = new THREE.LineBasicMaterial({ color: teamConfig.color, transparent: true, opacity: 0.6 });
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
            const leadPos = this.target.position.clone().add(this.target.velocity.clone().multiplyScalar(10));
            desiredDirection.subVectors(leadPos, this.position).normalize();
            
            // Engagement Distance
            const dist = this.position.distanceTo(this.target.mesh.position);
            const angle = this.velocity.angleTo(desiredDirection);
            
            if(dist < 80 && angle < 0.3) this.fire(dt);

        } else {
            // Patrol
            if (this.position.length() > CONFIG.worldSize / 2) {
                desiredDirection.subVectors(new THREE.Vector3(0,0,0), this.position).normalize();
            } else {
                desiredDirection.copy(this.velocity).normalize();
            }
        }

        // 2. Aerodynamics
        const currentDir = this.velocity.clone().normalize();
        currentDir.lerp(desiredDirection, CONFIG.turnSpeed * dt * 60);
        this.velocity.copy(currentDir).setLength(CONFIG.agentSpeed);

        this.position.add(this.velocity.clone().multiplyScalar(dt * 60));

        // 3. Banking
        const targetQuaternion = new THREE.Quaternion();
        const m = new THREE.Matrix4().lookAt(this.position, this.position.clone().add(this.velocity), new THREE.Vector3(0, 1, 0));
        targetQuaternion.setFromRotationMatrix(m);
        this.mesh.quaternion.slerp(targetQuaternion, 0.15);
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
        if(Math.random() < 0.08) { 
           // Laser
           const laserGeo = new THREE.BufferGeometry().setFromPoints([this.position, this.target.position]);
           const laserMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
           const laser = new THREE.Line(laserGeo, laserMat);
           this.scene.add(laser);
           setTimeout(() => { 
               this.scene.remove(laser); 
               laserGeo.dispose(); laserMat.dispose();
            }, 40);

           // Recoil
           this.position.sub(this.velocity.clone().normalize().multiplyScalar(0.2));
           this.target.takeDamage(15, this.team);
        }
    }

    takeDamage(amount, attackerTeam) {
        this.hp -= amount;
        this.mesh.material.emissive.setHex(0xffffff);
        setTimeout(() => {
            if(this.alive) this.mesh.material.emissive.setHex(CONFIG.teams[this.team].color);
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
        
        this.sim.shaker.trigger(0.8);

        // Particles
        const particleCount = 30;
        const geo = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        for(let i=0; i<particleCount; i++) {
            positions.push(this.position.x, this.position.y, this.position.z);
            velocities.push((Math.random()-0.5)*3, (Math.random()-0.5)*3, (Math.random()-0.5)*3);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: CONFIG.teams[this.team].color, size: 3, transparent: true });
        const particles = new THREE.Points(geo, mat);
        this.scene.add(particles);

        // Shockwave
        const ringGeo = new THREE.RingGeometry(0.1, 0.5, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const shockwave = new THREE.Mesh(ringGeo, ringMat);
        shockwave.position.copy(this.position);
        shockwave.lookAt(this.sim.camera.position); 
        this.scene.add(shockwave);

        const explodeAnim = () => {
            if(!particles.parent) return; 
            shockwave.scale.multiplyScalar(1.15);
            shockwave.material.opacity -= 0.05;

            const posAttr = particles.geometry.attributes.position;
            for(let i=0; i<particleCount; i++) {
                posAttr.setX(i, posAttr.getX(i) + velocities[i*3]);
                posAttr.setY(i, posAttr.getY(i) + velocities[i*3+1]);
                posAttr.setZ(i, posAttr.getZ(i) + velocities[i*3+2]);
            }
            posAttr.needsUpdate = true;
            mat.opacity -= 0.02;

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
        
        // GLOBAL REFERENCE
        window.sim = this;

        this.addSquad('CYAN');
        this.addSquad('MAGENTA');

        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.002);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 120, 250);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.5;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.strength = 1.5;
        bloomPass.radius = 0.4;
        bloomPass.threshold = 0.1;
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
        const starMat = new THREE.PointsMaterial({color: 0x888888, size: 1});
        this.scene.add(new THREE.Points(starGeo, starMat));
    }

    addSquad(team) {
        for(let i=0; i<3; i++) {
            this.agents.push(new Agent(this.scene, team, this));
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
        this.agents = this.agents.filter(a => a.alive);
        this.agents.forEach(agent => agent.update(delta, this.agents));
        this.controls.update();
        this.composer.render();
        
        document.getElementById('fps-counter').innerText = Math.round(1 / (delta/this.timeScale) || 60);
        document.getElementById('g-force').innerText = (this.timeScale * 3.5).toFixed(1); 
    }
}

new Simulation();
