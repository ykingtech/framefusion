import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/+esm';

export function initThreeBackground() {
  const canvas = document.querySelector('#three-bg');
  if (!canvas) return () => {};

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.z = 8;

  const group = new THREE.Group();
  scene.add(group);

  const geo = new THREE.IcosahedronGeometry(0.7, 1);
  const palette = [0x38bdf8, 0x4ade80, 0xfde047];
  const meshes = [];

  for (let i = 0; i < 16; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: palette[i % palette.length],
      transparent: true,
      opacity: 0.065 + (i % 4) * 0.012,
      wireframe: true,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(
      (Math.random() - 0.5) * 13,
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 4
    );
    const s = 0.45 + Math.random() * 1.4;
    mesh.scale.setScalar(s);
    mesh.userData.speed = 0.001 + Math.random() * 0.0025;
    group.add(mesh);
    meshes.push(mesh);
  }

  const particles = new THREE.BufferGeometry();
  const positions = new Float32Array(300 * 3);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (Math.random() - 0.5) * 18;
    positions[i + 1] = (Math.random() - 0.5) * 12;
    positions[i + 2] = (Math.random() - 0.5) * 7;
  }
  particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    particles,
    new THREE.PointsMaterial({ size: 0.026, color: 0x93c5fd, transparent: true, opacity: 0.36 })
  );
  scene.add(points);

  let raf = 0;
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const animate = (t) => {
    group.rotation.y = t * 0.000025;
    points.rotation.z = t * 0.00001;
    meshes.forEach((m, i) => {
      m.rotation.x += m.userData.speed;
      m.rotation.y += m.userData.speed * 1.3;
      m.position.y += Math.sin(t * 0.00035 + i) * 0.00045;
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  raf = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    renderer.dispose();
  };
}
