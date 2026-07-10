/* ============================================================
   ITS Collective — interaction + layout engine
   Ported 1:1 from the design handoff component logic.
   Plain vanilla JS, no framework.
   ============================================================ */
(() => {
  'use strict';

  // ---- design-time config (were component props) ----
  const config = {
    menuLayout: 'top',                      // 'top' | 'left' | 'frame'
    grainAmount: 0.38,                      // 0 – 0.7
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    bgTone: 'glacier',                      // initial tone
  };

  // ---- where the conversion actions go -------------------------------------
  // The waitlist posts JSON {email, source} to `waitlistEndpoint` if set (e.g.
  // a Formspree / Netlify / custom URL); with no endpoint it falls back to a
  // mailto: draft. The deck/contact/decode buttons open a pre-filled mailto:.
  // TODO(stakeholder): set the real inbox + (optionally) a waitlist endpoint.
  const CONTACT = {
    email: 'hello@its-collective.com',   // ← replace with the collective's real address
    waitlistEndpoint: null,               // ← e.g. 'https://formspree.io/f/xxxx'; null = mailto fallback
  };

  // ---- figure accent colours (index → figure) ----
  const figColors = [
    'oklch(0.57 0.15 30)',    // 01 red    — Visual Art
    'oklch(0.55 0.15 305)',   // 02 purple — Fashion
    'oklch(0.56 0.13 150)',   // 03 green  — Music
    'oklch(0.58 0.12 245)',   // 04 blue   — About  (placeholder)
    'oklch(0.68 0.13 70)',    // 05 amber  — Pitch  (placeholder)
  ];

  // ---- background tones (light-blue family) ----
  const bgTones = {
    glacier: { field: '#a1cad8', panel: '#bfe0e9' },
    mist:    { field: '#bcccd0', panel: '#dbe7e9' },
    slate:   { field: '#8fb0c4', panel: '#b3d0de' },
    powder:  { field: '#b8d3e0', panel: '#d6e9f0' },
    azure:   { field: '#93bfd6', panel: '#b8dced' },
  };
  const toneNames = ['glacier', 'mist', 'slate', 'powder', 'azure'];

  // ---- narration (lore in breadcrumbs) ----
  const narrations = [
    'the red one paints. nine works, kept in the dark until you decode.',
    'the violet one cuts the cloth. read the hem — it says more than it wears.',
    'the green one only listens. five tracks, one frequency. press play.',
    'we are five hands making one gesture. come closer.',
    'one night, everything at once. ask us where.',
  ];
  const HOME_NARRATION = 'ITS. five of us, one signal. pick a figure — none of us will tell you which.';

  // section index → data-section name
  const SECTIONS = ['art', 'fashion', 'music', 'about', 'pitch'];

  // ---- state ----
  const state = {
    active: null,       // null | 0..4  — which figure is selected
    show: null,         // null | 0..4  — which content is rendered (lags `active` by the fade)
    fade: false,        // transient cross-fade flag
    expanded: false,    // full-viewport "stepped in" mode
    vw: null, vh: null, // measured viewport (px)
    bgTone: null,       // user-picked tone (overrides config)
    showSwatches: false,
    bubbleOpen: true,   // narration box shown vs retracted to its handle
  };
  let fadeTimer = null;
  let scrollAnim = 0;      // rAF id for the scroll-to-top animation
  let collapseToken = 0;   // invalidates a pending "scroll then collapse" if superseded

  // Per-tab view memory (session only — a refresh starts blank). Each of the 5
  // sections remembers whether it was left expanded and where it was scrolled,
  // so switching away and back restores that tab exactly, like an app's tab bar.
  const tabView = SECTIONS.map(() => ({ expanded: false, scrollTop: 0 }));

  // ---- element refs ----
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = {
    app:        $('#app'),
    canvas:     $('#canvas'),
    scroll:     $('#scroll'),
    content:    $('#content'),
    arrow:      $('#arrow'),
    arrowSpin:  $('#arrowSpin'),
    bubble:     $('#bubble'),
    bubbleText: $('#bubbleText'),
    bubbleHandle: $('#bubbleHandle'),
    grain:      $('#grain'),
    closeCtrl:  $('#closeCtrl'),
    scrollHint: $('#scrollHint'),
    swatchTray: $('#swatchTray'),
    swatchToggle: $('#swatchToggle'),
    figs:       $$('.fig'),
    sections:   $$('.section'),
    swatches:   $$('.swatch'),
  };

  const EASE = 'cubic-bezier(.7,0,.15,1)';

  // ---- state helper ----
  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  // ============================================================ actions
  // Snapshot the currently-shown tab's live view so we can restore it later.
  function saveCurrentTab() {
    if (state.show != null) {
      tabView[state.show] = { expanded: state.expanded, scrollTop: el.scroll.scrollTop };
    }
  }

  function selectFig(i) {
    if (state.active === i) { activeTap(i); return; }   // same tab → the ladder
    collapseToken++; cancelAnimationFrame(scrollAnim);  // cancel any pending scroll-collapse
    saveCurrentTab();                                   // remember the tab we're leaving
    const v = tabView[i];                               // the tab we're entering
    setState({ active: i, fade: true });                // fade out at the current size
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      // Snap-restore: swap in the new tab already at its saved size + scroll
      // (no grow animation), then let the content cross-fade back in.
      el.app.classList.add('snap');
      setState({ show: i, fade: false, expanded: v.expanded });
      el.scroll.scrollTop = v.expanded ? v.scrollTop : 0;
      void el.canvas.offsetWidth;                       // flush the snapped layout
      requestAnimationFrame(() => el.app.classList.remove('snap'));
    }, 240);
  }

  // Animate the scroll container to the top, then run `done`. Cancels cleanly if
  // superseded (e.g. the user switches tabs mid-scroll).
  function scrollToTopThen(done) {
    cancelAnimationFrame(scrollAnim);
    const sc = el.scroll;
    const from = sc.scrollTop;
    if (from <= 2 || config.reduceMotion) { sc.scrollTop = 0; done(); return; }
    const dur = Math.min(520, 180 + from * 0.6);
    const t0 = performance.now();
    const ease = (p) => 1 - Math.pow(1 - p, 3);          // easeOutCubic
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      sc.scrollTop = from * (1 - ease(p));
      if (p < 1) scrollAnim = requestAnimationFrame(step);
      else done();
    };
    scrollAnim = requestAnimationFrame(step);
  }

  // Clicking the figure of the tab you're already on — a 2-step ladder. Because
  // scrolled-to-top is synonymous with zoomed-out, one click while expanded
  // scrolls to the top and then zooms out, as one continuous motion.
  function activeTap(i) {
    if (!state.expanded) { goHome(); return; }
    const token = ++collapseToken;
    scrollToTopThen(() => {
      if (token !== collapseToken) return;               // superseded — bail
      tabView[i] = { expanded: false, scrollTop: 0 };
      setState({ expanded: false });                     // zoom out (animated)
    });
  }

  function goHome() {
    collapseToken++; cancelAnimationFrame(scrollAnim);  // cancel any pending scroll-collapse
    saveCurrentTab();
    setState({ active: null, fade: true });
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => setState({ show: null, fade: false, expanded: false }), 240);
  }
  function arrowClick() {
    if (state.expanded) setState({ expanded: false });
    else if (state.active != null) goHome();
  }
  function collapse() { setState({ expanded: false }); }

  function onWheel(e) {
    if (state.active == null) return;
    if (!state.expanded) {
      if (e.deltaY > 8) setState({ expanded: true });
    } else {
      if (e.deltaY < 0 && el.scroll.scrollTop <= 0) setState({ expanded: false });
    }
  }

  // Touchscreens never fire `wheel`, so the wheel handler alone leaves mobile
  // unable to expand/collapse. Mirror the same intent with a vertical swipe:
  // swipe up (finger up) = "go deeper" → expand; swipe down while scrolled to
  // the top of the expanded content = collapse.
  const SWIPE = 10; // px of vertical travel before a swipe counts
  let touchStartY = null, touchActed = false;
  function onTouchStart(e) {
    if (state.active == null) return;
    touchStartY = e.touches[0].clientY;
    touchActed = false;
  }
  function onTouchMove(e) {
    if (state.active == null || touchStartY == null || touchActed) return;
    const dy = touchStartY - e.touches[0].clientY; // >0 = swipe up (deeper)
    if (!state.expanded) {
      if (dy > SWIPE) { setState({ expanded: true }); touchActed = true; }
    } else if (dy < -SWIPE && el.scroll.scrollTop <= 0) {
      setState({ expanded: false }); touchActed = true;
    }
  }

  // ============================================================ render
  function render() {
    const { active, show, fade, expanded, vw, vh } = state;
    const layout = config.menuLayout;
    const ready = vw != null;

    // ---- background tone ----
    const activeTone = state.bgTone ?? config.bgTone ?? 'glacier';
    const tone = bgTones[activeTone] || bgTones.glacier;
    el.app.style.setProperty('--field', tone.field);
    el.app.style.setProperty('--panel', tone.panel);
    el.grain.style.setProperty('--grain', config.grainAmount);

    // ---- expanded flag drives a bunch of CSS ----
    el.app.classList.toggle('expanded', expanded);

    // ---- responsive canvas (px, rectangular, follows the viewport) ----
    const baseW = ready ? Math.min(vw * 0.72, 1120) : 0;
    const baseH = ready ? Math.min(vh * 0.66, 760)  : 0;
    const halfW = baseW / 2, halfH = baseH / 2;
    const vmin  = ready ? Math.min(vw, vh) : 0;
    const gap   = ready ? vmin * 0.038 : 0;

    // How narrow the viewport is: 0 on desktop (>=900px), ramping to 1 by ~380px.
    const narrow = ready ? Math.min(1, Math.max(0, (900 - vw) / 520)) : 0;

    // Top-row figures each get an equal column across a fraction of the viewport
    // width. That fraction grows as the screen narrows (the side padding scales
    // down), and each figure fills more of its column — so on mobile the figures
    // stand taller instead of collapsing. Height is capped so the airy desktop
    // proportions are preserved, and columns guarantee the row never overlaps or
    // runs off-screen.
    const rowFrac = ready ? 0.70 + 0.24 * narrow : 0;   // figure-row width ÷ viewport width
    const colW    = ready ? (vw * rowFrac) / 5 : 0;     // per-figure column
    const figH  = ready ? Math.min(colW * 0.68 / 0.72, vh * (0.07 + 0.025 * narrow)) : 0;
    const figW  = figH * 0.72;

    // ---- menu positions (px offsets from canvas centre) ----
    const xs = [-0.4, -0.2, 0, 0.2, 0.4];       // left / frame layouts (canvas-relative)
    const topXs = [-2, -1, 0, 1, 2];            // top layout: one column apart, centred on the viewport
    const layouts = {
      top:  topXs.map(f => [f * colW, -(halfH + gap + figH * 0.5)]),
      left: xs.map(f => [-(halfW + gap + figW * 0.5), f * baseH]),
      frame: [
        [-0.3 * baseW, -(halfH + gap)], [0, -(halfH + gap)], [0.3 * baseW, -(halfH + gap)],
        [-(halfW + gap), -0.08 * baseH], [halfW + gap, -0.08 * baseH],
      ],
    };
    const expandedPos = [-0.16, -0.08, 0, 0.08, 0.16].map(f => [f * vw, -(vh * 0.42)]);
    const pos = expanded ? expandedPos : (layouts[layout] || layouts.top);

    // ---- canvas ----
    el.canvas.style.width  = expanded ? (ready ? vw + 'px' : '100vw') : (ready ? baseW + 'px' : '74vw');
    el.canvas.style.height = expanded ? (ready ? vh + 'px' : '100vh') : (ready ? baseH + 'px' : '80vh');
    el.canvas.style.borderRadius = expanded ? '0px' : '12px';
    el.canvas.style.zIndex = expanded ? 20 : 4;

    // ---- figures ----
    el.figs.forEach((node, i) => {
      const [x, y] = pos[i];
      const isActive = active === i;
      const dim = active != null && !isActive;
      const s  = expanded ? 0.62 : (isActive ? 1.14 : 1);
      const op = expanded ? (isActive ? 1 : 0.5) : (dim ? 0.28 : 1);
      node.style.color  = figColors[i];
      node.style.width  = (figW || 40) + 'px';
      node.style.height = (figH || 56) + 'px';
      node.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${s})`;
      node.style.opacity = op;
      node.style.zIndex = expanded ? 30 : 5;
    });

    // ---- arrow (lives in the stage, always parks UNDER the canvas) ----
    if (active == null) {
      el.arrow.style.width = '30vmin';
      el.arrow.style.transform = 'translate(-50%,-50%) translateY(0vmin)';
    } else {
      el.arrow.style.width = expanded ? '13vmin' : '15vmin';
      // Vertical park distance is keyed to viewport *height* (not vmin): on
      // landscape vmin==vh so wide viewports are unchanged, but in portrait vmin
      // would be the narrow width and leave the arrow floating too high.
      el.arrow.style.transform = expanded
        ? 'translate(-50%,-50%) translateY(47vh)'
        : 'translate(-50%,-50%) translateY(34vh)';
    }
    el.arrow.style.zIndex = expanded ? 25 : 6;
    // reduce-motion also honoured via CSS media query; mirror the config flag
    el.arrowSpin.style.animation = config.reduceMotion ? 'none' : '';

    // ---- content cross-fade + accent colour ----
    const accent = figColors[show ?? 0];
    el.content.style.setProperty('--accent', accent);
    el.content.style.opacity = fade ? 0 : 1;
    el.content.style.transform = fade ? 'scale(0.985)' : 'scale(1)';

    // ---- which section is visible ----
    const activeName = show == null ? 'home' : SECTIONS[show];
    el.sections.forEach((sec) => {
      sec.hidden = sec.dataset.section !== activeName;
    });

    // ---- chrome: close control + scroll hint ----
    el.closeCtrl.hidden = !expanded;
    el.scrollHint.hidden = !(show !== null && !expanded);

    // ---- narration bubble (placeholder copy, retractable) ----
    const narration = show == null ? HOME_NARRATION : narrations[show];
    const bubbleColor = show == null ? 'rgba(44,85,99,0.9)' : accent;
    el.bubbleText.textContent = narration;
    el.bubble.style.color = bubbleColor;
    el.bubble.style.borderColor = bubbleColor;
    el.bubbleHandle.style.color = bubbleColor;
    el.bubbleHandle.style.borderColor = bubbleColor;
    el.bubble.hidden = !state.bubbleOpen;
    el.bubbleHandle.hidden = state.bubbleOpen;

    // ---- swatch tray / toggle ----
    el.swatchTray.hidden = !state.showSwatches;
    el.swatchToggle.hidden = state.showSwatches;
    el.swatches.forEach((sw) => {
      sw.classList.toggle('is-active', sw.dataset.tone === activeTone);
    });
  }

  // ============================================================ wiring
  function measure() {
    setState({ vw: window.innerWidth, vh: window.innerHeight });
  }
  window.addEventListener('resize', measure);

  el.figs.forEach((node) => {
    node.addEventListener('click', () => selectFig(Number(node.dataset.fig)));
  });
  el.canvas.addEventListener('wheel', onWheel, { passive: true });
  el.canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  el.canvas.addEventListener('touchmove', onTouchMove, { passive: true });
  el.arrow.addEventListener('click', arrowClick);
  el.closeCtrl.addEventListener('click', collapse);
  // explicit tap affordance (touch has no hover; the hint doubles as a button)
  el.scrollHint.addEventListener('click', () => {
    if (state.active != null && !state.expanded) setState({ expanded: true });
  });
  // narration box: click to retract, click the handle to bring it back
  el.bubble.addEventListener('click', () => setState({ bubbleOpen: false }));
  el.bubbleHandle.addEventListener('click', () => setState({ bubbleOpen: true }));

  el.swatchToggle.addEventListener('click', () => setState({ showSwatches: true }));
  el.swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      const activeTone = state.bgTone ?? config.bgTone ?? 'glacier';
      // clicking the already-selected colour retracts the tray; any other switches
      if (sw.dataset.tone === activeTone) setState({ showSwatches: false });
      else setState({ bgTone: sw.dataset.tone });
    });
  });

  // ============================================================ conversion actions
  const MAILTO = {
    'decode':       { subject: 'ITS — coordinates / decode', body: 'Notify me the moment the coordinates are released.' },
    'contact':      { subject: 'ITS — hello',                body: '' },
    'request-deck': { subject: 'ITS — investor deck request', body: 'Name:\nOrganisation:\n\nPlease send the ITS event deck.' },
  };
  const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  function mailto(subject, body) {
    window.location.href =
      `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}` +
      (body ? `&body=${encodeURIComponent(body)}` : '');
  }
  async function submitWaitlist(email) {
    if (CONTACT.waitlistEndpoint) {
      const r = await fetch(CONTACT.waitlistEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, source: 'fashion-waitlist' }),
      });
      if (!r.ok) throw new Error('waitlist endpoint returned ' + r.status);
      return 'posted';
    }
    mailto('ITS — waitlist', `Add me to the ITS waitlist: ${email}`);
    return 'mailto';
  }

  // mailto CTAs (decode / contact / request-deck)
  document.querySelectorAll('[data-action]').forEach((btn) => {
    const m = MAILTO[btn.dataset.action];
    if (m) btn.addEventListener('click', () => mailto(m.subject, m.body));
  });

  // waitlist form: validate → submit → inline confirmation
  const waitForm = document.querySelector('form[data-action="waitlist"]');
  if (waitForm) {
    waitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = waitForm.querySelector('.wait-input');
      const btn = waitForm.querySelector('button');
      const email = input.value.trim();
      if (!validEmail(email)) {
        waitForm.classList.add('is-invalid');
        input.focus();
        return;
      }
      waitForm.classList.remove('is-invalid');
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = '···';
      try {
        const mode = await submitWaitlist(email);
        waitForm.innerHTML = `<span class="waitlist-done">${mode === 'posted' ? '▸ you’re on the list' : '▸ finish in your mail app'}</span>`;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = label;
        waitForm.classList.add('is-invalid');
        console.error(err);
      }
    });
    // clear the error state as soon as they start fixing it
    waitForm.querySelector('.wait-input').addEventListener('input', () => waitForm.classList.remove('is-invalid'));
  }

  // first measure paints the real px layout
  measure();
})();
