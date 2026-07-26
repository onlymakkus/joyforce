/* Joyforce — Datenschicht
 * Portiert aus challenge.html / ranking.html / profile.html von onlymakkus.de.
 * Schreibt in dieselben Tabellen, mit derselben Logik. Keine eigenen Tabellen.
 */
(function () {
  'use strict';

  var SB_URL = 'https://bsubsesbcxdaqofmkiqg.supabase.co';
  var SB_KEY = 'sb_publishable_fA2Dca6SVp0eB8k_WuqLrw_zplTnXBU';
  var SESSION_KEY = 'om_profile_session';

  async function sbFetch(path, o) {
    o = o || {};
    var r = await fetch(SB_URL + path, Object.assign({}, o, {
      headers: Object.assign({
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        Prefer: o.prefer || ''
      }, o.headers || {})
    }));
    if (!r.ok) {
      var t = await r.text().catch(function () { return ''; });
      throw new Error('Supabase ' + r.status + ': ' + t);
    }
    if (r.status === 204) return null;
    return r.json();
  }

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  }

  /* ---------- Session ---------- */

  function session() {
    try { var raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  function logout() { localStorage.removeItem(SESSION_KEY); }

  async function login(name, password) {
    name = (name || '').trim();
    if (!name || !password) throw new Error('Name und Passwort eingeben.');

    var disc = null, h = name.indexOf('#');
    if (h > 0) { disc = name.slice(h + 1); name = name.slice(0, h); }

    var q = '/rest/v1/profiles?name=eq.' + encodeURIComponent(name) + '&select=*';
    if (disc) q += '&discriminator=eq.' + encodeURIComponent(disc);

    var rows = await sbFetch(q);
    if (!rows || !rows.length) throw new Error('Kein Profil mit diesem Namen.');
    if (rows.length > 1) throw new Error('Mehrere Profile — bitte mit Discriminator, z. B. ' + name + '#1234.');

    var p = rows[0];
    var bcrypt = (window.dcodeIO && window.dcodeIO.bcrypt) || window.bcrypt;
    if (!bcrypt) throw new Error('bcrypt nicht geladen.');
    if (!bcrypt.compareSync(password, p.password_hash)) throw new Error('Passwort stimmt nicht.');

    var s = {
      id: p.id, name: p.name, discriminator: p.discriminator,
      displayName: p.display_name, avatarUrl: p.avatar_url || null
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  /* ---------- Registrierung ----------
   * Eins zu eins portiert aus profile.html. Nicht "sinngemäß" nachgebaut:
   * dieselbe Discriminator-Vergabe, dieselbe bcrypt-Kostenstufe (10),
   * derselbe Recovery-Code, dieselbe Absicherung gegen Doppelprofile.
   */

  function generateRecoveryCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen (O/0, I/1)
    var code = '';
    for (var i = 0; i < 12; i++) {
      if (i > 0 && i % 4 === 0) code += '-';
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  async function generateUniqueDiscriminator(name) {
    for (var attempt = 0; attempt < 20; attempt++) {
      var code = String(Math.floor(1000 + Math.random() * 9000));
      var taken = await sbFetch('/rest/v1/profiles?name=eq.' + encodeURIComponent(name) +
        '&discriminator=eq.' + code + '&select=id');
      if (!taken || taken.length === 0) return code;
    }
    throw new Error('Konnte keinen freien Discriminator finden.');
  }

  async function register(name, displayNameInput, password) {
    name = (name || '').trim();
    var displayName = (displayNameInput || '').trim() || name;
    if (!name) throw new Error('Bitte einen Namen eingeben.');
    if (!password || password.length < 6) throw new Error('Passwort braucht mindestens 6 Zeichen.');

    var bcrypt = (window.dcodeIO && window.dcodeIO.bcrypt) || window.bcrypt;
    if (!bcrypt) throw new Error('bcrypt nicht geladen.');

    // Name schon vergeben? Dann bekommt das neue Profil einen Discriminator.
    var existingPlain = await sbFetch('/rest/v1/profiles?name=eq.' + encodeURIComponent(name) +
      '&discriminator=is.null&select=id');
    var discriminator = null, handle = null;
    if (existingPlain && existingPlain.length > 0) {
      discriminator = await generateUniqueDiscriminator(name);
      handle = name + '#' + discriminator;
    }

    var hash = bcrypt.hashSync(password, 10);
    await sbFetch('/rest/v1/profiles', {
      method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({ name: name, discriminator: discriminator, display_name: displayName, password_hash: hash })
    });

    var filter = discriminator
      ? 'name=eq.' + encodeURIComponent(name) + '&discriminator=eq.' + discriminator
      : 'name=eq.' + encodeURIComponent(name) + '&discriminator=is.null';
    var created = await sbFetch('/rest/v1/profiles?' + filter + '&select=id,name,discriminator,display_name,created_at');

    // Ohne diese Prüfung knallt created[0] als TypeError — NACHDEM das Profil
    // schon angelegt wurde. Der Nutzer sieht einen Fehler, registriert sich
    // nochmal und hat plötzlich zwei Profile.
    if (!created || !created.length) {
      throw new Error('Profil wurde angelegt, konnte aber nicht geladen werden — bitte anmelden statt neu registrieren.');
    }
    var p = created[0];

    var recoveryCode = generateRecoveryCode();
    await sbFetch('/rest/v1/profiles?id=eq.' + p.id, {
      method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ recovery_code_hash: bcrypt.hashSync(recoveryCode, 10) })
    });

    // Kein avatarUrl — es gibt noch keins. Wie in profile.html.
    var s = {
      id: p.id, name: p.name, discriminator: p.discriminator,
      displayName: p.display_name || p.name
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return { session: s, recoveryCode: recoveryCode, handle: handle };
  }

  /* ---------- Profile-Map (Avatare, Anzeigenamen) ---------- */

  var PROFILES = {};

  async function loadProfiles() {
    var rows = await sbFetch('/rest/v1/profiles?select=id,name,display_name,avatar_url');
    PROFILES = {};
    (rows || []).forEach(function (p) { PROFILES[p.id] = p; });
    return PROFILES;
  }

  function nameOf(profileId, fallback) {
    var p = PROFILES[profileId];
    return (p && (p.display_name || p.name)) || fallback || '—';
  }

  function avatarOf(profileId) {
    var p = PROFILES[profileId];
    return (p && p.avatar_url) || null;
  }

  /* ---------- Aktive Challenge ---------- */

  async function loadActiveChallenge() {
    var now = new Date(), m = now.getMonth() + 1, y = now.getFullYear();
    var rows = await sbFetch(
      '/rest/v1/season_months?season_year=eq.' + y + '&month=eq.' + m + '&select=*,exercises(*)'
    );
    if (!rows || !rows.length) return null;

    var row = rows[0];
    if (row.is_december_vote) {
      return { decemberVote: true, monthId: row.id, month: m, year: y };
    }
    var ex = row.exercises;
    if (!ex) return null;

    return {
      monthId: row.id,
      slug: slugify(ex.name),
      month: m,
      year: y,
      label: ex.name,
      icon: ex.icon,
      description: ex.description,
      goal: row.custom_goal || ex.default_goal || 60,
      unit: ex.default_unit || '',
      equipment: ex.equipment,
      kneeSafe: ex.knee_safe,
      videoUrl: ex.video_url,
      levels: [
        ex.level_beginner ? { level: 'Basis', text: ex.level_beginner } : null,
        ex.level_intermediate ? { level: 'Fortgeschritten', text: ex.level_intermediate } : null,
        ex.level_advanced ? { level: 'Profi', text: ex.level_advanced } : null
      ].filter(Boolean)
    };
  }

  /* ---------- Eigener Fortschritt ---------- */

  async function myEntry(monthId, profileId) {
    var rows = await sbFetch(
      '/rest/v1/challenge_entries?season_month_id=eq.' + monthId +
      '&profile_id=eq.' + profileId + '&select=*'
    );
    return (rows && rows[0]) || null;
  }

  /* Wert dazurechnen. Portiert aus challenge.html:
   * - value1 wächst kumulativ, kein Deckel in der DB
   * - completed_ts (ms) nur beim erstmaligen Überschreiten des Ziels
   * - last_progress_ts ist der Tiebreak im Ranking
   * - log_active_day danach, der Server bestimmt den Tag in Berlin-Zeit
   * Rückgabe enthält alles, was undoProgress() zum Zurückrollen braucht.
   */
  async function addProgress(active, profile, amount) {
    amount = Math.max(0, parseInt(amount, 10) || 0);
    if (!amount) throw new Error('Bitte einen Wert eingeben.');
    if (amount > 10000) throw new Error('Wert außerhalb des möglichen Bereichs.');

    var prev = await myEntry(active.monthId, profile.id);
    var undo, newV1;

    if (prev) {
      var prevV1 = prev.value1 || 0;
      newV1 = prevV1 + amount;
      var patch = { value1: newV1, last_progress_ts: new Date().toISOString() };
      if (prevV1 < active.goal && newV1 >= active.goal) patch.completed_ts = Date.now();

      await sbFetch('/rest/v1/challenge_entries?id=eq.' + prev.id,
        { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });

      undo = {
        entryId: prev.id, amount: amount, prevValue: prevV1,
        prevCompletedTs: prev.completed_ts ?? null,
        prevProgressTs: prev.last_progress_ts ?? null
      };
    } else {
      newV1 = amount;
      // value2 und pin_hash sind Altlasten und bleiben leer.
      var entry = {
        challenge: active.slug,
        season_month_id: active.monthId,
        name: profile.name,
        profile_id: profile.id,
        value1: newV1,
        last_progress_ts: new Date().toISOString()
      };
      if (newV1 >= active.goal) entry.completed_ts = Date.now();

      var created = await sbFetch('/rest/v1/challenge_entries',
        { method: 'POST', prefer: 'return=representation', body: JSON.stringify(entry) });
      var newId = created && created[0] ? created[0].id : null;
      undo = { entryId: newId, amount: amount, prevValue: null, prevCompletedTs: null, prevProgressTs: null };
    }

    try {
      await sbFetch('/rest/v1/rpc/log_active_day',
        { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ p_profile_id: profile.id }) });
    } catch (e) { console.warn('log_active_day:', e.message); }

    return { value1: newV1, undo: undo };
  }

  async function undoProgress(undo) {
    if (!undo || !undo.entryId) return;
    if (undo.prevValue === null) {
      await sbFetch('/rest/v1/challenge_entries?id=eq.' + undo.entryId,
        { method: 'DELETE', prefer: 'return=minimal' });
    } else {
      // Zeitstempel mit zurückrollen, sonst verschlechtert Eintragen+Undo den Tiebreak.
      await sbFetch('/rest/v1/challenge_entries?id=eq.' + undo.entryId, {
        method: 'PATCH', prefer: 'return=minimal',
        body: JSON.stringify({
          value1: undo.prevValue,
          completed_ts: undo.prevCompletedTs,
          last_progress_ts: undo.prevProgressTs
        })
      });
    }
  }

  /* ---------- Ranking ---------- */

  // Sortierung identisch zu ranking.html und finalize_challenge:
  // gedeckelter Wert absteigend, dann wer zuerst da war, dann id.
  async function monthRanking(monthId, goal) {
    var entries = await sbFetch('/rest/v1/challenge_entries?season_month_id=eq.' + monthId + '&select=*') || [];
    var capped = function (e) { return Math.min(e.value1 || 0, goal); };
    var ts = function (e) {
      var t = e.last_progress_ts ? Date.parse(e.last_progress_ts) : NaN;
      return Number.isNaN(t) ? Infinity : t;
    };
    entries.sort(function (a, b) { return capped(b) - capped(a) || ts(a) - ts(b) || a.id - b.id; });
    return entries;
  }

  async function seasonRanking(year) {
    return await sbFetch(
      '/rest/v1/v_season_ranking?season_year=eq.' + (year || new Date().getFullYear()) +
      '&select=*&order=total_points.desc&limit=50'
    ) || [];
  }

  async function profileHistory(profileId) {
    return await sbFetch(
      '/rest/v1/v_profile_history?profile_id=eq.' + profileId +
      '&select=season_year,month,platz,punkte,abgerechnet'
    ) || [];
  }

  /* ---------- Streak & Erfolge ---------- */

  async function streaks(profileId) {
    var res = await Promise.all([
      sbFetch('/rest/v1/rpc/current_daily_streak', { method: 'POST', body: JSON.stringify({ p_profile_id: profileId }) }),
      sbFetch('/rest/v1/rpc/longest_daily_streak', { method: 'POST', body: JSON.stringify({ p_profile_id: profileId }) })
    ]);
    return {
      current: typeof res[0] === 'number' ? res[0] : 0,
      record: typeof res[1] === 'number' ? res[1] : 0
    };
  }

  async function achievements(profileId) {
    try {
      await sbFetch('/rest/v1/rpc/grant_achievements', { method: 'POST', prefer: 'return=minimal', body: '{}' });
    } catch (e) { console.warn('grant_achievements:', e.message); }
    return await sbFetch('/rest/v1/achievements?profile_id=eq.' + profileId + '&select=code,unlocked_at') || [];
  }

  async function allExercises() {
    return await sbFetch('/rest/v1/exercises?select=*&order=id') || [];
  }

  /* ---------- Aktivitätstage (daily_log) ---------- */

  /* Die Spaltennamen von daily_log sind hier nicht fest verdrahtet: gesucht wird
   * das erste Feld, das wie ein Datum aussieht. Schlägt der Zugriff fehl,
   * kommt eine leere Liste zurück — der Streifen bleibt dann einfach leer,
   * statt die ganze Seite mitzureißen.
   */
  async function activeDays(profileId) {
    try {
      var rows = await sbFetch('/rest/v1/daily_log?profile_id=eq.' + profileId + '&select=*&limit=400');
      if (!rows || !rows.length) return [];
      var key = null;
      Object.keys(rows[0]).forEach(function (k) {
        if (key || k === 'id' || k === 'profile_id') return;
        var v = rows[0][k];
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) key = k;
      });
      if (!key) return [];
      return rows.map(function (r) { return String(r[key]).slice(0, 10); });
    } catch (e) { console.warn('daily_log:', e.message); return []; }
  }

  /* ---------- Erfolgs-Feed (alle Profile) ---------- */

  async function recentAchievements(limit) {
    return await sbFetch('/rest/v1/achievements?select=code,unlocked_at,profile_id' +
      '&order=unlocked_at.desc&limit=' + (limit || 8)) || [];
  }

  /* Alle Codes, die in der Gruppe schon einmal vergeben wurden. Daraus baut das
   * Frontend die Badge-Wand — so muss die Codeliste nicht doppelt gepflegt werden.
   */
  async function knownCodes() {
    var rows = await sbFetch('/rest/v1/achievements?select=code&limit=1000') || [];
    var seen = {}, out = [];
    rows.forEach(function (r) { if (!seen[r.code]) { seen[r.code] = 1; out.push(r.code); } });
    return out.sort();
  }

  window.JF = {
    sbFetch: sbFetch,
    session: session, login: login, logout: logout, register: register,
    loadProfiles: loadProfiles, nameOf: nameOf, avatarOf: avatarOf,
    loadActiveChallenge: loadActiveChallenge,
    myEntry: myEntry, addProgress: addProgress, undoProgress: undoProgress,
    monthRanking: monthRanking, seasonRanking: seasonRanking, profileHistory: profileHistory,
    streaks: streaks, achievements: achievements, allExercises: allExercises,
    activeDays: activeDays, recentAchievements: recentAchievements, knownCodes: knownCodes
  };
})();
