(() => {
  const crashEl = document.getElementById('crash');
  const crashMsg = document.getElementById('crashMsg');
  const reloadNow = document.getElementById('reloadNow');
  reloadNow?.addEventListener('click', ()=> location.reload());
  window.addEventListener('error', e => { crashMsg.textContent = String(e.error || e.message || 'Unknown error'); crashEl.classList.remove('hidden'); });
  window.addEventListener('unhandledrejection', e => { crashMsg.textContent = String(e.reason || 'Unhandled rejection'); crashEl.classList.remove('hidden'); });

  const settingsModal = document.getElementById('settingsModal');
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettings = document.getElementById('closeSettings');
  const applySettings = document.getElementById('applySettings');
  const sizeSel = document.getElementById('size');
  const themeSel = document.getElementById('theme');
  const soundChk = document.getElementById('sound');
  const installBtn = document.getElementById('installBtn');
  const hardReloadBtn = document.getElementById('hardReload');

  let deferredPrompt = null;

  hardReloadBtn.addEventListener('click', async () => {
    try{
      if ('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      localStorage.clear();
      if ('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    }catch(e){ console.warn(e); }
    location.reload();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'inline-flex';
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }

  const STORAGE_KEY = 'p2048_state_v6';
  const BEST_KEY = 'p2048_best_v6';
  const PREF_KEY = 'p2048_prefs_v6';

  const gridEl = document.getElementById('grid');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const newBtn = document.getElementById('newGame');
  const undoBtn = document.getElementById('undo');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDesc = document.getElementById('overlayDesc');
  const tryAgain = document.getElementById('tryAgain');

  const prefs = loadPrefs();
  applyTheme(prefs.theme);
  sizeSel.value = String(prefs.size);
  themeSel.value = prefs.theme;
  soundChk.checked = prefs.sound;

  function loadPrefs(){ try { return JSON.parse(localStorage.getItem(PREF_KEY)) || { size:4, theme:'auto', sound:true }; } catch(e){ return { size:4, theme:'auto', sound:true }; } }
  function savePrefs(p){ localStorage.setItem(PREF_KEY, JSON.stringify(p)); }
  function applyTheme(mode){
    document.body.classList.remove('theme-dark','theme-light');
    if (mode === 'dark') document.body.classList.add('theme-dark');
    else if (mode === 'light') document.body.classList.add('theme-light');
  }

  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
  applySettings.addEventListener('click', () => {
    const newPrefs = { size: parseInt(sizeSel.value,10), theme: themeSel.value, sound: soundChk.checked };
    savePrefs(newPrefs);
    applyTheme(newPrefs.theme);
    SIZE = newPrefs.size;
    start(true);
    settingsModal.classList.add('hidden');
  });

  let SIZE = prefs.size || 4;
  const PROB_4 = 0.1;
  let grid, score, best, undoStack = [];

  function isValidGrid(g, size){
    if (!Array.isArray(g) || g.length !== size) return false;
    for (let r=0;r<size;r++){
      if (!Array.isArray(g[r]) || g[r].length !== size) return false;
      for (let c=0;c<size;c++){
        if (typeof g[r][c] !== 'number') return false;
      }
    }
    return true;
  }

  let audioCtx = null;
  function beep(freq=440, dur=0.05){
    if (!soundChk.checked) return;
    try{
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type='sine'; o.frequency.value=freq;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.06, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.start(); o.stop(audioCtx.currentTime + dur);
    }catch(e){}
  }

  function makeEmpty(){ return Array.from({length: SIZE}, () => Array.from({length: SIZE}, () => 0)); }
  function randCell(empty){ return empty[Math.floor(Math.random()*empty.length)]; }
  function addRandomTile(board){
    const empties = [];
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (!board[r][c]) empties.push([r,c]);
    if (!empties.length) return;
    const [r,c] = randCell(empties);
    board[r][c] = Math.random() < PROB_4 ? 4 : 2;
  }
  function clone(board){ return board.map(row => row.slice()); }

  function storeState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({grid, score, size: SIZE})); localStorage.setItem(BEST_KEY, String(best)); }
  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
      if (raw){
        const obj = JSON.parse(raw);
        const sz = parseInt((obj && obj.size) || SIZE, 10);
        if (!Number.isFinite(sz) || sz < 2 || sz > 8) return false;
        if (!isValidGrid(obj.grid, sz)) return false;
        if (!Number.isFinite(obj.score)) return false;
        SIZE = sz;
        grid = obj.grid;
        score = obj.score;
        return true;
      }
    }catch(e){}
    return false;
  }

  function start(newGame=false){
    overlay.classList.add('hidden');
    if (!newGame && loadState()){ draw(); measureLayoutAndSetReserve(); return; }
    grid = makeEmpty();
    score = 0;
    addRandomTile(grid); addRandomTile(grid);
    undoStack = [];
    best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    draw();
    storeState();
    measureLayoutAndSetReserve();
  }

  function canMove(board){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        if (board[r][c] === 0) return true;
        if (c+1<SIZE && board[r][c] === board[r][c+1]) return true;
        if (r+1<SIZE && board[r][c] === board[r+1][c]) return true;
      }
    }
    return false;
  }

  function compress(row){
    const nums = row.filter(v => v!==0);
    const out = [];
    for (let i=0;i<nums.length;i++){
      if (nums[i] === nums[i+1]){
        out.push(nums[i]*2);
        score += nums[i]*2;
        i++;
        beep(660, 0.05);
      } else out.push(nums[i]);
    }
    while (out.length < SIZE) out.push(0);
    return out;
  }

  function rotate(board){
    const n = SIZE;
    const res = Array.from({length:n}, () => Array.from({length:n}, () => 0));
    for (let r=0;r<n;r++) for (let c=0;c<n;c++) res[c][n-1-r] = board[r][c];
    return res;
  }

  function move(dir){
    let b = clone(grid);
    let rotated = 0;
    if (dir==='up'){ b = rotate(rotate(rotate(b))); rotated+=3; }
    else if (dir==='right'){ b = rotate(rotate(b)); rotated+=2; }
    else if (dir==='down'){ b = rotate(b); rotated+=1; }

    const before = JSON.stringify(b);
    for (let r=0;r<SIZE;r++) b[r] = compress(b[r]);
    const after = JSON.stringify(b);

    if (before !== after){
      for (let i=0;i<(4-rotated)%4;i++) b = rotate(b);
      grid = b;
      addRandomTile(grid);
      best = Math.max(best, score);
      storeState();
      undoStack.push({grid: clone(grid), score});
      if (undoStack.length > 1) undoStack = undoStack.slice(-1);
      draw();
      beep(240, 0.03);
      if (!canMove(grid)) showOverlay('Игра окончена', 'Нет доступных ходов');
    }
  }

  function showOverlay(title, desc){ overlayTitle.textContent = title; overlayDesc.textContent = desc; overlay.classList.remove('hidden'); }

  function draw(){
    if (!isValidGrid(grid, SIZE)){
      grid = makeEmpty();
      score = 0;
      addRandomTile(grid); addRandomTile(grid);
      storeState();
    }

    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${SIZE}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${SIZE}, 1fr)`;

    for (let i=0;i<SIZE*SIZE;i++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      gridEl.appendChild(cell);
    }

    const rect = gridEl.getBoundingClientRect();
    const gap = 10;
    const cellSize = (rect.width - (SIZE+1)*gap) / SIZE;

    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const v = grid[r][c];
        if (!v) continue;
        const tile = document.createElement('div');
        tile.className = 'tile new';
        tile.dataset.v = v;
        tile.style.width = tile.style.height = cellSize + 'px';
        tile.style.left = (gap + c*(cellSize+gap)) + 'px';
        tile.style.top  = (gap + r*(cellSize+gap)) + 'px';
        tile.innerHTML = `<div class="inner">${v}</div>`;
        tile.addEventListener('animationend', ()=> tile.classList.remove('new'), {once:true});
        gridEl.appendChild(tile);
      }
    }
    scoreEl.textContent = score;
    bestEl.textContent = best;
  }

  function handleKey(e){
    const key = e.key;
    const low = key.toLowerCase();
    const arrows = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
    if (arrows.includes(key)) { e.preventDefault(); }
    if (['arrowleft','a','h'].includes(low)) move('left');
    else if (['arrowright','d','l'].includes(low)) move('right');
    else if (['arrowup','w','k'].includes(low)) move('up');
    else if (['arrowdown','s','j'].includes(low)) move('down');
    if (document.activeElement !== gridEl) gridEl.focus();
  }
  window.addEventListener('keydown', handleKey, {passive:false});
  document.addEventListener('keydown', handleKey, {passive:false});
  gridEl.addEventListener('click', ()=> gridEl.focus());
  window.addEventListener('pointerdown', ()=> gridEl.focus(), {once:true});

  let touchStart = null;
  gridEl.addEventListener('touchstart', (e)=>{
    if (e.touches.length === 1){
      touchStart = {x:e.touches[0].clientX, y:e.touches[0].clientY};
    }
  }, {passive:true});
  gridEl.addEventListener('touchend', (e)=>{
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax,ay) > 24){
      if (ax > ay) move(dx>0?'right':'left'); else move(dy>0?'down':'up');
    }
    touchStart = null;
  }, {passive:true});

  newBtn.addEventListener('click', ()=> start(true));
  tryAgain.addEventListener('click', ()=> start(true));
  undoBtn.addEventListener('click', ()=>{
    if (undoStack.length){
      const last = undoStack.pop();
      grid = last.grid; score = last.score;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({grid, score, size: SIZE}));
      draw();
      overlay.classList.add('hidden');
    }
  });

  window.addEventListener('load', ()=>{ gridEl.focus(); measureLayoutAndSetReserve(); start(false); });
  window.addEventListener('resize', ()=>{ draw(); measureLayoutAndSetReserve(); });

  function measureLayoutAndSetReserve(){
    const top = (document.querySelector('.topbar')?.offsetHeight || 0);
    const sb  = (document.getElementById('scorebar')?.offsetHeight || 0);
    const ctr = (document.querySelector('.controls')?.offsetHeight || 0);
    const foot= (document.querySelector('.foot')?.offsetHeight || 0);
    const margins = 40;
    const reserve = top + sb + ctr + foot + margins;
    document.documentElement.style.setProperty('--topReserve', reserve + 'px');
  }
})();