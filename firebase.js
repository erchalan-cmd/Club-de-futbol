import { firebaseConfig } from "./firebase-config.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const isConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.startsWith("REEMPLAZA_")
);
const firebaseApp = isConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
const auth = firebaseApp ? getAuth(firebaseApp) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;

const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authMessage = document.querySelector("#authMessage");
const displayNameField = document.querySelector("#displayNameField");
const confirmPasswordField = document.querySelector("#confirmPasswordField");
const authModeButton = document.querySelector("#authModeButton");
const authSubmitButton = document.querySelector("#authSubmitButton");
let authMode = "register";
let stopWatchingUserData = [];

function setAuthMessage(message) {
  if (authMessage) authMessage.textContent = message;
  document.querySelectorAll("[data-firebase-status]").forEach((element) => {
    element.textContent = message;
  });
}

function setSyncStatus(message) {
  document.querySelectorAll("[data-sync-status]").forEach((element) => {
    element.textContent = message;
  });
}

function presentError(action, error) {
  console.error(`${action}:`, error);
  setAuthMessage(`${action}: ${error.message || "Error desconocido."}`);
  setSyncStatus(`${action}: ${error.message || "Error desconocido."}`);
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegistering = mode === "register";
  displayNameField.hidden = !isRegistering;
  confirmPasswordField.hidden = !isRegistering;
  document.querySelector("#authName").required = isRegistering;
  document.querySelector("#authConfirmPassword").required = isRegistering;
  document.querySelector("#authTitle").textContent = isRegistering ? "Crea tu cuenta" : "Inicia sesión";
  document.querySelector("#authDescription").textContent = isRegistering
    ? "Regístrate para guardar tus partidos y estadísticas."
    : "Accede para continuar tu campeonato y ver tus estadísticas.";
  authSubmitButton.textContent = isRegistering ? "Crear cuenta" : "Iniciar sesión";
  authModeButton.textContent = isRegistering
    ? "¿Ya tienes una cuenta? Inicia sesión"
    : "¿Aún no tienes cuenta? Regístrate";
  authForm.reset();
  setAuthMessage("");
}

function emitAuthState(user) {
  document.dispatchEvent(new CustomEvent("firebase-auth-state", { detail: { user } }));
}

function updateAccountUI(user) {
  document.querySelectorAll("[data-auth-open]").forEach((button) => {
    button.hidden = Boolean(user);
  });
  document.querySelectorAll("[data-signed-in]").forEach((element) => {
    element.hidden = !user;
  });
  document.querySelectorAll("[data-signed-out]").forEach((element) => {
    element.hidden = Boolean(user);
  });
  document.querySelectorAll("[data-account-name]").forEach((element) => {
    element.textContent = user?.displayName || user?.email || "";
  });
}

async function ensureUserRecords(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);
  const displayName = user.displayName || user.email || "Jugador";
  const playerRef = doc(db, "users", user.uid, "players", user.uid);
  const batch = writeBatch(db);
  const profile = {
    uid: user.uid,
    email: user.email || "",
    displayName,
    updatedAt: serverTimestamp()
  };
  const player = {
    uid: user.uid,
    email: user.email || "",
    name: displayName,
    updatedAt: serverTimestamp()
  };
  if (!userSnapshot.exists()) {
    profile.createdAt = serverTimestamp();
    player.createdAt = serverTimestamp();
  }
  batch.set(userRef, profile, { merge: true });
  batch.set(playerRef, player, { merge: true });
  await batch.commit();
}

function renderStat(name, value) {
  document.querySelectorAll(`[data-stat="${name}"]`).forEach((element) => {
    element.textContent = String(value ?? 0);
  });
}

function renderLiveList(selector, items, formatter, emptyMessage) {
  document.querySelectorAll(selector).forEach((list) => {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("li");
      empty.textContent = emptyMessage;
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("li");
      row.textContent = formatter(item);
      list.append(row);
    });
  });
}

function formatRecentMatch(snapshot) {
  const match = snapshot.data();
  return `${match.teamFlag || ""} ${match.teamName} ${match.goalsScored}–${match.goalsConceded} ${match.opponentFlag || ""} ${match.opponentName} · ${match.round}`;
}

function startWatchingUserData(user) {
  stopWatchingUserData.forEach((stop) => stop());
  stopWatchingUserData = [];
  setSyncStatus("Conectando con Firestore…");

  const userRef = doc(db, "users", user.uid);
  const statsRef = doc(userRef, "statistics", "summary");
  stopWatchingUserData.push(onSnapshot(statsRef, (snapshot) => {
    const stats = snapshot.data() || {};
    renderStat("matchesPlayed", stats.matchesPlayed);
    renderStat("matchesWon", stats.matchesWon);
    renderStat("goalsScored", stats.goalsScored);
    renderStat("goalsConceded", stats.goalsConceded);
    renderStat("championshipsWon", stats.championshipsWon);
    setSyncStatus("Estadísticas sincronizadas en tiempo real.");
  }, (error) => presentError("No se pudieron leer las estadísticas", error)));

  stopWatchingUserData.push(onSnapshot(collection(userRef, "players"), (snapshot) => {
    renderStat("playersCount", snapshot.size);
  }, (error) => presentError("No se pudieron leer los jugadores", error)));

  stopWatchingUserData.push(onSnapshot(collection(userRef, "teams"), (snapshot) => {
    renderStat("teamsCount", snapshot.size);
  }, (error) => presentError("No se pudieron leer los equipos", error)));

  const recentMatches = query(collection(userRef, "matches"), orderBy("createdAt", "desc"), limit(5));
  stopWatchingUserData.push(onSnapshot(recentMatches, (snapshot) => {
    renderLiveList("#recentMatches", snapshot.docs, formatRecentMatch, "Tus partidos aparecerán aquí.");
  }, (error) => presentError("No se pudieron leer los partidos", error)));

  const recentScorers = query(collection(userRef, "scorers"), orderBy("createdAt", "desc"), limit(5));
  stopWatchingUserData.push(onSnapshot(recentScorers, (snapshot) => {
    renderLiveList(
      "#recentScorers",
      snapshot.docs,
      (entry) => {
        const scorer = entry.data();
        return `${scorer.teamFlag || ""} ${scorer.playerName} · ${scorer.teamName}`;
      },
      "Los goles registrados aparecerán aquí."
    );
  }, (error) => presentError("No se pudieron leer los goleadores", error)));
}

function teamDocumentId(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function saveCompletedMatch(detail) {
  if (!db || !auth?.currentUser) throw new Error("Debes iniciar sesión para guardar el partido.");

  const user = auth.currentUser;
  const userRef = doc(db, "users", user.uid);
  const matchRef = doc(collection(userRef, "matches"));
  const statsRef = doc(userRef, "statistics", "summary");
  const playerRef = doc(userRef, "players", user.uid);
  const teamId = teamDocumentId(detail.team.name);
  const opponentId = teamDocumentId(detail.opponent.name);
  const batch = writeBatch(db);

  for (const team of [detail.team, detail.opponent]) {
    const id = teamDocumentId(team.name);
    batch.set(doc(userRef, "teams", id), {
      teamId: id,
      name: team.name,
      flag: team.flag,
      primary: team.primary,
      secondary: team.secondary,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  batch.set(playerRef, {
    uid: user.uid,
    email: user.email || "",
    name: user.displayName || user.email || "Jugador",
    teamId,
    teamName: detail.team.name,
    updatedAt: serverTimestamp()
  }, { merge: true });

  batch.set(matchRef, {
    playerId: user.uid,
    playerName: user.displayName || user.email || "Jugador",
    tournamentId: detail.tournamentId,
    mode: detail.mode,
    round: detail.round,
    teamId,
    teamName: detail.team.name,
    teamFlag: detail.team.flag,
    opponentId,
    opponentName: detail.opponent.name,
    opponentFlag: detail.opponent.flag,
    goalsScored: detail.goalsScored,
    goalsConceded: detail.goalsConceded,
    result: detail.result,
    durationSeconds: detail.durationSeconds,
    champion: detail.champion,
    createdAt: serverTimestamp()
  });

  detail.scorers.forEach((side) => {
    const isPlayer = side === "player";
    const scorerRef = doc(collection(userRef, "scorers"));
    batch.set(scorerRef, {
      matchId: matchRef.id,
      playerId: isPlayer ? user.uid : null,
      playerName: isPlayer ? (user.displayName || user.email || "Jugador") : "Rival controlado por computadora",
      teamId: isPlayer ? teamId : opponentId,
      teamName: isPlayer ? detail.team.name : detail.opponent.name,
      teamFlag: isPlayer ? detail.team.flag : detail.opponent.flag,
      goals: 1,
      createdAt: serverTimestamp()
    });
  });

  batch.set(statsRef, {
    matchesPlayed: increment(1),
    matchesWon: increment(detail.result === "win" ? 1 : 0),
    goalsScored: increment(detail.goalsScored),
    goalsConceded: increment(detail.goalsConceded),
    championshipsWon: increment(detail.champion ? 1 : 0),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
}

document.querySelectorAll("[data-auth-open]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!auth || !db) {
      setAuthMessage("Configura firebase-config.js y publica las reglas de Firestore antes de usar las cuentas.");
    }
    setAuthMode("register");
    authDialog.showModal();
  });
});

document.querySelector("#authClose").addEventListener("click", () => authDialog.close());
authDialog.addEventListener("click", (event) => {
  if (event.target === authDialog) authDialog.close();
});
authModeButton.addEventListener("click", () => setAuthMode(authMode === "register" ? "login" : "register"));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authForm.reportValidity()) return;
  if (!auth || !db) {
    setAuthMessage("Configura firebase-config.js con tu proyecto de Firebase para habilitar el acceso.");
    return;
  }

  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;
  const name = document.querySelector("#authName").value.trim();
  const confirmation = document.querySelector("#authConfirmPassword").value;
  if (authMode === "register" && password !== confirmation) {
    setAuthMessage("Las contraseñas no coinciden.");
    return;
  }

  authSubmitButton.disabled = true;
  setAuthMessage(authMode === "register" ? "Creando cuenta…" : "Iniciando sesión…");
  try {
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      await ensureUserRecords(credential.user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    presentError(authMode === "register" ? "No se pudo crear la cuenta" : "No se pudo iniciar sesión", error);
  } finally {
    authSubmitButton.disabled = false;
  }
});

document.querySelectorAll("[data-sign-out]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      authDialog.close();
      setAuthMessage("");
    } catch (error) {
      presentError("No se pudo cerrar la sesión", error);
    }
  });
});

document.addEventListener("championship-match-finished", (event) => {
  saveCompletedMatch(event.detail).then(() => {
    setSyncStatus("Partido y estadísticas guardados en Firestore.");
  }).catch((error) => {
    presentError("No se pudo guardar el partido en Firestore", error);
  });
});

if (!auth || !db) {
  const message = "Firebase aún no está configurado. Completa firebase-config.js para habilitar las cuentas.";
  setAuthMessage(message);
  setSyncStatus(message);
  updateAccountUI(null);
  emitAuthState(null);
} else {
  onAuthStateChanged(auth, async (user) => {
    stopWatchingUserData.forEach((stop) => stop());
    stopWatchingUserData = [];
    updateAccountUI(user);
    if (!user) {
      emitAuthState(null);
      return;
    }

    try {
      await ensureUserRecords(user);
      startWatchingUserData(user);
      setAuthMessage("");
      if (authDialog.open) authDialog.close();
    } catch (error) {
      presentError("No se pudo preparar el perfil de Firestore", error);
    }
    emitAuthState(user);
  });
}
