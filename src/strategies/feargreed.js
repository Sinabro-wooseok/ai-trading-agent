// Fear & Greed Index 전략 (강화판)
// 연구 기반: 지수 15 미만 → 역사적으로 멀티월 랠리 선행 (2018년 이후 예외 없음)
// 지수 <= 15 → STRONG_BUY (포지션 2배)
// 지수 <= 25 → BUY
// 지수 >= 75 → SELL
// 지수 >= 85 → STRONG_SELL (포지션 2배)

const https = require('https');

let cachedIndex = null;
let lastFetchTime = 0;
const CACHE_TTL = 3600 * 1000;

function fetchFearGreedIndex() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (cachedIndex && now - lastFetchTime < CACHE_TTL) {
      resolve(cachedIndex);
      return;
    }

    const req = https.get('https://api.alternative.me/fng/?limit=1', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const value = parseInt(json.data[0].value);
          const label = json.data[0].value_classification;
          cachedIndex = { value, label };
          lastFetchTime = now;
          resolve(cachedIndex);
        } catch {
          resolve(cachedIndex || { value: 50, label: 'Neutral' });
        }
      });
    });
    req.on('error', () => resolve(cachedIndex || { value: 50, label: 'Neutral' }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(cachedIndex || { value: 50, label: 'Neutral' });
    });
  });
}

async function getFearGreedSignal() {
  const { value, label } = await fetchFearGreedIndex();

  // 강화된 임계값 + 포지션 승수 반환
  if (value <= 15) return { signal: 'BUY', value, label, multiplier: 2.0, strength: 'STRONG' };
  if (value <= 25) return { signal: 'BUY', value, label, multiplier: 1.5, strength: 'NORMAL' };
  if (value >= 85) return { signal: 'SELL', value, label, multiplier: 2.0, strength: 'STRONG' };
  if (value >= 75) return { signal: 'SELL', value, label, multiplier: 1.5, strength: 'NORMAL' };
  return { signal: 'HOLD', value, label, multiplier: 1.0, strength: 'NEUTRAL' };
}

module.exports = { getFearGreedSignal, fetchFearGreedIndex };
