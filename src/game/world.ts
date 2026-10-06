/** Renderer, scene, lights and the static level (ground + merged decor = 2 draw calls). */
import * as THREE from 'three';
import { CONFIG } from '../config';
import { merge } from './geo';
import { Layout, Solid, heightAt } from './levels';

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private staticGroup = new THREE.Group();
  private decorMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  solids: Solid[] = [];
  half = 50;
  readonly isMobile: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const dpr = Math.min(window.devicePixelRatio || 1, this.isMobile ? CONFIG.perf.pixelRatioMobile : CONFIG.perf.pixelRatioDesktop);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-0.6, 1, 0.45);
    this.scene.add(hemi, sun, this.staticGroup);
  }

  build(layout: Layout) {
    for (const c of this.staticGroup.children) (c as THREE.Mesh).geometry?.dispose();
    this.staticGroup.clear();
    this.solids = layout.solids;
    this.half = layout.half;
    const t = layout.theme;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, 90, 260);

    // ground: play area + darker outskirts so a zoomed-out camera never sees the void
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: t.groundEdge }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(layout.half * 2, layout.half * 2), new THREE.MeshLambertMaterial({ color: t.ground }));
    inner.rotation.x = -Math.PI / 2;
    this.staticGroup.add(outer, inner);

    if (layout.decor.length) {
      const decor = new THREE.Mesh(merge(layout.decor), this.decorMat);
      decor.matrixAutoUpdate = false;
      this.staticGroup.add(decor);
    }
  }

  heightAt = (x: number, z: number) => heightAt(this.solids, x, z);

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
  }
}
