// 레벨 3: 파라미터 자동 튜닝
// 최근 거래 성과 기반으로 전략 파라미터를 자동 조정
// - 투표 임계값: 승률 낮으면 강화, 높으면 완화
// - 손절 비율: ATR 변동성에 따라 자동 조정
// - 포지션 비율: 연속 손실 시 자동 축소

const fs = require('fs');
const path = require('path');

const PARAMS_FILE = path.join(__dirname, '../../data/params.json');
const WINDOW = 20; // 최근 N회 거래 분석

const DEFAULTS = {
  voteThreshold: 3,         // 7표 중 몇 표 필요 (3~5)
  stopLossPct: 0.03,        // 손절 % (0.02~0.05)
  positionRiskPct: 0.01,    // ATR 포지션 리스크 % (0.005~0.02)
  cooldownMs: 5 * 60 * 1000,
  lastTuned: null,
  history: [],              // 최근 조정 이력
};

function loadParams() {
  if (fs.existsSync(PARAMS_FILE)) {
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf8')) }; } catch {}
  }
  return { ...DEFAULTS };
}

function saveParams(params) {
  fs.writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));
}

// 최근 N회 거래의 승률과 연속 손실 수 계산
function analyzeRecentTrades(trades) {
  const recent = trades.slice(0, WINDOW);
  if (recent.length < 5) return null;

  // SELL 거래만 평가 (BUY-SELL 페어)
  const buys = trades.filter(t => t.side === 'BUY');
  const sells = trades.filter(t => t.side === 'SELL');

  let wins = 0, losses = 0, consecutiveLosses = 0, maxConsec = 0;

  sells.slice(0, WINDOW).forEach(sell => {
    const prevBuy = buys.find(b => new Date(b.timestamp) < new Date(sell.timestamp));
    if (!prevBuy) return;
    const pnl = (sell.price - prevBuy.price) / prevBuy.price * 100;
    if (pnl > 0) {
      wins++;
      consecutiveLosses = 0;
    } else {
      losses++;
      consecutiveLosses++;
      maxConsec = Math.max(maxConsec, consecutiveLosses);
    }
  });

  const total = wins + losses;
  return { winRate: total > 0 ? wins / total : 0, wins, losses, maxConsec, total };
}

// 파라미터 자동 조정
function tune(trades, currentATR) {
  const params = loadParams();
  const analysis = analyzeRecentTrades(trades);
  if (!analysis || analysis.total < 5) return params;

  const changes = [];
  const { winRate, maxConsec } = analysis;

  // 투표 임계값 조정
  const oldThreshold = params.voteThreshold;
  if (winRate < 0.35) {
    params.voteThreshold = Math.min(5, params.voteThreshold + 1);
  } else if (winRate > 0.65 && params.voteThreshold > 3) {
    params.voteThreshold = Math.max(3, params.voteThreshold - 1);
  }
  if (params.voteThreshold !== oldThreshold) {
    changes.push(`임계값 ${oldThreshold}→${params.voteThreshold}`);
  }

  // 연속 손실 3회 이상 → 포지션 리스크 축소
  const oldRisk = params.positionRiskPct;
  if (maxConsec >= 3) {
    params.positionRiskPct = Math.max(0.005, params.positionRiskPct * 0.8);
  } else if (winRate > 0.6) {
    params.positionRiskPct = Math.min(0.02, params.positionRiskPct * 1.1);
  }
  if (Math.abs(params.positionRiskPct - oldRisk) > 0.0001) {
    changes.push(`리스크 ${(oldRisk*100).toFixed(2)}%→${(params.positionRiskPct*100).toFixed(2)}%`);
  }

  // ATR 기반 손절 비율 조정
  if (currentATR) {
    const oldSL = params.stopLossPct;
    // ATR이 가격 대비 크면 손절폭 넓게, 작으면 좁게
    const atrPct = currentATR / 67000; // 대략적인 BTC 가격 기준
    const targetSL = Math.min(0.05, Math.max(0.015, atrPct * 1.5));
    params.stopLossPct = parseFloat(((params.stopLossPct * 0.7 + targetSL * 0.3)).toFixed(4));
    if (Math.abs(params.stopLossPct - oldSL) > 0.001) {
      changes.push(`손절 ${(oldSL*100).toFixed(1)}%→${(params.stopLossPct*100).toFixed(1)}%`);
    }
  }

  params.lastTuned = new Date().toISOString();
  if (changes.length) {
    params.history = [
      { time: params.lastTuned, changes, winRate: (winRate * 100).toFixed(1) },
      ...(params.history || []).slice(0, 19),
    ];
    console.log(`[자동 튜닝] 승률:${(winRate*100).toFixed(1)}% | ${changes.join(', ')}`);
  }

  saveParams(params);
  return params;
}

function getParams() {
  return loadParams();
}

module.exports = { getParams, tune };
