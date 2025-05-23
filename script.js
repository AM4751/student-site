/*
  SUMMARY:

  This script powers a two-player browser-based poker game with betting, hand evaluation,
  simulation, and dynamic UI rendering. Each section is modular for easy expansion.

  1. CONSTANTS – Card suits/values, control IDs, and base config.                         [~15 lines]
  2. STATE VARIABLES – Tracks all round and player data.                                  [~20 lines]
  3. PERSISTENCE – Handles chip/score loading/saving.                                     [~15 lines]
  4. DECK & DEAL – Functions to create/shuffle/deal cards.                                [~30 lines]
  5. UI CONTROLS – Enables/disables UI buttons.                                           [~10 lines]
  6. BETTING – Handles actions for call/raise/fold + pot.                                 [~50 lines]
  7. WIN PROBABILITY – Monte Carlo win odds calculator.                                   [~40 lines]
  8. ROUND SIMULATION – Manages stage progression.                                        [~40 lines]
  9. RESET & VICTORY – Game reset, rematch, and victory detection.                        [~25 lines]
 10. EVENT BINDINGS – Button interactions.                                                [~10 lines]
 11. HAND EVALUATION – Determines best hand rank.                                         [~60 lines]
 12. UI RENDERING – Card rendering, round stats, logs.                                    [~70 lines]
*/

/* -------------------- 1. CONSTANTS -------------------- */
const suits = ['♠', '♥', '♦', '♣'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const handRanks = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush'];
const DEFAULT_BET = 10;

/* all live buttons/inputs that really exist in the markup */
const P1_CONTROLS = ['checkBtnP1', 'callBtnP1', 'raiseBtnP1', 'foldBtnP1', 'raiseAmountP1'];
const P2_CONTROLS = ['checkBtnP2', 'callBtnP2', 'raiseBtnP2', 'foldBtnP2', 'raiseAmountP2'];

const START_CONTROLS = ['startBtn', 'resetBtn', 'rematchBtn'];

/* put this right after the other CONSTANTS section ------------------------- */
const BETTING_CONTROLS = [
  ...P1_CONTROLS,   // callBtnP1, raiseBtnP1, foldBtnP1, raiseAmountP1
  ...P2_CONTROLS    // callBtnP2, raiseBtnP2, foldBtnP2, raiseAmountP2
];

/* ------------------------------------------------------------------------- */
/*  helper that shows / hides buttons by setting style.display               */
function showControls(buttonIds = []) {
  /* list of every control we might want to toggle */
  const all = [...BETTING_CONTROLS, ...START_CONTROLS];

  all.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;                       // skip if not in DOM
    /*   visible  when its id is in the array we were given
         hidden   otherwise                                         */
    el.style.display = buttonIds.includes(id) ? 'inline-block' : 'none';
  });
}

function hideCheckButtons() {
  ['checkBtnP1', 'checkBtnP2'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = 'none';
  });
}



/* -------------------- 2. STATE -------------------- */
let deck = [];
let playerHands = [[], []];
let communityCards = [];
let chips = loadChips();          // [ P1 , P2 ]
let scoreboard = loadScoreboard();     // [ P1 , P2 ]
let roundHistory = [];
let roundStats = [];
let contributions = [0, 0];
let currentPlayer = 1;                 // 1 or 2
let gameState = { stage: 'preflop', pot: 0, currentBet: 0, folded: false };
let oddsWorker = null;
let betStarter = 1;     // player who opened this betting round
let betCompleted = false; // becomes true after the second player acts
let dealerButton = 1;  // 1 or 2 → who acts second (the dealer)
let bettingActionCount = 0; // at global or inside the function



/* -------------------- 3. PERSISTENCE -------------------- */
function loadChips() { return JSON.parse(localStorage.getItem('pokerChips') || '[100,100]'); }
function loadScoreboard() { return JSON.parse(localStorage.getItem('pokerScoreboard') || '[0,0]'); }
function saveState() {
  localStorage.setItem('pokerChips', JSON.stringify(chips));
  localStorage.setItem('pokerScoreboard', JSON.stringify(scoreboard));
}

/* -------------------- 4.  DECK  -------------------- */
function createDeck() { return suits.flatMap(s => values.map(v => ({ suit: s, value: v }))); }
function shuffleDeck(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));[d[i], d[j]] = [d[j], d[i]];
  } return d;
}
function ensureFreshDeck() {
  if (deck.length < 9) deck = shuffleDeck(createDeck());
}
function resetRound() {
  deck = shuffleDeck(createDeck());
  playerHands = [[], []];
  communityCards = [];
  contributions = [0, 0];
  gameState = { stage: 'preflop', pot: 0, currentBet: 0, folded: false };
  window._afterBetCallback = null;    // << ADD THIS!!
  document.getElementById('raiseAmountP1').value = '';
  document.getElementById('raiseAmountP2').value = '';
  logState('Round reset');
  updatePotUI();
  updateDeckStats();
  updateDeckGrid();
}

function dealHoleCards() {
  ensureFreshDeck();
  playerHands[0] = [deck.pop(), deck.pop()];
  playerHands[1] = [deck.pop(), deck.pop()];
  logState('Hole cards dealt', true);
  updateDeckStats();
}
function dealFlop() {
  deck.pop(); communityCards = [deck.pop(), deck.pop(), deck.pop()];
  gameState.stage = 'flop'; logState('Flop dealt', true); updateDeckStats();
}
function dealTurn() {
  deck.pop(); communityCards.push(deck.pop());
  gameState.stage = 'turn'; logState('Turn dealt', true); updateDeckStats();
}
function dealRiver() {
  deck.pop(); communityCards.push(deck.pop());
  gameState.stage = 'river'; logState('River dealt', true); updateDeckStats();
}


/* ------------------------------------------------------------------
   BETTING‑TURN STARTER  –  restores the helper used by
   simulateRoundStepByStep() to initialise each betting phase
------------------------------------------------------------------- */
function startPlayerBet(playerNum, stageLabel, afterBetCallback = null) {
  currentPlayer = playerNum;          // 1 or 2
  betStarter = playerNum;             // Who opened this betting round
  betCompleted = false;               // Reset betting cycle

  bettingActionCount = 0;

  showControls(BETTING_CONTROLS);     // Show betting UI
  updateTurnDisplay();                // Highlight active player

  // Show or hide Check buttons based on current betting
  const canCheck = gameState.currentBet === 0;
  const checkBtnP1 = document.getElementById('checkBtnP1');
  const checkBtnP2 = document.getElementById('checkBtnP2');
  if (checkBtnP1 && checkBtnP2) {
    checkBtnP1.style.display = canCheck ? 'inline-block' : 'none';
    checkBtnP2.style.display = canCheck ? 'inline-block' : 'none';
    checkBtnP1.disabled = !canCheck;
    checkBtnP2.disabled = !canCheck;
  }

  // ✅ NEW: Enable only the active player
  enableGroup(P1_CONTROLS, currentPlayer === 1);
  enableGroup(P2_CONTROLS, currentPlayer === 2);

  // Store callback to run AFTER betting complete
  window._afterBetCallback = typeof afterBetCallback === 'function' ? afterBetCallback : null;
}



/* ------------------------------------------------------------------
   ROUND CLEAN‑UP – called from handleFold() and from resolveWinner()
------------------------------------------------------------------- */
function finalizeRound(message) {
  saveState();
  updateScoreboardUI();
  updateChipsUI();
  updateHistoryLog(message);
  logState(message);
  addToLogDetails(message);

  checkVictory();

  showControls(START_CONTROLS);

  hideCheckButtons();  // << here cleanly!

  dealerButton = dealerButton === 1 ? 2 : 1;   // Flip dealer for next round

  const nextBtn = document.getElementById('nextRoundBtn');
  if (nextBtn) nextBtn.style.display = 'inline-block';

  if (window._afterBetCallback && !gameState.folded) {
    const cb = window._afterBetCallback;
    window._afterBetCallback = null;
    cb();
  }


}



/* -------------------- 5.  TURN / CONTROL helpers -------------------- */
function enableGroup(ids, yes) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !yes; });
}
function switchTurn() { currentPlayer = currentPlayer === 1 ? 2 : 1; updateTurnDisplay(); }

function updateTurnDisplay() {
  const lbl = document.getElementById('activePlayer');
  if (lbl) lbl.textContent = `Player ${currentPlayer}'s Turn`;

  enableGroup(P1_CONTROLS, currentPlayer === 1);
  enableGroup(P2_CONTROLS, currentPlayer === 2);

  const raiseBtnP1 = document.getElementById('raiseBtnP1');
  const raiseBtnP2 = document.getElementById('raiseBtnP2');

  if (raiseBtnP1) raiseBtnP1.disabled = (currentPlayer !== 1);
  if (raiseBtnP2) raiseBtnP2.disabled = (currentPlayer !== 2);

  /* add/remove .active class for outline + tint */
  document.querySelectorAll('.player-panel').forEach((panel, idx) => {
    panel.classList.toggle('active', idx === currentPlayer - 1);
  });
}



/* ---------- Betting‑round bookkeeping (NEW) ---------- */

function maybeFinishBetting(playerNum) {
  if (gameState.folded) return; // someone folded already

  bettingActionCount++;

  if (bettingActionCount >= 2) {
    betCompleted = true;
    
    // Instead of only disabling
    // showControls([]);        // HIDE all betting controls cleanly
    hideCheckButtons();      // (optional but nice)

    if (window._afterBetCallback) {
      const cb = window._afterBetCallback;
      window._afterBetCallback = null;
      cb(); // nextStage() gets called properly now!
    }
  } else {
    switchTurn();
  }
}







/* -------------------- 6.  BETTING (fixed IDs) -------------------- */
function player1Bet(action) {
  enableGroup(P1_CONTROLS, false);
  let bet = DEFAULT_BET;
  const input = document.getElementById('raiseAmountP1');
  const amt = Number(input.value) || DEFAULT_BET;

  if (action === 'raise') {
    bet = Math.min(Math.max(amt, DEFAULT_BET), chips[0]);
    addToLogDetails(`Player 1 raises to $${bet}`);
    chips[0] -= bet;
    contributions[0] += bet;
    gameState.pot += bet;
    gameState.currentBet = bet;
    document.getElementById('checkBtnP1').style.display = 'none';
    document.getElementById('checkBtnP2').style.display = 'none';
    maybeFinishBetting(1);   // <-- OK here
  } else if (action === 'call') {
    bet = Math.min(gameState.currentBet, chips[0]);
    addToLogDetails(`Player 1 calls $${bet}`);
    chips[0] -= bet;
    contributions[0] += bet;
    gameState.pot += bet;
    maybeFinishBetting(1);   // <-- OK here
  } else if (action === 'check') {
    addToLogDetails(`Player 1 checks`);
    maybeFinishBetting(1);   // <-- OK here
  } else {
    return handleFold(1);
  }

  updatePotUI();
}




function player2Bet(action) {
  enableGroup(P2_CONTROLS, false);
  let bet = DEFAULT_BET;
  const input = document.getElementById('raiseAmountP2');
  const amt = Number(input.value) || DEFAULT_BET;

  if (action === 'raise') {
    bet = Math.min(Math.max(amt, DEFAULT_BET), chips[1]);
    addToLogDetails(`Player 2 raises to $${bet}`);
    chips[1] -= bet;
    contributions[1] += bet;
    gameState.pot += bet;
    gameState.currentBet = bet;
    document.getElementById('checkBtnP1').style.display = 'none';
    document.getElementById('checkBtnP2').style.display = 'none';
    maybeFinishBetting(2);   // ✅ ADD THIS!!
  } else if (action === 'call') {
    bet = Math.min(gameState.currentBet, chips[1]);
    addToLogDetails(`Player 2 calls $${bet}`);
    chips[1] -= bet;
    contributions[1] += bet;
    gameState.pot += bet;
    maybeFinishBetting(2);   // ✅ ADD THIS!!
  } else if (action === 'check') {
    addToLogDetails(`Player 2 checks`);
    maybeFinishBetting(2);
  } else {
    return handleFold(2);
  }

  updatePotUI();
}





function handleFold(loser) {
  gameState.folded = true;
  const winner = loser === 1 ? 2 : 1;
  scoreboard[winner - 1]++; chips[winner - 1] += gameState.pot;
  contributions = [0, 0]; updatePotUI();
  finalizeRound(`Player ${loser} folds. Player ${winner} wins.`);
}

/* -------------------- 7.  WIN‑PROBABILITY (runtime‑safe) -------------------- */
/* ---------- Win‑probability now off‑thread ---------- */

function updateWinProbabilityUI() {

  /* --- cache spans & loader --- */
  const p1WinPct = document.getElementById('p1WinPct');
  const p2WinPct = document.getElementById('p2WinPct');
  const tiePct = document.getElementById('tiePct');
  const loader = document.getElementById('oddsLoading');
  const grid = document.getElementById('oddsGrid');
  if (!p1WinPct || !p2WinPct || !tiePct || !loader || !grid) return;

  /* reset */
  p1WinPct.textContent = p2WinPct.textContent = tiePct.textContent = '--';
  loader.textContent = '⏳ 0%…';
  loader.style.display = 'block';
  grid.innerHTML = '';

  /* create the worker once */
  if (!oddsWorker) {
    oddsWorker = new Worker('oddsWorker.js');

    oddsWorker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        /* stream card into the grid */
        renderOddsByCard([data.result], true);
        const pct = Math.round((data.done / data.total) * 100);
        loader.textContent = `⏳ ${pct}%…`;
        return;
      }

      if (data.type === 'complete') {
        loader.style.display = 'none';

        const sums = data.oddsByCard.reduce((acc, o) => ({
          p1: acc.p1 + o.p1,
          p2: acc.p2 + o.p2,
          tie: acc.tie + o.tie
        }), { p1: 0, p2: 0, tie: 0 });

        const n = data.oddsByCard.length;
        p1WinPct.textContent = Math.round(sums.p1 / n) + '%';
        p2WinPct.textContent = Math.round(sums.p2 / n) + '%';
        tiePct.textContent = Math.round(sums.tie / n) + '%';
      }
    };
  }

  /* kick off a fresh simulation */
  oddsWorker.postMessage({
    playerHands,
    communityCards,
    deck,
    trialsPerCard: 30     /* tweak accuracy ↔ speed */
  });
}





// -------------------- 8. ROUND SIMULATION [~40] --------------------
function simulateRoundStepByStep() {
  resetRound();
  setTimeout(() => {
    dealHoleCards();
    showControls(BETTING_CONTROLS);

    const stages = ['Pre-flop', 'Flop', 'Turn', 'River', 'Showdown'];
    let currentStageIndex = 0;

    function nextStage() {
      if (gameState.folded) return;

      const stage = stages[currentStageIndex];

      // (1) Perform stage-specific action BEFORE betting
      if (stage === 'Flop') {
        dealFlop();
        updateWinProbabilityUI();
      } else if (stage === 'Turn') {
        dealTurn();
        updateWinProbabilityUI();
      } else if (stage === 'River') {
        dealRiver();
        updateWinProbabilityUI();
      } else if (stage === 'Showdown') {
        resolveWinner();
        return;
      }

      showControls(BETTING_CONTROLS);


      // (2) THEN start the betting for this stage
      const opener = (stage === 'Pre-flop') ? (dealerButton === 1 ? 2 : 1) : dealerButton;

      startPlayerBet(opener, stage, () => {
        // (3) After betting ends, move to the next stage
        currentStageIndex++;
        setTimeout(nextStage, 800);
      });
    }

    nextStage();
    
  }, 500);
}









// -------------------- 9. RESET & VICTORY [~25] --------------------
function resetGame() {
  chips = [100, 100];
  scoreboard = [0, 0];
  roundHistory = [];
  roundStats = [];
  contributions = [0, 0];
  saveState();
  updateChipsUI();
  updateScoreboardUI();
  updateHistoryLog("Game reset");
  logState("Game has been reset");
  showControls(START_CONTROLS);
  updatePotUI();
  const nextBtn = document.getElementById('nextRoundBtn');
  if (nextBtn) nextBtn.style.display = 'none';

}

function rematchGame() {
  chips = [100, 100];
  scoreboard = [0, 0];
  roundHistory = [];
  roundStats = [];
  contributions = [0, 0];
  saveState();
  updateChipsUI();
  updateScoreboardUI();
  updateHistoryLog("Rematch started");
  logState("Rematch initialized");
  showControls(START_CONTROLS);
  updatePotUI();
  const nextBtn = document.getElementById('nextRoundBtn');
  if (nextBtn) nextBtn.style.display = 'none';

}

function checkVictory() {
  if (scoreboard[0] >= 5 || scoreboard[1] >= 5) {
    const winner = scoreboard[0] >= 5 ? "Player 1" : "Player 2";
    addToLogDetails(`🏆 ${winner} wins the match!`);
    logState(`${winner} has won 5 rounds! Game Over.`);
    showControls(['resetBtn']);
    return true;
  }
  return false;
}

//* -------------------- EVENT BINDINGS (clean) -------------------- */
document.getElementById('startBtn').addEventListener('click', simulateRoundStepByStep);
document.getElementById('resetBtn').addEventListener('click', resetGame);
document.getElementById('rematchBtn').addEventListener('click', rematchGame);

document.getElementById('callBtnP1').addEventListener('click', () => currentPlayer === 1 && player1Bet('call'));
document.getElementById('raiseBtnP1').addEventListener('click', () => currentPlayer === 1 && player1Bet('raise'));
document.getElementById('foldBtnP1').addEventListener('click', () => currentPlayer === 1 && player1Bet('fold'));

document.getElementById('callBtnP2').addEventListener('click', () => currentPlayer === 2 && player2Bet('call'));
document.getElementById('raiseBtnP2').addEventListener('click', () => currentPlayer === 2 && player2Bet('raise'));
document.getElementById('foldBtnP2').addEventListener('click', () => currentPlayer === 2 && player2Bet('fold'));

document.getElementById('nextRoundBtn').addEventListener('click', () => {
  document.getElementById('nextRoundBtn').style.display = 'none'; // hide after clicking
  simulateRoundStepByStep(); // start a fresh round
});

document.getElementById('checkBtnP1').addEventListener('click', () => {
  if (currentPlayer === 1 && gameState.currentBet === 0) player1Bet('check');
});

document.getElementById('checkBtnP2').addEventListener('click', () => {
  if (currentPlayer === 2 && gameState.currentBet === 0) player2Bet('check');
});




// -------------------- 11. HAND EVALUATION [~60] --------------------
function evaluateHandStrength(cards) {
  const counts = {};
  const suitsMap = {};
  for (let card of cards) {
    counts[card.value] = (counts[card.value] || 0) + 1;
    suitsMap[card.suit] = (suitsMap[card.suit] || []).concat(card);
  }

  const valueIndices = cards.map(c => values.indexOf(c.value)).sort((a, b) => a - b);
  const uniqueValues = [...new Set(valueIndices)];
  if (uniqueValues.includes(12)) uniqueValues.unshift(-1); // Ace-low straight

  const hasRun = (arr) => {
    let run = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1] + 1) {
        run++;
        if (run >= 5) return true;
      } else run = 1;
    }
    return false;
  };

  let isStraightFlush = false;
  for (let suit in suitsMap) {
    const suited = suitsMap[suit];
    if (suited.length >= 5) {
      const sVals = suited.map(c => values.indexOf(c.value)).sort((a, b) => a - b);
      const unique = [...new Set(sVals)];
      if (unique.includes(12)) unique.unshift(-1);
      if (hasRun(unique)) isStraightFlush = true;
    }
  }

  const isFlush = Object.values(suitsMap).some(cards => cards.length >= 5);
  const isStraight = hasRun(uniqueValues);
  const freq = Object.values(counts).sort((a, b) => b - a);

  let name;
  if (isStraightFlush) name = 'Straight Flush';
  else if (freq[0] === 4) name = 'Four of a Kind';
  else if (freq[0] === 3 && freq[1] === 2) name = 'Full House';
  else if (isFlush) name = 'Flush';
  else if (isStraight) name = 'Straight';
  else if (freq[0] === 3) name = 'Three of a Kind';
  else if (freq[0] === 2 && freq[1] === 2) name = 'Two Pair';
  else if (freq[0] === 2) name = 'One Pair';
  else name = 'High Card';

  return { rank: handRanks.indexOf(name), name };
}

function getCombinations(arr, size) {
  const result = [];
  function combine(sub, combo = []) {
    if (combo.length === size) return result.push(combo);
    for (let i = 0; i < sub.length; i++) {
      combine(sub.slice(i + 1), combo.concat(sub[i]));
    }
  }
  combine(arr);
  return result;
}

function getBestHand(cards) {
  const combos = getCombinations(cards, 5);
  return combos.reduce((best, hand) => {
    const score = evaluateHandStrength(hand);
    return score.rank > best.rank ? score : best;
  }, { rank: -1 });
}

function resolveWinner() {
  const p1 = getBestHand([...playerHands[0], ...communityCards]);
  const p2 = getBestHand([...playerHands[1], ...communityCards]);

  let res;
  if (p1.rank > p2.rank) {
    chips[0] += gameState.pot;
    scoreboard[0]++;
    res = "Player 1 wins";
  } else if (p2.rank > p1.rank) {
    chips[1] += gameState.pot;
    scoreboard[1]++;
    res = "Player 2 wins";
  } else {
    const half = Math.floor(gameState.pot / 2);
    chips[0] += half;
    chips[1] += gameState.pot - half;
    res = "It's a tie";
  }

  contributions = [0, 0];
  updatePotUI();
  saveState();
  updateScoreboardUI();
  updateChipsUI();
  updateHistoryLog(res);
  logState(res);
  displayRoundStats();
  logRoundSummary();
  roundStats = [];
  showControls(START_CONTROLS);
}
// -------------------- 12. UI RENDERING [~70] --------------------

function updateChipsUI() {
  const chipEl = document.getElementById('chips');
  if (chipEl) chipEl.textContent = `Player 1: $${chips[0]} | Player 2: $${chips[1]}`;
}

function updateScoreboardUI() {
  const scoreEl = document.getElementById('scoreboard');
  if (scoreEl) scoreEl.textContent = `P1 Wins: ${scoreboard[0]} | P2 Wins: ${scoreboard[1]}`;
}

function updatePotUI() {
  const potEl = document.getElementById('potInfo');
  if (!potEl) return;
  potEl.textContent = `Pot: $${gameState.pot} | P1 Contribution: $${contributions[0]} | P2 Contribution: $${contributions[1]}`;
}

function updateHistoryLog(result) {
  roundHistory.unshift(result);
  if (roundHistory.length > 5) roundHistory.pop();

  const ul = document.getElementById('historyLog');
  if (!ul) return;
  ul.innerHTML = '';

  roundHistory.forEach((entry, index) => {
    const roundNum = roundHistory.length - index;
    const p1Hand = playerHands[0]?.map?.(formatCard).join(' ') || '--';
    const p2Hand = playerHands[1]?.map?.(formatCard).join(' ') || '--';
    const community = communityCards?.map?.(formatCard).join(' ') || '--';
    const pot = typeof gameState.pot === 'number' ? `$${gameState.pot}` : '--';

    const win = roundStats.at(-1)?.winOdds || { p1: '--', p2: '--', tie: '--' };

    const li = document.createElement('li');
    li.innerHTML = `
      <div><strong>Round ${roundNum}:</strong> ${entry}</div>
      <div style="margin-left: 1rem; font-size: 0.85rem; color: #ccc;">
        Player 1 Hand: ${p1Hand}<br/>
        Player 2 Hand: ${p2Hand}<br/>
        Community Cards: ${community}<br/>
        Pot: ${pot}<br/>
        Win % → P1: ${win.p1}% | P2: ${win.p2}% | Tie: ${win.tie}%
      </div>
    `;
    ul.appendChild(li);
  });
}

function displayRoundStats() {
  const container = document.getElementById('roundStats');
  if (!container) return;
  container.innerHTML = roundStats.map(stat =>
    `<div><strong>${stat.stage}:</strong> P1 ${stat.winOdds.p1}%, P2 ${stat.winOdds.p2}%, Tie ${stat.winOdds.tie}%, Pot $${stat.pot}</div>`
  ).join('');
}

function logRoundSummary() {
  const container = document.getElementById('roundStats');
  if (!container) return;

  const p1Hand = playerHands[0]?.map(formatCard).join(' ') || '--';
  const p2Hand = playerHands[1]?.map(formatCard).join(' ') || '--';
  const community = communityCards?.map(formatCard).join(' ') || '--';
  const pot = gameState.pot || 0;
  const win = roundStats.at(-1)?.winOdds || { p1: '--', p2: '--', tie: '--' };

  const summary = `
    <div style="margin-bottom: 1rem;">
      <strong>Round ${roundHistory.length} Summary</strong><br/>
      Player 1 Hand: ${p1Hand}<br/>
      Player 2 Hand: ${p2Hand}<br/>
      Community Cards: ${community}<br/>
      Final Pot: $${pot}<br/>
      Win Odds: Player 1 - ${win.p1}% | Player 2 - ${win.p2}% | Tie - ${win.tie}%<br/>
    </div>
  `;

  container.innerHTML = summary + container.innerHTML;
}

function logState(msg, animate = false) {
  const logEl = document.getElementById('log');
  if (logEl) logEl.innerHTML = `<strong>${msg}</strong>`;

  renderCards('player1', playerHands[0], animate);
  renderCards('player2', playerHands[1], animate);
  renderCards('community', communityCards, animate);

  updateChipsUI();
  updateScoreboardUI();
  updatePotUI();
  updateDeckStats();
  updateDeckGrid();
  addToLogDetails(`[${gameState.stage}] ${msg}`);
}

function renderCards(containerId, cards, animateNew = true) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const existing = Array.from(el.children).map(img => img.alt);
  el.innerHTML = '';
  cards.forEach(card => {
    const img = document.createElement('img');
    img.src = `images/cards/${cardToFilename(card)}`;
    img.alt = `${card.value}${card.suit}`;
    img.classList.add('card-img');
    if (animateNew && !existing.includes(img.alt)) {
      img.classList.add('flip');
    }
    el.appendChild(img);
  });
}

function addToLogDetails(text) {
  const logDiv = document.getElementById('logDetails');
  if (!logDiv) return;
  const p = document.createElement('div');
  p.textContent = text;
  logDiv.appendChild(p);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function formatCard(card) {
  return `${card.value}${card.suit}`;
}

function cardToFilename(card) {
  const suitMap = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
  const valueMap = { 'J': 'jack', 'Q': 'queen', 'K': 'king', 'A': 'ace' };
  const value = valueMap[card.value] || card.value;
  const suit = suitMap[card.suit];
  return `${value}_of_${suit}.png`;
}
function updateDeckStats() {
  const remainingEl = document.getElementById('deckRemaining');
  const usedEl = document.getElementById('usedCards');
  if (!remainingEl || !usedEl) return;

  const used = [...playerHands[0], ...playerHands[1], ...communityCards];
  const usedSet = new Set(used.map(c => c.value + c.suit));
  const remaining = deck.filter(card => !usedSet.has(card.value + card.suit));

  remainingEl.textContent = remaining.map(formatCard).join(' ');
  usedEl.textContent = used.map(formatCard).join(' ');
}

function updateDeckGrid() {
  const grid = document.getElementById('deckGrid');
  if (!grid) return;

  const used = [...playerHands[0], ...playerHands[1], ...communityCards];
  const usedKeys = new Set(used.map(c => c.value + c.suit));

  // Full deck (unshuffled order)
  const fullDeck = suits.flatMap(suit => values.map(value => ({ value, suit })));

  grid.innerHTML = '';
  fullDeck.forEach(card => {
    const key = card.value + card.suit;
    const div = document.createElement('div');
    div.className = 'card-preview';
    if (usedKeys.has(key)) div.classList.add('used');
    div.textContent = `${card.value}${card.suit}`;
    grid.appendChild(div);
  });
}

function renderOddsByCard(oddsList, append = false) {
  const grid = document.getElementById('oddsGrid');
  if (!grid) return;
  if (!append) grid.innerHTML = '';

  oddsList.forEach(item => {
    const div = document.createElement('div');
    div.className = 'card-preview card-odds';
    div.innerHTML = `
      <strong>${item.card.value}${item.card.suit}</strong>
      <span>P1: ${item.p1}%</span>
      <span>P2: ${item.p2}%</span>
      <span>Tie: ${item.tie}%</span>
    `;
    grid.appendChild(div);
  });
}


/* -------------------- INIT -------------------- */
resetRound();
updateChipsUI(); updateScoreboardUI(); updateTurnDisplay();


