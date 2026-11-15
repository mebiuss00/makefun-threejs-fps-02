// The HUD: every DOM element the player reads, updated from game state once a
// frame. It owns no game state of its own — health, money, the clock, the
// killfeed, the buy menu, the scoreboard and the minimap are all projections
// of the fighters, the match and the world it is handed.
import { WEAPONS, GRENADES, ARMOR, TEAM_NAMES } from './config.js';
import { SITES } from './map.js';
import { activeWeapon } from './fighters.js';

export const BUY_HOTKEYS = [
  ['Digit1', 'hornet'], ['Digit2', 'boar'], ['Digit3', 'lance'], ['Digit4', 'longbow'],
  ['Digit5', 'vest'], ['Digit6', 'helm'], ['Digit7', 'shard'], ['Digit8', 'flare'], ['Digit9', 'veil'],
];
const BUY_ROWS = [
  ['hornet', '1'], ['boar', '2'], ['lance', '3'], ['longbow', '4'],
  ['vest', '5'], ['helm', '6'], ['shard', '7'], ['flare', '8'], ['veil', '9'],
];

function el(id) { return document.getElementById(id); }
function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function itemName(key) {
  if (WEAPONS[key]) return WEAPONS[key].name;
  if (GRENADES[key]) return GRENADES[key].name;
  if (key === 'vest') return 'Vest';
  if (key === 'helm') return 'Vest + Helmet';
  return key;
}
function itemPrice(key) {
  if (WEAPONS[key]) return WEAPONS[key].price;
  if (GRENADES[key]) return GRENADES[key].price;
  if (key === 'vest') return ARMOR.vestPrice;
  if (key === 'helm') return ARMOR.helmPrice;
  return 0;
}

export function createHud({ onPlay }) {
  const hud = el('hud');
  const overlay = el('overlay');
  const minimap = el('minimap').getContext('2d');
  const feed = [];
  let bannerUntil = 0;
  let hitmarkUntil = 0;
  let vignetteLevel = 0;
  let buyVisible = false;

  // Alive pips, five a side, built once.
  const pipEls = { breach: [], ward: [] };
  for (const team of ['breach', 'ward']) {
    for (let i = 0; i < 5; i += 1) {
      const pip = document.createElement('div');
      pip.className = `pip ${team}`;
      el(`pips-${team}`).appendChild(pip);
      pipEls[team].push(pip);
    }
  }
  // Buy rows, built once.
  const buyRowEls = {};
  for (const [key, hotkey] of BUY_ROWS) {
    const row = document.createElement('div');
    row.className = 'buyrow';
    row.innerHTML = `<kbd>${hotkey}</kbd><span class="nm">${itemName(key)}</span><span class="pr">$${itemPrice(key)}</span>`;
    el('buyrows').appendChild(row);
    buyRowEls[key] = row;
  }

  el('play').addEventListener('click', () => onPlay());

  function owns(player, key) {
    if (WEAPONS[key]) return (player.slots.primary?.key === key) || (player.slots.sidearm?.key === key);
    if (GRENADES[key]) return player.grenades[key] > 0;
    if (key === 'vest') return player.armor > 0;
    if (key === 'helm') return player.helmet;
    return false;
  }

  const api = {
    showGame() {
      hud.hidden = false;
      overlay.hidden = true;
    },
    showStart(verdict, match) {
      hud.hidden = true;
      overlay.hidden = false;
      if (verdict) {
        el('overlay-title').innerHTML = verdict.replace(' ', '<span class="thin"> </span>');
        el('overlay-copy').textContent = `Final score — Breachers ${match.scores.breach}, Wardens ${match.scores.ward}, over ${match.round} rounds.`;
        el('play').textContent = 'Play again';
      }
    },
    banner(title, sub, seconds = 2.4) {
      el('banner-title').textContent = title;
      el('banner-sub').textContent = sub ?? '';
      el('banner').classList.add('on');
      bannerUntil = performance.now() / 1000 + seconds;
    },
    progress(label, frac) {
      const wrap = el('progress-wrap');
      if (!label) { wrap.hidden = true; return; }
      wrap.hidden = false;
      el('progress-label').textContent = label;
      el('progress').firstElementChild.style.width = `${Math.round(frac * 100)}%`;
    },
    interact(text) {
      const box = el('interact');
      if (!text) { box.hidden = true; return; }
      box.hidden = false;
      el('interact-text').textContent = text;
    },
    spectate(name) {
      const box = el('spectate');
      if (!name) { box.hidden = true; return; }
      box.hidden = false;
      el('spectate-name').textContent = name;
    },
    killfeed(killer, victim, weaponName, headshot) {
      const row = document.createElement('div');
      row.className = 'killrow';
      const kc = killer.team === 'breach' ? 'kb' : 'kw';
      const vc = victim.team === 'breach' ? 'kb' : 'kw';
      row.innerHTML = `<span class="${kc}">${killer.name}</span><span class="wep">${weaponName}${headshot ? ' <span class="head">HEADSHOT</span>' : ''}</span><span class="${vc}">${victim.name}</span>`;
      el('killfeed').prepend(row);
      feed.push({ node: row, until: performance.now() / 1000 + 4.5 });
    },
    hitmarker(kill) {
      const marker = el('hitmarker');
      marker.classList.add('on');
      marker.classList.toggle('kill', kill);
      hitmarkUntil = performance.now() / 1000 + (kill ? 0.22 : 0.1);
    },
    damage(angleDiff, amount) {
      vignetteLevel = Math.min(1, vignetteLevel + amount / 90);
      const dir = el('dmgdir');
      dir.style.transform = `translate(-50%, -50%) rotate(${angleDiff}rad)`;
      dir.style.opacity = 1;
    },
    roundIntro(match, site) {
      el('round-num').textContent = match.round;
      el('score-breach').textContent = match.scores.breach;
      el('score-ward').textContent = match.scores.ward;
      el('objective').textContent = `BUY PHASE — PLANT AT ${site === 'A' ? 'KILN' : 'VAULT'}`;
    },
    roundEnd(match) {
      el('score-breach').textContent = match.scores.breach;
      el('score-ward').textContent = match.scores.ward;
    },
    matchEnd(match, verdict) {
      api.showStart(verdict, match);
    },
    setBuyVisible(visible, player) {
      buyVisible = visible;
      el('buymenu').hidden = !visible;
      if (visible && player) api.renderBuy(player);
    },
    renderBuy(player) {
      el('buymoney').textContent = `$${player.money}`;
      for (const [key] of BUY_ROWS) {
        const row = buyRowEls[key];
        const owned = owns(player, key);
        row.classList.toggle('owned', owned);
        row.classList.toggle('cant', !owned && player.money < itemPrice(key));
        row.querySelector('.pr').textContent = owned ? 'OWNED' : `$${itemPrice(key)}`;
      }
    },
    flashBuy(key) {
      const row = buyRowEls[key];
      if (!row) return;
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 350);
    },
    setScoreboard(visible, fighters, player) {
      const board = el('scoreboard');
      board.hidden = !visible;
      if (!visible) return;
      const body = el('scorebody');
      body.innerHTML = '';
      for (const team of ['breach', 'ward']) {
        const head = document.createElement('tr');
        head.className = 'teamrow';
        head.innerHTML = `<td colspan="4" style="color: var(--${team === 'breach' ? 'rust' : 'teal'})">${TEAM_NAMES[team].toUpperCase()}</td>`;
        body.appendChild(head);
        for (const f of fighters.filter((x) => x.team === team)) {
          const tr = document.createElement('tr');
          if (!f.alive) tr.className = 'dead';
          if (f === player) tr.className = 'me';
          tr.innerHTML = `<td>${f.name}${f.isPlayer ? ' (you)' : ''}</td><td>${f.kills}</td><td>${f.deaths}</td><td>$${f.money}</td>`;
          body.appendChild(tr);
        }
      }
    },
    update(now, { player, match, world, fighters }) {
      const real = performance.now() / 1000;
      if (real > bannerUntil) el('banner').classList.remove('on');
      if (real > hitmarkUntil) el('hitmarker').classList.remove('on');
      for (let i = feed.length - 1; i >= 0; i -= 1) {
        if (real > feed[i].until) { feed[i].node.remove(); feed.splice(i, 1); }
      }
      vignetteLevel = Math.max(0, vignetteLevel - 0.016);
      const lowHp = player.alive && player.health < 35 ? 0.25 + 0.12 * Math.sin(real * 6) : 0;
      el('vignette').style.opacity = Math.max(vignetteLevel, lowHp).toFixed(2);
      el('dmgdir').style.opacity = Math.max(0, Number(el('dmgdir').style.opacity || 0) - 0.03);
      // Flash: a hard white that drains over the blind's last second.
      const flashLeft = player.flashUntil - now;
      el('flashoverlay').style.opacity = flashLeft > 0
        ? (player.flashStrength * Math.min(1, flashLeft / 0.9)).toFixed(2) : 0;
      el('scope').style.opacity = player.scoped ? 1 : 0;

      // Vitals.
      el('health').textContent = Math.max(0, Math.ceil(player.health));
      el('healthbar').firstElementChild.style.width = `${Math.max(0, player.health)}%`;
      el('healthbar').classList.toggle('low', player.health < 35);
      el('armor').textContent = player.helmet ? `${Math.ceil(player.armor)}▸H` : Math.ceil(player.armor);
      el('money').textContent = `$${player.money}`;
      const weapon = activeWeapon(player);
      const ammoBox = el('ammo');
      if (weapon) {
        el('ammo-mag').textContent = weapon.mag;
        el('ammo-reserve').textContent = `/ ${weapon.reserve}`;
        el('weapon-name').textContent = WEAPONS[weapon.key].name + (player.reloadLeft > 0 ? ' — RELOADING' : '');
        ammoBox.classList.toggle('empty', weapon.mag === 0);
      } else {
        el('ammo-mag').textContent = '—';
        el('ammo-reserve').textContent = '';
        el('weapon-name').textContent = itemName(player.active);
        ammoBox.classList.remove('empty');
      }
      const slots = el('slots');
      const slotText = [
        player.slots.primary ? `1 ${WEAPONS[player.slots.primary.key].name.split(' ')[0]}` : null,
        `2 ${WEAPONS[player.slots.sidearm.key].name.split(' ')[0]}`,
        player.grenades.shard ? `3 Shard ×${player.grenades.shard}` : null,
        player.grenades.flare ? `4 Flare ×${player.grenades.flare}` : null,
        player.grenades.veil ? `5 Veil ×${player.grenades.veil}` : null,
        player.carryingCharge ? 'CHARGE' : null,
      ].filter(Boolean);
      if (slots.dataset.text !== slotText.join('|')) {
        slots.dataset.text = slotText.join('|');
        slots.innerHTML = slotText.map((t) => {
          const num = t[0];
          const key = { 1: 'primary', 2: 'sidearm', 3: 'shard', 4: 'flare', 5: 'veil' }[num];
          return `<span class="${player.active === key ? 'on' : ''}">${t}</span>`;
        }).join('');
      }
      // Crosshair bloom, in pixels, from the same spread the bullets use.
      if (weapon) {
        const def = WEAPONS[weapon.key];
        const spread = def.spreadBase + player.bloom + (player.onGround ? def.spreadMove * Math.min(1, player.speedNow / 5.3) : def.spreadAir);
        el('crosshair').style.setProperty('--gap', `${Math.round(3 + spread * 620)}px`);
      }
      // Clock and objective.
      const timer = el('timer');
      if (match.phase === 'buy') {
        timer.textContent = fmtTime(match.phaseT);
        timer.classList.remove('hot');
        el('buytimer').textContent = Math.ceil(match.phaseT);
        el('objective').textContent = `BUY PHASE — PLANT AT ${world.plan.site === 'A' ? 'KILN' : 'VAULT'}`;
      } else if (match.phase === 'planted') {
        timer.textContent = fmtTime(world.bomb.timer);
        timer.classList.add('hot');
        el('objective').textContent = world.bomb.site ? `CHARGE PLANTED — ${SITES[world.bomb.site].name}` : 'CHARGE PLANTED';
      } else if (match.phase === 'live') {
        timer.textContent = fmtTime(match.phaseT);
        timer.classList.toggle('hot', match.phaseT < 15);
        const bomb = world.bomb;
        el('objective').textContent = bomb.state === 'dropped'
          ? 'THE CHARGE IS DOWN — RECOVER IT'
          : player.carryingCharge
            ? `PLANT THE CHARGE AT ${world.plan.site === 'A' ? 'KILN' : 'VAULT'}`
            : 'COVER THE CARRIER';
      } else {
        timer.textContent = '—';
        timer.classList.remove('hot');
      }
      for (const team of ['breach', 'ward']) {
        const alive = fighters.filter((f) => f.team === team && f.alive).length;
        pipEls[team].forEach((pip, i) => pip.classList.toggle('dead', i >= alive));
      }
      if (buyVisible) api.renderBuy(player);
      drawMinimap(now, { player, world, fighters });
    },
  };

  function drawMinimap(now, { player, world, fighters }) {
    const W = 196;
    const H = 140;
    const sx = (x) => ((x + 35) / 70) * W;
    const sz = (z) => ((z + 25) / 50) * H;
    minimap.fillStyle = '#12151a';
    minimap.fillRect(0, 0, W, H);
    for (const [key, site] of Object.entries(SITES)) {
      minimap.strokeStyle = key === 'A' ? '#e8a33d' : '#2fa8a0';
      minimap.lineWidth = 1.5;
      minimap.strokeRect(sx(site.minX), sz(site.minZ), sx(site.maxX) - sx(site.minX), sz(site.maxZ) - sz(site.minZ));
      minimap.fillStyle = minimap.strokeStyle;
      minimap.font = '700 11px system-ui';
      minimap.fillText(key, sx(site.center.x) - 3, sz(site.center.z) + 4);
    }
    minimap.fillStyle = '#565d66';
    for (const box of world.map.colliders) {
      if (box.min.y > 2) continue;
      minimap.fillRect(sx(box.min.x), sz(box.min.z), Math.max(1.5, sx(box.max.x) - sx(box.min.x)), Math.max(1.5, sz(box.max.z) - sz(box.min.z)));
    }
    for (const noise of world.noise) {
      if (noise.team === player.team || now - noise.at > 1.1) continue;
      minimap.fillStyle = 'rgba(224,106,44,0.75)';
      minimap.beginPath();
      minimap.arc(sx(noise.x), sz(noise.z), 3, 0, Math.PI * 2);
      minimap.fill();
    }
    for (const f of fighters) {
      if (!f.alive || f.team !== player.team) continue;
      minimap.fillStyle = f.isPlayer ? '#ffffff' : '#e06a2c';
      minimap.beginPath();
      minimap.arc(sx(f.pos.x), sz(f.pos.z), f.isPlayer ? 3.4 : 2.6, 0, Math.PI * 2);
      minimap.fill();
      if (f.isPlayer) {
        minimap.strokeStyle = '#ffffff';
        minimap.beginPath();
        minimap.moveTo(sx(f.pos.x), sz(f.pos.z));
        minimap.lineTo(sx(f.pos.x - Math.sin(f.yaw) * 3.4), sz(f.pos.z - Math.cos(f.yaw) * 3.4));
        minimap.stroke();
      }
    }
    const bomb = world.bomb;
    if (bomb.state !== 'held' || (bomb.carrier && !bomb.carrier.isPlayer)) {
      if (Math.floor(now * 2.4) % 2 === 0) {
        minimap.fillStyle = '#ff4a38';
        minimap.fillRect(sx(bomb.pos.x) - 3, sz(bomb.pos.z) - 3, 6, 6);
      }
    }
  }

  return api;
}
