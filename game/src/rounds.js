// The match: rounds, phases, money and the Charge. This module owns the one
// shared world object every other system reads — phase, clock, bomb, plan,
// noise — and advances it one fixed step at a time. It pays the economy,
// picks each round's plan, plants and defuses, and decides when a round and
// the match are over.
import * as THREE from 'three';
import { TIMING, ECONOMY } from './config.js';
import { buyItem, resetFighter, damageFighter } from './fighters.js';
import { SPAWNS, SITES } from './map.js';
import { botBuy } from './bots.js';

export function createRounds(world, { hud, audio }) {
  const { fighters, player } = world;
  const match = {
    round: 0,
    scores: { breach: 0, ward: 0 },
    phase: 'menu', // menu | buy | live | planted | end | over
    phaseT: 0,
    winner: null,
    endReason: '',
    lossStreak: { breach: 0, ward: 0 },
    lastSite: null,
    siteFails: 0,
  };
  world.phase = 'menu';
  world.bomb = {
    state: 'held', // held | dropped | planted
    carrier: null, pos: new THREE.Vector3(), site: null,
    timer: 0, plantProgress: 0, defuseProgress: 0, defuser: null, beepAcc: 0,
  };
  world.plan = { site: 'A' };
  world.teamInfo = {
    breach: { contactAt: -99, contactSite: null, deathAt: -99, deathSite: null },
    ward: { contactAt: -99, contactSite: null, deathAt: -99, deathSite: null },
  };

  // The Charge as a prop: a dark block with a blinking eye. It rides a bot
  // carrier's back, and sits in the world when dropped or planted.
  const chargeMesh = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.24, 0.14),
    new THREE.MeshStandardMaterial({ color: '#26221c', roughness: 0.6, metalness: 0.3 }),
  );
  const chargeEye = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.02),
    new THREE.MeshBasicMaterial({ color: '#ff3524' }),
  );
  chargeEye.position.set(0.08, 0.04, -0.08);
  chargeMesh.add(chargeBody, chargeEye);
  chargeMesh.visible = false;
  world.scene.add(chargeMesh);

  function pay(fighter, amount) {
    fighter.money = Math.min(ECONOMY.maxMoney, fighter.money + amount);
  }

  function teamOf(team) {
    return fighters.filter((f) => f.team === team);
  }

  function aliveCount(team) {
    return teamOf(team).reduce((n, f) => n + (f.alive ? 1 : 0), 0);
  }

  function pickSite() {
    // Attack the site that is working; two failures in a row sends us elsewhere.
    if (match.lastSite && match.siteFails >= 2) {
      return match.lastSite === 'A' ? 'B' : 'A';
    }
    return Math.random() < 0.55 ? 'A' : 'B';
  }

  function assignPlans() {
    world.plan.site = pickSite();
    const breachBots = fighters.filter((f) => f.team === 'breach' && !f.isPlayer);
    breachBots.forEach((f, i) => {
      f.bot.laneIndex = i;
      f.bot.laneStep = 0;
      f.bot.threwUtility = false;
      f.bot.dest = null;
      f.bot.destName = null;
    });
    const wardBots = fighters.filter((f) => f.team === 'ward');
    const posts = [['A', 0], ['A', 1], ['B', 0], ['B', 1], ['mid', 0]];
    wardBots.forEach((f, i) => {
      const [site, postIndex] = posts[i % posts.length];
      f.bot.postSite = site;
      f.bot.postIndex = postIndex;
      f.bot.role = site === 'mid' ? 'rotate' : 'hold';
      f.bot.dest = null;
      f.bot.destName = null;
    });
    world.teamInfo.breach.contactAt = -99;
    world.teamInfo.ward.contactAt = -99;
    world.teamInfo.breach.contactSite = null;
    world.teamInfo.ward.contactSite = null;
    world.teamInfo.breach.deathAt = -99;
    world.teamInfo.ward.deathAt = -99;
    world.teamInfo.breach.deathSite = null;
    world.teamInfo.ward.deathSite = null;
  }

  function setupRound() {
    match.round += 1;
    match.phase = 'buy';
    world.phase = 'buy';
    match.phaseT = TIMING.buySeconds;
    match.winner = null;
    const spawnCount = { breach: 0, ward: 0 };
    for (const f of fighters) {
      const list = SPAWNS[f.team];
      const spawn = list[spawnCount[f.team] % list.length];
      spawnCount[f.team] += 1;
      resetFighter(f, spawn, f.alive);
      f.carryingCharge = false;
    }
    const bomb = world.bomb;
    bomb.state = 'held';
    bomb.carrier = player;
    bomb.site = null;
    bomb.timer = 0;
    bomb.plantProgress = 0;
    bomb.defuseProgress = 0;
    bomb.defuser = null;
    player.carryingCharge = true;
    assignPlans();
    for (const f of fighters) if (!f.isPlayer) botBuy(f.bot, buyItem);
    hud.banner(`ROUND ${match.round}`, `Breachers ${match.scores.breach} — ${match.scores.ward} Wardens · plant at ${world.plan.site === 'A' ? 'KILN' : 'VAULT'}`, 2.6);
    hud.roundIntro(match, world.plan.site);
  }

  function startMatch() {
    match.round = 0;
    match.scores = { breach: 0, ward: 0 };
    match.lossStreak = { breach: 0, ward: 0 };
    match.lastSite = null;
    match.siteFails = 0;
    for (const f of fighters) {
      f.money = ECONOMY.startMoney;
      f.kills = 0;
      f.deaths = 0;
      f.alive = true;
      resetFighter(f, SPAWNS[f.team][0], false);
    }
    setupRound();
  }

  function endRound(winner, reason) {
    if (match.phase === 'end' || match.phase === 'over') return; // one ending only
    match.phase = 'end';
    world.phase = 'end';
    match.phaseT = TIMING.endSeconds;
    match.winner = winner;
    match.endReason = reason;
    match.scores[winner] += 1;
    const loser = winner === 'breach' ? 'ward' : 'breach';
    match.lossStreak[winner] = 0;
    match.lossStreak[loser] += 1;
    if (world.plan.site === match.lastSite && winner !== 'breach') match.siteFails += 1;
    else if (winner === 'breach') match.siteFails = 0;
    match.lastSite = world.plan.site;
    const lossPay = ECONOMY.lossBase + ECONOMY.lossStep * Math.min(ECONOMY.lossMaxSteps, match.lossStreak[loser] - 1);
    for (const f of teamOf(winner)) pay(f, ECONOMY.winReward);
    for (const f of teamOf(loser)) pay(f, lossPay);
    hud.banner(
      winner === player.team ? 'ROUND WON' : 'ROUND LOST',
      reason,
      3.4,
    );
    hud.roundEnd(match, winner, reason);
    audio.stinger(winner === player.team);
    const matchOver = match.scores[winner] >= TIMING.roundsToWin || match.round >= TIMING.maxRounds;
    if (matchOver) {
      match.phase = 'over';
      world.phase = 'over';
      const verdict = match.scores.breach === match.scores.ward
        ? 'DRAW'
        : (match.scores.breach > match.scores.ward ? 'BREACHERS WIN THE FOUNDRY' : 'WARDENS HOLD THE FOUNDRY');
      hud.matchEnd(match, verdict);
    }
  }

  function onKill(killer, victim) {
    if (killer && killer.team !== victim.team) {
      killer.kills += 1;
      pay(killer, ECONOMY.killReward);
    }
    const bomb = world.bomb;
    if (victim.carryingCharge) {
      victim.carryingCharge = false;
      bomb.state = 'dropped';
      bomb.carrier = null;
      bomb.pos.copy(victim.pos);
    }
    // The dead fighter's team learns where it happened: the Wardens'
    // help rotation reads the freshest death to decide whether the
    // other site is being hit alone. A death off-site is charged to
    // whichever plant point it fell nearer.
    const info = world.teamInfo[victim.team];
    info.deathAt = world.now;
    const deathSite = world.map.siteAt(victim.pos.x, victim.pos.z);
    if (deathSite) {
      info.deathSite = deathSite;
    } else {
      const dA = Math.hypot(victim.pos.x - SITES.A.plant.x, victim.pos.z - SITES.A.plant.z);
      const dB = Math.hypot(victim.pos.x - SITES.B.plant.x, victim.pos.z - SITES.B.plant.z);
      info.deathSite = dA <= dB ? 'A' : 'B';
    }
    if (match.phase !== 'live' && match.phase !== 'planted') return;
    if (aliveCount('ward') === 0) {
      endRound('breach', 'Wardens eliminated');
    } else if (aliveCount('breach') === 0 && bomb.state !== 'planted') {
      endRound('ward', 'Breachers eliminated');
    } else if (aliveCount('breach') === 0 && bomb.state === 'planted') {
      // The Charge is down: the round runs to the defuse or the blast.
    }
  }

  function plantAt(site) {
    const bomb = world.bomb;
    bomb.state = 'planted';
    bomb.site = site;
    bomb.timer = TIMING.bombSeconds;
    bomb.pos.copy(SITES[site].plant);
    bomb.pos.y = 0.12;
    bomb.defuseProgress = 0;
    bomb.defuser = null;
    if (bomb.carrier) {
      pay(bomb.carrier, ECONOMY.planterBonus);
      bomb.carrier.carryingCharge = false;
    }
    for (const f of teamOf('breach')) pay(f, ECONOMY.plantTeamBonus);
    match.phase = 'planted';
    world.phase = 'planted';
    audio.plantDone(bomb.pos);
    hud.banner('THE CHARGE IS PLANTED', `${SITES[site].name} · ${TIMING.bombSeconds} seconds`, 2.6);
    // Name the defuser now: nearest Warden with a kit, else nearest Warden.
    let best = null;
    let bestDist = Infinity;
    for (const f of teamOf('ward')) {
      if (!f.alive) continue;
      const d = f.pos.distanceTo(bomb.pos) - (f.kit ? 6 : 0);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    bomb.defuser = best;
  }

  function detonate() {
    const bomb = world.bomb;
    world.fx.explosion(bomb.pos);
    audio.explosion(bomb.pos);
    world.hooks.blast(bomb.pos, 11);
    for (const f of fighters) {
      if (!f.alive) continue;
      const centre = new THREE.Vector3(f.pos.x, f.pos.y + 0.9, f.pos.z);
      const dist = centre.distanceTo(bomb.pos);
      if (dist < 10) {
        const raw = 420 * Math.max(0.1, 1 - dist / 10);
        const { killed } = damageFighter(f, raw, 'chest', 0.2);
        if (killed) onKill(null, f);
      }
    }
    bomb.state = 'gone';
    endRound('breach', 'The Charge detonated');
  }

  /**
   * One fixed step. intent carries the local player's hands this tick:
   * { channel: true while E is held near the objective }.
   */
  function step(dt, intent) {
    world.noise = world.noise.filter((n) => world.now - n.at < 1.6);
    const bomb = world.bomb;
    // Keep the prop where the Charge is.
    if (bomb.state === 'held' && bomb.carrier && !bomb.carrier.isPlayer && bomb.carrier.model) {
      chargeMesh.visible = true;
      bomb.carrier.model.root.add(chargeMesh);
      chargeMesh.position.set(0, 1.15, 0.3);
      chargeMesh.rotation.set(0, 0, 0);
    } else if (bomb.state === 'dropped' || bomb.state === 'planted') {
      if (chargeMesh.parent !== world.scene) world.scene.add(chargeMesh);
      chargeMesh.visible = true;
      chargeMesh.position.copy(bomb.pos);
      chargeMesh.position.y = Math.max(0.12, bomb.pos.y);
      chargeEye.material.color.setHex(world.now % 0.5 < 0.25 ? 0xff3524 : 0x57150f);
    } else {
      chargeMesh.visible = false;
    }
    if (bomb.state === 'held' && bomb.carrier) bomb.pos.copy(bomb.carrier.pos);

    if (match.phase === 'buy' || match.phase === 'end') {
      match.phaseT -= dt;
      if (match.phaseT <= 0 && match.phase === 'buy') {
        match.phase = 'live';
        world.phase = 'live';
        match.phaseT = TIMING.roundSeconds;
        hud.banner('ROUND LIVE', world.plan.site === 'A' ? 'Take the Kiln' : 'Take the Vault', 1.6);
      } else if (match.phaseT <= 0 && match.phase === 'end' && world.phase !== 'over') {
        setupRound();
      }
      return;
    }
    if (match.phase === 'over' || match.phase === 'menu') return;

    // Charge pickup: a living Breacher who reaches a dropped Charge takes it.
    if (bomb.state === 'dropped') {
      for (const f of teamOf('breach')) {
        if (f.alive && Math.hypot(f.pos.x - bomb.pos.x, f.pos.z - bomb.pos.z) < 1.3) {
          bomb.state = 'held';
          bomb.carrier = f;
          f.carryingCharge = true;
          break;
        }
      }
    }

    // Planting: the carrier channels on a site.
    if (match.phase === 'live' && bomb.state === 'held' && bomb.carrier) {
      const carrier = bomb.carrier;
      const site = world.map.siteAt(carrier.pos.x, carrier.pos.z);
      const channeling = carrier.isPlayer
        ? intent.channel && carrier.speedNow < 0.6
        : carrier.bot && carrier.bot.planting;
      if (site && channeling && carrier.alive) {
        bomb.plantProgress += dt;
        if (carrier.isPlayer) hud.progress('PLANTING THE CHARGE', bomb.plantProgress / TIMING.plantSeconds);
        if (bomb.plantProgress >= TIMING.plantSeconds) {
          bomb.plantProgress = 0;
          plantAt(site);
        }
      } else {
        bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
        if (carrier.isPlayer) hud.progress(null, 0);
      }
    }

    if (match.phase === 'live') {
      match.phaseT -= dt;
      if (match.phaseT <= 0) endRound('ward', 'Time expired — the Foundry holds');
      return;
    }

    if (match.phase === 'planted') {
      bomb.timer -= dt;
      bomb.beepAcc += dt;
      const interval = bomb.timer < 5 ? 0.16 : bomb.timer < 10 ? 0.4 : 0.85;
      if (bomb.beepAcc >= interval) {
        bomb.beepAcc = 0;
        audio.beep(bomb.pos, bomb.timer < 10 ? 1180 : 880, 0.06, 0.16);
      }
      // Defusing: a Warden channels on the Charge.
      let channeler = null;
      for (const f of teamOf('ward')) {
        if (!f.alive) continue;
        if (Math.hypot(f.pos.x - bomb.pos.x, f.pos.z - bomb.pos.z) > 1.9) continue;
        const wants = f.isPlayer ? intent.channel : f.bot && f.bot.defusing;
        if (wants) { channeler = f; break; }
      }
      if (channeler) {
        if (bomb.defuser !== channeler) bomb.defuser = channeler;
        const need = channeler.kit ? TIMING.defuseKitSeconds : TIMING.defuseBareSeconds;
        bomb.defuseProgress += dt;
        bomb.wireAcc = (bomb.wireAcc ?? 0) + dt;
        if (bomb.wireAcc > 0.3) {
          bomb.wireAcc = 0;
          audio.defuseWire(bomb.pos);
        }
        if (channeler.isPlayer) hud.progress('DEFUSING', bomb.defuseProgress / need);
        if (bomb.defuseProgress >= need) {
          pay(channeler, ECONOMY.defuserBonus);
          bomb.state = 'gone';
          endRound('ward', 'The Charge was defused');
          return;
        }
      } else if (player.team === 'ward') {
        hud.progress(null, 0);
      }
      if (bomb.defuser && !bomb.defuser.alive) {
        let best = null;
        let bestDist = Infinity;
        for (const f of teamOf('ward')) {
          if (!f.alive) continue;
          const d = f.pos.distanceTo(bomb.pos) - (f.kit ? 6 : 0);
          if (d < bestDist) { bestDist = d; best = f; }
        }
        bomb.defuser = best;
      }
      if (bomb.timer <= 0) detonate();
    }
  }

  return { match, startMatch, setupRound, step, onKill };
}
