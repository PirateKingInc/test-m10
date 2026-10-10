function c(o,d){const t=document.createElement("style");t.textContent="#debug{position:fixed;left:4px;bottom:4px;z-index:50;background:rgba(0,0,0,.72);color:#9fffb0;font:11px/1.35 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;max-width:330px;pointer-events:none;white-space:pre}",document.head.appendChild(t);const e=document.createElement("div");e.id="debug",document.body.appendChild(e);const n=()=>{const p=o.dev.stats(),s=Object.entries(p).map(([i,a])=>`${i.padEnd(9)}${a}`).join(`
`);e.textContent=`JUNK MAGNET debug
${s}
— overrides: ${d.join(", ")||"none"}`};setInterval(n,250),n()}export{c as mountDebug};
