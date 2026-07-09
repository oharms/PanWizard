# PanWizard Rebrand — Implementation Guide (Claude Code)

This ports the new brand system into the **PanWizard repo**. Each step below is a
copy-paste prompt for Claude Code, run from the repo root. Do them in order; each is
self-contained and safe to commit on its own.

> Design source of truth lives in this design project:
> `PanWizard Brand.dc.html` · `PanWizard UI Kit.dc.html` · `PanWizard HUD.dc.html`
> Generated art + SVGs are in `assets/`. Drop those files into the repo's `assets/`
> before running Step 2.

---

## Brand tokens (reference — paste into any prompt if drift appears)

| Token | Hex | Role |
| --- | --- | --- |
| Ember | `#FF5A3C` | Primary / brand / active |
| Conduit | `#5B4BE6` | Links, agent connectors, focus |
| Verify | `#1E8E5A` | Success / done / healthy |
| Butter | `#FFCE4A` | Pending / highlights |
| Ink | `#211E18` | Text, dark surfaces |
| Paper | `#F3ECDD` | Cards / light surfaces |
| Sand | `#E7DBC2` | Canvas / page background |

Type: **Gabarito** (display) + **JetBrains Mono** (code/labels).
Logo: node-graph mark — coral parent → indigo links → butter + green children.

---

## Step 1 — Drop in the new assets

Copy these files from the design project's `assets/` into the repo's `assets/`:

- `pan-mark.svg` — primary node-graph mark (transparent)
- `pan-logo-lockup.svg` — mark + wordmark on ink
- `pan-hero.png` — README / npm hero banner (1024²)
- `pan-avatar.png` — npm / CLI / favicon icon (rounded square)
- `pan-orchestration.png` — orchestration illustration
- `pan-docs-header.png` — soft docs-header background

```
Update assets/pan-logo-2000.svg and assets/pan-logo-2000-transparent.svg to the new
PanWizard mark: a node-graph glyph — a coral (#FF5A3C) parent node at top, two indigo
(#5B4BE6) connector lines fanning down to a butter (#FFCE4A) node on the lower-left and
a green (#1E8E5A) node on the lower-right — beside a bold rounded-sans wordmark
"PanWizard" ("Pan" in #FF5A3C, "Wizard" in #FBF7EE on dark / #211E18 on light). Use
assets/pan-logo-lockup.svg as the reference. Keep the same viewBox/dimensions the old
files used so every <img> reference still renders.
```

---

## Step 2 — README hero + brand

```
Replace the README.md header so the hero image is assets/pan-hero.png (the new banner).
Apply the PanWizard brand: keep the centered layout, swap the npm/license badge colors
to brand hex (version #FF5A3C, downloads #5B4BE6, license #1E8E5A, all labelColor
#211E18), and add a short "Brand" section near the bottom with the token table and the
note that banner/avatar/illustration art is generated from image-prompts.md. Use the
content of README-brand-draft.md from the design project as the source — do not change
any factual/usage copy, commands, or install instructions.
```

---

## Step 3 — Re-theme the HUD (light, on-brand)

File: `pan-wizard-core/bin/lib/hud.cjs`.

```
In pan-wizard-core/bin/lib/hud.cjs, re-theme the HUD from the current dark palette to
the light PanWizard brand. Make ONLY visual changes — do not touch collectHudData(),
the render*() data wiring, or any data shape/test.

1. Replace the :root block at the top of HUD_CSS with:

:root{
  --bg:#E7DBC2;--panel:#FBF7EE;--panel2:#F3ECDD;--border:#E4D8C0;
  --text:#211E18;--text2:#5C5446;--muted:#9A9180;
  --coral:#FF5A3C;--amber:#C9A227;--cyan:#5B4BE6;--green:#1E8E5A;
  --violet:#5B4BE6;--red:#D2431F;
  --font:"Gabarito","Segoe UI",system-ui,sans-serif;
  --mono:"JetBrains Mono","SFMono-Regular",Consolas,monospace;
}

2. Replace the .pill.* rules with light-theme equivalents:

.pill.ok{background:#E4F3EB;color:#1E8E5A;}
.pill.info{background:#E9E6FB;color:#5B4BE6;}
.pill.warn{background:#FFF3D4;color:#9A7A12;}
.pill.danger{background:#FBE2DB;color:#D2431F;}
.pill.muted{background:#EDE8DC;color:#8C8475;}

3. Add a subtle card lift: on .panel and .metric add
   box-shadow:0 1px 3px rgba(33,30,24,0.05);
4. In the TIER_COLOR map, change reasoning to 'var(--coral)' so Mission Control /
   reasoning agents read coral instead of amber.
5. Bump the header: in renderMission, render the node-graph mark (inline SVG from
   assets/pan-mark.svg) to the left of the project title.

Keep all class names, structure, and the self-contained (no-network) output intact.
Run `node pan-wizard-core/bin/lib/... hud --stdout` mentally / `npm test` to confirm
renderHud still produces the same sections.
```

---

## Step 4 — Add the "Now building" panel (what + where)

This is the new panel that answers *what is it building* and *where in the project*.

```
In pan-wizard-core/bin/lib/hud.cjs, add a new "Now building" panel that renders BETWEEN
the mission panel and the command stack. It must show (a) WHERE — a horizontal phase
stepper across all roadmap phases with the current phase highlighted — and (b) WHAT —
the current phase name, the pan pipeline stage (research → plan → execute → verify),
and the in-flight build tasks (one row per active army worktree with a progress bar).

Use only data already on the object returned by collectHudData():
  d.roadmap            // [{number,name,status,plans,summaries}]
  d.state.current_phase, d.state.current_phase_name
  d.worktrees          // [{branch,worktree}]
  d.progress           // {percent,completed,total,...}

Add this helper + renderer (mirror the existing esc()/pill()/bar() style):

function pipelineStage(p){
  if(!p) return 'queued';
  if(p.status==='complete') return 'verify';
  if(p.status==='partial')  return 'execute';
  if(p.status==='researched') return 'plan';
  if(p.status==='discussed')  return 'research';
  return 'queued';
}

function renderNowBuilding(d){
  if(!d.roadmap.length) return '';
  const curNum = d.state.current_phase
    || (d.roadmap.find(p=>p.status!=='complete')||{}).number;
  const cur = d.roadmap.find(p=>String(p.number)===String(curNum)) || d.roadmap[0];
  const stage = pipelineStage(cur);
  const stages = ['research','plan','execute','verify'];

  // WHERE — stepper
  const steps = d.roadmap.map(p=>{
    const done = p.status==='complete';
    const active = String(p.number)===String(cur.number);
    const cls = done?'ok':active?'now':'todo';
    return `<div class="step ${cls}"><span class="sdot">${done?'✓':esc(p.number)}</span>`
      + `<span class="slabel">${esc((p.name||'').split(' ')[0]||p.number)}</span></div>`;
  }).join('<span class="sline"></span>');

  // WHAT — pipeline + in-flight worktrees
  const pipe = stages.map(s=>{
    const i = stages.indexOf(s), ci = stages.indexOf(stage);
    const k = i<ci?'done':i===ci?'on':'off';
    return `<span class="pstep ${k}">${esc(s)}${i<ci?' ✓':i===ci?' ●':''}</span>`;
  }).join('<span class="pgt">›</span>');

  const tasks = d.worktrees.length
    ? d.worktrees.map(t=>`<div class="task"><span class="tname">${esc(t.branch.replace(/^army\//,''))}</span>`
        + `<span class="amono dim">${esc(t.worktree)}</span></div>`).join('')
    : `<div class="task dim amono">${cur.plans||0} plan(s) · ${cur.summaries||0} done</div>`;

  return `
  <section class="panel nowbuilding">
    <div class="ph">now building — phase ${esc(cur.number)} of ${esc(d.progress.total)}</div>
    <div class="stepper">${steps}</div>
    <div class="nbcard">
      <div class="nbhead"><div class="nbtitle">Phase ${esc(cur.number)} — ${esc(cur.name||'')}</div>
        <div class="pipeline">${pipe}</div></div>
      <div class="tasks">${tasks}</div>
    </div>
  </section>`;
}

Wire it into renderHud()'s body array, right after renderMission(d). Add matching CSS to
HUD_CSS using existing tokens (.stepper as a flex row; .step.now .sdot uses --coral with
a soft ring; .step.ok .sdot uses --green; .pstep.on uses --coral). Then add
'now-building' to the sections list in cmdHud() so the JSON result reports it.
Add a unit test in tests/hud.test.cjs asserting renderHud output contains "now building"
when a roadmap exists.
```

---

## Step 5 — Verify

```
Run npm test and npm run test:scenarios. Then generate a sample HUD with
`node bin/install.js` env or the pan-tools dispatcher: `pan-tools hud --out /tmp/hud.html`
and open it to confirm the light theme + the "now building" panel render correctly with
real project data. Fix any failing hud tests caused by the new section.
```

---

## Notes
- The HUD stays a single self-contained file — no external CSS/JS/fonts fetched. Gabarito
  / JetBrains Mono are named with system fallbacks; if you want them embedded, base64 a
  woff2 into an `@font-face` inside HUD_CSS (optional).
- Nothing here changes planning/state semantics — the HUD remains a pure view.
- Re-generate any new art with the prompts in `image-prompts.md`.
