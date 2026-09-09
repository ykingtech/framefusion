import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/+esm';

export function initThreeBackground() {
  const canvas = document.querySelector('#three-bg');
  if (!canvas) return () => {};

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 8;

  const root = new THREE.Group();
  scene.add(root);

  // Warm metallic particle field.
  const pGeo = new THREE.BufferGeometry();
  const count = 520;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 18;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 7;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.026,
    color: 0xe3b75e,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  }));
  scene.add(points);

  // Floating thin gold rings for a luxury event feel.
  const rings = [];
  for (let i = 0; i < 9; i++) {
    const radius = 0.75 + Math.random() * 1.25;
    const tube = 0.006 + Math.random() * 0.012;
    const geo = new THREE.TorusGeometry(radius, tube, 8, 110);
    const mat = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? 0xf4d27a : (i % 3 === 1 ? 0xb76f2a : 0xe5b653),
      transparent: true,
      opacity: 0.06 + Math.random() * 0.06,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4);
    ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    ring.userData.speed = 0.00025 + Math.random() * 0.00045;
    root.add(ring);
    rings.push(ring);
  }

  // A pair of large ribbon-like arcs near the edges.
  const arcMaterial = new THREE.MeshBasicMaterial({ color: 0xd99e3f, transparent: true, opacity: 0.045, wireframe: true });
  const knot1 = new THREE.Mesh(new THREE.TorusKnotGeometry(1.45, 0.018, 180, 12, 2, 5), arcMaterial.clone());
  knot1.position.set(-4.6, 1.7, -1.8);
  knot1.scale.setScalar(1.45);
  root.add(knot1);
  const knot2 = new THREE.Mesh(new THREE.TorusKnotGeometry(1.15, 0.016, 160, 10, 3, 7), arcMaterial.clone());
  knot2.position.set(4.7, -2.0, -2.2);
  knot2.scale.setScalar(1.3);
  root.add(knot2);

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
    points.rotation.z = t * 0.000008;
    root.rotation.y = Math.sin(t * 0.00006) * 0.035;
    knot1.rotation.z = t * 0.000035;
    knot1.rotation.x = 0.45 + Math.sin(t * 0.00008) * 0.08;
    knot2.rotation.z = -t * 0.00003;
    rings.forEach((ring, i) => {
      ring.rotation.x += ring.userData.speed;
      ring.rotation.y += ring.userData.speed * (i % 2 ? -1 : 1.2);
      ring.position.y += Math.sin(t * 0.00025 + i) * 0.00025;
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
