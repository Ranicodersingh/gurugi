// ══════════════════════════════════════════════════
//  GURUJI — firebase.js
//  Single source of truth: Firebase > localStorage > UI
// ══════════════════════════════════════════════════

// ── Globals ──
window.FBDB          = null;
window.FBAUTH        = null;
window.googleProvider = null;
window.CURRENT_USER  = null;
window.FB_READY      = false;

const ARRAY_KEYS = ['sp_students','sp_payments','sp_classes','sp_hw','sp_prog','sp_batches'];
const ALL_KEYS   = [...ARRAY_KEYS, 'sp_settings','sp_avail','sp_theme'];

// ── Data path ──
function userRef(key){
  return FBDB.ref('swarpro/users/' + CURRENT_USER.uid + '/' + key);
}

// ── Write: localStorage first (instant UI), then Firebase (sync all devices) ──
function fbSet(key, data){
  localStorage.setItem(key, JSON.stringify(data));
  try{
    if(CURRENT_USER && FBDB){
      const val = (Array.isArray(data) && data.length === 0) ? null : data;
      userRef(key).set(val).catch(e => console.warn('fbSet error:', e));
    }
  } catch(e){ console.warn('fbSet error:', e); }
}

function fbSetRaw(key, val){
  localStorage.setItem(key, val);
  try{
    if(CURRENT_USER && FBDB)
      userRef(key).set(val).catch(e => console.warn('fbSetRaw error:', e));
  } catch(e){}
}

// ── Apply Firebase snapshot → localStorage ──
function applySnapshot(data){
  ALL_KEYS.forEach(k => {
    if(!data){
      if(ARRAY_KEYS.includes(k)) localStorage.setItem(k, '[]');
      return;
    }
    const v = data[k];
    if(v != null){
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } else {
      if(ARRAY_KEYS.includes(k))  localStorage.setItem(k, '[]');
      else if(k !== 'sp_settings') localStorage.removeItem(k);
    }
  });
}

// ── Real-time listener ──
let _realtimeRef = null;

function loadFromFirebase(callback){
  if(!CURRENT_USER || !FBDB){ FB_READY = true; callback(); return; }

  // ✅ FIX 5: Debug log
  console.log('Firebase: attaching listener for uid', CURRENT_USER.uid);

  const ref = FBDB.ref('swarpro/users/' + CURRENT_USER.uid);
  _realtimeRef = ref;
  let firstLoad = true;

  ref.on('value', snap => {
    const data = snap.val();

    // ✅ FIX 5: Debug log
    console.log('Firebase data received:', data ? 'has data' : 'empty');

    // ✅ FIX 3: Always overwrite localStorage from Firebase (clear stale cache)
    applySnapshot(data);

    if(firstLoad){
      firstLoad  = false;
      FB_READY   = true;

      // ✅ FIX 1: Boot app, then force UI refresh after short delay
      callback();
      setTimeout(() => {
        refreshUI();
        console.log('Firebase loaded — UI refreshed');
      }, 200);

    } else {
      // ✅ FIX 2: Real-time update from another device
      console.log('Firebase real-time update — refreshing UI');
      refreshUI();
      flashSyncDot();
    }

  }, err => {
    console.warn('Firebase listener error:', err);
    if(firstLoad){ firstLoad = false; FB_READY = true; callback(); }
  });
}

function detachRealtimeListener(){
  if(_realtimeRef){ _realtimeRef.off(); _realtimeRef = null; }
}

// ── Flash sync dot on real-time update ──
function flashSyncDot(){
  const dot = document.getElementById('fbDot');
  if(!dot) return;
  dot.style.background = '#f59e0b';
  dot.title = 'Syncing…';
  setTimeout(() => { dot.style.background = '#34d399'; dot.title = 'Synced ✓'; }, 1500);
}

// ── Refresh whichever page is currently visible ──
function refreshUI(){
  try{
    const pg = document.querySelector('.pg.on');
    if(!pg) return;
    const id = pg.id;
    if     (id === 'pg-dash')   typeof renderDash     === 'function' && renderDash();
    else if(id === 'pg-stu')    typeof renderStu      === 'function' && renderStu();
    else if(id === 'pg-batch')  typeof renderBatches  === 'function' && renderBatches();
    else if(id === 'pg-sch')    typeof renderSchContent === 'function' && renderSchContent();
    else if(id === 'pg-rep')    typeof renderRep      === 'function' && renderRep();
    else if(id === 'pg-alerts') typeof renderAlerts   === 'function' && renderAlerts();
    else if(id === 'pg-set')    typeof renderSettings === 'function' && renderSettings();
    else if(id === 'pg-det' && window.detId)
      typeof renderDet === 'function' && renderDet(window.detId);
    typeof updateBell === 'function' && updateBell();
  } catch(e){ console.warn('refreshUI error:', e); }
}

// ══════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ══════════════════════════════════════════════════

function enableAuthButtons(){
  const sb = document.getElementById('authSubmitBtn');
  const gb = document.getElementById('googleBtn');
  if(sb){ sb.disabled = false; sb.textContent = 'Sign In / Register'; sb.style.opacity = '1'; }
  if(gb){ gb.disabled = false; gb.style.opacity = '1'; }
}

function signInEmail(){
  if(!FBAUTH){ showAuthError('Still connecting… please wait'); return; }
  const email = (document.getElementById('authEmail').value || '').trim();
  const pass  = document.getElementById('authPass').value || '';
  if(!email || !pass){ showAuthError('Enter email and password'); return; }
  setAuthLoading(true);
  FBAUTH.signInWithEmailAndPassword(email, pass).catch(e => {
    if(e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential'){
      FBAUTH.createUserWithEmailAndPassword(email, pass)
        .catch(err => { showAuthError(friendlyAuthError(err)); setAuthLoading(false); });
    } else { showAuthError(friendlyAuthError(e)); setAuthLoading(false); }
  });
}

function signInGoogle(){
  if(!FBAUTH || !googleProvider){ showAuthError('Still connecting… please wait'); return; }
  setAuthLoading(true);
  FBAUTH.signInWithRedirect(googleProvider)
    .catch(e => { showAuthError(friendlyAuthError(e)); setAuthLoading(false); });
}

function signOut(){
  if(!FBAUTH) return;
  detachRealtimeListener();
  FBAUTH.signOut().then(() => { CURRENT_USER = null; localStorage.clear(); location.reload(); });
}

function forgotPassword(){
  if(!FBAUTH){ showAuthError('Still connecting… please wait'); return; }
  const email = (document.getElementById('authEmail').value || '').trim();
  if(!email){ showAuthError('Enter your email first'); return; }
  FBAUTH.sendPasswordResetEmail(email)
    .then(() => {
      const el = document.getElementById('authError');
      if(el){ el.textContent = '✅ Reset link sent to ' + email; el.style.display = 'block';
        el.style.background = '#0a2a10'; el.style.borderColor = 'var(--grn)'; el.style.color = 'var(--grn)'; }
    }).catch(e => showAuthError(friendlyAuthError(e)));
}

function friendlyAuthError(e){
  const map = {
    'auth/wrong-password':           'Wrong password.',
    'auth/invalid-email':            'Invalid email address.',
    'auth/email-already-in-use':     'Email already registered — try signing in.',
    'auth/weak-password':            'Password must be at least 6 characters.',
    'auth/user-not-found':           'No account found.',
    'auth/invalid-credential':       'Wrong email or password.',
    'auth/popup-closed-by-user':     'Google sign-in cancelled.',
    'auth/network-request-failed':   'No internet connection.',
  };
  return map[e.code] || e.message || 'Something went wrong.';
}

function showAuthError(msg){
  const el = document.getElementById('authError');
  if(el){ el.textContent = msg; el.style.display = 'block'; }
}

function setAuthLoading(v){
  const b = document.getElementById('authSubmitBtn');
  const g = document.getElementById('googleBtn');
  if(b){ b.disabled = v; b.textContent = v ? 'Please wait…' : 'Sign In / Register'; }
  if(g) g.disabled = v;
}

function showUserMenu(){
  const u = CURRENT_USER; if(!u) return;
  document.getElementById('userMenuName').textContent  = u.displayName || 'Teacher';
  document.getElementById('userMenuEmail').textContent = u.email;
  const photo  = document.getElementById('userMenuPhoto');
  const avatar = document.getElementById('userMenuAvatar');
  if(u.photoURL){ photo.src = u.photoURL; photo.style.display = 'block'; avatar.style.display = 'none'; }
  else { photo.style.display = 'none'; avatar.style.display = 'flex'; }
  document.getElementById('userMenuProvider').textContent =
    'Signed in via ' + u.providerData.map(p => p.providerId === 'google.com' ? 'Google' : 'Email').join(', ');
  document.getElementById('userMenuOv').classList.add('on');
}

// ══════════════════════════════════════════════════
//  FIREBASE INIT
// ══════════════════════════════════════════════════
let fbInitAttempts = 0;

function initFirebase(){
  fbInitAttempts++;
  if(typeof firebase === 'undefined'){
    if(fbInitAttempts > 50){
      console.warn('Firebase SDK failed to load');
      enableAuthButtons();
      document.getElementById('fbLoadingOv').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    setTimeout(initFirebase, 100);
    return;
  }

  const cfg = {
    apiKey:            "AIzaSyDq0wU2b5YXwTxioyulhYuHt-oC_JVk7-4",
    authDomain:        "guruji-efd1c.firebaseapp.com",
    databaseURL:       "https://guruji-efd1c-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "guruji-efd1c",
    storageBucket:     "guruji-efd1c.firebasestorage.app",
    messagingSenderId: "655258391567",
    appId:             "1:655258391567:web:cc371f3f4fe7df6897bf7a"
  };

  if(!firebase.apps.length) firebase.initializeApp(cfg);
  window.FBDB          = firebase.database();
  window.FBAUTH        = firebase.auth();
  window.googleProvider = new firebase.auth.GoogleAuthProvider();

  enableAuthButtons();

  // ── Auth state ──
  FBAUTH.onAuthStateChanged(user => {
    if(user){
      CURRENT_USER = user;
      // ✅ FIX 4: Log which user is signed in (helps debug different-account issue)
      console.log('Signed in as:', user.email, '| uid:', user.uid);

      document.getElementById('loginScreen').style.display  = 'none';
      document.getElementById('app').style.display          = window.innerWidth >= 768 ? 'grid' : 'flex';
      document.getElementById('fbLoadingOv').style.display  = 'flex';

      const uphoto  = document.getElementById('userPhoto');
      const uavatar = document.getElementById('userAvatarFallback');
      if(uphoto){ uphoto.src = user.photoURL || ''; uphoto.style.display = user.photoURL ? 'block' : 'none'; }
      if(uavatar) uavatar.style.display = user.photoURL ? 'none' : 'flex';

      // ✅ FIX 1: Load Firebase data FIRST, then boot + refresh
      loadFromFirebase(() => {
        document.getElementById('fbLoadingOv').style.display = 'none';
        if(typeof bootApp === 'function') bootApp();
        // Extra refresh after bootApp settles
        setTimeout(() => { refreshUI(); }, 300);
      });

    } else {
      CURRENT_USER = null;
      document.getElementById('loginScreen').style.display  = 'flex';
      document.getElementById('app').style.display          = 'none';
      document.getElementById('fbLoadingOv').style.display  = 'none';
    }
  });

  // Handle Google redirect result
  FBAUTH.getRedirectResult()
    .then(result => { if(result && result.user) console.log('Google redirect OK'); })
    .catch(e => { if(e.code !== 'auth/no-current-user') console.warn('Redirect:', e); });
}

// ── Boot ──
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initFirebase);
} else {
  initFirebase();
}

// ── Safety net — show login after 5s if stuck ──
setTimeout(() => {
  const ov  = document.getElementById('fbLoadingOv');
  const ls  = document.getElementById('loginScreen');
  const app = document.getElementById('app');
  if(ov && ov.style.display !== 'none'){
    ov.style.display = 'none';
    if(ls && ls.style.display === 'none' && app && app.style.display === 'none'){
      ls.style.display = 'flex';
      enableAuthButtons();
    }
  }
}, 5000);
