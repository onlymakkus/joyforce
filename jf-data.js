/* Joyforce — Datenschicht
 * Liest/schreibt gegen dieselbe Supabase-Instanz wie onlymakkus.de.
 * Kein Supabase Auth: Login läuft über die profiles-Tabelle + bcryptjs im Browser.
 */
(function () {
  'use strict';

  var SB_URL = 'https://bsubsesbcxdaqofmkiqg.supabase.co';
  var SB_KEY = 'sb_publishable_fA2Dca6SVp0eB8k_WuqLrw_zplTnXBU';
  var SESSION_KEY = 'om_profile_session';

  async function sbFetch(path, opts) {
    opts = opts || {};
    var headers = {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
    };
    if (opts.method && opts.method !== 'GET') headers.Prefer = 'return=representation';
    Object.assign(headers, opts.headers || {});

    var r = await fetch(SB_URL + path, Object.assign({}, opts, { headers: headers }));
    if (!r.ok) {
      var t = await r.text().catch(function () { return ''; });
      throw new Error('Supabase ' + r.status + ': ' + t);
    }
    if (r.status === 204) return null;
    return r.json();
  }

  /* ---------- Session ---------- */

  function session() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  async function login(name, password) {
    name = (name || '').trim();
    if (!name || !password) throw new Error('Name und Passwort eingeben.');

    // "Laura#1234" → name=Laura, discriminator=1234
    var disc = null;
    var hash = name.indexOf('#');
    if (hash > 0) { disc = name.slice(hash + 1); name = name.slice(0, hash); }

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
      id: p.id,
      name: p.name,
      discriminator: p.discriminator,
      displayName: p.display_name,
      avatarUrl: p.avatar_url || null,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  /* ---------- Einträge ---------- */

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function loadEntries(profileId, limit) {
    var rows = await sbFetch(
      '/rest/v1/jf_entries?profile_id=eq.' + profileId +
      '&select=day,value&order=day.asc&limit=' + (limit || 60)
    );
    return rows || [];
  }

  // Ein Wert pro Tag: vorhandener Eintrag wird überschrieben.
  async function saveEntry(profileId, value) {
    var rows = await sbFetch('/rest/v1/jf_entries?on_conflict=profile_id,day', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ profile_id: profileId, day: today(), value: value }),
    });
    return rows && rows[0];
  }

  async function loadRanking() {
    var rows = await sbFetch('/rest/v1/jf_ranking?select=*&order=score.desc&limit=200');
    return rows || [];
  }

  window.JF = {
    sbFetch: sbFetch,
    session: session,
    login: login,
    logout: logout,
    loadEntries: loadEntries,
    saveEntry: saveEntry,
    loadRanking: loadRanking,
    today: today,
  };
})();
