/* ==================== CONFIG ==================== */
// Kirim magic link & verifikasi/aktivasi: keduanya sekarang pakai Free RestAPI
// (GET + apikey), karena API sebelumnya (Zyvor) gagal diakses dari browser (CORS).
const AM_SEND_API   = "https://free-restapi.biz.id/api/alightmotion-send?apikey=adin2207";
const AM_VERIFY_API = "https://free-restapi.biz.id/api/alight-verifyy?apikey=adin2207";

// Nomor WhatsApp buat order paket
const OWNER_WA     = "6282286315293";
const SUB_ADMIN_WA = "62895405227128";

const PLANS = {
  silver:   { name: "Silver",   price: 10000, days: 7 },
  gold:     { name: "Gold",     price: 15000, days: 30 },
  platinum: { name: "Platinum", price: null,  days: 365 } // rahasia, hanya bisa diaktifkan admin
};

/* ==================== TEMA TAMPILAN ==================== */
function applyTheme(theme) {
  if (theme && theme !== "blue") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.querySelectorAll(".theme-swatch").forEach(sw => {
    sw.classList.toggle("active", sw.dataset.theme === (theme || "blue"));
  });
}

function getSavedTheme() {
  try { return localStorage.getItem("appTheme") || "blue"; } catch (_) { return "blue"; }
}

applyTheme(getSavedTheme());

document.querySelectorAll(".theme-swatch").forEach(btn => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme;
    try { localStorage.setItem("appTheme", theme); } catch (_) {}
    applyTheme(theme);
  });
});

/* ==================== FIREBASE ==================== */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ==================== HARGA PAKET (Firestore-backed, realtime) ==================== */
let unsubscribePrices = null;

function attachPriceListener() {
  if (unsubscribePrices) return;
  unsubscribePrices = db.collection("settings").doc("prices").onSnapshot(
    (snap) => {
      if (snap.exists) {
        const p = snap.data();
        if (typeof p.silver === "number") PLANS.silver.price = p.silver;
        if (typeof p.gold === "number") PLANS.gold.price = p.gold;
        if (typeof p.platinum === "number") PLANS.platinum.price = p.platinum;
      }
      if (typeof updatePackagePrices === "function" && document.getElementById("silverPrice")) {
        updatePackagePrices();
      }
      if (typeof fillAdminPriceInputs === "function") fillAdminPriceInputs();
    },
    (err) => console.warn("price listener error:", err)
  );
}
attachPriceListener();

/* ==================== STORAGE HELPERS (Firestore) ==================== */
let currentUserData = null;   // cache dari dokumen users/{uid}, disinkronkan realtime
let unsubscribeUserDoc = null;

function getCurrentUser() {
  return currentUserData;
}

function attachUserListener(uid) {
  return new Promise((resolve) => {
    if (unsubscribeUserDoc) unsubscribeUserDoc();
    let first = true;
    unsubscribeUserDoc = db.collection("users").doc(uid).onSnapshot(
      (snap) => {
        if (snap.exists) {
          currentUserData = snap.data();
          if (appScreen.style.display !== "none") refreshUI();
        }
        if (first) { first = false; resolve(); }
      },
      (err) => {
        console.warn("listener error", err);
        if (first) { first = false; resolve(); }
      }
    );
  });
}

function mapAuthError(err) {
  const code = err && err.code;
  console.error("Firebase auth error:", code, err && err.message);
  switch (code) {
    case "auth/email-already-in-use": return "Email sudah terdaftar.";
    case "auth/invalid-email": return "Email tidak valid.";
    case "auth/weak-password": return "Password minimal 6 karakter.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Username/email atau password salah.";
    case "auth/too-many-requests": return "Terlalu banyak percobaan. Coba lagi nanti.";
    case "auth/network-request-failed": return "Koneksi gagal. Periksa internet kamu.";
    case "auth/unauthorized-domain": return "Domain ini belum diizinkan di Firebase (Authentication > Settings > Authorized domains).";
    case "auth/operation-not-allowed": return "Metode Email/Password belum diaktifkan di Firebase Console.";
    case "auth/configuration-not-found": return "Authentication belum di-setup di Firebase Console.";
    case "permission-denied": return "Akses Firestore ditolak — pastikan Security Rules sudah di-Publish di Firebase Console.";
    case "unavailable": return "Firestore tidak bisa dihubungi. Cek koneksi internet.";
    default: return code ? `Terjadi kesalahan (${code}).` : "Terjadi kesalahan. Coba lagi.";
  }
}

function hasUnlimitedAccess(user) {
  return !!(user &&
    (user.plan === "silver" || user.plan === "gold" || user.plan === "platinum") &&
    user.planExpire && Date.now() < user.planExpire);
}

async function checkIsAdmin(uid) {
  try {
    const doc = await db.collection("admins").doc(uid).get();
    return doc.exists;
  } catch (e) {
    console.warn("checkIsAdmin error:", e);
    return false;
  }
}

/* ==================== DOM REFS ==================== */
const authScreen   = document.getElementById("authScreen");
const appScreen    = document.getElementById("appScreen");
const adminScreen  = document.getElementById("adminScreen");
const loginForm    = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginMsg     = document.getElementById("loginMsg");
const regMsg       = document.getElementById("regMsg");
const displayUser  = document.getElementById("displayUser");
const creditValue  = document.getElementById("creditValue");
const planBadge    = document.getElementById("planBadge");
const planExpire   = document.getElementById("planExpire");
const msgBox       = document.getElementById("msgBox");
const emailInput   = document.getElementById("emailInput");
const magicInput   = document.getElementById("magicInput");
const sendBtn      = document.getElementById("sendBtn");
const activateBtn  = document.getElementById("activateBtn");
const btnText      = document.getElementById("btnText");
const adminLoginModal = document.getElementById("adminLoginModal");
const adminLoginMsg   = document.getElementById("adminLoginMsg");

let cachedEmail = "";
let adminModeRequested = false;
let allAdminUsers = [];

/* ==================== UI HELPERS ==================== */
function showMsg(el, text, type = "error") {
  const icon = type === "success"
    ? '<i class="fas fa-circle-check"></i>'
    : '<i class="fas fa-circle-exclamation"></i>';
  el.innerHTML = icon + '<span>' + text + '</span>';
  el.className = "message show " + type;
}

function hideMsg(el) {
  el.className = "message";
  el.innerHTML = "";
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatRp(n) {
  return "Rp " + n.toLocaleString("id-ID");
}

/* ==================== CELEBRASI SUKSES (confetti) ==================== */
const CONFETTI_COLORS = ["#3d84e8", "#a9d4ff", "#cda85e", "#f1dfb0", "#c6cbd4", "#c6a4ef", "#34d399"];

function celebrateSuccess() {
  const overlay = document.getElementById("celebrateOverlay");
  overlay.classList.remove("fade-out");
  overlay.style.display = "flex";

  const pieceCount = 46;
  const pieces = [];
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const size = 6 + Math.random() * 7;
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const left = Math.random() * 100;
    const duration = 2.2 + Math.random() * 1.4;
    const delay = Math.random() * 0.3;
    const drift = (Math.random() - 0.5) * 220;
    const spin = 360 + Math.random() * 360;

    piece.style.left = left + "vw";
    piece.style.width = size + "px";
    piece.style.height = (size * (Math.random() > 0.5 ? 1 : 2.2)) + "px";
    piece.style.background = color;
    piece.style.setProperty("--drift", drift + "px");
    piece.style.setProperty("--spin", spin + "deg");
    piece.style.animationDuration = duration + "s";
    piece.style.animationDelay = delay + "s";

    document.body.appendChild(piece);
    pieces.push(piece);
  }

  setTimeout(() => {
    overlay.classList.add("fade-out");
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.classList.remove("fade-out");
    }, 420);
  }, 2200);

  setTimeout(() => {
    pieces.forEach(p => p.remove());
  }, 3800);
}

/* ==================== AUTH UI ==================== */
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    loginForm.classList.toggle("active", target === "login");
    registerForm.classList.toggle("active", target === "register");
    hideMsg(loginMsg);
    hideMsg(regMsg);
  });
});

/* ==================== REGISTER ==================== */
document.getElementById("registerBtn").addEventListener("click", async () => {
  const username = document.getElementById("regUser").value.trim().toLowerCase();
  const email    = document.getElementById("regEmail").value.trim().toLowerCase();
  const pass     = document.getElementById("regPass").value;
  const pass2    = document.getElementById("regPass2").value;
  const registerBtn = document.getElementById("registerBtn");

  hideMsg(regMsg);

  if (!username || username.length < 3) {
    showMsg(regMsg, "Username minimal 3 karakter.", "error");
    return;
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    showMsg(regMsg, "Username hanya boleh huruf, angka, underscore.", "error");
    return;
  }
  if (!email || !email.includes("@")) {
    showMsg(regMsg, "Email tidak valid.", "error");
    return;
  }
  if (pass.length < 6) {
    showMsg(regMsg, "Password minimal 6 karakter.", "error");
    return;
  }
  if (pass !== pass2) {
    showMsg(regMsg, "Password tidak cocok.", "error");
    return;
  }

  registerBtn.disabled = true;
  const oldLabel = registerBtn.innerHTML;
  registerBtn.innerHTML = '<div class="loader"></div>';

  try {
    const unameSnap = await db.collection("usernames").doc(username).get();
    if (unameSnap.exists) {
      showMsg(regMsg, "Username sudah dipakai.", "error");
      return;
    }

    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    const uid = cred.user.uid;

    const batch = db.batch();
    batch.set(db.collection("usernames").doc(username), { uid, email });
    batch.set(db.collection("users").doc(uid), {
      username,
      email,
      credits: 0,
      plan: "free",
      planExpire: null,
      createdAt: Date.now()
    });
    await batch.commit();

    showMsg(regMsg, "Berhasil daftar! Order paket Silver/Gold dulu di menu Paket untuk bisa aktivasi.", "success");
    // enterApp() akan dipanggil otomatis lewat onAuthStateChanged
  } catch (err) {
    showMsg(regMsg, mapAuthError(err), "error");
  } finally {
    registerBtn.disabled = false;
    registerBtn.innerHTML = oldLabel;
  }
});

/* ==================== LOGIN ==================== */
document.getElementById("loginBtn").addEventListener("click", async () => {
  const input = document.getElementById("loginUser").value.trim().toLowerCase();
  const pass  = document.getElementById("loginPass").value;
  const loginBtn = document.getElementById("loginBtn");

  hideMsg(loginMsg);

  if (!input || !pass) {
    showMsg(loginMsg, "Isi username/email dan password.", "error");
    return;
  }

  loginBtn.disabled = true;
  const oldLabel = loginBtn.innerHTML;
  loginBtn.innerHTML = '<div class="loader"></div>';

  try {
    let email = input;
    if (!input.includes("@")) {
      const unameSnap = await db.collection("usernames").doc(input).get();
      if (!unameSnap.exists) {
        showMsg(loginMsg, "Username/email atau password salah.", "error");
        return;
      }
      email = unameSnap.data().email;
    }

    await auth.signInWithEmailAndPassword(email, pass);
    showMsg(loginMsg, "Berhasil masuk!", "success");
    // enterApp() akan dipanggil otomatis lewat onAuthStateChanged
  } catch (err) {
    showMsg(loginMsg, mapAuthError(err), "error");
  } finally {
    loginBtn.disabled = false;
    loginBtn.innerHTML = oldLabel;
  }
});

/* ==================== LUPA PASSWORD ==================== */
const forgotPassModal = document.getElementById("forgotPassModal");
const forgotPassMsg   = document.getElementById("forgotPassMsg");

document.getElementById("forgotPassBtn").addEventListener("click", () => {
  document.getElementById("forgotEmail").value = "";
  hideMsg(forgotPassMsg);
  forgotPassModal.style.display = "flex";
});

function closeForgotPassModal() {
  forgotPassModal.style.display = "none";
}
document.getElementById("forgotPassCancel").addEventListener("click", closeForgotPassModal);
forgotPassModal.querySelector(".modal-backdrop").addEventListener("click", closeForgotPassModal);

document.getElementById("forgotPassBtn2").addEventListener("click", async () => {
  const input = document.getElementById("forgotEmail").value.trim().toLowerCase();
  const btn = document.getElementById("forgotPassBtn2");

  hideMsg(forgotPassMsg);

  if (!input) {
    showMsg(forgotPassMsg, "Isi username atau email dulu.", "error");
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';

  try {
    let email = input;
    if (!input.includes("@")) {
      const unameSnap = await db.collection("usernames").doc(input).get();
      if (!unameSnap.exists) {
        showMsg(forgotPassMsg, "Username tidak ditemukan.", "error");
        return;
      }
      email = unameSnap.data().email;
    }

    await auth.sendPasswordResetEmail(email);
    showMsg(forgotPassMsg, "Link reset password sudah dikirim ke email kamu. Cek inbox / folder spam.", "success");
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      showMsg(forgotPassMsg, "Email tidak terdaftar.", "error");
    } else {
      showMsg(forgotPassMsg, mapAuthError(err), "error");
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldLabel;
  }
});

/* ==================== LOGOUT ==================== */
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await auth.signOut();
  document.getElementById("loginUser").value = "";
  document.getElementById("loginPass").value = "";
  hideMsg(loginMsg);
});

/* ==================== ENTER APP ==================== */
function enterApp() {
  const user = getCurrentUser();
  if (!user) return;

  // Status paket dihitung langsung dari timestamp planExpire (lihat hasUnlimitedAccess),
  // jadi tidak perlu menulis apapun ke Firestore di sini. User tidak lagi punya izin
  // menulis plan/credits ke dokumennya sendiri — itu murni wewenang admin sekarang.
  authScreen.style.display = "none";
  adminScreen.style.display = "none";
  appScreen.style.display = "";
  goToMainPage("home");
  refreshUI();
  updatePackagePrices();
  attachAnnouncementListener();
}

/* ==================== PENGUMUMAN (User) ==================== */
let unsubscribeAnnouncements = null;

function attachAnnouncementListener() {
  if (unsubscribeAnnouncements) unsubscribeAnnouncements();
  const listEl = document.getElementById("announcementList");
  unsubscribeAnnouncements = db.collection("announcements")
    .where("active", "==", true)
    .onSnapshot(
      (snap) => {
        if (snap.empty) {
          listEl.innerHTML = "";
          return;
        }
        const items = [];
        snap.forEach(doc => items.push(doc.data()));
        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        listEl.innerHTML = items.map(a => `
          <div class="announcement-item">
            <i class="fas fa-bullhorn"></i>
            <div class="announcement-text">${escapeHtml(a.message)}</div>
          </div>
        `).join("");
      },
      (err) => console.warn("announcement listener error:", err)
    );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
let secretTapCount = 0;
let secretTapTimer = null;

document.getElementById("secretTrigger").addEventListener("click", () => {
  secretTapCount++;
  if (secretTapTimer) clearTimeout(secretTapTimer);
  secretTapTimer = setTimeout(() => { secretTapCount = 0; }, 3000);
  if (secretTapCount >= 5) {
    secretTapCount = 0;
    openAdminLoginModal();
  }
});

function openAdminLoginModal() {
  document.getElementById("adminEmail").value = "";
  document.getElementById("adminPass").value = "";
  hideMsg(adminLoginMsg);
  adminLoginModal.style.display = "flex";
}

function closeAdminLoginModal() {
  adminLoginModal.style.display = "none";
}

document.getElementById("adminLoginCancel").addEventListener("click", closeAdminLoginModal);
adminLoginModal.querySelector(".modal-backdrop").addEventListener("click", closeAdminLoginModal);

document.getElementById("adminLoginBtn").addEventListener("click", async () => {
  const email = document.getElementById("adminEmail").value.trim().toLowerCase();
  const pass  = document.getElementById("adminPass").value;
  const btn   = document.getElementById("adminLoginBtn");

  hideMsg(adminLoginMsg);

  if (!email || !pass) {
    showMsg(adminLoginMsg, "Isi email dan password admin.", "error");
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';

  try {
    adminModeRequested = true;
    await auth.signInWithEmailAndPassword(email, pass);
    // hasil diproses di onAuthStateChanged
  } catch (err) {
    adminModeRequested = false;
    showMsg(adminLoginMsg, mapAuthError(err), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldLabel;
  }
});

document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
  sessionStorage.removeItem("adminIntroShown");
  await auth.signOut();
});

function enterAdminPanel() {
  authScreen.style.display = "none";
  appScreen.style.display = "none";
  // adminScreen SENGAJA belum ditampilkan di sini — baru dimunculkan
  // setelah video intro selesai/di-skip (lihat playAdminIntro), jadi urutannya
  // pasti: login berhasil -> intro tampil -> intro selesai -> panel admin muncul.
  loadAdminUsers();
  loadAdminVouchers();
  loadAdminAnnouncements();
  fillAdminPriceInputs();
  playAdminIntro(() => {
    adminScreen.style.display = "";
  });
}

/* ==================== INTRO ADMIN (video selamat datang) ==================== */
function playAdminIntro(onComplete) {
  const reveal = () => { if (onComplete) onComplete(); };

  if (sessionStorage.getItem("adminIntroShown") === "1") {
    // Sudah pernah ditonton di sesi tab ini — langsung ke panel tanpa intro lagi.
    reveal();
    return;
  }
  sessionStorage.setItem("adminIntroShown", "1");

  const overlay = document.getElementById("adminIntroOverlay");
  const video   = document.getElementById("adminIntroVideo");
  const skipBtn = document.getElementById("adminIntroSkip");
  const muteBtn = document.getElementById("adminIntroMute");

  overlay.classList.remove("fade-out");
  overlay.style.display = "flex";

  try { video.currentTime = 0; } catch (_) {}

  function setMuteIcon(isMuted) {
    muteBtn.innerHTML = isMuted
      ? '<i class="fas fa-volume-xmark"></i>'
      : '<i class="fas fa-volume-high"></i>';
    muteBtn.classList.toggle("aic-mute-hint", isMuted);
  }

  // Coba putar DENGAN suara dulu (baru saja ada interaksi login = user gesture).
  // Kalau browser tetap memblokir autoplay bersuara, baru fallback ke mute
  // supaya videonya tetap jalan (bukan macet), dengan tombol jelas buat
  // mengaktifkan suara secara manual.
  video.muted = false;
  video.removeAttribute("muted");
  setMuteIcon(false);

  const playPromise = video.play();
  if (playPromise && playPromise.then) {
    playPromise.catch(() => {
      video.muted = true;
      setMuteIcon(true);
      video.play().catch(() => {});
    });
  }

  function unmute() {
    video.muted = false;
    setMuteIcon(false);
  }

  let closed = false;
  function closeIntro() {
    if (closed) return;
    closed = true;
    overlay.classList.add("fade-out");
    video.pause();
    reveal(); // panel admin dimunculkan begitu intro mulai fade-out (cross-fade halus)
    setTimeout(() => { overlay.style.display = "none"; }, 620);
  }

  muteBtn.onclick = () => {
    if (video.muted) { unmute(); } else { video.muted = true; setMuteIcon(true); }
  };
  // Tap di mana saja pada video juga mengaktifkan suara (kalau lagi mute) —
  // pola umum yang sudah familiar (seperti TikTok/Instagram).
  video.onclick = () => { if (video.muted) unmute(); };

  skipBtn.onclick = closeIntro;
  video.onended = closeIntro;
}

async function loadAdminUsers() {
  const listEl = document.getElementById("adminUserList");
  listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">Memuat...</p>';
  try {
    const snap = await db.collection("users").get();
    allAdminUsers = [];
    snap.forEach(doc => allAdminUsers.push({ uid: doc.id, ...doc.data() }));
    applyAdminSearch();
  } catch (e) {
    listEl.innerHTML = '<p style="color:#f87171;text-align:center;padding:20px;">Gagal memuat data: ' + (e.message || e) + '</p>';
  }
}

function applyAdminSearch() {
  const q = document.getElementById("adminSearchInput").value.trim().toLowerCase();
  const filtered = !q ? allAdminUsers : allAdminUsers.filter(u =>
    (u.username && u.username.toLowerCase().includes(q)) ||
    (u.email && u.email.toLowerCase().includes(q))
  );
  renderAdminUsers(filtered);
}

document.getElementById("adminSearchInput").addEventListener("input", applyAdminSearch);

function renderAdminUsers(list) {
  const listEl = document.getElementById("adminUserList");
  if (list.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">Tidak ada akun ditemukan.</p>';
    return;
  }
  listEl.innerHTML = "";
  list.forEach(u => {
    const unlimited = hasUnlimitedAccess(u);
    const item = document.createElement("div");
    item.className = "admin-user-item";
    item.innerHTML = `
      <div class="au-top">
        <div>
          <div class="au-name">@${u.username || "-"}</div>
          <div class="au-email">${u.email || "-"}</div>
        </div>
        <div class="plan-badge ${u.plan || "free"}">${(u.plan || "free").toUpperCase()}</div>
      </div>
      <div class="au-meta">
        ${unlimited ? "Aktif sampai " + formatDate(u.planExpire) : "Tidak ada paket aktif"}
      </div>
      <div class="admin-user-actions">
        <button class="silver-action" data-uid="${u.uid}" data-action="silver">7 Hari Silver</button>
        <button class="gold-action" data-uid="${u.uid}" data-action="gold">30 Hari Gold</button>
        <button class="platinum-action" data-uid="${u.uid}" data-action="platinum">1 Tahun Platinum</button>
        <button class="reset-action" data-uid="${u.uid}" data-action="reset">Reset Free</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAdminAction(btn.dataset.uid, btn.dataset.action, btn));
  });
}

async function handleAdminAction(uid, action, btn) {
  const allButtons = btn.closest(".admin-user-actions").querySelectorAll("button");
  allButtons.forEach(b => b.disabled = true);
  const oldLabel = btn.textContent;
  btn.textContent = "...";

  try {
    let data;
    if (action === "reset") {
      data = { plan: "free", planExpire: null };
    } else {
      const plan = PLANS[action];
      data = { plan: action, planExpire: Date.now() + plan.days * 24 * 60 * 60 * 1000 };
    }
    await db.collection("users").doc(uid).update(data);
    await loadAdminUsers();
  } catch (e) {
    alert("Gagal update: " + (e.message || e));
    allButtons.forEach(b => b.disabled = false);
    btn.textContent = oldLabel;
  }
}

/* ==================== ATUR HARGA PAKET (Admin) ==================== */
function fillAdminPriceInputs() {
  const silverEl = document.getElementById("priceSilverInput");
  const goldEl = document.getElementById("priceGoldInput");
  const platinumEl = document.getElementById("pricePlatinumInput");
  if (!silverEl) return; // belum masuk admin panel

  if (document.activeElement !== silverEl) silverEl.value = PLANS.silver.price ?? "";
  if (document.activeElement !== goldEl) goldEl.value = PLANS.gold.price ?? "";
  if (document.activeElement !== platinumEl) platinumEl.value = PLANS.platinum.price ?? "";
}

document.getElementById("priceSaveBtn").addEventListener("click", async () => {
  const silverEl = document.getElementById("priceSilverInput");
  const goldEl = document.getElementById("priceGoldInput");
  const platinumEl = document.getElementById("pricePlatinumInput");
  const msgEl = document.getElementById("priceAdminMsg");
  const btn = document.getElementById("priceSaveBtn");

  hideMsg(msgEl);

  const silver = parseInt(silverEl.value, 10);
  const gold = parseInt(goldEl.value, 10);
  const platinumRaw = platinumEl.value.trim();
  const platinum = platinumRaw === "" ? null : parseInt(platinumRaw, 10);

  if (!silver || silver < 0) {
    showMsg(msgEl, "Harga Silver harus angka positif.", "error");
    return;
  }
  if (!gold || gold < 0) {
    showMsg(msgEl, "Harga Gold harus angka positif.", "error");
    return;
  }
  if (platinumRaw !== "" && (!platinum || platinum < 0)) {
    showMsg(msgEl, "Harga Platinum harus angka positif, atau kosongkan.", "error");
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';

  try {
    await db.collection("settings").doc("prices").set({
      silver, gold, platinum, updatedAt: Date.now()
    }, { merge: true });
    showMsg(msgEl, "Harga paket berhasil disimpan & langsung berlaku ke semua user.", "success");
  } catch (e) {
    showMsg(msgEl, "Gagal menyimpan harga: " + (e.message || e), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldLabel;
  }
});

/* ==================== KELOLA VOUCHER (Admin) ==================== */
let allAdminVouchers = [];

async function loadAdminVouchers() {
  const listEl = document.getElementById("adminVoucherList");
  listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:14px;">Memuat voucher...</p>';
  try {
    const snap = await db.collection("vouchers").get();
    allAdminVouchers = [];
    snap.forEach(doc => allAdminVouchers.push({ code: doc.id, ...doc.data() }));
    renderAdminVouchers();
  } catch (e) {
    listEl.innerHTML = '<p style="color:#f87171;text-align:center;padding:14px;">Gagal memuat voucher: ' + (e.message || e) + '</p>';
  }
}

function renderAdminVouchers() {
  const listEl = document.getElementById("adminVoucherList");
  if (allAdminVouchers.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:14px;">Belum ada voucher.</p>';
    return;
  }
  listEl.innerHTML = "";
  allAdminVouchers.forEach(v => {
    const expired = v.expiresAt && Date.now() > v.expiresAt;
    const isLive = v.active && !expired;

    let statusLabel = "AKTIF";
    let statusClass = "gold";
    if (!v.active) { statusLabel = "NONAKTIF"; statusClass = ""; }
    else if (expired) { statusLabel = "KADALUARSA"; statusClass = ""; }

    const durasiText = v.expiresAt
      ? (expired ? "Kadaluarsa sejak " + formatDate(v.expiresAt) : "Berlaku sampai " + formatDate(v.expiresAt))
      : "Tanpa batas waktu";

    const usedCount = v.usedCount || 0;
    const usageText = v.maxUses ? `Dipakai ${usedCount}/${v.maxUses}` : `Dipakai ${usedCount}x`;
    const limitReached = v.maxUses && usedCount >= v.maxUses;

    const item = document.createElement("div");
    item.className = "admin-user-item";
    item.innerHTML = `
      <div class="au-top">
        <div>
          <div class="au-name">${v.code}</div>
          <div class="au-email">Diskon ${v.discount}% · ${durasiText} · ${usageText}</div>
        </div>
        <div class="plan-badge ${statusClass}">${limitReached ? "HABIS" : statusLabel}</div>
      </div>
      <div class="admin-user-actions">
        <button class="toggle-action" data-code="${v.code}" data-action="toggle" ${expired ? "disabled" : ""}>
          ${v.active ? "Nonaktifkan" : "Aktifkan"}
        </button>
        <button class="delete-action" data-code="${v.code}" data-action="delete">Hapus</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleVoucherAction(btn.dataset.code, btn.dataset.action, btn));
  });
}

async function handleVoucherAction(code, action, btn) {
  const allButtons = btn.closest(".admin-user-actions").querySelectorAll("button");
  allButtons.forEach(b => b.disabled = true);
  const oldLabel = btn.textContent;
  btn.textContent = "...";

  try {
    if (action === "delete") {
      await db.collection("vouchers").doc(code).delete();
    } else {
      const current = allAdminVouchers.find(v => v.code === code);
      await db.collection("vouchers").doc(code).update({ active: !current.active });
    }
    await loadAdminVouchers();
  } catch (e) {
    alert("Gagal update voucher: " + (e.message || e));
    allButtons.forEach(b => b.disabled = false);
    btn.textContent = oldLabel;
  }
}

document.getElementById("voucherCreateBtn").addEventListener("click", async () => {
  const codeInput = document.getElementById("voucherCodeInput");
  const discountInput = document.getElementById("voucherDiscountInput");
  const durationInput = document.getElementById("voucherDurationInput");
  const maxUsesInput = document.getElementById("voucherMaxUsesInput");
  const msgEl = document.getElementById("voucherAdminMsg");
  const btn = document.getElementById("voucherCreateBtn");

  hideMsg(msgEl);

  const code = codeInput.value.trim().toUpperCase();
  const discount = parseInt(discountInput.value, 10);
  const durationDays = durationInput.value.trim() === "" ? null : parseInt(durationInput.value, 10);
  const maxUses = maxUsesInput.value.trim() === "" ? null : parseInt(maxUsesInput.value, 10);

  if (!code || !/^[A-Z0-9_]+$/.test(code)) {
    showMsg(msgEl, "Kode voucher hanya boleh huruf, angka, underscore.", "error");
    return;
  }
  if (!discount || discount < 1 || discount > 99) {
    showMsg(msgEl, "Diskon harus antara 1-99%.", "error");
    return;
  }
  if (durationInput.value.trim() !== "" && (!durationDays || durationDays < 1)) {
    showMsg(msgEl, "Durasi harus angka positif, atau kosongkan untuk tanpa batas waktu.", "error");
    return;
  }
  if (maxUsesInput.value.trim() !== "" && (!maxUses || maxUses < 1)) {
    showMsg(msgEl, "Maks pemakaian harus angka positif, atau kosongkan untuk tanpa batas.", "error");
    return;
  }

  const expiresAt = durationDays ? Date.now() + durationDays * 24 * 60 * 60 * 1000 : null;

  btn.disabled = true;
  const oldLabel = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';

  try {
    await db.collection("vouchers").doc(code).set({
      discount,
      active: true,
      expiresAt,
      maxUses,
      usedCount: 0,
      createdAt: Date.now()
    });
    showMsg(msgEl, `Voucher ${code} (${discount}%) berhasil dibuat` +
      (expiresAt ? `, berlaku ${durationDays} hari` : ", tanpa batas waktu") +
      (maxUses ? `, maks ${maxUses}x pakai.` : ", tanpa batas pemakaian."), "success");
    codeInput.value = "";
    discountInput.value = "";
    durationInput.value = "";
    maxUsesInput.value = "";
    await loadAdminVouchers();
  } catch (e) {
    showMsg(msgEl, "Gagal membuat voucher: " + (e.message || e), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldLabel;
  }
});

/* ==================== KELOLA PENGUMUMAN (Admin) ==================== */
let allAdminAnnouncements = [];

async function loadAdminAnnouncements() {
  const listEl = document.getElementById("adminAnnounceList");
  listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:14px;">Memuat pengumuman...</p>';
  try {
    const snap = await db.collection("announcements").get();
    allAdminAnnouncements = [];
    snap.forEach(doc => allAdminAnnouncements.push({ id: doc.id, ...doc.data() }));
    allAdminAnnouncements.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderAdminAnnouncements();
  } catch (e) {
    listEl.innerHTML = '<p style="color:#f87171;text-align:center;padding:14px;">Gagal memuat pengumuman: ' + (e.message || e) + '</p>';
  }
}

function renderAdminAnnouncements() {
  const listEl = document.getElementById("adminAnnounceList");
  if (allAdminAnnouncements.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:14px;">Belum ada pengumuman.</p>';
    return;
  }
  listEl.innerHTML = "";
  allAdminAnnouncements.forEach(a => {
    const item = document.createElement("div");
    item.className = "admin-user-item";
    item.innerHTML = `
      <div class="au-top">
        <div style="flex:1;">
          <div class="au-name" style="font-weight:600;">${escapeHtml(a.message)}</div>
          <div class="au-email">${formatDate(a.createdAt)}</div>
        </div>
        <div class="plan-badge ${a.active ? "gold" : ""}">${a.active ? "TAMPIL" : "TERSEMBUNYI"}</div>
      </div>
      <div class="admin-user-actions">
        <button class="announce-toggle" data-id="${a.id}" data-action="toggle">
          ${a.active ? "Sembunyikan" : "Tampilkan"}
        </button>
        <button class="delete-action" data-id="${a.id}" data-action="delete">Hapus</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAnnouncementAction(btn.dataset.id, btn.dataset.action, btn));
  });
}

async function handleAnnouncementAction(id, action, btn) {
  const allButtons = btn.closest(".admin-user-actions").querySelectorAll("button");
  allButtons.forEach(b => b.disabled = true);
  const oldLabel = btn.textContent;
  btn.textContent = "...";

  try {
    if (action === "delete") {
      await db.collection("announcements").doc(id).delete();
    } else {
      const current = allAdminAnnouncements.find(a => a.id === id);
      await db.collection("announcements").doc(id).update({ active: !current.active });
    }
    await loadAdminAnnouncements();
  } catch (e) {
    alert("Gagal update pengumuman: " + (e.message || e));
    allButtons.forEach(b => b.disabled = false);
    btn.textContent = oldLabel;
  }
}

document.getElementById("announceCreateBtn").addEventListener("click", async () => {
  const textInput = document.getElementById("announceTextInput");
  const msgEl = document.getElementById("announceAdminMsg");
  const btn = document.getElementById("announceCreateBtn");

  hideMsg(msgEl);

  const message = textInput.value.trim();
  if (!message) {
    showMsg(msgEl, "Isi pengumuman tidak boleh kosong.", "error");
    return;
  }
  if (message.length > 300) {
    showMsg(msgEl, "Pengumuman maksimal 300 karakter.", "error");
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';

  try {
    await db.collection("announcements").add({
      message,
      active: true,
      createdAt: Date.now()
    });
    showMsg(msgEl, "Pengumuman berhasil dikirim & langsung tampil ke semua user.", "success");
    textInput.value = "";
    await loadAdminAnnouncements();
  } catch (e) {
    showMsg(msgEl, "Gagal mengirim pengumuman: " + (e.message || e), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldLabel;
  }
});

/* ==================== AUTH STATE (sesi otomatis) ==================== */
auth.onAuthStateChanged(async (user) => {
  if (user) {
    await attachUserListener(user.uid);

    if (adminModeRequested) {
      adminModeRequested = false;
      const isAdmin = await checkIsAdmin(user.uid);
      if (isAdmin) {
        closeAdminLoginModal();
        enterAdminPanel();
      } else {
        showMsg(adminLoginMsg, "Akun ini bukan admin.", "error");
        await auth.signOut();
      }
    } else {
      enterApp();
    }
  } else {
    currentUserData = null;
    if (unsubscribeUserDoc) { unsubscribeUserDoc(); unsubscribeUserDoc = null; }
    if (unsubscribeAnnouncements) { unsubscribeAnnouncements(); unsubscribeAnnouncements = null; }
    authScreen.style.display = "";
    appScreen.style.display = "none";
    adminScreen.style.display = "none";
  }
});

function refreshUI() {
  const user = getCurrentUser();
  if (!user) return;

  displayUser.textContent = "@" + user.username;

  const unlimited = hasUnlimitedAccess(user);
  creditValue.textContent = unlimited ? "Unlimited" : "Terkunci";
  creditValue.classList.toggle("active", unlimited);

  planBadge.textContent = (user.plan || "free").toUpperCase();
  planBadge.className = "plan-badge " + (user.plan || "free");

  if (unlimited) {
    planExpire.textContent = "Aktif sampai " + formatDate(user.planExpire);
  } else {
    planExpire.textContent = "Tidak ada paket aktif";
  }

  // Halaman Profil
  document.getElementById("profileAvatar").textContent = user.username.charAt(0);
  document.getElementById("profileUsername").textContent = "@" + user.username;
  document.getElementById("profileEmail").textContent = user.email;

  const profilePlanBadge = document.getElementById("profilePlanBadge");
  profilePlanBadge.textContent = (user.plan || "free").toUpperCase();
  profilePlanBadge.className = "plan-badge " + (user.plan || "free");

  document.getElementById("profilePlanExpire").textContent = unlimited
    ? "Aktif sampai " + formatDate(user.planExpire)
    : "Tidak ada paket aktif";
}

/* ==================== NAVIGASI (Bottom Nav + Subpage) ==================== */
let lastMainPage = "home";

function goToMainPage(pageKey) {
  lastMainPage = pageKey;
  document.querySelectorAll(".bnav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.page === pageKey);
  });
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page" + pageKey.charAt(0).toUpperCase() + pageKey.slice(1)).classList.add("active");
}

document.querySelectorAll(".bnav-item").forEach(btn => {
  btn.addEventListener("click", () => goToMainPage(btn.dataset.page));
});

function openPackagesSubpage() {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("pagePackages").classList.add("active");
}

function closePackagesSubpage() {
  goToMainPage(lastMainPage);
}

document.getElementById("qaActivate").addEventListener("click", () => goToMainPage("activate"));
document.getElementById("qaPackage").addEventListener("click", openPackagesSubpage);
document.getElementById("profileOrderBtn").addEventListener("click", openPackagesSubpage);
document.getElementById("packagesBackBtn").addEventListener("click", closePackagesSubpage);

/* ==================== API ERROR PARSER ==================== */
function describeFetchError(err) {
  const raw = (err && err.message) || String(err);
  let hint = "Gagal terhubung ke server aktivasi.";
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    hint = "Server aktivasi tidak bisa dihubungi dari browser (kemungkinan server sedang down, atau belum mengizinkan akses dari domain website ini/CORS).";
  } else if (/json/i.test(raw)) {
    hint = "Server aktivasi mengirim balasan yang formatnya tidak sesuai (bukan JSON).";
  }
  return `${hint} [Detail: ${raw}]`;
}

function parseApiError(data) {
  if (!data) return "Terjadi kesalahan tidak diketahui.";
  if (typeof data.error === "object" && data.error !== null) {
    const msg = data.error.message || "";
    if (msg.includes("QUOTA_EXCEEDED") || msg.toLowerCase().includes("quota")) {
      return "Kuota server sedang penuh. Coba lagi beberapa saat.";
    }
    if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("not found")) {
      return "Email tidak valid atau tidak ditemukan.";
    }
    return msg || "Gagal memproses permintaan.";
  }
  if (typeof data.error === "string") {
    if (data.error.includes("QUOTA_EXCEEDED") || data.error.toLowerCase().includes("quota")) {
      return "Kuota server sedang penuh. Coba lagi beberapa saat.";
    }
    try {
      const parsed = JSON.parse(data.error);
      if (parsed?.error?.message) return parseApiError({ error: parsed.error });
    } catch (_) {}
    return data.error;
  }
  if (data.message) return data.message;
  return "Gagal memproses permintaan.";
}

/* ==================== SEND MAGIC LINK ==================== */
sendBtn.addEventListener("click", async () => {
  const user = getCurrentUser();
  if (!user) return;

  if (!hasUnlimitedAccess(user)) {
    showMsg(msgBox, "Kamu belum punya paket aktif. Order paket Silver atau Gold dulu di menu Paket untuk bisa aktivasi AM Prem.", "error");
    return;
  }

  const email = emailInput.value.trim();
  if (!email || !email.includes("@")) {
    showMsg(msgBox, "Masukkan alamat email yang valid.", "error");
    emailInput.focus();
    return;
  }

  const oldText = sendBtn.textContent;
  sendBtn.innerHTML = '<div class="loader"></div>';
  sendBtn.disabled = true;
  hideMsg(msgBox);

  try {
    const url = `${AM_SEND_API}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (res.ok && data.status !== false && data.error == null) {
      cachedEmail = email;
      showMsg(msgBox, "Magic Link berhasil dikirim. Silakan cek inbox email kamu.", "success");
      magicInput.focus();
      sendBtn.classList.add("sent");
      sendBtn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        sendBtn.textContent = oldText;
        sendBtn.classList.remove("sent");
        sendBtn.disabled = false;
      }, 2200);
    } else {
      showMsg(msgBox, parseApiError(data), "error");
      sendBtn.textContent = oldText;
      sendBtn.disabled = false;
    }
  } catch (err) {
    showMsg(msgBox, describeFetchError(err), "error");
    sendBtn.textContent = oldText;
    sendBtn.disabled = false;
  }
});

/* ==================== ACTIVATE ==================== */
activateBtn.addEventListener("click", async () => {
  const user = getCurrentUser();
  if (!user) return;

  if (!hasUnlimitedAccess(user)) {
    showMsg(msgBox, "Kamu belum punya paket aktif. Order paket Silver atau Gold dulu di menu Paket untuk bisa aktivasi AM Prem.", "error");
    return;
  }

  const email = emailInput.value.trim();
  const magic = magicInput.value.trim();

  if (!email || !magic) {
    showMsg(msgBox, "Email dan Magic Link wajib diisi.", "error");
    return;
  }
  if (!magic.startsWith("http")) {
    showMsg(msgBox, "Magic Link harus berupa URL yang valid.", "error");
    magicInput.focus();
    return;
  }

  const emailToUse = cachedEmail || email;

  btnText.innerHTML = '<div class="loader"></div> Menghubungkan...';
  activateBtn.disabled = true;
  hideMsg(msgBox);

  try {
    const url = `${AM_VERIFY_API}&email=${encodeURIComponent(emailToUse)}&magiclink=${encodeURIComponent(magic)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (res.ok && data.status !== false && data.error == null) {
      const successText = "Lisensi Premium berhasil diaktifkan. Paket " + user.plan.toUpperCase() +
        " aktif sampai " + formatDate(user.planExpire) + ".";

      activateBtn.classList.add("success-state");
      btnText.innerHTML = '<i class="fas fa-circle-check"></i> Berhasil Diaktifkan!';
      showMsg(msgBox, successText, "success");
      cachedEmail = "";
      celebrateSuccess();
    } else {
      showMsg(msgBox, parseApiError(data), "error");
      btnText.innerHTML = '<i class="fas fa-shield-halved"></i> Verifikasi & Aktifkan';
      activateBtn.disabled = false;
    }
  } catch (err) {
    showMsg(msgBox, describeFetchError(err), "error");
    btnText.innerHTML = '<i class="fas fa-shield-halved"></i> Verifikasi & Aktifkan';
    activateBtn.disabled = false;
  }
});

/* ==================== VOUCHER (User) ==================== */
let appliedVoucher = null; // { code, discount }

function getDiscountedPrice(price) {
  if (!appliedVoucher || price == null) return price;
  return Math.round(price * (1 - appliedVoucher.discount / 100));
}

function updatePackagePrices() {
  const silverEl = document.getElementById("silverPrice");
  const goldEl = document.getElementById("goldPrice");

  if (appliedVoucher) {
    const silverNew = getDiscountedPrice(PLANS.silver.price);
    const goldNew = getDiscountedPrice(PLANS.gold.price);
    silverEl.innerHTML = `<span class="pkg-price-old">${formatRp(PLANS.silver.price)}</span><span class="pkg-price-new">${formatRp(silverNew)}</span>`;
    goldEl.innerHTML = `<span class="pkg-price-old">${formatRp(PLANS.gold.price)}</span><span class="pkg-price-new">${formatRp(goldNew)}</span>`;
  } else {
    silverEl.textContent = formatRp(PLANS.silver.price);
    goldEl.textContent = formatRp(PLANS.gold.price);
  }
}

document.getElementById("voucherApplyBtn").addEventListener("click", async () => {
  const input = document.getElementById("voucherInput");
  const msgEl = document.getElementById("voucherMsg");
  const btn = document.getElementById("voucherApplyBtn");
  const code = input.value.trim().toUpperCase();

  hideMsg(msgEl);

  if (!code) {
    appliedVoucher = null;
    updatePackagePrices();
    showMsg(msgEl, "Voucher dihapus.", "success");
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.innerHTML = '<div class="loader"></div>';

  try {
    const snap = await db.collection("vouchers").doc(code).get();
    if (!snap.exists) {
      appliedVoucher = null;
      updatePackagePrices();
      showMsg(msgEl, "Kode voucher tidak ditemukan.", "error");
      return;
    }
    const v = snap.data();
    const expired = v.expiresAt && Date.now() > v.expiresAt;
    const limitReached = v.maxUses && (v.usedCount || 0) >= v.maxUses;
    if (!v.active || expired) {
      appliedVoucher = null;
      updatePackagePrices();
      showMsg(msgEl, expired ? "Kode voucher sudah kadaluarsa." : "Kode voucher sudah tidak aktif.", "error");
      return;
    }
    if (limitReached) {
      appliedVoucher = null;
      updatePackagePrices();
      showMsg(msgEl, "Voucher ini sudah mencapai batas maksimal pemakaian.", "error");
      return;
    }
    appliedVoucher = { code, discount: v.discount };
    updatePackagePrices();
    showMsg(msgEl, `Voucher ${code} berhasil dipakai! Diskon ${appliedVoucher.discount}%.`, "success");
  } catch (e) {
    showMsg(msgEl, "Gagal memeriksa voucher. Coba lagi.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
});

/* ==================== ORDER PAKET VIA WHATSAPP ==================== */
document.querySelectorAll(".btn-pkg").forEach(btn => {
  btn.addEventListener("click", async () => {
    const planKey = btn.dataset.plan;
    const plan = PLANS[planKey];
    if (!plan) return;

    const user = getCurrentUser();
    if (!user) {
      alert("Silakan login dulu.");
      return;
    }

    const finalPrice = getDiscountedPrice(plan.price);
    let text =
      `Bg Dinn saya mau order paket ${plan.name} di Adin AM Premium\n\n` +
      `Username: ${user.username}\n` +
      `Email: ${user.email}`;

    if (appliedVoucher) {
      try {
        const voucherRef = db.collection("vouchers").doc(appliedVoucher.code);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(voucherRef);
          if (!snap.exists) throw new Error("Voucher tidak ditemukan.");
          const v = snap.data();
          const used = v.usedCount || 0;
          if (v.maxUses && used >= v.maxUses) throw new Error("LIMIT_REACHED");
          tx.update(voucherRef, { usedCount: used + 1 });
        });
      } catch (e) {
        if (e && e.message === "LIMIT_REACHED") {
          alert("Voucher ini baru saja mencapai batas maksimal pemakaian. Silakan order tanpa voucher atau pakai kode lain.");
          appliedVoucher = null;
          updatePackagePrices();
        } else {
          alert("Gagal memproses voucher: " + (e.message || e));
        }
        return;
      }

      text += `\nVoucher: ${appliedVoucher.code} (diskon ${appliedVoucher.discount}%)\n` +
        `Harga: ${formatRp(finalPrice)} (harga normal ${formatRp(plan.price)})`;
    } else {
      text += `\nHarga: ${formatRp(plan.price)}`;
    }

    openOrderChoiceModal(plan, appliedVoucher ? finalPrice : plan.price, text);
  });
});

function openOrderChoiceModal(plan, priceToShow, waText) {
  const modal = document.getElementById("orderChoiceModal");
  const summary = document.getElementById("orderChoiceSummary");
  const ownerBtn = document.getElementById("orderChoiceOwner");
  const adminBtn = document.getElementById("orderChoiceAdmin");
  const cancelBtn = document.getElementById("orderChoiceCancel");

  summary.textContent = `Paket ${plan.name} — ${formatRp(priceToShow)}`;
  modal.style.display = "flex";

  function close() { modal.style.display = "none"; }

  function goTo(number) {
    const url = `https://wa.me/${number}?text=${encodeURIComponent(waText)}`;
    window.open(url, "_blank", "noopener");
    close();
  }

  ownerBtn.onclick = () => goTo(OWNER_WA);
  adminBtn.onclick = () => goTo(SUB_ADMIN_WA);
  cancelBtn.onclick = close;
  modal.querySelector(".modal-backdrop").onclick = close;
}

/* ==================== KEYBOARD ==================== */
emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});
magicInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") activateBtn.click();
});

document.getElementById("loginPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});
document.getElementById("regPass2").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("registerBtn").click();
});
document.getElementById("forgotEmail").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("forgotPassBtn2").click();
});

/* ==================== INIT ====================
   Sesi login sekarang ditangani otomatis oleh Firebase Auth
   lewat listener auth.onAuthStateChanged() di atas. */
